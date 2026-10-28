// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { shelfQuery } from '../src/features/shelf/queries/shelf.queries.ts';
import { ApiError } from '../src/api/errors.ts';
import type { AppRuntime } from '../src/app/runtime.ts';
import type { Book } from '../src/api/types.ts';
const books = [{ id: 'a', title: 'A', author: '甲', updatedAt: 1 }, { id: 'b', title: 'B', author: '乙', updatedAt: 2 }] as Book[];
function runtime(error?: Error) {
  return { api: { baseUrl: 'https://reader.test', currentSession: () => ({ user: { id: 'one' } }), listBooks: vi.fn(async () => { if (error) throw error; return { items: books, total: 2, page: 1, pageSize: 60 }; }) }, offline: { replaceBooks: vi.fn(async () => undefined), books: () => books, progressFor: (id: string) => ({ updatedAt: id === 'b' ? 2 : 1 }) } } as unknown as AppRuntime;
}
async function load(value: AppRuntime, sort: 'recent' | 'title' = 'recent', search = '') {
  const options = shelfQuery(value, 1, sort, search);
  return (options.queryFn as Function)({ signal: new AbortController().signal });
}
it('persists the online shelf for offline reopening', async () => {
  const value = runtime(); await load(value);
  expect(value.api.listBooks).toHaveBeenCalledWith(expect.objectContaining({ sort: 'recent' }), expect.anything());
  expect(shelfQuery(value).staleTime).toBe(0);
  expect(value.offline.replaceBooks).toHaveBeenCalledWith(books);
});
it('uses scoped cached books when offline and applies sorting and search', async () => {
  const value = runtime(new ApiError('offline', 'offline'));
  expect((await load(value)).items.map((book: Book) => book.id)).toEqual(['b', 'a']);
  expect((await load(value, 'title', '甲')).items.map((book: Book) => book.id)).toEqual(['a']);
});
it.each([500, 502, 503, 504])('uses cached books when the server or gateway returns %s', async status => {
  expect((await load(runtime(new ApiError('server', 'unreachable', '', status)))).items.map((book: Book) => book.id)).toEqual(['b', 'a']);
});
it('keeps the error when no local books are available', async () => {
  const error = new ApiError('server', 'unreachable', '', 502);
  const value = runtime(error);
  value.offline.books = () => [];
  await expect(load(value)).rejects.toBe(error);
});
it('uses cached books when the request never settles, without waiting for browser network errors', async () => {
  vi.useFakeTimers();
  try {
    const value = runtime();
    value.api.listBooks = vi.fn(() => new Promise<never>(() => {}));
    const result = load(value);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await result).items.map((book: Book) => book.id)).toEqual(['b', 'a']);
  } finally { vi.useRealTimers(); }
});
it('does not mask account authorization failures with cached books', async () => {
  await expect(load(runtime(new ApiError('unauthorized', 'expired')))).rejects.toMatchObject({ kind: 'unauthorized' });
});
it('keeps placeholder results for the same server, account and page', () => {
  const value = runtime();
  const oldQuery = { queryKey: shelfQuery(value).queryKey } as any;
  const data = { items: books, total: 2, page: 1, pageSize: 60 };
  const placeholder = shelfQuery(value, 1, 'title').placeholderData as Function;
  expect(placeholder(data, oldQuery)).toBe(data);
  expect((shelfQuery(value, 2, 'title').placeholderData as Function)(data, oldQuery)).toBeUndefined();
});

it('does not keep placeholder results across account changes', () => {
  const value = runtime();
  const oldQuery = { queryKey: shelfQuery(value).queryKey } as any;
  const data = { items: books, total: 2, page: 1, pageSize: 60 };
  value.api.currentSession = () => ({ user: { id: 'two' } }) as any;
  expect((shelfQuery(value, 1, 'title').placeholderData as Function)(data, oldQuery)).toBeUndefined();
});

it('does not keep placeholder results across server changes', () => {
  const value = runtime();
  const oldQuery = { queryKey: shelfQuery(value).queryKey } as any;
  const data = { items: books, total: 2, page: 1, pageSize: 60 };
  (value.api as any).baseUrl = 'https://other-reader.test';
  expect((shelfQuery(value, 1, 'title').placeholderData as Function)(data, oldQuery)).toBeUndefined();
});
it('passes combined filters without changing the per-account recent sort', async () => {
  const value = runtime();
  const options = shelfQuery(value, 2, 'recent', '甲', { status: 'reading', series: '系列', tag: '标签' });
  await (options.queryFn as Function)({ signal: new AbortController().signal });
  expect(value.api.listBooks).toHaveBeenCalledWith(expect.objectContaining({ page: 2, sort: 'recent', search: '甲', status: 'reading', series: '系列', tag: '标签' }), expect.anything());
  expect(options.queryKey).toContain('one');
});
it('applies reading status, series and tags to the offline shelf and returns an empty matching page', async () => {
  const value = runtime(new ApiError('offline', 'offline'));
  value.offline.books = () => [
    { ...books[0], readingState: 'reading', series: '系列', tags: ['标签'] },
    { ...books[1], readingState: 'want', series: '其他', tags: [] },
  ] as Book[];
  const loadFiltered = async (status: 'reading' | 'finished') => {
    const options = shelfQuery(value, 1, 'recent', '', { status, series: '系列', tag: '标签' });
    return (options.queryFn as Function)({ signal: new AbortController().signal });
  };
  expect((await loadFiltered('reading')).items.map((book: Book) => book.id)).toEqual(['a']);
  expect(await loadFiltered('finished')).toMatchObject({ items: [], total: 0 });
});
it('does not expose a cached shelf when the account changes during the request', async () => {
  const value = runtime();
  let user = 'one';
  value.api.currentSession = () => ({ user: { id: user } }) as any;
  value.api.listBooks = vi.fn(async () => { user = 'two'; throw new ApiError('offline', 'offline'); });
  await expect(load(value)).rejects.toMatchObject({ kind: 'offline' });
  expect(value.offline.replaceBooks).not.toHaveBeenCalled();
});

it.each(['server', 'account'])('does not expose another scope when a hanging request times out after changing %s', async scope => {
  vi.useFakeTimers();
  try {
    const value = runtime();
    value.api.listBooks = vi.fn(() => new Promise<never>(() => {}));
    const result = expect(load(value)).rejects.toMatchObject({ kind: 'offline' });
    if (scope === 'server') (value.api as any).baseUrl = 'https://other-reader.test';
    else value.api.currentSession = () => ({ user: { id: 'other' } }) as any;
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    expect(value.offline.replaceBooks).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
