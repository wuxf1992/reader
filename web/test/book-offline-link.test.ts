// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { resolveReaderBook } from '../src/features/reader/resolve-book.ts';
import { OfflineStore } from '../src/store/offline.ts';
import type { Book } from '../src/api/types.ts';

const book = { id: 'linked-book', title: '直达链接小说', format: 'chapters' } as Book;
function storage() {
  const rows = new Map<string, string>();
  return { get: async (key: string) => rows.get(key) ?? null,
    set: async (key: string, value: string) => { rows.set(key, value); },
    remove: async (key: string) => { rows.delete(key); } };
}
async function resolve(offline: OfflineStore, getBook: () => Promise<{ book: Book }>) {
  try { return await resolveReaderBook({ getBook: async () => ({ ...await getBook(), progress: null }) }, offline, book.id); } catch { return null; }
}
describe('book links survive offline reopening', () => {
  it('persists a directly opened book and resolves it after a fresh offline load', async () => {
    const kv = storage(), online = new OfflineStore(kv);
    await online.setScope('server:account-one');
    expect(await resolve(online, async () => ({ book }))).toEqual(book);
    const reopened = new OfflineStore(kv);
    await reopened.setScope('server:account-one');
    const unavailable = vi.fn(async () => { throw new Error('offline'); });
    expect(await resolve(reopened, unavailable)).toEqual(book);
    expect(unavailable).not.toHaveBeenCalled();
  });
  it('does not expose the cached book to another account', async () => {
    const kv = storage(), one = new OfflineStore(kv), two = new OfflineStore(kv);
    await one.setScope('server:one'); await resolve(one, async () => ({ book }));
    await two.setScope('server:two');
    expect(await resolve(two, async () => { throw new Error('offline'); })).toBeNull();
  });
  it('still opens an online book when device storage cannot be written', async () => {
    const cache = { books: () => [], replaceBooks: async () => { throw new Error('quota'); } };
    expect(await resolve(cache as unknown as OfflineStore, async () => ({ book }))).toEqual(book);
  });
});
