import { expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import type { ReaderApi } from '../src/api/client.ts';
import type { Manifest, Session } from '../src/api/types.ts';
import { OfflineDownloads } from '../src/core/offline-downloads.ts';
import { PublicationCache, publicationScope } from '../src/store/publications.ts';
import { MemoryKv, MemoryBlobs } from './helpers/env.ts';

const manifest = { book: { id: 'book', title: '小说', format: 'chapters' }, files: [], content: { kind: 'text', total: 2, revision: 'one', groups: [], items: [0, 1].map(seq => ({ id: String(seq), seq, title: '第' + seq + '章', href: 'chapter:' + seq, resourceRef: 'r:' + seq, kind: 'chapter', mediaType: 'text/plain' })) } } as unknown as Manifest;
function fixture() {
  let user = 'first', baseUrl = 'https://reader.test', release!: () => void, signal: AbortSignal | undefined;
  const kv = new MemoryKv(), blobs = new MemoryBlobs();
  const asset = vi.fn().mockImplementationOnce((_book, _ref, options) => {
    signal = options.signal;
    // Simulate a transport that still returns a response after cancellation.
    return new Promise(resolve => { release = () => resolve(new NodeBlob(['正文'])); });
  }).mockResolvedValue(new NodeBlob(['正文']));
  const api = { get baseUrl() { return baseUrl; }, currentSession: () => user ? { user: { id: user } } as Session : null, asset } as unknown as ReaderApi;
  const downloads = new OfflineDownloads(api, { kv, blobs });
  const cache = new PublicationCache(kv, blobs, publicationScope(baseUrl, user));
  return { downloads, cache, kv, blobs, asset, release: () => release(), signal: () => signal,
    changeUser: (value: string) => { user = value; }, changeServer: () => { baseUrl = 'https://another.test'; } };
}
it('shares the running task across routes without restoring its persisted running state as paused', async () => {
  const env = fixture(), task = await env.downloads.get(manifest), states: string[] = [];
  const unsubscribe = task.onChange(state => states.push(state.status));
  const pending = task.start();
  await vi.waitFor(() => expect(env.asset).toHaveBeenCalledTimes(1));
  expect(await env.downloads.get(manifest)).toBe(task);
  expect(task.state.status).toBe('running'); expect(env.downloads.running('book')).toBe(true);
  env.release(); await pending; unsubscribe();
  expect(task.state.status).toBe('complete'); expect(states).toContain('complete');
  expect(await env.cache.entries()).toHaveLength(2);
});
it.each(['account', 'server', 'logout'] as const)('discards a late response after %s changes', async change => {
  const env = fixture(), task = await env.downloads.get(manifest), pending = task.start();
  await vi.waitFor(() => expect(env.asset).toHaveBeenCalledTimes(1));
  if (change === 'server') env.changeServer(); else env.changeUser(change === 'account' ? 'second' : '');
  env.release(); await pending;
  expect(task.state.status).toBe('paused'); expect(env.asset).toHaveBeenCalledTimes(1);
  expect(await env.cache.entries()).toHaveLength(0);
  expect(await env.blobs.list()).toHaveLength(0);
  await env.downloads.clear();
});
it.each(['pause', 'cancel', 'clear', 'disconnect', 'revision'] as const)('waits for pending bytes and prevents late writes on %s', async operation => {
  const env = fixture(), task = await env.downloads.get(manifest), pending = task.start();
  await vi.waitFor(() => expect(env.asset).toHaveBeenCalledTimes(1));
  const stopped = operation === 'clear' ? env.downloads.clearBook('book') : operation === 'disconnect' ? env.downloads.clear()
    : operation === 'revision' ? env.downloads.get({ ...manifest, content: { ...manifest.content!, revision: 'two' } }) : task.pause(operation === 'cancel');
  expect(env.signal()?.aborted).toBe(true);
  env.release(); await pending; await stopped;
  expect(await env.cache.entries()).toHaveLength(0); expect(env.asset).toHaveBeenCalledTimes(1);
  if (operation === 'revision') expect((await env.downloads.get({ ...manifest, content: { ...manifest.content!, revision: 'two' } })).state.status).toBe('idle');
  else if (operation === 'clear') { expect(task.state.status).toBe('idle'); await task.start(); expect(await env.cache.entries()).toHaveLength(2); }
  else expect(task.state.status).toBe(operation === 'cancel' ? 'cancelled' : 'paused');
});
it('restores an interrupted range and reuses finished chapters after a new application starts', async () => {
  const env = fixture();
  await env.cache.putTask('book', JSON.stringify({ status: 'running', completed: 1, total: 2, from: 1, to: 2, message: '下载中', revision: 'one' }));
  await env.cache.putResource('book', 'r:0', new Uint8Array([1]));
  const task = await env.downloads.get(manifest);
  expect(task.state).toMatchObject({ status: 'paused', completed: 1, from: 1, to: 2 });
  const pending = task.start(task.state.from, task.state.to);
  await vi.waitFor(() => expect(env.asset).toHaveBeenCalledTimes(1)); env.release(); await pending;
  expect(task.state.status).toBe('complete'); expect(env.asset).toHaveBeenCalledWith('book', 'r:1', expect.anything());
  expect(await env.cache.entries()).toHaveLength(2);
});

it('preserves completed task status when the application disconnects', async () => {
  const env = fixture(), task = await env.downloads.get(manifest), pending = task.start();
  await vi.waitFor(() => expect(env.asset).toHaveBeenCalledTimes(1)); env.release(); await pending;
  await env.downloads.clear();
  expect(task.state.status).toBe('complete');
  expect(JSON.parse((await env.cache.task('book'))!).status).toBe('complete');
});
