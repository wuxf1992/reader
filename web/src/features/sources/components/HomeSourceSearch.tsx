import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../../../api/errors.ts';
import type { ExtensionForm, ExtensionPage, SourceEntry, SourceInstance, SourcePage } from '../../../api/sources.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { newId } from '../../../core/id.ts';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { useMediaEnabled } from '../../../shared/stores/features.ts';
import { Icon } from '../../../ui/icon.tsx';
import { LazyCover } from '../../../ui/lazy-cover.tsx';
import { notify } from '../../../ui/notifications.ts';
import { groupSourceResults, mergePages, sourceChapterLabel } from '../../../ui/source-results.ts';
import type { MediaChannel } from '../../media/api/media-api.ts';
import {
  BRIDGE_CHANNEL_LABELS,
  classifySources,
  extractExtensionSearchView,
  sourceManageLink,
  sourceSearchLink,
  sourcesForBookShelf,
  sourcesForMediaScope,
  type BridgeSource,
} from '../source-search-bridge.ts';
import { SourceVideo } from './SourceVideo.tsx';
import '../styles/source-search-bridge.css';

const COMPACT_LIMIT = 8;

const sourceCoverUrl = (sourceId: string, entry: SourceEntry) =>
  entry.coverRef
    ? `/api/v1/sources/${encodeURIComponent(sourceId)}/cover?entryRef=${encodeURIComponent(entry.ref)}&coverRef=${encodeURIComponent(entry.coverRef)}`
    : null;

export function useBridgeSources(): BridgeSource[] {
  const runtime = useRuntime();
  const api = runtime?.api;
  const canQuery = typeof api?.sources === 'function';
  const admin = useAuthStore((state) => state.verifiedUser?.role === 'admin');
  const mediaEnabled = useMediaEnabled();
  const query = useQuery<SourceInstance[]>({
    queryKey: ['sources', api?.baseUrl ?? ''],
    queryFn: () => api.sources(),
    enabled: canQuery,
    staleTime: 60_000,
    retry: false,
  });
  return useMemo(() => classifySources(query.data, { admin, mediaEnabled }), [query.data, admin, mediaEnabled]);
}

function CatalogSourcePanel({
  item,
  query,
  triggerKey,
}: {
  item: BridgeSource;
  query: string;
  triggerKey: number;
}) {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const hasFilters = Boolean(item.source.descriptor?.capabilities.includes('search.filters'));
  const filtersQuery = useQuery({
    queryKey: ['source-filters', runtime.api.baseUrl, item.source.id],
    queryFn: () => runtime.api.sourceFilters(item.source.id),
    enabled: hasFilters && typeof runtime.api?.sourceFilters === 'function',
    staleTime: 300_000,
    retry: false,
  });
  const siteField = filtersQuery.data?.find((field) => field.key === 'site' && field.type === 'select');
  const poolOptions = siteField?.options?.length
    ? siteField.options
    : hasFilters
      ? [
          { value: item.channel === 'comic' ? '' : 'all', label: '主力源' },
          { value: 'backup', label: '备用源' },
        ]
      : [];
  const defaultPool = siteField?.value !== undefined ? String(siteField.value) : (poolOptions[0]?.value ?? '');
  const [selectedPool, setSelectedPool] = useState<string | null>(null);
  const pool = selectedPool ?? defaultPool;
  useEffect(() => {
    setSelectedPool(null);
  }, [item.source.id]);

  const [page, setPage] = useState<SourcePage>();
  const [status, setStatus] = useState<'idle' | 'searching' | 'stopped' | 'complete' | 'error'>('idle');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [acquiredMap, setAcquiredMap] = useState<Record<string, string>>({});
  const runRef = useRef<AbortController | null>(null);
  const lastSearchedRef = useRef('');

  const stop = useCallback(() => {
    runRef.current?.abort();
    runRef.current = null;
    setStatus((current) => (current === 'searching' ? 'stopped' : current));
  }, []);

  const runSearch = useCallback(
    async (targetQuery: string, targetPool: string) => {
      const trimmed = targetQuery.trim();
      if (!trimmed || typeof runtime.api?.searchSource !== 'function') return;
      runRef.current?.abort();
      const controller = new AbortController();
      runRef.current = controller;
      lastSearchedRef.current = trimmed;
      setPage(undefined);
      setError('');
      setExpanded(false);
      setStatus('searching');
      const filters = hasFilters && targetPool ? { site: targetPool } : {};
      try {
        for await (const next of runtime.api.searchSource(
          item.source.id,
          { query: trimmed, filters, sessionId: newId(), resultLimit: 120 },
          { signal: controller.signal },
        )) {
          if (runRef.current !== controller) return;
          setPage((previous) => mergePages(previous, next));
          if (next.limitReached) break;
        }
        if (runRef.current === controller) {
          setStatus('complete');
        }
      } catch (reason) {
        if (runRef.current === controller) {
          setError(describeError(reason));
          setStatus('error');
        }
      } finally {
        if (runRef.current === controller) runRef.current = null;
      }
    },
    [hasFilters, item.source.id, runtime.api],
  );

  useEffect(() => {
    if (triggerKey > 0 && query.trim()) {
      void runSearch(query, pool);
    }
    return () => {
      runRef.current?.abort();
      runRef.current = null;
    };
  }, [item.source.id, triggerKey, selectedPool]); // eslint-disable-line react-hooks/exhaustive-deps

  const acquire = useMutation({
    mutationFn: ({ ref }: { ref: string }) => runtime.api.acquireSource(item.source.id, ref),
    onError: (reason) => notify(describeError(reason), { kind: 'error' }),
  });

  const groups = useMemo(() => groupSourceResults(page?.items ?? [], true), [page?.items]);
  const visibleGroups = expanded ? groups : groups.slice(0, COMPACT_LIMIT);
  const queryChanged = status !== 'idle' && lastSearchedRef.current !== query.trim();

  return (
    <div className="source-bridge-panel" aria-busy={status === 'searching'}>
      <div className="source-bridge-bar">
        <div className="source-bridge-bar-left">
          {poolOptions.length > 1 && (
            <div className="source-bridge-pools" role="group" aria-label={`${item.label}搜索范围`}>
              {poolOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="source-bridge-pool"
                  aria-pressed={pool === option.value}
                  disabled={status === 'searching'}
                  onClick={() => setSelectedPool(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {status === 'searching' ? (
            <button type="button" className="source-bridge-action" onClick={stop}>
              停止搜索
            </button>
          ) : (
            <button
              type="button"
              className="source-bridge-action is-primary"
              onClick={() => void runSearch(query, pool)}
            >
              <Icon name="search" size={14} />
              {queryChanged ? `搜索「${query}」` : status === 'idle' ? `搜索${item.label}` : '重新搜索'}
            </button>
          )}
        </div>
        <div className="source-bridge-bar-right">
          <Link className="source-bridge-link" to={sourceSearchLink(item, query)}>
            在书源页查看全部
            <Icon name="chevron-right" size={16} />
          </Link>
        </div>
      </div>

      {status !== 'idle' && (
        <p className={status === 'error' ? 'source-bridge-status is-error' : 'source-bridge-status'} role="status">
          {status === 'searching'
            ? `正在搜索${item.label}`
            : status === 'stopped'
              ? '已停止搜索'
              : status === 'error'
                ? `搜索失败：${error}`
                : '搜索完成'}
          {page?.batch ? ` · 已检查 ${page.batch.completed} / ${page.batch.total} 个来源` : ''}
          {groups.length > 0 ? ` · 已找到 ${groups.length} 项` : ''}
        </p>
      )}

      {status === 'complete' && groups.length === 0 && (
        <p className="source-bridge-status">
          在{item.label}的当前来源里没有找到「{lastSearchedRef.current}」，可切换备用源或前往书源页尝试。
        </p>
      )}

      {visibleGroups.length > 0 && (
        <div className="source-bridge-list">
          {visibleGroups.map((group) => {
            const entry = group.entry;
            const shelfId = acquiredMap[entry.ref] ?? entry.shelfBookId ?? entry.metadata?.publicationId;
            const chapterLabel = sourceChapterLabel(entry);
            const metaParts = [
              entry.authors?.join(' / ') || (item.channel === 'comic' ? '' : '作者未知'),
              chapterLabel,
              group.entries.length > 1 ? `${group.entries.length} 个来源` : entry.sourceName,
            ].filter(Boolean);
            return (
              <article className="source-bridge-row" key={group.key}>
                <div className="source-bridge-row-main">
                  <LazyCover
                    url={sourceCoverUrl(item.source.id, group.entries.find((candidate) => candidate.coverRef) ?? entry)}
                    title={entry.title}
                  />
                  <div className="source-bridge-row-copy">
                    <strong title={entry.title}>{entry.title}</strong>
                    {metaParts.length > 0 && <small title={metaParts.join(' · ')}>{metaParts.join(' · ')}</small>}
                  </div>
                </div>
                {shelfId ? (
                  <Link className="source-bridge-action is-primary" to={`/book/${encodeURIComponent(shelfId)}`}>
                    开始阅读
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="source-bridge-action"
                    disabled={acquire.isPending}
                    onClick={() =>
                      acquire.mutate(
                        { ref: entry.ref },
                        {
                          onSuccess: (result) => {
                            if (result.kind === 'action-required') {
                              notify(result.action?.label ?? '请先完成授权', { kind: 'error' });
                            } else if (result.publicationId) {
                              setAcquiredMap((previous) => ({ ...previous, [entry.ref]: result.publicationId! }));
                              void queryClient.invalidateQueries({ queryKey: ['shelf'] });
                              void queryClient.invalidateQueries({ queryKey: ['search', 'books'] });
                              notify(`《${entry.title}》已加入书架`, { kind: 'success' });
                            }
                          },
                        },
                      )
                    }
                  >
                    加入书架
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {groups.length > COMPACT_LIMIT && !expanded && (
        <div className="source-bridge-pager">
          <button type="button" className="source-bridge-action" onClick={() => setExpanded(true)}>
            展开更多（共 {groups.length} 项）
          </button>
        </div>
      )}
    </div>
  );
}

function SourceAudio({
  playback,
  baseUrl,
}: {
  playback: NonNullable<ExtensionPage['playback']>;
  baseUrl: string;
}) {
  const validPath = /^\/api\/v1\/sources\/playback\/[\w-]{24}\/[\w-]{24}$/.test(playback.path);
  const url = validPath ? baseUrl + playback.path : '';
  if (!url) return null;
  return (
    <section className="source-bridge-panel" aria-label={playback.title}>
      <strong>{playback.title}</strong>
      <audio className="source-bridge-audio" src={url} controls autoPlay />
    </section>
  );
}

function ExtensionMediaPanel({
  item,
  query,
  autoSearch,
  triggerKey,
}: {
  item: BridgeSource;
  query: string;
  autoSearch: boolean;
  triggerKey: number;
}) {
  const runtime = useRuntime();
  const [pool, setPool] = useState('');
  const [searchPage, setSearchPage] = useState<ExtensionPage | null>(null);
  const [episodesPage, setEpisodesPage] = useState<ExtensionPage | null>(null);
  const [playback, setPlayback] = useState<ExtensionPage['playback']>();
  const [activeEpisodeKey, setActiveEpisodeKey] = useState('');
  const [busy, setBusy] = useState<'idle' | 'search' | 'episodes' | 'play'>('idle');
  const [error, setError] = useState('');
  const seqRef = useRef(0);
  const lastQueryRef = useRef('');

  const pageId = item.pageId!;

  const runSearch = useCallback(
    async (targetQuery: string, targetPool: string) => {
      const trimmed = targetQuery.trim();
      if (!trimmed || typeof runtime.api?.sourcePage !== 'function') return;
      const seq = ++seqRef.current;
      lastQueryRef.current = trimmed;
      setBusy('search');
      setError('');
      setEpisodesPage(null);
      setActiveEpisodeKey('');
      try {
        const next = await runtime.api.sourcePage(item.source.id, pageId, 'search', {
          query: trimmed,
          site: targetPool,
        });
        if (seqRef.current !== seq) return;
        setSearchPage(next);
      } catch (reason) {
        if (seqRef.current !== seq) return;
        setError(describeError(reason));
      } finally {
        if (seqRef.current === seq) setBusy('idle');
      }
    },
    [item.source.id, pageId, runtime.api],
  );

  const runFormAction = useCallback(
    async (form: ExtensionForm, mode: 'episodes' | 'play', episodeKey?: string) => {
      if (typeof runtime.api?.sourcePage !== 'function') return;
      const seq = ++seqRef.current;
      setBusy(mode);
      setError('');
      try {
        const next = await runtime.api.sourcePage(item.source.id, pageId, form.id, form.values ?? {});
        if (seqRef.current !== seq) return;
        setEpisodesPage(next);
        if (next.playback) {
          setPlayback(next.playback);
          if (episodeKey) setActiveEpisodeKey(episodeKey);
        }
      } catch (reason) {
        if (seqRef.current !== seq) return;
        setError(describeError(reason));
      } finally {
        if (seqRef.current === seq) setBusy('idle');
      }
    },
    [item.source.id, pageId, runtime.api],
  );

  useEffect(() => {
    seqRef.current += 1;
    setSearchPage(null);
    setEpisodesPage(null);
    setPlayback(undefined);
    setActiveEpisodeKey('');
    setError('');
    setBusy('idle');
    if (autoSearch && query.trim()) {
      void runSearch(query, pool);
    }
    return () => {
      seqRef.current += 1;
    };
  }, [item.source.id, autoSearch, autoSearch ? query : '', autoSearch ? pool : '']); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoSearch && triggerKey > 0 && query.trim()) {
      void runSearch(query, pool);
    }
  }, [autoSearch, item.source.id, triggerKey, pool]); // eslint-disable-line react-hooks/exhaustive-deps

  const activePage = episodesPage ?? searchPage;
  const view = activePage ? extractExtensionSearchView(activePage, pool) : null;
  const poolOptions = view?.poolOptions ?? [
    { value: '', label: '主力源' },
    { value: 'backup', label: '备用源' },
  ];
  const queryChanged = !autoSearch && searchPage !== null && lastQueryRef.current !== query.trim();

  return (
    <div className="source-bridge-panel" aria-busy={busy !== 'idle'}>
      <div className="source-bridge-bar">
        <div className="source-bridge-bar-left">
          <div className="source-bridge-pools" role="group" aria-label={`${item.label}来源池`}>
            {poolOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="source-bridge-pool"
                aria-pressed={pool === option.value}
                disabled={busy !== 'idle'}
                onClick={() => setPool(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="source-bridge-action is-primary"
            disabled={busy !== 'idle' || !query.trim()}
            onClick={() => void runSearch(query, pool)}
          >
            <Icon name="search" size={14} />
            {busy === 'search'
              ? '正在搜索…'
              : queryChanged
                ? `搜索「${query}」`
                : searchPage
                  ? '重新搜索'
                  : `搜索${item.label}`}
          </button>
        </div>
        <div className="source-bridge-bar-right">
          <Link className="source-bridge-link" to={sourceSearchLink(item, query, pool)}>
            完整插件页
            <Icon name="chevron-right" size={16} />
          </Link>
        </div>
      </div>

      {playback &&
        (item.channel === 'audiobook' ? (
          <SourceAudio key={playback.path} playback={playback} baseUrl={runtime.api.baseUrl} />
        ) : (
          <SourceVideo key={playback.path} playback={playback} baseUrl={runtime.api.baseUrl} />
        ))}

      {busy !== 'idle' && (
        <p className="source-bridge-status" role="status">
          {busy === 'search'
            ? `正在搜索${item.label}…`
            : busy === 'episodes'
              ? '正在读取剧集目录…'
              : '正在解析播放地址…'}
        </p>
      )}

      {error && (
        <p className="source-bridge-status is-error" role="alert">
          {error}
        </p>
      )}

      {view?.notice && !error && (
        <p className={view.noticeKind === 'error' ? 'source-bridge-status is-error' : 'source-bridge-status'} role="status">
          {view.notice}
        </p>
      )}

      {view?.isEpisodesView ? (
        <>
          <div className="source-bridge-episodes-head">
            <h3>{view.sectionTitle || '剧集列表'}</h3>
            {searchPage && (
              <button
                type="button"
                className="source-bridge-action"
                disabled={busy !== 'idle'}
                onClick={() => setEpisodesPage(null)}
              >
                返回搜索结果
              </button>
            )}
          </div>
          {view.items.length === 0 ? (
            <p className="source-bridge-status">{view.emptyText || '暂无可播放剧集。'}</p>
          ) : (
            <div className="source-bridge-episodes">
              {view.items.map((episode, index) => {
                const episodeKey = `${episode.title}:${String(episode.primaryForm?.values?.episode ?? index)}`;
                return (
                  <button
                    key={episodeKey}
                    type="button"
                    className="source-bridge-episode"
                    aria-current={activeEpisodeKey === episodeKey ? 'true' : undefined}
                    disabled={busy !== 'idle' || !episode.primaryForm}
                    title={episode.title}
                    onClick={() => {
                      if (episode.primaryForm) void runFormAction(episode.primaryForm, 'play', episodeKey);
                    }}
                  >
                    {episode.title}
                  </button>
                );
              })}
            </div>
          )}
          {view.paginationForms.length > 0 && (
            <div className="source-bridge-pager">
              {view.paginationForms.map((form) => (
                <button
                  key={`${form.id}:${form.submit}:${String(form.values?.page ?? '')}`}
                  type="button"
                  className="source-bridge-action"
                  disabled={busy !== 'idle'}
                  onClick={() => void runFormAction(form, 'episodes')}
                >
                  {form.submit}
                </button>
              ))}
              {view.paginationLabel && <span className="source-bridge-status">{view.paginationLabel}</span>}
            </div>
          )}
        </>
      ) : view ? (
        view.items.length === 0 ? (
          <div className="source-bridge-bar">
            <p className="source-bridge-status">
              {view.emptyText || `没有在${item.label}找到「${lastQueryRef.current}」。`}
            </p>
            {view.suggestBackupPool && (
              <button
                type="button"
                className="source-bridge-action"
                disabled={busy !== 'idle'}
                onClick={() => setPool('backup')}
              >
                改用备用源搜索
              </button>
            )}
          </div>
        ) : (
          <div className="source-bridge-list">
            {view.items.map((entry, index) => (
              <article className="source-bridge-row" key={`${entry.title}:${String(entry.primaryForm?.values?.ref ?? index)}`}>
                <div className="source-bridge-row-copy">
                  <strong title={entry.title}>{entry.title}</strong>
                  {entry.description && <small title={entry.description}>{entry.description}</small>}
                </div>
                {entry.primaryForm && (
                  <button
                    type="button"
                    className="source-bridge-action"
                    disabled={busy !== 'idle'}
                    onClick={() => void runFormAction(entry.primaryForm!, 'episodes')}
                  >
                    {entry.primaryForm.submit || '查看剧集'}
                  </button>
                )}
              </article>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

/**
 * Mounted on `/search`: offers click-to-search across all enabled novel, comic, video, and
 * audiobook plugin sources without triggering external scrapers on live-typing debounce.
 */
export function GlobalSourceSearchSection({
  query,
  submitCount,
}: {
  query: string;
  submitCount: number;
}) {
  const sources = useBridgeSources();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [triggerKey, setTriggerKey] = useState(0);
  const lastSubmitRef = useRef(submitCount);

  useEffect(() => {
    if (submitCount !== lastSubmitRef.current) {
      lastSubmitRef.current = submitCount;
      if (activeId && query.trim()) {
        setTriggerKey((value) => value + 1);
      }
    }
  }, [activeId, query, submitCount]);

  if (!query.trim() || sources.length === 0) return null;

  const active = sources.find((item) => item.source.id === activeId) ?? null;

  return (
    <section className="search-page-section source-bridge-section" aria-label="在线书源搜索">
      <header>
        <h2>
          在线书源<small>{sources.length} 个来源可用</small>
        </h2>
        <Link to={`/sources?q=${encodeURIComponent(query)}`}>
          前往书源中心
          <Icon name="chevron-right" size={16} />
        </Link>
      </header>
      <div className="source-bridge-tabs" role="group" aria-label="选择在线书源">
        {sources.map((item) => {
          const selected = active?.source.id === item.source.id;
          return (
            <button
              key={item.source.id}
              type="button"
              className="source-bridge-tab"
              aria-pressed={selected}
              onClick={() => {
                setActiveId(item.source.id);
                setTriggerKey((value) => value + 1);
              }}
            >
              <Icon name="search" size={14} />
              <span>{item.label}</span>
              <span className="source-bridge-kind">{BRIDGE_CHANNEL_LABELS[item.channel]}</span>
            </button>
          );
        })}
      </div>
      {active ? (
        active.mode === 'extension' ? (
          <ExtensionMediaPanel item={active} query={query} autoSearch={false} triggerKey={triggerKey} />
        ) : (
          <CatalogSourcePanel item={active} query={query} triggerKey={triggerKey} />
        )
      ) : (
        <p className="source-bridge-status">点选上方在线书源，立即按「{query}」检索外部资源。</p>
      )}
    </section>
  );
}

/**
 * Mounted on `/media/search`: automatically searches enabled online video/audiobook sources
 * matching the active scope when a query is submitted, with in-place episodes and playback.
 */
export function MediaSourceSearchSection({
  scope,
  query,
}: {
  scope: MediaChannel | 'all';
  query: string;
}) {
  const allSources = useBridgeSources();
  const sources = useMemo(() => sourcesForMediaScope(allSources, scope), [allSources, scope]);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    if (sources.length && !sources.some((item) => item.source.id === selectedId)) {
      setSelectedId(sources[0]!.source.id);
    }
  }, [selectedId, sources]);

  if (sources.length === 0) return null;

  const active = sources.find((item) => item.source.id === selectedId) ?? sources[0]!;
  const trimmed = query.trim();

  if (!trimmed) {
    return (
      <div className="source-bridge-hint" aria-label="在线片源提示">
        <span>
          在线{scope === 'audiobook' ? '有声书' : scope === 'video' ? '视频' : '影音'}源已就绪：
          {sources.map((item) => item.label).join('、')}（提交关键词后同步搜索）
        </span>
        <Link className="source-bridge-link" to={sourceManageLink(active)}>
          管理规则
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
    );
  }

  return (
    <section className="search-page-section source-bridge-section" aria-label="在线影音源结果">
      <header>
        <h2>
          在线{BRIDGE_CHANNEL_LABELS[active.channel]}源
          {sources.length > 1 ? <small>{sources.length} 个来源</small> : null}
        </h2>
        <Link className="source-bridge-link" to={sourceManageLink(active)}>
          管理规则
          <Icon name="chevron-right" size={16} />
        </Link>
      </header>
      {sources.length > 1 && (
        <div className="source-bridge-tabs" role="group" aria-label="切换在线影音源">
          {sources.map((item) => (
            <button
              key={item.source.id}
              type="button"
              className="source-bridge-tab"
              aria-pressed={active.source.id === item.source.id}
              onClick={() => setSelectedId(item.source.id)}
            >
              <span>{item.label}</span>
              <span className="source-bridge-kind">{BRIDGE_CHANNEL_LABELS[item.channel]}</span>
            </button>
          ))}
        </div>
      )}
      {active.mode === 'extension' ? (
        <ExtensionMediaPanel item={active} query={trimmed} autoSearch triggerKey={0} />
      ) : (
        <CatalogSourcePanel item={active} query={trimmed} triggerKey={1} />
      )}
    </section>
  );
}

/**
 * Mounted on `/media/:channel` when the local library is empty so users with plugin video/audiobook
 * sources have an obvious one-tap way to search and play directly from the channel homepage.
 */
export function ChannelSourceEntry({ channel }: { channel: MediaChannel }) {
  const allSources = useBridgeSources();
  const sources = useMemo(() => sourcesForMediaScope(allSources, channel), [allSources, channel]);
  if (sources.length === 0) return null;

  const primary = sources[0]!;
  const label = channel === 'audiobook' ? '有声书' : '视频';

  return (
    <section className="source-bridge-shortcut" aria-label={`在线${label}源入口`}>
      <h3>也可以直接搜索在线{label}源</h3>
      <p>已启用：{sources.map((item) => item.label).join('、')}</p>
      <div className="source-bridge-shortcut-actions">
        <Link className="source-bridge-action is-primary" to={`/media/search?scope=${encodeURIComponent(channel)}`}>
          <Icon name="search" size={14} />
          搜索在线{label}
        </Link>
        <Link className="source-bridge-action" to={sourceManageLink(primary)}>
          管理规则
        </Link>
      </div>
    </section>
  );
}

/**
 * Mounted on `/shelf`: whenever a user filters the shelf by keyword, offers one-click links to
 * search enabled novel/comic sources directly with the same keyword.
 */
export function ShelfSourceSearchStrip({ query }: { query: string }) {
  const allSources = useBridgeSources();
  const sources = useMemo(() => sourcesForBookShelf(allSources), [allSources]);
  const trimmed = query.trim();
  if (!trimmed || sources.length === 0) return null;

  return (
    <div className="source-bridge-shelf-strip" aria-label="在在线书源中搜索">
      <span>没找到？去在线书源搜「{trimmed}」：</span>
      {sources.map((item) => (
        <Link key={item.source.id} className="source-bridge-action" to={sourceSearchLink(item, trimmed)}>
          <Icon name="search" size={14} />
          <span>{item.label}</span>
          <span className="source-bridge-kind">{BRIDGE_CHANNEL_LABELS[item.channel]}</span>
        </Link>
      ))}
    </div>
  );
}
