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
  expect(value.offline.replaceBooks).toHaveBeenCalledWith(books);
});
it('uses scoped cached books when offline and applies sorting and search', async () => {
  const value = runtime(new ApiError('offline', 'offline'));
  expect((await load(value)).items.map((book: Book) => book.id)).toEqual(['b', 'a']);
  expect((await load(value, 'title', '甲')).items.map((book: Book) => book.id)).toEqual(['a']);
});
it('does not mask account authorization failures with cached books', async () => {
  await expect(load(runtime(new ApiError('unauthorized', 'expired')))).rejects.toMatchObject({ kind: 'unauthorized' });
});
