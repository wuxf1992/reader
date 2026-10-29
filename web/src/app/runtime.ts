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
  const player = new MediaPlayer(mediaApi);
  const playback = new PlaybackService(player, mediaApi);
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
  return {
    api, mediaApi, player, playback, settings, offline, sync, downloads, queryClient, platform,
    pageHost: bridge ? androidPageHost(bridge) : null,
    speechBridge: bridge ? androidSpeechBridge(bridge) : null,
    async authenticated() {
      const session = api.currentSession();
      if (!session) { useAuthStore.getState().setSession(null); return; }
      await offline.setScope(publicationScope(api.baseUrl, session.user.id));
      const user = await api.me();
      migrateAppearance(mediaApi.preferenceScope(), await settings.load());
      useAuthStore.getState().setSession(session);
      useAuthStore.getState().verify(user);
      queryClient.clear();
      sync.start();
      player.reconnectNative();
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
      await readerFlush?.(); await offline.flush(); await player.flush();
    },
    async flush() {
      await Promise.allSettled([player.flush(), (async () => { await readerFlush?.(); await offline.flush(); await sync.flush(); })()]);
    },
    connect() {
      const validation = new AbortController();
      const session = api.currentSession(), server = api.baseUrl;
      const current = () => !validation.signal.aborted && api.baseUrl === server
        && api.currentSession()?.user.id === session?.user.id && useAuthStore.getState().session?.user.id === session?.user.id;
      const stopSession = api.onSessionChange(session => {
        if (!session || session.user.id !== useAuthStore.getState().session?.user.id) { validation.abort(); void downloads.clear(); }
        // Publish a new account only after authenticated() selects its offline scope.
        if (!session || session.user.id === useAuthStore.getState().session?.user.id) useAuthStore.getState().setSession(session);
        queryClient.clear();
        if (!session) { sync.stop(); void player.stop(); }
      });
      const stopSync = sync.onStatus(useSyncStore.getState().update);
      useSyncStore.getState().update(sync.status());
      if (session) {
        sync.start();
        // Render the cached account before verifying it; listeners are attached first.
        if (!useAuthStore.getState().verifiedUser) void (async () => {
          try {
            if (await platform.connectivity() === 'offline' || !current()) return;
            const user = await withOfflineTimeout(api.me({ signal: validation.signal }), true);
            if (!current()) return;
            if (user?.id !== session.user.id) { await api.discardSession(); return; }
            useAuthStore.getState().verify(user);
          } catch (error) {
            if (current() && (!(error instanceof ApiError) || !['offline', 'server', 'aborted'].includes(error.kind))) await api.discardSession();
          } finally { validation.abort(); }
        })().catch(() => undefined);
      }
      return () => { validation.abort(); stopSession(); stopSync(); sync.stop(); void downloads.clear(); };
    },
  };
}
export type AppRuntime = Awaited<ReturnType<typeof createAppRuntime>>;
