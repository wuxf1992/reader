// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';

/** 书架 (prototypes 2/19): 在读 / 想读 / 已读 and 分组 drive the query and the URL; ⋯ marks a book. */
const shelfCalls: unknown[][] = [];
const book = { id: 'b1', title: '夜航船', author: '示例作者', coverUrl: null, format: 'epub', readingState: 'reading' };
const shelfResult: any = { data: { items: [book], total: 1, pageSize: 60 }, isPending: false, isPlaceholderData: false, error: null };
vi.mock('../src/features/shelf/queries/shelf.queries.ts', () => ({
  useShelf: (...args: unknown[]) => { shelfCalls.push(args); return shelfResult; },
  useShelfGroups: (enabled: boolean) => ({ data: enabled ? { authors: [], series: ['三体'], tags: ['科幻'], formats: [] } : undefined, isPending: false, error: null }),
}));
const { ShelfPage } = await import('../src/features/shelf/pages/ShelfPage.tsx');

const root = document.createElement('div');
document.body.append(root);
if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
const setReadingStatus = vi.fn(async () => undefined);
const runtime = {
  api: { baseUrl: 'https://reader.example.com', currentSession: () => null, setReadingStatus, coverBytes: async () => new Uint8Array() },
  offline: { progressFor: () => undefined },
  updateSettings: async () => undefined,
} as any;
let location = '';
function Where() { location = useLocation().search; return null; }
const paint = (path: string) => act(() => render(
  <RuntimeContext.Provider value={runtime}>
    <QueryClientProvider client={new QueryClient()}><>
      <MemoryRouter initialEntries={[path]}><Routes><Route path="/shelf" element={<><ShelfPage /><Where /></>} /></Routes></MemoryRouter>
    </></QueryClientProvider>
  </RuntimeContext.Provider>, root));
const click = (text: string) => act(() => [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!.click());
afterEach(() => { act(() => render(null, root)); shelfCalls.length = 0; setReadingStatus.mockClear(); Object.assign(shelfResult, { data: { items: [book], total: 1, pageSize: 60 }, isPending: false, isPlaceholderData: false, error: null }); });

it('filters by reading state and by one 分组, keeping both in the URL', async () => {
  paint('/shelf?status=want');
  expect(shelfCalls.at(-1)?.[3]).toEqual({ status: 'want' });
  expect([...root.querySelectorAll('[aria-label="阅读状态"] button')].map(button => [button.textContent, button.getAttribute('aria-pressed')]))
    .toEqual([['全部', 'false'], ['在读', 'false'], ['想读', 'true'], ['已读', 'false']]);
  await click('在读');
  expect(new URLSearchParams(location).get('status')).toBe('reading');
  await click('分组');
  await click('系列 · 三体');
  expect(Object.fromEntries(new URLSearchParams(location))).toMatchObject({ status: 'reading', series: '三体', page: '1' });
  expect(shelfCalls.at(-1)?.[3]).toEqual({ status: 'reading', series: '三体' });
  // The active group is its own chip; pressing it removes the group and keeps the state.
  await act(() => root.querySelector<HTMLButtonElement>('.shelf-group-active')!.click());
  expect(Object.fromEntries(new URLSearchParams(location))).toEqual({ sort: 'recent', page: '1', status: 'reading' });
});

it('shows a card\'s state and marks it from the ⋯ menu', async () => {
  paint('/shelf');
  expect(root.querySelector('.book-state')?.textContent).toBe('在读');
  expect(root.querySelector('.format-badge')?.textContent).toBe('epub');
  await act(() => root.querySelector<HTMLButtonElement>('.book-more')!.click());
  const options = [...root.querySelectorAll('.sheet-list button')].map(button => button.textContent);
  expect(options).toEqual(['标记为想读', '标记为已读', '清除标记', '从书架拿掉']);
  await click('标记为已读');
  expect(setReadingStatus).toHaveBeenCalledWith('b1', 'finished');
  await act(() => root.querySelector<HTMLButtonElement>('.book-more')!.click());
  await click('清除标记');
  expect(setReadingStatus).toHaveBeenLastCalledWith('b1', null);
});

it('offers every shelf sort in a native select and keeps filters in the URL', async () => {
  paint('/shelf?status=want&series=%E4%B8%89%E4%BD%93');
  const select = root.querySelector<HTMLSelectElement>('select[aria-label="排序方式"]')!;
  expect([...select.options].map(option => option.value)).toEqual(['recent', 'added', 'title', 'author']);
  await act(() => {
    select.value = 'title';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(Object.fromEntries(new URLSearchParams(location))).toEqual({ sort: 'title', page: '1', status: 'want', series: '三体' });
  expect(shelfCalls.at(-1)?.[3]).toEqual({ status: 'want', series: '三体' });
});

it('does not show an empty result while an empty placeholder is being replaced', () => {
  Object.assign(shelfResult, { data: { items: [], total: 0, pageSize: 60 }, isPending: false, isPlaceholderData: true });
  paint('/shelf?q=新关键词');
  expect(root.textContent).not.toContain('没有匹配的书');
  expect(root.querySelector('.shelf-count')?.textContent).toBe('正在更新');
});

it('labels chapter collections as a shelf format without changing shared cards', async () => {
  paint('/shelf');
  const chapterBook = { ...book, id: 'chapters', format: 'chapters' };
  const { BookCard } = await import('../src/features/shelf/pages/ShelfPage.tsx');
  await act(() => render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={new QueryClient()}><MemoryRouter><BookCard book={chapterBook as any} showAuthor={false} showProgress={false} onRemove={() => undefined} /></MemoryRouter></QueryClientProvider>
    </RuntimeContext.Provider>, root));
  expect(root.querySelector('.format-badge')?.textContent).toBe('连载');
  await act(() => render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={new QueryClient()}><MemoryRouter><BookCard book={chapterBook as any} showAuthor={false} showProgress={false} /></MemoryRouter></QueryClientProvider>
    </RuntimeContext.Provider>, root));
  expect(root.querySelector('.format-badge')?.textContent).toBe('chapters');
});
