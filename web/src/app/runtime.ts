import { ReaderApi, type SessionStore } from '../api/client.ts';
import { ApiError } from '../api/errors.ts';
import type { Book, Session } from '../api/types.ts';
import { createWebPlatform } from '../core/web-platform.ts';
import { androidPageHost, androidSpeechBridge, createAndroidPlatform, detectAndroidBridge } from '../core/android-platform.ts';
import { SyncEngine } from '../core/sync.ts';
import { OfflineDownloads } from '../core/offline-downloads.ts';
import { OfflineStore } from '../store/offline.ts';
import { SettingsStore, type AppSettings } from '../store/settings.ts';
import { publicationScope } from '../store/publications.ts';
import { MediaApi } from '../features/media/api/media-api.ts';
import { MediaPlayer } from '../features/media/services/player.ts';
import { createAppQueryClient } from '../shared/query/query-client.ts';
import { useAuthStore } from '../shared/stores/auth.store.ts';
import { useSettingsStore } from '../shared/stores/settings.store.ts';
import { useSyncStore } from '../shared/stores/sync.store.ts';
import { PlaybackService } from '../features/media/services/PlaybackService.ts';
import { migrateAppearance } from '../shared/theme/theme.ts';
import { withOfflineTimeout } from '../core/offline-timeout.ts';
import { mediaEnabled } from '../shared/stores/features.ts';

export function validServerUrl(value?: string): string {
  if (!value?.trim()) return '';
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && url.hostname !== 'appassets.androidplatform.net' ? value.trim() : '';
  } catch { return ''; }
}
export function inferDefaultUrl(): string {
  if (typeof location === 'undefined' || location.protocol === 'file:') return '';
  if (location.hostname === 'appassets.androidplatform.net') {
    try { return validServerUrl(window.ReaderAndroid?.configuredServerUrl?.()); } catch { return ''; }
  }
  return location.origin;
}

/** Resources shared across routes. This module neither renders nor chooses pages. */
export async function createAppRuntime(defaultServerUrl = '') {
  let api: ReaderApi;
  const bridge = detectAndroidBridge();
  const baseUrl = () => api?.baseUrl ?? defaultServerUrl;
  const platform = await (bridge ? createAndroidPlatform(baseUrl, bridge) : createWebPlatform(baseUrl));
  const sessions: SessionStore = {
    async load() {
      try {
        const value = JSON.parse(await platform.kv.get('reader.session.v1') ?? 'null') as Session | null;
        return value?.accessToken && value.refreshToken ? value : null;
      } catch { return null; }
    },
    save: session => platform.kv.set('reader.session.v1', JSON.stringify(session)),
    clear: () => platform.kv.remove('reader.session.v1'),
  };
  api = new ReaderApi(platform, sessions);
  const mediaApi = new MediaApi(api);
  let player:MediaPlayer|undefined;
  let playback:PlaybackService|undefined;
  const getPlayer=()=>player??=new MediaPlayer(mediaApi);
  const getPlayback=()=>playback??=new PlaybackService(getPlayer(),mediaApi);
  const settings = new SettingsStore(platform.kv);
  const offline = new OfflineStore(platform.kv);
  const sync = new SyncEngine(api, offline, platform);
  const downloads = new OfflineDownloads(api, platform);
  const queryClient = createAppQueryClient();
  const loadedSettings = await settings.load();
  useSettingsStore.getState().replace(loadedSettings);
  api.setBaseUrl(validServerUrl(await settings.serverUrl()) || validServerUrl(defaultServerUrl) || inferDefaultUrl());
  const restored = await api.restore();
  if (restored) migrateAppearance(mediaApi.preferenceScope(), loadedSettings);
  useAuthStore.getState().setSession(restored);
  if (restored) {
    await offline.setScope(publicationScope(api.baseUrl, restored.user.id), { claimLegacy: true });
  }
  let currentBook: Book | null = null;
  let readerFlush: (() => Promise<void>) | null = null;
  let capabilityRevision=0;
  let mediaAllowed=mediaEnabled(useAuthStore.getState().verifiedUser??useAuthStore.getState().session?.user);
  let refreshing:{scope:string;promise:Promise<void>}|undefined;
  function refreshCapabilities():Promise<void>{
    const scope=JSON.stringify([api.baseUrl,api.currentSession()?.user.id]);
    if(refreshing?.scope===scope)return refreshing.promise;
    const promise=readCapabilities().finally(()=>{if(refreshing?.promise===promise)refreshing=undefined;});
    refreshing={scope,promise};
    return promise;
  }
  let capabilityRequest: AbortController | null = null;
  async function readCapabilities() {
    const session = api.currentSession(), server = api.baseUrl;
    if (!session) return;
    const revision = ++capabilityRevision;
    const validation = new AbortController();
    capabilityRequest = validation;
    const current = () => !validation.signal.aborted && revision === capabilityRevision
      && api.baseUrl === server && api.currentSession()?.user.id === session.user.id
      && useAuthStore.getState().session?.user.id === session.user.id;
    try {
      if (await platform.connectivity() === 'offline' || !current()) return;
      const user = await withOfflineTimeout(api.me({ signal: validation.signal }), true);
      if (!current()) return;
      if (user.id !== session.user.id) { await api.discardSession(); return; }
      useAuthStore.getState().verify(user);
      if (!mediaEnabled(user)) {
        playback?.stop();
        if (mediaAllowed) await player?.stop().catch(() => undefined);
        const predicate = (query: { queryKey: readonly unknown[] }) => query.queryKey.includes('media');
        await queryClient.cancelQueries({ predicate });
        queryClient.removeQueries({ predicate });
      }
      mediaAllowed = mediaEnabled(user);
    } catch (error) {
      if (current() && (!(error instanceof ApiError) || !['offline', 'server', 'aborted'].includes(error.kind))) await api.discardSession();
      throw error;
    } finally {
      validation.abort();
      if (capabilityRequest === validation) capabilityRequest = null;
    }
  }
  return {
    api, mediaApi, get player(){return getPlayer();}, get playback(){return getPlayback();}, settings, offline, sync, downloads, queryClient, platform,
    refreshCapabilities,
    pageHost: bridge ? androidPageHost(bridge) : null,
    speechBridge: bridge ? androidSpeechBridge(bridge) : null,
    async authenticated() {
      const session = api.currentSession();
      if (!session) { useAuthStore.getState().setSession(null); return; }
      await offline.setScope(publicationScope(api.baseUrl, session.user.id));
      migrateAppearance(mediaApi.preferenceScope(), await settings.load());
      queryClient.clear();
      useAuthStore.getState().setSession({ ...session, user: { ...session.user, features: { media: false } } });
      await refreshCapabilities();
      sync.start();
      if(mediaEnabled(useAuthStore.getState().verifiedUser))getPlayer().reconnectNative();
    },
    async updateSettings(patch: Partial<AppSettings>) {
      useSettingsStore.getState().replace(await settings.update(patch));
    },
    registerReader(book: Book, flush: () => Promise<void>) {
      currentBook = book; readerFlush = flush;
      return () => { if (readerFlush === flush) { currentBook = null; readerFlush = null; } };
    },
    currentBook: () => currentBook,
    syncStatus: () => sync.status(),
    settingsSnapshot: () => settings.load(),
    async saveBeforeUpdate() {
      await readerFlush?.(); await offline.flush(); await player?.flush();
    },
    async flush() {
      await Promise.allSettled([player?.flush(), (async () => { await readerFlush?.(); await offline.flush(); await sync.flush(); })()]);
    },
    connect() {
      let scope = JSON.stringify([api.baseUrl, api.currentSession()?.user.id]);
      const stopSession = api.onSessionChange(session => {
        refreshing = undefined;
        const nextScope = JSON.stringify([api.baseUrl, session?.user.id]);
        const verified = scope === nextScope ? useAuthStore.getState().verifiedUser : null;
        if (scope !== nextScope) {
          capabilityRevision++; capabilityRequest?.abort();
          mediaAllowed = false; playback?.stop();
          void player?.stop().catch(() => undefined);
          void downloads.clear();
        }
        scope = nextScope;
        // authenticated() loads the new account's scope before it becomes visible.
        if (!session || session.user.id === useAuthStore.getState().session?.user.id) {
          useAuthStore.getState().setSession(session);
          if (verified) useAuthStore.getState().verify(verified);
        }
        queryClient.clear();
        if (!session) sync.stop();
      });
      const refresh = () => { void refreshCapabilities().catch(() => undefined); };
      const timer = setInterval(refresh, 15000);
      window.addEventListener('focus', refresh);
      window.addEventListener('online', refresh);
      const stopSync = sync.onStatus(useSyncStore.getState().update);
      useSyncStore.getState().update(sync.status());
      if (api.currentSession()) {
        sync.start();
        if (!useAuthStore.getState().verifiedUser) refresh();
      }
      return () => {
        capabilityRevision++; capabilityRequest?.abort();
        clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
        stopSession(); stopSync(); sync.stop(); void downloads.clear();
      };
    },
  };
}
export type AppRuntime = Awaited<ReturnType<typeof createAppRuntime>>;
