import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BookOpen, LibraryBig, MoreHorizontal, Search } from 'lucide-react';
import type { Book, ContinueReadingItem, ReadingState } from '../../../api/types.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import { useSyncStore } from '../../../shared/stores/sync.store.ts';
import { useShelf, useShelfGroups, type ShelfFilters } from '../queries/shelf.queries.ts';
import { SHELF_SORTS, ShelfSettingsSheet } from '../../../ui/shelf-settings.tsx';
import { IconButton, Callout } from '../../../ui/toolkit.tsx';
import { OpdsAccess } from '../../../ui/opds-access.tsx';
import { DialogView, type Dialog } from '../../../ui/dialog.tsx';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { animateShelfPositions, captureShelfPositions, resetShelfMotion, type ShelfSnapshot } from '../shelf-motion.ts';

export function useCover(api: ReturnType<typeof useRuntime>['api'], coverUrl: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!coverUrl) return;
    let live = true;
    let objectUrl: string | undefined;
    void api.coverBytes(coverUrl).then(bytes => {
      if (!live) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
      setSrc(objectUrl);
    }).catch(() => { if (live) setSrc(null); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, coverUrl]);
  return src;
}

export function BookCard({ book, showAuthor, showProgress, onRemove }: { book: Book | ContinueReadingItem; showAuthor: boolean; showProgress: boolean; onRemove?: () => void }) {
  const runtime = useRuntime();
  const src = useCover(runtime.api, book.coverUrl);
  const progress = 'percentage' in book ? book.percentage : runtime.offline?.progressFor(book.id)?.percentage;
  return <div className="book-card" data-shelf-book-id={book.id}>
    <Link className="book-open" aria-label={`${book.title} ${book.author ?? ''}`.trim()} to={`/book/${encodeURIComponent(book.id)}`}>
      <div className="cover">
        {src ? <img src={src} alt="" loading="lazy" /> : <div className="placeholder">{book.title || '无封面'}</div>}
        <span className="format-badge">{book.format?.toUpperCase() === 'CHAPTERS' && onRemove ? '连载' : book.format || '书籍'}</span>
        {showProgress && progress !== undefined && progress > 0 && <div className="cover-progress"><span style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} /></div>}
      </div>
      <div className="title">{book.title || '未命名'}</div>
      {showAuthor && <div className="author">{book.author || '未知作者'}</div>}
    </Link>
    {(('readingState' in book && book.readingState) || onRemove) && <div className="book-meta">
      {'readingState' in book && book.readingState && <span className="book-state" data-state={book.readingState}>{readingLabels[book.readingState]}</span>}
      {onRemove && <button type="button" className="book-more" aria-label={`${book.title} 的操作`} title="书籍操作" onClick={onRemove}><MoreHorizontal size={17} aria-hidden="true" /></button>}
    </div>}
  </div>;
}

const readingLabels: Record<ReadingState, string> = { reading: '在读', want: '想读', finished: '已读' };
const readingStates = ['reading', 'want', 'finished'] as const;
const isReadingState = (value: string | null): value is ReadingState => readingStates.includes(value as ReadingState);
type BookAction = ReadingState | 'clear' | 'remove';

export function ShelfPage() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const settings = useSettingsStore(state => state.settings);
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [sort, setSort] = useState<typeof settings.shelfSort>((params.get('sort') as typeof settings.shelfSort) || settings.shelfSort);
  const [search, setSearch] = useState(params.get('q') || '');
  const [queryText, setQueryText] = useState(params.get('q') || '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [opdsOpen, setOpdsOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Book | ContinueReadingItem | null>(null);
  const [menuTarget, setMenuTarget] = useState<Book | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const motionAnimations = useRef(new Map<string, Animation>());
  const pendingMotion = useRef<{ key: string; before: ShelfSnapshot } | null>(null);
  // 在读 / 想读 / 已读 and one 分组 (a series or a tag), all in the URL like the page and sort.
  const status = isReadingState(params.get('status')) ? params.get('status') as ReadingState : undefined;
  const series = params.get('series') || undefined, tag = series ? undefined : params.get('tag') || undefined;
  const filters: ShelfFilters = { ...(status ? { status } : {}), ...(series ? { series } : {}), ...(tag ? { tag } : {}) };
  const filtered = !!(status || series || tag);
  const groups = useShelfGroups(groupsOpen);
  const query = useShelf(page, sort, queryText, filters);
  const identity = (view: { page: number; sort: string; search: string; status?: ReadingState | undefined; series?: string | undefined; tag?: string | undefined }) => JSON.stringify([
    runtime.api.baseUrl, runtime.api.currentSession()?.user.id, view.page, view.sort, view.search.trim(), view.status ?? '', view.series ?? '', view.tag ?? '',
  ]);
  const currentIdentity = identity({ page, sort, search: queryText, status, series, tag });
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const pending = pendingMotion.current;
    if (!grid) {
      if (pending && (pending.key !== currentIdentity || query.error && !query.isFetching || query.data && !query.isPlaceholderData)) pendingMotion.current = null;
      return;
    }
    if (pending && pending.key !== currentIdentity) {
      pendingMotion.current = null;
      resetShelfMotion(grid, motionAnimations.current);
    } else if (pending && query.error && !query.isFetching) {
      pendingMotion.current = null;
      resetShelfMotion(grid, motionAnimations.current);
    } else if (pending && pending.key === currentIdentity && query.data && !query.isPlaceholderData) {
      pendingMotion.current = null;
      animateShelfPositions(grid, pending.before, motionAnimations.current, matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
  }, [currentIdentity, query.data, query.error, query.isPlaceholderData]);
  useEffect(() => () => {
    for (const animation of motionAnimations.current.values()) animation.cancel();
    motionAnimations.current.clear();
  }, []);
  useEffect(() => useSyncStore.subscribe((state, previous) => {
    if (state.status.lastSyncAt !== previous.status.lastSyncAt) void queryClient.invalidateQueries({ queryKey: ['shelf', runtime.api.baseUrl] });
  }), [queryClient, runtime.api.baseUrl]);
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1;
  const cards = useMemo(() => query.data?.items ?? [], [query.data]);
  useEffect(() => { void runtime.updateSettings({ shelfSort: sort }); }, [runtime, sort]);
  // Every navigation keeps what it does not change; a new filter or query starts at page 1.
  const go = (next: { q?: string; sort?: typeof sort; page?: number; status?: ReadingState | null; series?: string | null; tag?: string | null }, animate = false) => {
    const q = next.q ?? queryText, nextStatus = next.status === undefined ? status : next.status ?? undefined;
    const nextSeries = next.series === undefined ? series : next.series ?? undefined, nextTag = next.tag === undefined ? tag : next.tag ?? undefined;
    const nextPage = next.page ?? 1, nextSort = next.sort ?? sort;
    const targetIdentity = identity({ page: nextPage, sort: nextSort, search: q, status: nextStatus, series: nextSeries, tag: nextSeries ? undefined : nextTag });
    if (targetIdentity !== currentIdentity) {
      const grid = gridRef.current;
      if (animate) {
        const scroller = grid?.closest<HTMLElement>('.shelf') ?? document.querySelector<HTMLElement>('.shelf-screen');
        const before = grid ? captureShelfPositions(grid, motionAnimations.current) : {
          positions: new Map<string, { left: number; top: number; opacity: number }>(),
          scrollLeft: scroller?.scrollLeft ?? 0,
          scrollTop: scroller?.scrollTop ?? 0,
        };
        pendingMotion.current = { key: targetIdentity, before };
      } else {
        pendingMotion.current = null;
        if (grid) {
          resetShelfMotion(grid, motionAnimations.current);
        }
      }
    }
    setParams({ ...(q ? { q } : {}), sort: nextSort, page: String(nextPage), ...(nextStatus ? { status: nextStatus } : {}), ...(nextSeries ? { series: nextSeries } : nextTag ? { tag: nextTag } : {}) });
  };
  const onSort = (value: string) => { const next = value as typeof sort; setSort(next); go({ sort: next }, true); };
  const onSearch = (event: FormEvent) => { event.preventDefault(); setQueryText(search.trim()); go({ q: search.trim() }); };
  const clearSearch = () => { setSearch(''); setQueryText(''); go({ q: '' }); };
  const clearFilters = () => go({ status: null, series: null, tag: null }, true);
  const act = async (book: Book, action: BookAction) => {
    if (action === 'remove') { setRemoveTarget(book); return; }
    setActionError('');
    try {
      const readingState = action === 'clear' ? null : action;
      await runtime.api.setReadingStatus(book.id, readingState);
      await queryClient.invalidateQueries({ queryKey: ['shelf'] });
    } catch (error) { setActionError(error instanceof Error ? error.message : '标记失败，请稍后重试。'); }
  };
  const menuOptions = (book: Book) => [
    ...readingStates.filter(state => state !== book.readingState).map(state => ({ value: state, label: '标记为' + readingLabels[state] })),
    ...(book.readingState ? [{ value: 'clear', label: '清除标记' }] : []),
    { value: 'remove', label: '从书架拿掉' },
  ];
  const groupOptions = [
    { value: '', label: '全部书籍' },
    ...(groups.data?.series ?? []).map(value => ({ value: 'series:' + value, label: '系列 · ' + value })),
    ...(groups.data?.tags ?? []).map(value => ({ value: 'tag:' + value, label: '标签 · ' + value })),
  ];
  const groupLabel = series ? '系列 · ' + series : tag ? '标签 · ' + tag : '';
  const remove = async (book: Book | ContinueReadingItem) => { await runtime.api.browseBatchShelf({ bookIds: [book.id] }, 'remove'); await runtime.offline.removeBooks([book.id]); await queryClient.invalidateQueries({ queryKey: ['shelf'] }); };
  const densityLabel = settings.shelfDensity === 'compact' ? '紧凑' : settings.shelfDensity === 'comfortable' ? '宽松' : '适中';
  return <div id="shelf-scroll" className="shelf shelf-screen">
    <header className="shelf-head">
      <div className="shelf-head-text"><h1 className="shelf-title">书架</h1>
        <nav className="collection-links shelf-links" aria-label="发现书籍">
          <Link className="button collection-link" to="/library"><LibraryBig size={18} /><span>书库</span></Link>
          <Link className="button collection-link" to="/sources"><Search size={18} /><span>书源</span></Link>
        </nav>
      </div>
      <div className="shelf-head-actions">
        <IconButton icon="tune" label={`书架设置 · ${densityLabel}`} onClick={() => setSettingsOpen(true)} />
      </div>
    </header>
    <div className="shelf-discovery">
      <form className="shelf-search" role="search" onSubmit={onSearch}>
        <Search className="search-glyph" size={18} aria-hidden="true" />
        <input type="search" aria-label="搜索书库" placeholder="搜索书名、作者、系列" value={search} onChange={event => setSearch(event.currentTarget.value)} />
        {search && <button type="button" className="search-clear" aria-label="清除搜索" onClick={clearSearch}>×</button>}
      </form>
    </div>
    <section className="shelf-section" aria-label={queryText ? '搜索结果' : '全部书籍'}>
      <div className="shelf-filters">
        <div className="shelf-state-filter" role="group" aria-label="阅读状态">
          <button type="button" className="chip" aria-pressed={!status} onClick={() => go({ status: null }, true)}>全部</button>
          {readingStates.map(state => <button key={state} type="button" className="chip" aria-pressed={status === state} onClick={() => go({ status: state }, true)}>{readingLabels[state]}</button>)}
        </div>
        {groupLabel
          ? <button type="button" className="chip shelf-group-active" aria-pressed="true" aria-label={`${groupLabel}，点按取消分组`} onClick={() => go({ series: null, tag: null }, true)}><span>{groupLabel}</span><span aria-hidden="true"> ×</span></button>
          : <button type="button" className="chip shelf-group" aria-haspopup="dialog" onClick={() => setGroupsOpen(true)}>分组</button>}
      </div>
      <FloatingNotice message={actionError} error />
      {(!query.isPending && (cards.length > 0 || queryText || filtered)) && <div className="shelf-toolbar"><span className="shelf-count muted" role="status" aria-live="polite" aria-atomic="true">{query.isPlaceholderData ? '正在更新' : queryText ? `「${queryText}」 · 找到 ${query.data?.total ?? 0} 本` : `共 ${query.data?.total ?? 0} 本`}</span><select className="shelf-sort" aria-label="排序方式" value={sort} onChange={event => onSort(event.currentTarget.value)}>{SHELF_SORTS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>}
      {query.isPending && <FloatingNotice message="正在加载书架…" busy />}
      {query.error && <Callout tone="error" title="书架加载失败">{query.error.message}</Callout>}
      {query.data && !query.isPlaceholderData && cards.length === 0 && filtered && !queryText && <div className="empty-state collection-empty"><BookOpen className="empty-glyph" aria-hidden="true" /><p>{status ? `还没有${readingLabels[status]}的书` : '这个分组里没有书'}</p><p className="muted">{status === 'want' ? '在书籍的“⋯”菜单里可以标记想读。' : '换一个分类，或查看全部书籍。'}</p><div className="empty-actions"><button type="button" className="button" onClick={clearFilters}>查看全部书籍</button></div></div>}
      {query.data && !query.isPlaceholderData && cards.length === 0 && !(filtered && !queryText) && <div className="empty-state collection-empty"><BookOpen className="empty-glyph" aria-hidden="true" /><p>{queryText ? '没有匹配的书' : '书架还没有书'}</p><p className="muted">{queryText ? '换个关键词，或者检查一下作者名的写法' : '从书库挑选喜欢的书，或通过书源搜索，加入书架后就能开始阅读。'}</p><div className="empty-actions">{queryText ? <button type="button" className="button" onClick={clearSearch}>清除搜索</button> : <><Link className="button primary" to="/sources"><Search size={16} />去搜书</Link><Link className="button" to="/library"><LibraryBig size={16} />打开书库</Link></>}</div></div>}
      {cards.length > 0 && <div ref={gridRef} className="book-grid" aria-busy={query.isFetching || undefined} data-density={settings.shelfDensity} data-show-author={String(settings.shelfShowAuthor)} data-show-progress={String(settings.shelfShowProgress)}>{cards.map(book => <BookCard key={book.id} book={book} showAuthor={settings.shelfShowAuthor} showProgress={settings.shelfShowProgress} onRemove={() => setMenuTarget(book)} />)}</div>}
      {query.data && pages > 1 && <nav className="shelf-pager" aria-label="翻页"><button type="button" disabled={page <= 1} onClick={() => go({ page: page - 1 })}>上一页</button><span>{page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => go({ page: page + 1 })}>下一页</button></nav>}
    </section>
    {settingsOpen && <ShelfSettingsSheet settings={settings} onPatch={patch => { void runtime.updateSettings(patch); }} onClose={() => setSettingsOpen(false)} onOpenExternalReader={() => { setSettingsOpen(false); setOpdsOpen(true); }} />}
    {opdsOpen && <OpdsAccess api={runtime.api} onSignedOut={() => { void runtime.api.signOut(); }} onClose={() => { setOpdsOpen(false); setSettingsOpen(true); }} />}
    {menuTarget && <DialogView dialog={{ kind: 'pick', title: `《${menuTarget.title || '未命名'}》`, options: menuOptions(menuTarget), resolve: (_value: string | null) => undefined } satisfies Dialog} destructive="从书架拿掉" onClose={answer => { const target = menuTarget; setMenuTarget(null); if (typeof answer === 'string' && answer) void act(target, answer as BookAction); }} />}
    {groupsOpen && <DialogView dialog={{ kind: 'pick', title: groups.isPending ? '分组 · 正在读取…' : groups.error ? '分组 · 读取失败' : '分组', options: groupOptions, resolve: (_value: string | null) => undefined } satisfies Dialog} destructive="" onClose={answer => {
      setGroupsOpen(false);
      if (typeof answer !== 'string') return;
      if (answer === '') go({ series: null, tag: null }, true);
      else if (answer.startsWith('series:')) go({ series: answer.slice(7), tag: null }, true);
      else if (answer.startsWith('tag:')) go({ tag: answer.slice(4), series: null }, true);
    }} />}
    {removeTarget && <DialogView dialog={{ kind: 'confirm', title: '移出书架', body: `确定要将《${removeTarget.title}》移出书架吗？`, resolve: (_answer: boolean) => undefined } satisfies Dialog} destructive="移出书架" onClose={answer => { const target = removeTarget; setRemoveTarget(null); if (answer === true) void remove(target); }} />}
  </div>;
}
