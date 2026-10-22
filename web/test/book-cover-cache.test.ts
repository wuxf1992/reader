import { afterEach, expect, it, vi } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
import { ApiError } from '../src/api/errors.ts';
import { FetchTransport } from '../src/core/fetch-transport.ts';
import type { Session } from '../src/api/types.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';

const cover = '/api/v1/books/novel/cover';
const session = (id = 'a'): Session => ({ user: { id, username: id, displayName: id, role: 'member', createdAt: 0 }, accessToken: 'token-' + id, refreshToken: 'refresh-' + id, accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 });
function setup() {
  const transport = new FakeTransport(); const platform = makePlatform(transport);
  async function open(user = 'a', server = 'https://reader.test') {
    const api = new ReaderApi(platform, { async load() { return session(user); }, async save() {}, async clear() {} });
    api.setBaseUrl(server); await api.restore(); return api;
  }
  return { transport, platform, open };
}
afterEach(() => vi.unstubAllGlobals());

it('persists across API instances, reuses 304, and replaces an image when its hash changes', async () => {
  const { open, transport, platform } = setup();
  transport.respondWith(() => ({ status: 200, headers: { etag: '"first"' }, bytes: new Uint8Array([1, 2]) }));
  await (await open()).coverBytes(cover);
  transport.respondWith(request => {
    expect(request.headers['if-none-match']).toBe('"first"'); return { status: 304, headers: {} };
  });
  const reopened = await open();
  expect(await reopened.coverBytes(cover)).toEqual(new Uint8Array([1, 2]));
  transport.respondWith(() => ({ status: 200, headers: { etag: '"second"' }, bytes: new Uint8Array([3, 4]) }));
  expect(await reopened.coverBytes(cover)).toEqual(new Uint8Array([3, 4]));
  expect(await platform.blobs.list()).toHaveLength(1);
  transport.respondWith(request => {
    expect(request.headers['if-none-match']).toBe('"second"'); return { status: 304, headers: {} };
  });
  expect(await (await open()).coverBytes(cover)).toEqual(new Uint8Array([3, 4]));
});

it('uses the persistent image offline without hiding permission or cancellation failures', async () => {
  const { open, transport } = setup(); const api = await open();
  transport.respondWith(() => ({ status: 200, headers: { etag: '"first"' }, bytes: new Uint8Array([1]) }));
  await api.coverBytes(cover);
  transport.failWith(new ApiError('offline', 'offline'));
  expect(await (await open()).coverBytes(cover)).toEqual(new Uint8Array([1]));
  for (const kind of ['forbidden', 'not_found', 'aborted'] as const) {
    transport.failWith(new ApiError(kind, kind));
    await expect(api.coverBytes(cover)).rejects.toMatchObject({ kind });
  }
});

it('isolates server/account caches and rejects an account switch during a cache read', async () => {
  const { open, transport, platform } = setup();
  transport.respondWith(() => ({ status: 200, headers: { etag: '"first"' }, bytes: new Uint8Array([1]) }));
  const api = await open(); await api.coverBytes(cover);
  transport.failWith(new ApiError('offline', 'offline'));
  await expect((await open('b')).coverBytes(cover)).rejects.toMatchObject({ kind: 'offline' });
  await expect((await open('a', 'https://other.test')).coverBytes(cover)).rejects.toMatchObject({ kind: 'offline' });
  const get = platform.blobs.get.bind(platform.blobs);
  vi.spyOn(platform.blobs, 'get').mockImplementation(async key => {
    api.setBaseUrl('https://other.test'); return get(key);
  });
  await expect(api.coverBytes(cover)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
});

it('redownloads missing bytes and tolerates unavailable storage', async () => {
  const { open, transport, platform } = setup(); const api = await open();
  transport.respondWith(request => {
    expect(request.headers['if-none-match']).toBeUndefined();
    return { status: 200, headers: { etag: '"first"' }, bytes: new Uint8Array([1]) };
  });
  await api.coverBytes(cover);
  await platform.blobs.remove((await platform.blobs.list())[0]!);
  expect(await api.coverBytes(cover)).toEqual(new Uint8Array([1]));
  vi.spyOn(platform.kv, 'get').mockRejectedValue(new Error('storage unavailable'));
  vi.spyOn(platform.blobs, 'put').mockRejectedValue(new Error('quota exceeded'));
  expect(await api.coverBytes(cover)).toEqual(new Uint8Array([1]));
});

it('does not apply book caching to source or media endpoints', async () => {
  const { open, transport, platform } = setup(); const api = await open();
  transport.respondWith(request => {
    expect(request.headers['if-none-match']).toBeUndefined();
    return { status: 200, headers: { etag: '"first"' }, bytes: new Uint8Array([1]) };
  });
  await api.coverBytes('/api/v1/media/items/one/cover');
  await api.coverBytes('/api/v1/sources/one/cover?ref=one');
  expect(await platform.blobs.list()).toEqual([]);
});

it('accepts binary 304 and validates past old immutable browser caches', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { etag: '"first"' } }));
  vi.stubGlobal('fetch', fetch);
  const transport = new FetchTransport(() => 'https://reader.test');
  const response = await transport.send({ url: cover, method: 'GET', headers: { 'if-none-match': '"first"' }, binary: true, cache: 'no-cache' });
  expect(response.status).toBe(304); expect(response.bytes).toHaveLength(0);
  expect(fetch.mock.calls[0]?.[1].cache).toBe('no-cache');
});
