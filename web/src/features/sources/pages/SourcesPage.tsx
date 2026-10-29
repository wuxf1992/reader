import { Sheet } from '../../../ui/sheet.tsx';
import { ActionMenu } from '../../../ui/action-menu.tsx';
import { Button, Callout, IconTextButton } from '../../../ui/toolkit.tsx';
import { SourcesHeader } from '../components/SourcesHeader.tsx';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Search } from 'lucide-react';
import type { ExtensionField, SourceEntry, SourcePage } from '../../../api/sources.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { notify } from '../../../ui/notifications.ts';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { useSources, useSourceTypes } from '../hooks/sourceQueries.ts';
import { SearchableSelect } from '../../../ui/searchable-select.tsx';
import { mergePages, groupSourceResults, sourceChapterCount, sourceChapterLabel, withChapterCount } from '../../../ui/source-results.ts';
import { SourceBookDetails } from '../components/SourceBookDetails.tsx';
import { CatalogFeedback } from '../../../ui/catalog-feedback.tsx';
import { PluginManager } from '../components/PluginManager.tsx';

type SourceTab = 'search' | 'sources' | 'updates' | 'plugins';
type SearchState = 'idle' | 'searching' | 'stopped' | 'complete' | 'error' | 'limited';

export function SourcesPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  // /sources/plugins opens the hub on its 插件管理 tab.
  const [tab, setTab] = useState<SourceTab>(useLocation().pathname === '/sources/plugins' ? 'plugins' : 'search');
  const [sourceId, setSourceId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [catalogPage, setCatalogPage] = useState<SourcePage>();
  const [catalogError, setCatalogError] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [catalogFilters, setCatalogFilters] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<SourceEntry | null>(null);
  const updateChapterCount = useCallback((ref: string, count: number) => setCatalogPage(previous => withChapterCount(previous, ref, count)), []);
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [resultGroupKey, setResultGroupKey] = useState<string | null>(null);
  const [resultGroupQuery, setResultGroupQuery] = useState('');
  const [acquired, setAcquired] = useState<{ id: string; ref: string; title: string } | null>(null);
  const searchSession = useRef<string | null>(null);
  const searchRequest = useRef<{ query: string; filters: Record<string, string> } | null>(null);
  const searchRun = useRef<AbortController | null>(null);
  const catalogEpoch = useRef(0);
  const sources = useSources();
  const types = useSourceTypes();
  const subscriptions = useQuery({ queryKey: ['subscriptions', runtime.api.baseUrl], queryFn: () => runtime.api.subscriptions(), enabled: tab === 'updates' });
  const [busy, setBusy] = useState<string | null>(null);
  const enabledSources = (sources.data ?? []).filter(source => source.enabled && source.descriptor);
  const selectedSourceId = sourceId || enabledSources.find(source => source.isDefault)?.id || enabledSources[0]?.id || '';
  const selectedSource = enabledSources.find(source => source.id === selectedSourceId);
  const sourceFilters = useQuery({ queryKey: ['source-filters', runtime.api.baseUrl, selectedSourceId], queryFn: () => runtime.api.sourceFilters(selectedSourceId), enabled: !!selectedSourceId && !!selectedSource?.descriptor?.capabilities.includes('search.filters') });
  const detailQuery = useQuery({ queryKey: ['source-detail', runtime.api.baseUrl, selectedSourceId, detail?.ref], queryFn: () => runtime.api.sourceDetail(selectedSourceId, detail!.ref), enabled: !!detail });
  const acquire = useMutation({ mutationFn: ({ ref, option }: { ref: string; option?: string }) => runtime.api.acquireSource(selectedSourceId, ref, option), onError: reason => notify(reason instanceof Error ? reason.message : '加入书架失败', { kind: 'error' }) });
  const hasChapters = !!selectedSource?.descriptor?.capabilities.includes('content.manifest');
  const grouped = searchState !== 'idle' && !(selectedSource?.descriptor?.builtin && selectedSource.sourceType === 'local');
  const results = groupSourceResults(catalogPage?.items ?? [], grouped);
  const activeGroup = results.find(group => group.key === resultGroupKey);
  const canResume = !!searchSession.current && !!searchRequest.current && searchState !== 'limited'
    && !!(catalogPage?.nextCursor || searchState === 'stopped' || searchState === 'error')
    && keyword.trim() === searchRequest.current.query && JSON.stringify(catalogFilters) === JSON.stringify(searchRequest.current.filters);
  const resume = canResume && (searchState === 'stopped' || searchState === 'error');
  const filterOptions = (field: ExtensionField) => {
    const parent = catalogFilters[field.changeAction ?? field.dependsOn ?? ''];
    return (field.options ?? []).filter(option => !parent || !option.parentValues || option.parentValues.includes(parent));
  };
  useEffect(() => { if (!sourceId && selectedSourceId) setSourceId(selectedSourceId); }, [selectedSourceId, sourceId]);
  const sourceTypeLabel = (id: string) => types.data?.find(item => item.id === id)?.label ?? id;
  const loadCatalog = async (ref?: string) => {
    if (!selectedSourceId || !selectedSource?.descriptor?.capabilities.includes('browse')) return;
    const epoch = ++catalogEpoch.current;
    setDiscoveryOpen(true); setCatalogPage(undefined); setCatalogBusy(true); setCatalogError(''); setSearchState('idle'); setResultGroupKey(null); setAcquired(null);
    try { const page = await runtime.api.sourceCatalog(selectedSourceId, ref ? { ref } : {}); if (catalogEpoch.current === epoch) setCatalogPage(page); }
    catch (reason) { if (catalogEpoch.current === epoch) setCatalogError(reason instanceof Error ? reason.message : '目录加载失败'); }
    finally { if (catalogEpoch.current === epoch) setCatalogBusy(false); }
  };
  const toggleDiscovery = () => {
    if (!discoveryOpen) { void loadCatalog(); return; }
    ++catalogEpoch.current; setDiscoveryOpen(false); setCatalogPage(undefined); setCatalogError(''); setCatalogBusy(false);
  };
  const stopSearch = () => { searchRun.current?.abort(); searchRun.current = null; setCatalogBusy(false); setSearchState('stopped'); };
  const searchSources = async (append = false) => {
    const request = append ? searchRequest.current : { query: keyword.trim(), filters: { ...catalogFilters } };
    if (!request?.query || !selectedSource || catalogBusy || (append && !canResume)) return;
    const run = new AbortController(); searchRun.current = run; ++catalogEpoch.current;
    const current = () => searchRun.current === run;
    setDiscoveryOpen(false); setCatalogBusy(true); setCatalogError(''); setSearchState('searching');
    if (!append) { setCatalogPage(undefined); searchSession.current = crypto.randomUUID(); setAcquired(null); setResultGroupKey(null); }
    searchRequest.current = request;
    try {
      for await (const page of runtime.api.searchSource(selectedSource.id, { ...request, sessionId: searchSession.current!, ...(append && catalogPage?.nextCursor ? { cursor: catalogPage.nextCursor } : {}), resultLimit: 10000 }, { signal: run.signal })) {
        if (!current()) return;
        setCatalogPage(previous => mergePages(previous, page));
        if (page.limitReached) { setSearchState('limited'); break; }
      }
      if (current()) setSearchState(previous => previous === 'limited' ? previous : 'complete');
    } catch (reason) { if (current()) { setCatalogError(reason instanceof Error ? reason.message : '搜索失败，已保留找到的书籍。'); setSearchState('error'); } }
    finally { if (current()) { searchRun.current = null; setCatalogBusy(false); } }
  };
  const acquireEntry = (entry: SourceEntry, option?: string) => acquire.mutate(option === undefined ? { ref: entry.ref } : { ref: entry.ref, option }, { onSuccess: result => {
    if (result.kind === 'action-required') notify(result.action?.label ?? '请先完成授权', { kind: 'error' });
    else if (result.publicationId) {
      void queryClient.invalidateQueries({ queryKey: ['shelf'] });
      void queryClient.invalidateQueries({ queryKey: ['source-detail'] });
      notify(`《${entry.title}》已加入书架`, { kind: 'success' });
      setAcquired({ id: result.publicationId, ref: entry.ref, title: entry.title });
    }
  } });
  const mutateSubscription = async (id: string, patch?: { enabled?: boolean; intervalMinutes?: number }) => {
    setBusy(id);
    try {
      if (patch) await runtime.api.configureSubscription(id, patch);
      else await runtime.api.refreshPublication(id);
      await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      notify(patch ? patch.enabled === undefined ? '检查间隔已更新' : patch.enabled ? '已开启追更' : '已关闭追更' : '检查完成', { kind: 'success' });
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '追更操作失败，请重试', { kind: 'error' });
    } finally { setBusy(null); }
  };
  const updateSource = async (id: string, patch: { enabled?: boolean; isDefault?: boolean }) => {
    setBusy(id);
    try { await runtime.api.saveSource(id, patch); await sources.refetch(); }
    catch (reason) { notify(reason instanceof Error ? reason.message : '更新失败，请稍后重试。', { kind: 'error' }); }
    finally { setBusy(null); }
  };
  useEffect(() => {
    ++catalogEpoch.current; searchRun.current?.abort(); searchRun.current = null;
    setDiscoveryOpen(false); setCatalogBusy(false); setCatalogPage(undefined); setCatalogError(''); setCatalogFilters({}); setDetail(null); searchSession.current = null;
    setSearchState('idle'); setAcquired(null); setKeyword(''); setResultGroupKey(null); setResultGroupQuery(''); searchRequest.current = null;
    if (selectedSource?.descriptor?.capabilities.includes('browse') && !selectedSource.descriptor.capabilities.includes('search')) void loadCatalog();
    return () => { ++catalogEpoch.current; searchRun.current?.abort(); searchRun.current = null; };
  }, [selectedSourceId]);
  useEffect(() => { if (detail && detailQuery.data) setDetail({ ...detail, ...detailQuery.data }); }, [detailQuery.data]);
  const detailInShelf = !!detail && (acquired?.ref === detail.ref || !!detail.shelfBookId);
  return <div className="sources-screen sources-hub">
    <SourcesHeader title="书源与追更" backTo="/shelf" />
    <nav className="sources-tabs" role="tablist" aria-label="书源功能" onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')];
      const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); tabs[next]!.click(); tabs[next]!.focus();
    }}>
      {([['search', '搜书'], ['sources', '书源管理'], ['updates', '自动追更'], ...(admin ? [['plugins', '插件管理']] : [])] as Array<[SourceTab, string]>).map(([id, label]) => <button key={id} type="button" role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} onClick={() => setTab(id)}>{label}{id === 'updates' && (subscriptions.data ?? []).some(item => item.newChapters > 0) && <span className="sources-tab-dot" aria-label="有更新" />}</button>)}
    </nav>
    <main className="sources-body" role="tabpanel">
      {tab === 'search' && <>
        <section className="sources-card source-picker">
          <div><h2>搜书</h2><p className="muted">选择来源，发现想读的书。</p></div>
          <SearchableSelect label="选择来源" value={selectedSourceId} options={enabledSources.map(source => ({ value: source.id, label: source.name + (source.isDefault ? '（默认）' : '') }))} onChange={setSourceId} />
          {!selectedSourceId && <p className="muted">{enabledSources.length ? '选择来源后，即可搜索书籍或浏览目录。' : '暂无可用来源，请先添加或启用来源。'}</p>}
          {/* An empty state names its way out: the fix for "no source" lives on the next tab. */}
          {!selectedSourceId && !enabledSources.length && <IconTextButton className="primary source-picker-cta" icon="plus" label="前往书源管理" onClick={() => setTab('sources')} />}
        </section>
        {selectedSource && <section className="sources-card source-catalog"><h2>搜索与浏览</h2>
          {catalogError && <Callout tone="error" onDismiss={() => setCatalogError('')}>{catalogError}</Callout>}
          {selectedSource.descriptor?.capabilities.includes('search') && <form className="sources-search" onSubmit={event => { event.preventDefault(); void searchSources(resume); }}>
            {sourceFilters.data?.filter(field => field.type === 'select').map(field => <SearchableSelect key={field.key} label={field.label} value={catalogFilters[field.key] ?? ''} disabled={catalogBusy} options={filterOptions(field)} onChange={value => setCatalogFilters(previous => { const next = { ...previous, [field.key]: value }; for (const dependent of sourceFilters.data ?? []) { if ((dependent.changeAction ?? dependent.dependsOn) === field.key && !dependent.options?.some(option => option.value === next[dependent.key] && (!option.parentValues || !value || option.parentValues.includes(value)))) next[dependent.key] = ''; } return next; })} />)}
            <label className="source-keyword">搜索书籍<input type="search" placeholder="输入书名或作者" required disabled={catalogBusy} value={keyword} onChange={event => setKeyword(event.currentTarget.value)} /></label>
            {searchState === 'searching' ? <button className="button search-stop" type="button" onClick={stopSearch}>停止搜索</button> : <div className="search-split"><button className="button primary" type="submit" disabled={catalogBusy}><Search size={16} />{resume ? '继续搜索' : '搜索'}</button>{searchRequest.current && <ActionMenu className="button primary search-menu-toggle" label="搜索选项" items={[
                { label: '继续搜索', description: '保留结果，继续未完成的来源', disabled: !canResume, onSelect: () => void searchSources(true) },
                { label: '重新搜索', description: '清空结果，从头搜索', onSelect: () => void searchSources(false) },
              ]} />}</div>}
          </form>}
          {selectedSource.descriptor?.capabilities.includes('browse') && selectedSource.descriptor.capabilities.includes('search') && <Button className="button source-discovery-toggle" disabled={catalogBusy} aria-expanded={discoveryOpen} onClick={toggleDiscovery}>{discoveryOpen ? '收起书海 / 发现' : '书海 / 发现'}</Button>}
          {searchState !== 'idle' && <div className="search-progress" role="status"><span>{({ searching: '正在搜索', stopped: '已停止搜索', complete: '搜索完成', error: '搜索中断', limited: '已达到结果上限' })[searchState]}{catalogPage?.batch ? ` · 已检查 ${catalogPage.batch.completed} / ${catalogPage.batch.total} 个来源` : ''} · 已找到 {results.length} 本书</span>{catalogPage?.batch && <progress aria-label="书源搜索进度" max={Math.max(1, catalogPage.batch.total)} value={catalogPage.batch.completed} />}</div>}
          {catalogPage && grouped && <label className="catalog-group-filter">筛选分组<input type="search" placeholder="搜索书名或作者" value={resultGroupQuery} onChange={event => setResultGroupQuery(event.currentTarget.value)} /></label>}
          {catalogPage && <CatalogFeedback page={catalogPage} count={results.length} merged={searchState !== 'idle'} searching={searchState === 'searching'} compact={!catalogPage.items.length && !!catalogPage.navigation?.length} />}
          {catalogPage?.navigation && <div className="source-navigation">{catalogPage.navigation.map(item => <Button className="button" key={item.ref} onClick={() => void loadCatalog(item.ref)}>{item.title}</Button>)}</div>}
          {catalogBusy && !catalogPage && <FloatingNotice message={searchState === 'searching' ? '正在搜索书籍…' : '正在加载目录…'} busy />}
          {catalogPage && <div className="source-results">{results.filter(group => { const q = resultGroupQuery.trim().toLocaleLowerCase(); return !q || group.entry.title.toLocaleLowerCase().includes(q) || group.entry.authors?.some(author => author.toLocaleLowerCase().includes(q)); }).map(group => { const countEntry = group.entries.find(entry => sourceChapterCount(entry) !== undefined) ?? group.entry; return <article className="sources-row catalog-book" key={group.key}><div><strong>{group.entry.title}</strong><small>{group.entry.authors?.join(' / ') || '作者未知'}</small>{hasChapters && <small>{sourceChapterLabel(countEntry)}{grouped && sourceChapterCount(countEntry) !== undefined && ` · ${countEntry.sourceName ?? selectedSource?.name}`}</small>}{!grouped && group.entry.description && <p className="source-description">{group.entry.description}</p>}</div>{grouped ? <button className="button catalog-source-count" type="button" onClick={() => setResultGroupKey(group.key)}><span>{group.entries.length} 条书源</span><ChevronRight size={16} /></button> : <div className="sources-actions"><button className="button" type="button" onClick={() => setDetail(group.entry)}>详情</button>{(group.entry.options?.length ? group.entry.options : [{ id: '', label: '加入书架' }]).map(option => <button className="button primary" type="button" key={option.id} disabled={option.available === false || acquire.isPending} onClick={() => acquireEntry(group.entry, option.id)}>{option.label}</button>)}</div>}</article>; })}</div>}
          {catalogPage && !catalogBusy && !catalogPage.items.length && !catalogPage.navigation?.length && <div className="catalog-empty"><strong>{searchState === 'idle' ? '暂无可浏览内容' : '没有找到匹配书籍'}</strong><p>{searchState === 'idle' ? '可以搜索书名，或选择其他来源。' : '试试其他关键词，或调整搜索范围。'}</p></div>}
          {searchState === 'complete' && catalogPage?.nextCursor && <div className="catalog-pagination"><button className="button" type="button" disabled={!canResume} onClick={() => void searchSources(true)}>加载更多结果</button></div>}
          {acquired && <button className="button" type="button" onClick={() => navigate(`/book/${encodeURIComponent(acquired.id)}`)}>阅读《{acquired.title}》</button>}
        </section>}
      </>}
      {tab === 'sources' && <section className="sources-card sources-list">
        <div className="sources-list-heading"><h2>我的来源 <span className="source-count">{sources.data?.length ?? 0}</span></h2>{admin && <Link className="button source-add" to="/sources/manage/new"><Plus size={16} />添加来源</Link>}</div>
        {sources.isPending && <FloatingNotice message="正在加载书源…" busy />}{sources.error && <p className="notice error">{sources.error.message}</p>}{!sources.isPending && !sources.data?.length && <p className="muted">还没有配置书源。请添加来源或启用插件。</p>}
        {(sources.data ?? []).map(source => <article className="sources-row source-entry" key={source.id}><div className="source-entry-top"><div className="source-entry-info"><strong>{source.name}{source.isDefault && <span className="source-default-badge">默认</span>}</strong><small>{source.descriptor?.label ?? sourceTypeLabel(source.sourceType)}</small><span className={'source-state' + (source.enabled ? ' is-enabled' : '')}>{source.enabled ? '已启用' : '已暂停'}</span></div><div className="source-entry-actions">{source.descriptor?.credentialKeys?.length ? <Link className="button" to={'/sources/' + encodeURIComponent(source.id) + '/credentials'}>书源登录</Link> : null}{admin && <ActionMenu label="管理" title={`${source.name}管理`} items={[
            ...(source.descriptor?.extensions?.pages ?? []).map(page => ({ label: page.title, onSelect: () => navigate('/sources/' + encodeURIComponent(source.id) + '/' + encodeURIComponent(page.id)) })),
            { label: '基本设置', onSelect: () => navigate('/sources/manage/' + encodeURIComponent(source.id)) },
            { label: source.isDefault ? '取消默认' : '设为默认', disabled: busy === source.id || (!source.isDefault && (!source.enabled || !source.descriptor?.capabilities.includes('search'))), onSelect: () => void updateSource(source.id, { isDefault: !source.isDefault }) },
            { label: source.enabled ? '暂停' : '启用', disabled: busy === source.id, onSelect: () => void updateSource(source.id, { enabled: !source.enabled }) },
          ]} />}</div></div></article>)}
      </section>}
      {tab === 'updates' && <section className="sources-card"><h2>自动追更</h2><p className="notice">服务端定时检查目录，浏览器关闭后继续运行。正文和图片在阅读时缓存。</p>
        {subscriptions.isPending && <FloatingNotice message="正在加载追更列表…" busy />}
        {subscriptions.error && <Callout tone="error">{subscriptions.error.message}<button className="button" type="button" onClick={() => void subscriptions.refetch()}>重新加载</button></Callout>}
        {subscriptions.isSuccess && !subscriptions.data.length && <p>先从章节书源加入书籍，再开启追更。</p>}
        {(subscriptions.data ?? []).map(item => <article className="sources-row" key={item.bookId}><div><strong>{item.title}</strong><small>{item.newChapters ? '新增 ' + item.newChapters + ' 章 · ' : ''}上次成功：{item.lastSuccessAt ? new Date(item.lastSuccessAt).toLocaleString() : '尚未检查'}</small><small>{item.enabled ? '下次检查：' + new Date(item.nextCheckAt).toLocaleString() : '自动追更已关闭'}{item.lastError ? ' · 检查失败：' + item.lastError : ''}</small></div><div className="sources-actions">
          <label className="source-interval">检查间隔<select aria-label={`${item.title}检查间隔`} value={item.intervalMinutes} disabled={!!busy} onChange={event => void mutateSubscription(item.bookId, { intervalMinutes: Number(event.currentTarget.value) })}><option value="15">15 分钟</option><option value="60">1 小时</option><option value="360">6 小时</option><option value="1440">1 天</option></select></label>
          <button className="button" type="button" disabled={!!busy} onClick={() => void mutateSubscription(item.bookId, { enabled: !item.enabled })}>{item.enabled ? '关闭追更' : '开启追更'}</button>
          <button className="button" type="button" disabled={!!busy} onClick={() => void mutateSubscription(item.bookId)}>立即检查</button>
          <Link className="button" to={'/book/' + encodeURIComponent(item.bookId)}>阅读</Link>
        </div></article>)}
      </section>}
      {tab === 'plugins' && (admin ? <PluginManager /> : <Callout tone="warning">只有管理员可以管理插件</Callout>)}
    </main>
    {activeGroup && <Sheet onClose={() => setResultGroupKey(null)} title="书源列表"><div className="sheet-form"><p>{activeGroup.entry.title} · {activeGroup.entries.length} 条书源</p>{activeGroup.entries.map(entry => { const option = entry.options?.[0]; return <article className="catalog-source-item" key={entry.ref}><div><strong>{entry.sourceName ?? selectedSource?.name}</strong><p className="source-description">{hasChapters && <>{sourceChapterLabel(entry)} · </>}最新章节：{entry.latestChapter || '暂无信息'}</p></div><div className="sources-actions"><Button className="button" onClick={() => setDetail(entry)}>详情</Button><Button className="button primary" disabled={option?.available === false} busy={acquire.isPending} onClick={() => acquireEntry(entry, option?.id)}>{option?.label ?? '加入书架'}</Button></div></article>; })}</div></Sheet>}
    {detail && <Sheet onClose={() => setDetail(null)} title={detail.title || '书籍详情'}><div className="sheet-form">{detailQuery.isPending && <FloatingNotice message="正在读取书籍详情…" busy />}{detailQuery.error && <Callout tone="error">{detailQuery.error.message}</Callout>}{detail && <><SourceBookDetails key={selectedSourceId + ':' + detail.ref} entry={detail} sourceId={selectedSourceId} sourceName={selectedSource?.name} inShelf={detailInShelf ? true : detail.shelfBookId === null ? false : undefined} canPreview={hasChapters && !detailQuery.isFetching} onChapterCount={updateChapterCount} />{detail.options?.map(option => <Button key={option.id} disabled={detailInShelf || option.available === false} busy={acquire.isPending} onClick={() => acquireEntry(detail, option.id)}>{detailInShelf ? '已加入书架' : option.label}</Button>)}{(!detail.options || detail.options.length === 0) && <Button disabled={detailInShelf} busy={acquire.isPending} onClick={() => acquireEntry(detail)}>{detailInShelf ? '已加入书架' : '加入书架'}</Button>}</>}</div></Sheet>}
  </div>;
}
