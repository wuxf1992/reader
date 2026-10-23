import { describe, expect, it } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
import type { Session } from '../src/api/types.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';

const session: Session = {
  user: { id: 'reader', username: 'reader', displayName: 'Reader', role: 'member', createdAt: 0 },
  accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15,
};

async function apiWith(transport: FakeTransport): Promise<ReaderApi> {
  const api = new ReaderApi(makePlatform(transport), { load: async () => session, save: async () => {}, clear: async () => {} });
  await api.restore();
  return api;
}

describe('ReaderApi navigation query cache', () => {
  it('reloads subscriptions after toggles, interval changes and manual checks', async () => {
    const transport = new FakeTransport();
    let subscription = { bookId: 'book/id', enabled: false, intervalMinutes: 60, newChapters: 0 };
    transport.respondWith(request => {
      if (request.method === 'PATCH') subscription = { ...subscription, ...JSON.parse(String(request.body)) };
      if (request.method === 'POST') subscription = { ...subscription, newChapters: 3 };
      return { status: 200, headers: {}, json: { subscriptions: [{ ...subscription }] } };
    });
    const api = await apiWith(transport);
    await api.subscriptions();
    await api.subscriptions();
    expect(transport.requests).toHaveLength(1);
    for (const enabled of [true, false]) {
      await api.configureSubscription('book/id', { enabled });
      expect((await api.subscriptions())[0]?.enabled).toBe(enabled);
    }
    await api.configureSubscription('book/id', { intervalMinutes: 15 });
    expect((await api.subscriptions())[0]?.intervalMinutes).toBe(15);
    await api.refreshPublication('book/id');
    expect((await api.subscriptions())[0]?.newChapters).toBe(3);
    expect(transport.countMatching(request => request.method === 'GET')).toBe(5);
  });

  it('refreshes explicitly, separates pages, and leaves polling uncached', async () => {
    const transport = new FakeTransport();
    transport.json({ items: [], total: 0 });
    const api = await apiWith(transport);
    await api.listBooks({ page: 1 });
    await api.listBooks({ page: 2 });
    api.refreshQueries();
    await api.listBooks({ page: 1 });
    expect(transport.requests).toHaveLength(3);
    await api.mediaRequest('/api/v1/media/scan-jobs');
    await api.mediaRequest('/api/v1/media/scan-jobs');
    expect(transport.requests).toHaveLength(5);
  });

  it('keeps media catalog cached across playback heartbeats', async () => {
    const transport = new FakeTransport();
    transport.json({ items: [] });
    const api = await apiWith(transport);
    await api.mediaRequest('/api/v1/media/browse?channel=music');
    await api.mediaRequest('/api/v1/media/playback/session/progress', 'PUT', { position: 10 });
    await api.mediaRequest('/api/v1/media/browse?channel=music');
    expect(transport.requests).toHaveLength(2);
  });

  it('deduplicates concurrent shelf reads and reuses them on return', async () => {
    const transport = new FakeTransport();
    transport.json({ items: [{ id: 'book-1' }], total: 1 });
    const api = await apiWith(transport);
    await Promise.all([api.listBooks(), api.listBooks()]);
    await api.listBooks();
    expect(transport.countMatching(request => request.url.startsWith('/api/v1/books'))).toBe(1);
  });

  it('invalidates navigation data after a write', async () => {
    const transport = new FakeTransport();
    transport.respondWith(request => request.method === 'GET'
      ? { status: 200, headers: {}, json: { items: [{ id: 'book-1' }], total: 1 } }
      : { status: 200, headers: {}, json: {} });
    const api = await apiWith(transport);
    await api.listBooks();
    await api.browseBatchShelf({ bookIds: ['book-1'] }, 'remove');
    await api.listBooks();
    expect(transport.countMatching(request => request.url.startsWith('/api/v1/books'))).toBe(2);
  });

  it('refreshes every shelf sort and only the matching book detail after changing reading status', async () => {
    const transport = new FakeTransport();
    transport.respondWith(request => {
      if (request.method === 'PUT') return { status: 200, headers: {}, json: {} };
      if (request.url.startsWith('/api/v1/subscriptions')) return { status: 200, headers: {}, json: { subscriptions: [] } };
      if (request.url === '/api/v1/books/book-1') return { status: 200, headers: {}, json: { book: { id: 'book-1' }, progress: null } };
      if (request.url === '/api/v1/books/book-2') return { status: 200, headers: {}, json: { book: { id: 'book-2' }, progress: null } };
      return { status: 200, headers: {}, json: { items: [], total: 0 } };
    });
    const api = await apiWith(transport);
    const shelfSorts = [{ sort: 'title' as const }, { sort: 'author' as const }, { sort: 'added' as const, page: 2 }];
    for (const sort of shelfSorts) await api.listBooks(sort);
    await api.getBook('book-1');
    await api.getBook('book-2');
    await api.subscriptions();

    await api.setReadingStatus('book-1', 'finished');

    for (const sort of shelfSorts) await api.listBooks(sort);
    await api.getBook('book-1');
    await api.getBook('book-2');
    await api.subscriptions();
    expect(transport.countMatching(request => request.method === 'GET' && request.url.startsWith('/api/v1/books?'))).toBe(6);
    expect(transport.countMatching(request => request.method === 'GET' && request.url === '/api/v1/books/book-1')).toBe(2);
    expect(transport.countMatching(request => request.method === 'GET' && request.url === '/api/v1/books/book-2')).toBe(1);
    expect(transport.countMatching(request => request.method === 'GET' && request.url === '/api/v1/subscriptions')).toBe(1);
  });

  it('shows a newly acquired novel in previously visited shelf sorts without waiting for cache expiry', async () => {
    const transport = new FakeTransport();
    let acquired = false;
    transport.respondWith(request => {
      if (request.method === 'POST' && request.url.endsWith('/acquire')) {
        acquired = true;
        return { status: 200, headers: {}, json: { kind: 'ready', publicationId: 'new-book' } };
      }
      if (request.url.startsWith('/api/v1/library/continue')) {
        return { status: 200, headers: {}, json: { items: [] } };
      }
      const items = acquired ? [{ id: 'new-book', title: '药师门徒修仙笔记' }, { id: 'old-book' }] : [{ id: 'old-book' }];
      return { status: 200, headers: {}, json: { items, total: items.length } };
    });
    const api = await apiWith(transport);
    const queries = [
      { sort: 'added' as const, order: 'desc' as const, page: 1, pageSize: 60 },
      { sort: 'added' as const, order: 'desc' as const, page: 2, pageSize: 60 },
      { sort: 'title' as const, page: 1 },
      { sort: 'author' as const, page: 1 },
    ];
    for (const query of queries) await api.listBooks(query);
    await api.continueReading(100);
    await api.acquireSource('novel-web', 'selected-novel');
    for (const query of queries) {
      expect((await api.listBooks(query)).items.map(book => book.id)).toContain('new-book');
    }
    await api.continueReading(100);
    expect(transport.countMatching(request => request.url.startsWith('/api/v1/books?'))).toBe(8);
    expect(transport.countMatching(request => request.url.startsWith('/api/v1/library/continue'))).toBe(2);
  });

});

it('uses the existing authenticated manifest endpoint and keeps only chapters in reading order', async () => {
  const transport = new FakeTransport();
  transport.json({ items: [{ id: 'b', seq: 2, title: '第二章', kind: 'chapter' }, { id: 'page', seq: 0, title: '页面', kind: 'page' }, { id: 'a', seq: 1, title: '第一章', kind: 'chapter' }] });
  const api = await apiWith(transport);
  const chapters = await api.sourceChapters('source/id', 'legado:ref');
  expect(chapters.map(item => item.id)).toEqual(['a', 'b']);
  expect(transport.requests.at(-1)?.url).toBe('/api/v1/sources/source%2Fid/publications/legado%3Aref/manifest');
  expect(transport.requests).toHaveLength(1);
});

it('refreshes recent reading order on return while retaining other shelf caches', async () => {
  const transport = new FakeTransport();
  let read = false;
  transport.respondWith(request => {
    if (request.method === 'PUT') { read = true; return { status: 200, headers: {}, json: { progress: null } }; }
    return { status: 200, headers: {}, json: { items: read ? [{ id: 'b' }, { id: 'a' }] : [{ id: 'a' }, { id: 'b' }], total: 2 } };
  });
  const api = await apiWith(transport);
  await api.listBooks({ sort: 'recent' });
  await api.listBooks({ sort: 'added' });
  await api.putProgress({ bookId: 'b', locator: 'r1:0:c0', percentage: 0.4, chapterTitle: '第一章', device: 'test', updatedAt: 300 });
  expect((await api.listBooks({ sort: 'recent' })).items.map(book => book.id)).toEqual(['b', 'a']);
  await api.listBooks({ sort: 'added' });
  expect(transport.countMatching(request => request.method === 'GET' && request.url.includes('sort=recent'))).toBe(2);
  expect(transport.countMatching(request => request.method === 'GET' && request.url.includes('sort=added'))).toBe(1);
});
