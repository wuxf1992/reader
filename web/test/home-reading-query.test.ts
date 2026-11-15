// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readingQuery } from '../src/features/home/queries/home.queries.ts';
import { ApiError } from '../src/api/errors.ts';
import type { AppRuntime } from '../src/app/runtime.ts';

function runtime() {
  return {
    api: { baseUrl: 'https://reader.test', currentSession: () => ({ user: { id: 'one' } }), continueReading: vi.fn(async () => []) },
    offline: {
      current: {}, cacheContinueReading: vi.fn(async () => undefined),
      books: () => [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'unread', title: 'Unread' }],
      progressFor: (id: string) => id === 'unread' ? undefined : ({ bookId: id, percentage: .4, chapterTitle: '第二章', updatedAt: id === 'b' ? 20 : 10 }),
    },
  } as unknown as AppRuntime;
}
const load = (value: AppRuntime) => (readingQuery(value).queryFn as Function)({ signal: new AbortController().signal });
const placeholder = (value: AppRuntime) => (readingQuery(value).placeholderData as Function)();
afterEach(() => vi.useRealTimers());

it('immediately offers the most recently read cached book, excluding unread books', () => {
  expect(placeholder(runtime())).toMatchObject([{ id: 'b', percentage: .4, chapterTitle: '第二章', lastReadAt: 20 }]);
});
it('does not turn an empty local cache into an authoritative empty answer', () => {
  const value = runtime(); value.offline.books = () => [];
  expect(placeholder(value)).toBeUndefined();
});
it('lets a successful empty online answer clear a stale local card', async () => {
  const value = runtime();
  expect(await load(value)).toEqual([]);
  expect(value.api.continueReading).toHaveBeenCalledWith(1, expect.objectContaining({ fresh: true }));
});
it.each(['offline', 'server'] as const)('falls back to the local reading position on %s', async kind => {
  const value = runtime(); value.api.continueReading = vi.fn(async () => { throw new ApiError(kind, 'failed'); });
  expect(await load(value)).toMatchObject([{ id: 'b', lastReadAt: 20 }]);
});
it('does not mask an authorization failure with local records', async () => {
  const value = runtime(); value.api.continueReading = vi.fn(async () => { throw new ApiError('unauthorized', 'expired'); });
  await expect(load(value)).rejects.toMatchObject({ kind: 'unauthorized' });
});
it.each([true, false])('settles a never-ending request with cache=%s', async hasCache => {
  vi.useFakeTimers();
  const value = runtime(); value.api.continueReading = vi.fn(() => new Promise<never>(() => {}));
  if (!hasCache) value.offline.books = () => [];
  const result = hasCache ? expect(load(value)).resolves.toMatchObject([{ id: 'b' }]) : expect(load(value)).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(8000);
  await result;
  expect(vi.mocked(value.api.continueReading).mock.calls[0]![1]!.signal?.aborted).toBe(true);
});
it.each(['server', 'account'])('does not use cached records after changing %s during a request', async scope => {
  vi.useFakeTimers();
  const value = runtime(); value.api.continueReading = vi.fn(() => new Promise<never>(() => {}));
  const options = readingQuery(value);
  const result = expect((options.queryFn as Function)({ signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TIMEOUT' });
  if (scope === 'server') (value.api as any).baseUrl = 'https://other.test';
  else value.api.currentSession = () => ({ user: { id: 'two' } }) as any;
  expect((options.placeholderData as Function)()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(8000);
  await result;
  expect(readingQuery(value).queryKey).not.toEqual(options.queryKey);
});

it('uses the last server continuation before a full progress sync has ever completed', () => {
  const value = runtime();
  value.offline.books = () => [];
  value.offline.current.continueReading = [{ id: 'server-book', title: 'Saved response', percentage: .2, chapterTitle: 'Cached chapter', lastReadAt: 30 }] as any;
  expect(placeholder(value)).toMatchObject([{ id: 'server-book', lastReadAt: 30 }]);
});
it('prefers more recent unsynced local reading over the saved server response', () => {
  const value = runtime();
  value.offline.current.continueReading = [{ id: 'older', percentage: .1, lastReadAt: 1 }] as any;
  expect(placeholder(value)).toMatchObject([{ id: 'b', lastReadAt: 20 }]);
});
it('returns the online result without waiting for disk persistence', async () => {
  const value = runtime();
  value.offline.cacheContinueReading = vi.fn(() => new Promise<never>(() => {}));
  expect(await load(value)).toEqual([]);
  expect(value.offline.cacheContinueReading).toHaveBeenCalledWith([]);
});
