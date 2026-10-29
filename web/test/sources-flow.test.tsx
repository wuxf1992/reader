// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { render } from '../src/shared/ui/render-root.ts';
import { SourcesPage } from '../src/features/sources/pages/SourcesPage.tsx';
import { notify } from '../src/ui/notifications.ts';
import type { SourcePage } from '../src/api/sources.ts';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';

vi.mock('../src/ui/notifications.ts', () => ({ notify: vi.fn(), placeNotifications: vi.fn() }));
vi.mock('../src/ui/floating-notice.tsx', () => ({ FloatingNotice: ({ message }: { message: string }) => <span role="status">{message}</span> }));

const root = document.createElement('div');
document.body.append(root);
const entries = ['甲书源', '乙书源'].map((sourceName, index) => ({ ref: `ref-${index}`, title: '测试小说', authors: ['作者'], sourceName, options: [{ id: 'read', label: '加入书架' }] }));
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = vi.fn(() => 'blob:detail-cover');
    static override revokeObjectURL = vi.fn();
  });
});

afterEach(() => { act(() => render(null, root)); client?.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find(item => (item.textContent === text || item.getAttribute('aria-label') === text))!;
const detailDialog = () => [...document.querySelectorAll('[role="dialog"]')].find(dialog => dialog.getAttribute('aria-label') === '测试小说')!;
const directoryDialog = () => document.querySelector<HTMLElement>('.source-directory-modal')!;
const closeDirectory = async () => { await act(async () => button(directoryDialog(), '关闭').click()); await settle(); };

async function mount(capabilities = ['search', 'browse', 'content.manifest']) {
  let subscription = { bookId: 'book/id', title: '测试小说', enabled: false, intervalMinutes: 60, newChapters: 0, nextCheckAt: 1000, lastSuccessAt: null };
  const api = {
    baseUrl: 'https://reader.test',
    currentSession: () => ({ user: { id: 'fixture' } }),
    sources: vi.fn(async () => [{ id: 'demo', name: '网络书源', enabled: true, sourceType: 'novel', descriptor: { capabilities } }]),
    sourceTypes: vi.fn(async () => []),
    sourceCatalog: vi.fn(async (): Promise<SourcePage> => ({ items: entries })),
    sourceDetail: vi.fn(async (_id: string, ref: string) => ({ ...entries.find(entry => entry.ref === ref), shelfBookId: null })),
    searchSource: vi.fn(async function* () { yield { items: entries }; }),
    sourceChapters: vi.fn(async (_id: string, _ref: string, _options: any) => Array.from({ length: 205 }, (_, seq) => ({ id: 'chapter-' + seq, seq, title: `第${seq + 1}章 内容` }))),
    coverBytes: vi.fn(async (_url: string, _options: { signal?: AbortSignal } = {}): Promise<Uint8Array> => new Uint8Array([137, 80, 78, 71])),
    acquireSource: vi.fn(async () => ({ kind: 'ready', publicationId: 'book/id' })),
    subscriptions: vi.fn(async () => [{ ...subscription }]),
    configureSubscription: vi.fn(async (_id: string, patch: { enabled?: boolean; intervalMinutes?: number }) => { subscription = { ...subscription, ...patch }; }),
    refreshPublication: vi.fn(async () => { subscription = { ...subscription, newChapters: 3 }; }),
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => render(<RuntimeContext value={{ api } as any}><QueryClientProvider client={client}><MemoryRouter initialEntries={['/sources']}><Routes><Route path="/sources" element={<SourcesPage />} /><Route path="/book/:id" element={<p>书籍页面</p>} /></Routes></MemoryRouter></QueryClientProvider></RuntimeContext>, root));
  await settle();
  await settle();
  return api;
}

it.each(['暂停', '设为默认'])('reports failed %s updates and leaves the source usable for retry', async action => {
  useAuthStore.getState().verify({ id: 'fixture', role: 'admin' } as any);
  try {
    const api = await mount();
    const saveSource = vi.fn().mockRejectedValueOnce(new Error('更新失败，请重试')).mockResolvedValueOnce({});
    Object.assign(api, { saveSource });
    await act(async () => button(root, '书源管理').click());
    await act(async () => button(root, '管理').click());
    await act(async () => button(document, action).click());
    expect(notify).toHaveBeenCalledWith('更新失败，请重试', { kind: 'error' });
    expect(root.textContent).toContain('已启用');
    await act(async () => button(root, '管理').click());
    expect(button(document, action).disabled).toBe(false);
    await act(async () => button(document, action).click());
    expect(saveSource).toHaveBeenCalledTimes(2);
  } finally { useAuthStore.getState().setSession(null); }
});

it('supports arrow, Home and End keys in the source tabs', async () => {
  await mount();
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  tabs[0]!.focus();
  for (const [key, index] of [['ArrowRight', 1], ['End', tabs.length - 1], ['Home', 0]] as const) {
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
    expect(tabs[index]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[index]);
  }
});

it('keeps discovery closed on entry, loads it on demand and avoids book counts for navigation-only pages', async () => {
  const api = await mount();
  expect(api.sourceCatalog).not.toHaveBeenCalled();
  expect(root.querySelector('.source-navigation')).toBeNull();
  expect(root.textContent).not.toContain('本页 0 本书');
  expect(root.textContent).not.toContain('没有找到匹配书籍');
  api.sourceCatalog.mockResolvedValueOnce({ title: '书海 / 发现', items: [], navigation: [{ title: '示例书源', ref: 'explore:one' }] });
  await act(async () => button(root, '书海 / 发现').click()); await settle();
  expect(api.sourceCatalog).toHaveBeenCalledExactlyOnceWith('demo', {});
  expect(root.querySelector('.source-navigation')?.textContent).toContain('示例书源');
  expect(root.textContent).not.toContain('本页 0 本书');
  expect(root.querySelector('.catalog-empty')).toBeNull();
  api.sourceCatalog.mockResolvedValueOnce({ title: '示例书源', items: [], navigation: [{ title: '排行榜', ref: 'explore:one:0' }] });
  await act(async () => button(root, '示例书源').click()); await settle();
  expect(api.sourceCatalog).toHaveBeenLastCalledWith('demo', { ref: 'explore:one' });
  expect(root.querySelector('.source-navigation')?.textContent).toBe('排行榜');
  await act(async () => button(root, '收起书海 / 发现').click()); await settle();
  expect(root.querySelector('.source-navigation')).toBeNull();
  expect(root.querySelector('.catalog-feedback')).toBeNull();
  expect(button(root, '书海 / 发现').getAttribute('aria-expanded')).toBe('false');
  await search();
  expect(root.querySelector('.catalog-source-count')?.textContent).toBe('2 条书源');
  expect(api.sourceCatalog).toHaveBeenCalledTimes(2);
});

it('still loads the catalog automatically for a browse-only source', async () => {
  const api = await mount(['browse']);
  expect(api.sourceCatalog).toHaveBeenCalledExactlyOnceWith('demo', {});
  expect(root.querySelectorAll('.catalog-book')).toHaveLength(2);
  expect(button(root, '书海 / 发现')).toBeUndefined();
});

const openUpdates = async () => {
  await act(async () => [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === '自动追更')!.click());
  await settle();
};

it('updates subscription controls after enabling, disabling, interval changes and manual checks', async () => {
  const api = await mount();
  await openUpdates();
  expect(root.textContent).toContain('自动追更已关闭');
  await act(async () => button(root, '开启追更').click()); await settle();
  expect(api.configureSubscription).toHaveBeenLastCalledWith('book/id', { enabled: true });
  expect(button(root, '关闭追更')).toBeDefined();
  expect(root.textContent).toContain('下次检查：');
  expect(notify).toHaveBeenLastCalledWith('已开启追更', { kind: 'success' });
  await act(async () => button(root, '关闭追更').click()); await settle();
  expect(root.textContent).toContain('自动追更已关闭');
  expect(notify).toHaveBeenLastCalledWith('已关闭追更', { kind: 'success' });
  await act(async () => {
    const select = root.querySelector<HTMLSelectElement>('.source-interval select')!;
    select.value = '15'; select.dispatchEvent(new Event('change', { bubbles: true }));
  }); await settle();
  expect(api.configureSubscription).toHaveBeenLastCalledWith('book/id', { intervalMinutes: 15 });
  expect(root.querySelector<HTMLSelectElement>('.source-interval select')!.value).toBe('15');
  await act(async () => button(root, '立即检查').click()); await settle();
  expect(api.refreshPublication).toHaveBeenCalledExactlyOnceWith('book/id');
  expect(root.textContent).toContain('新增 3 章');
});

it('prevents duplicate subscription writes, reports failures and allows retry', async () => {
  const api = await mount();
  await openUpdates();
  let fail!: (reason: Error) => void;
  api.configureSubscription.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const enable = button(root, '开启追更');
  await act(async () => enable.click());
  expect(enable.disabled).toBe(true);
  expect(button(root, '立即检查').disabled).toBe(true);
  await act(async () => enable.click());
  expect(api.configureSubscription).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error('保存失败'))); await settle();
  expect(notify).toHaveBeenLastCalledWith('保存失败', { kind: 'error' });
  expect(enable.disabled).toBe(false);
  expect(root.textContent).toContain('自动追更已关闭');
  await act(async () => enable.click()); await settle();
  expect(button(root, '关闭追更')).toBeDefined();
});

it('shows subscription load errors with retry instead of claiming the shelf is empty', async () => {
  const api = await mount();
  api.subscriptions.mockRejectedValueOnce(new Error('追更列表加载失败'));
  await openUpdates();
  expect(root.textContent).toContain('追更列表加载失败');
  expect(root.textContent).not.toContain('先从章节书源加入书籍');
  await act(async () => button(root, '重新加载').click()); await settle();
  expect(root.textContent).toContain('自动追更已关闭');
  expect(root.textContent).not.toContain('追更列表加载失败');
});

async function search() {
  await act(async () => {
    const input = root.querySelector<HTMLInputElement>('.source-keyword input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '测试小说');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

async function openGroup() {
  await search();
  await act(async () => root.querySelector<HTMLButtonElement>('.catalog-source-count')!.click());
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

it('uses search feedback before the first result and clears it after completion', async () => {
  const api = await mount();
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  api.searchSource.mockImplementationOnce(async function* () { await waiting; yield { items: entries }; });
  await search();
  expect(root.textContent).toContain('正在搜索书籍…');
  expect(root.textContent).not.toContain('正在加载目录…');
  await act(async () => finish());
  await settle();
  expect(root.textContent).not.toContain('正在搜索书籍…');
});

it('keeps the source list after acquisition and uses the official reading button on the search page', async () => {
  const api = await mount();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const dialog = await openGroup();
  expect(dialog.querySelectorAll('.catalog-source-item')).toHaveLength(2);
  expect(dialog.querySelector('input[type="search"]')).toBeNull();
  let finish!: (result: { kind: string; publicationId: string }) => void;
  api.acquireSource.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const add = button(dialog.querySelectorAll('.catalog-source-item')[1]!, '加入书架');
  await act(async () => add.click());
  await settle();
  expect(add.disabled).toBe(true);
  await act(async () => add.click());
  expect(api.acquireSource).toHaveBeenCalledExactlyOnceWith('demo', 'ref-1', 'read');
  await act(async () => finish({ kind: 'ready', publicationId: 'book/id' }));
  await settle();
  expect(root.querySelector('.sources-screen')).not.toBeNull();
  expect(dialog.isConnected).toBe(true);
  expect(dialog.textContent).not.toContain('阅读《测试小说》');
  expect(button(root, '阅读《测试小说》')).toBeDefined();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['shelf'] });
  expect(notify).toHaveBeenCalledWith('《测试小说》已加入书架', { kind: 'success' });
  await act(async () => dialog.querySelector<HTMLButtonElement>('.sheet-close')!.click());
  await settle();
  await act(async () => button(root, '阅读《测试小说》').click());
  expect(root.querySelector('p')?.textContent).toBe('书籍页面');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps both dialogs after acquiring in details and reads after returning to the search page', async () => {
  const api = await mount();
  const dialog = await openGroup();
  await act(async () => button(dialog, '详情').click());
  await settle();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
  expect(dialog.isConnected).toBe(true);
  expect(dialog.querySelectorAll('.catalog-source-item')).toHaveLength(2);
  expect(detailDialog().isConnected).toBe(true);
  let detail = detailDialog();
  await act(async () => detail.querySelector<HTMLButtonElement>('.sheet-close')!.click());
  await settle();
  expect(dialog.isConnected).toBe(true);
  expect(dialog.closest('[inert]')).toBeNull();
  await act(async () => button(dialog, '详情').click());
  await settle();
  detail = detailDialog();
  await act(async () => button(detail, '加入书架').click());
  await settle();
  expect(api.acquireSource).toHaveBeenCalledWith('demo', 'ref-0', 'read');
  expect(root.querySelector('.sources-screen')).not.toBeNull();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
  expect(detail.textContent).not.toContain('阅读《测试小说》');
  expect(notify).toHaveBeenCalledWith('《测试小说》已加入书架', { kind: 'success' });
  await act(async () => detail.querySelector<HTMLButtonElement>('.sheet-close')!.click());
  await settle();
  await act(async () => dialog.querySelector<HTMLButtonElement>('.sheet-close')!.click());
  await settle();
  await act(async () => button(root, '阅读《测试小说》').click());
  expect(root.querySelector('p')?.textContent).toBe('书籍页面');
});

it.each(['error', 'authorization'])('keeps the source dialog open and reports %s instead of silently succeeding', async mode => {
  const api = await mount();
  if (mode === 'error') api.acquireSource.mockRejectedValueOnce(new Error('书源不可用'));
  else api.acquireSource.mockResolvedValueOnce({ kind: 'action-required', action: { label: '需要登录书源' } } as any);
  const dialog = await openGroup();
  await act(async () => button(dialog, '加入书架').click());
  await settle();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(root.textContent).not.toContain('书籍页面');
  expect(notify).toHaveBeenCalledWith(mode === 'error' ? '书源不可用' : '需要登录书源', { kind: 'error' });
});


it('shows source details, expands the full description and reflects an existing shelf acquisition', async () => {
  const api = await mount();
  const description = '长简介'.repeat(100) + '完整简介结尾';
  api.sourceDetail.mockResolvedValueOnce({ ...entries[0], shelfBookId: 'existing', coverUrl: 'http://images.example.com/cover.jpg', latestChapter: '第八章 新的故事', description } as any);
  const group = await openGroup();
  await act(async () => button(group, '详情').click());
  await settle(); await settle();
  const detail = detailDialog();
  expect(detail.textContent).toContain('甲书源');
  expect(detail.textContent).toContain('第八章 新的故事');
  expect(detail.textContent).toContain('作者');
  expect(detail.textContent).toContain('已加入书架');
  expect(button(detail, '已加入书架').disabled).toBe(true);
  expect(detail.textContent).not.toContain('完整简介结尾');
  await act(async () => button(detail, '展开完整简介').click());
  expect(detail.textContent).toContain('完整简介结尾');
  expect(button(detail, '收起简介').getAttribute('aria-expanded')).toBe('true');
  await act(async () => button(detail, '收起简介').click());
  expect(detail.textContent).not.toContain('完整简介结尾');
  const image = detail.querySelector('img')!;
  expect(image.alt).toBe('测试小说封面'); expect(image.src).toBe('blob:detail-cover');
  expect(api.coverBytes).toHaveBeenCalledWith('/api/v1/sources/demo/cover?ref=ref-0', expect.objectContaining({ signal: expect.any(AbortSignal) }), expect.any(Function));
  await act(async () => detail.querySelector<HTMLButtonElement>('.sheet-close')!.click());
  await settle();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:detail-cover');
  expect(api.acquireSource).not.toHaveBeenCalled();
  expect(group.isConnected).toBe(true);
});

it('keeps details usable when cover loading fails and shows placeholders for missing fields', async () => {
  const api = await mount();
  api.sourceDetail.mockResolvedValueOnce({ ...entries[0], authors: [], sourceName: undefined, shelfBookId: null, coverUrl: 'https://images.example.com/missing.jpg' } as any);
  api.coverBytes.mockRejectedValueOnce(new Error('image offline'));
  const group = await openGroup();
  await act(async () => button(group, '详情').click());
  await settle(); await settle();
  const detail = detailDialog();
  expect(detail.textContent).toContain('暂无封面');
  expect(detail.textContent).toContain('作者未知');
  expect(detail.textContent).toContain('网络书源');
  expect(detail.textContent).toContain('暂无信息');
  expect(detail.textContent).toContain('暂无简介');
  expect(detail.textContent).toContain('尚未加入书架');
  expect(button(detail, '加入书架').disabled).toBe(false);
});

it('loads the directory while the cover request is still pending', async () => {
  const api = await mount();
  api.sourceDetail.mockResolvedValueOnce({ ...entries[0], shelfBookId: null, coverUrl: 'https://images.example.com/slow.jpg' } as any);
  let coverSignal: AbortSignal | undefined;
  api.coverBytes.mockImplementationOnce((_url: string, options: { signal?: AbortSignal } = {}) => new Promise<Uint8Array>((_resolve, reject) => {
    coverSignal = options.signal;
    coverSignal?.addEventListener('abort', () => reject(coverSignal!.reason), { once: true });
  }));
  const group = await openGroup();
  await act(async () => button(group, '详情').click()); await settle();
  const detail = detailDialog();
  expect(coverSignal?.aborted).toBe(false);
  await act(async () => button(detail, '查看目录').click()); await settle(); await settle();
  expect(api.sourceChapters).toHaveBeenCalledOnce();
  expect(directoryDialog().textContent).toContain('共 205 章');
  expect(coverSignal?.aborted).toBe(true);
  await closeDirectory();
  await act(async () => detail.querySelector<HTMLButtonElement>('.sheet-close')!.click()); await settle();
  expect(coverSignal?.aborted).toBe(true);
});


it('renders each result batch while slower sources are still searching', async () => {
  const api = await mount();
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  api.searchSource.mockImplementationOnce(async function* () {
    yield { items: [{ ...entries[0], title: '测试小说！' }] };
    await waiting;
    yield { items: [entries[1]] };
  });
  await search();
  expect(root.querySelector('.search-progress')?.textContent).toContain('正在搜索');
  expect(root.querySelector('.catalog-source-count')?.textContent).toBe('1 条书源');
  await act(async () => root.querySelector<HTMLButtonElement>('.catalog-source-count')!.click());
  const group = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(group.querySelectorAll('.catalog-source-item')).toHaveLength(1);
  await act(async () => button(group, '详情').click()); await settle();
  const detail = detailDialog();
  await act(async () => button(detail, '查看目录').click()); await settle();
  await closeDirectory();
  await act(async () => detail.querySelector<HTMLButtonElement>('.sheet-close')!.click()); await settle();
  expect(group.textContent).toContain('共 205 章');
  await act(async () => finish()); await settle();
  expect(group.querySelectorAll('.catalog-source-item')).toHaveLength(2);
  expect(group.querySelectorAll('.catalog-source-item')[0]!.textContent).toContain('共 205 章');
  expect(root.querySelector('.search-progress')?.textContent).toContain('搜索完成');
});

it('moves a late exact title above related books while the search is still running', async () => {
  const api = await mount();
  let next!: () => void, finish!: () => void;
  const waiting = new Promise<void>(resolve => { next = resolve; });
  const ending = new Promise<void>(resolve => { finish = resolve; });
  api.searchSource.mockImplementationOnce(async function* () {
    yield { items: [{ ...entries[0], title: '测试小说续篇', metadata: { searchOrder: [3, 0] } }] };
    await waiting;
    yield { items: [{ ...entries[1], metadata: { searchOrder: [1, 0] } }] };
    await ending;
  });
  await search();
  expect(root.querySelector('.catalog-book strong')?.textContent).toBe('测试小说续篇');
  await act(async () => next()); await settle();
  expect([...root.querySelectorAll('.catalog-book strong')].map(item => item.textContent)).toEqual(['测试小说', '测试小说续篇']);
  expect(root.querySelector('.search-progress')?.textContent).toContain('正在搜索');
  await act(async () => finish()); await settle();
  expect(root.querySelector('.search-progress')?.textContent).toContain('搜索完成');
});

it('opens a separate scrollable directory on demand and returns to the retained detail and source list', async () => {
  const api = await mount();
  const group = await openGroup();
  expect(api.sourceChapters).not.toHaveBeenCalled();
  expect(group.querySelectorAll('.catalog-source-item')[0]!.textContent).toContain('章数待获取');
  await act(async () => button(group, '详情').click()); await settle();
  const detail = detailDialog();
  expect(api.sourceChapters).not.toHaveBeenCalled();
  expect(detail.querySelector('dl button')).toBeNull();
  expect(button(detail, '查看目录').textContent).toContain('章节目录');
  expect(button(detail, '查看目录').getAttribute('aria-haspopup')).toBe('dialog');
  await act(async () => button(detail, '查看目录').click()); await settle(); await settle();
  const directory = directoryDialog();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(3);
  expect(directoryDialog().isConnected).toBe(true);
  expect(group.isConnected).toBe(true);
  expect(directory.closest('[inert]')).toBeNull();
  expect(api.sourceChapters).toHaveBeenCalledExactlyOnceWith('demo', 'ref-0', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(api.acquireSource).not.toHaveBeenCalled();
  expect(directory.querySelectorAll('li')).toHaveLength(205);
  expect(directory.textContent).toContain('测试小说');
  expect(directory.textContent).toContain('共 205 章');
  expect(directory.querySelector('li:first-child')?.textContent).toBe('第205章 内容');
  expect(directory.querySelector('li:last-child')?.textContent).toBe('第1章 内容');
  expect(button(directory, '倒序').getAttribute('aria-pressed')).toBe('true');
  await act(async () => button(directory, '正序').click()); await settle();
  expect(directory.querySelector('li:first-child')?.textContent).toBe('第1章 内容');
  expect(directory.querySelector('li:last-child')?.textContent).toBe('第205章 内容');
  await act(async () => button(directory, '倒序').click()); await settle();
  expect(directory.querySelector('li:first-child')?.textContent).toBe('第205章 内容');
  expect(api.sourceChapters).toHaveBeenCalledTimes(1);
  expect(client.getQueryData<Array<{ title: string }>>(['source-chapters', api.baseUrl, 'demo', 'ref-0'])?.[0]?.title).toBe('第1章 内容');
  expect(directory.querySelector('ol')?.getAttribute('tabindex')).toBe('0');
  await act(async () => directory.dispatchEvent(new Event('cancel', { cancelable: true })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  expect(directoryDialog()).toBeNull();
  expect(detail.isConnected).toBe(true);
  expect(detail.closest('[inert]')).toBeNull();
  expect(group.isConnected).toBe(true);
  await act(async () => button(detail, '查看目录').click()); await settle();
  expect(api.sourceChapters).toHaveBeenCalledTimes(1);
  await closeDirectory();
  await act(async () => detail.querySelector<HTMLButtonElement>('.sheet-close')!.click()); await settle();
  expect(group.closest('[inert]')).toBeNull();
  expect(group.querySelectorAll('.catalog-source-item')[0]!.textContent).toContain('共 205 章');
  expect(group.querySelectorAll('.catalog-source-item')[1]!.textContent).toContain('章数待获取');
  expect(root.querySelector('.catalog-book')?.textContent).toContain('共 205 章');
});

it('reports directory failures, retries, and cancels outstanding loading when only the directory closes', async () => {
  const api = await mount();
  api.sourceChapters.mockRejectedValueOnce(new Error('书源目录暂时不可用'));
  const group = await openGroup();
  await act(async () => button(group, '详情').click()); await settle();
  let detail = detailDialog();
  await act(async () => button(detail, '查看目录').click()); await settle();
  expect(directoryDialog().textContent).toContain('书源目录暂时不可用');
  await act(async () => button(directoryDialog(), '重试加载目录').click()); await settle(); await settle();
  expect(directoryDialog().textContent).toContain('共 205 章');
  await closeDirectory();
  await act(async () => detail.querySelector<HTMLButtonElement>('.sheet-close')!.click()); await settle();
  let aborted = false;
  api.sourceChapters.mockImplementationOnce((_id, _ref, { signal }: any) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true })));
  await act(async () => button(group.querySelectorAll('.catalog-source-item')[1]!, '详情').click()); await settle();
  detail = detailDialog();
  await act(async () => button(detail, '查看目录').click()); await settle();
  expect(directoryDialog().textContent).toContain('正在加载目录…');
  await closeDirectory();
  expect(aborted).toBe(true);
  expect(detail.isConnected).toBe(true);
  expect(detail.closest('[inert]')).toBeNull();
  expect(group.isConnected).toBe(true);
  expect(api.acquireSource).not.toHaveBeenCalled();
});
