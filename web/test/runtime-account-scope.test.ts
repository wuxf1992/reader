// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { FakeTransport, makePlatform } from './helpers/env.ts';
import { createAppRuntime } from '../src/app/runtime.ts';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import type { Book, Session } from '../src/api/types.ts';
import { ApiError } from '../src/api/errors.ts';
vi.mock('../src/core/web-platform.ts', () => ({ createWebPlatform: vi.fn() }));
vi.mock('../src/features/media/services/player.ts', () => ({ MediaPlayer: class extends EventTarget { element = document.createElement('div'); reconnectNative() {} async stop() {} async flush() {} } }));
import { createWebPlatform } from '../src/core/web-platform.ts';
it('publishes a logged-in account only after its private offline scope is loaded', async () => {
  useAuthStore.getState().setSession(null);
  const transport = new FakeTransport(), platform = makePlatform(transport);
  vi.mocked(createWebPlatform).mockResolvedValue(platform);
  const session: Session = { user: { id: 'b', username: 'b', displayName: 'b', role: 'admin', createdAt: 0 }, accessToken: 'access-b', refreshToken: 'refresh-b', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 };
  transport.respondWith(request => ({ status: 200, headers: {}, json: request.url.endsWith('/login') ? session : { user: session.user } }));
  const runtime = await createAppRuntime('https://reader.test');
  await runtime.offline.setScope('previous-account');
  await runtime.offline.replaceBooks([{ id: 'private-a' } as Book]);
  const disconnect = runtime.connect();
  try {
    await runtime.api.login('b', 'password12');
    expect(useAuthStore.getState().session).toBeNull();
    await runtime.authenticated();
    expect(useAuthStore.getState().session?.user.id).toBe('b');
    expect(useAuthStore.getState().verifiedUser?.role).toBe('admin');
    expect(runtime.offline.books()).toEqual([]);
  } finally { runtime.sync.stop(); disconnect(); useAuthStore.getState().setSession(null); }
});

it('restores an offline login without making a startup verification request', async () => {
  const transport = new FakeTransport(), platform = makePlatform(transport);
  platform.setOnline(false);
  const session: Session = { user: { id: 'offline-user', username: 'reader', displayName: 'reader', role: 'admin', createdAt: 0 }, accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: 0, refreshTokenExpiresAt: 9e15 };
  await platform.kv.set('reader.session.v1', JSON.stringify(session));
  vi.mocked(createWebPlatform).mockResolvedValue(platform);
  transport.failWith(new Error('verification must not run'));
  const runtime = await createAppRuntime('https://reader.test');
  try {
    expect(transport.requests.some(request => request.url === '/api/v1/auth/me')).toBe(false);
    expect(useAuthStore.getState().session).toEqual(session);
    expect(useAuthStore.getState().verifiedUser).toBeNull();
    expect(await platform.kv.get('reader.session.v1')).toBe(JSON.stringify(session));
  } finally { runtime.sync.stop(); useAuthStore.getState().setSession(null); }
});

it('saves actual runtime progress locally before an update without waiting for network sync, and propagates save failures', async () => {
  const transport = new FakeTransport(), platform = makePlatform(transport);
  vi.mocked(createWebPlatform).mockResolvedValue(platform);
  const runtime = await createAppRuntime('https://reader.test');
  const sync = vi.spyOn(runtime.sync, 'flush').mockImplementation(() => new Promise(() => {}));
  const calls: string[] = [];
  const save = vi.fn(async () => { calls.push('position'); });
  runtime.registerReader({ id: 'cached' } as Book, save);
  vi.spyOn(runtime.offline, 'flush').mockImplementation(async () => { calls.push('storage'); });
  await runtime.saveBeforeUpdate();
  expect(calls).toEqual(['position', 'storage']);
  expect(sync).not.toHaveBeenCalled();
  const error = new Error('storage full');
  save.mockRejectedValueOnce(error);
  await expect(runtime.saveBeforeUpdate()).rejects.toBe(error);
  runtime.sync.stop();
});

it('bounds startup even when online verification never responds and preserves local login', async () => {
  vi.useFakeTimers();
  const transport = new FakeTransport(), platform = makePlatform(transport);
  const session: Session = { user: { id: 'cached-user', username: 'reader', displayName: 'reader', role: 'admin', createdAt: 0 }, accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 };
  await platform.kv.set('reader.session.v1', JSON.stringify(session));
  vi.mocked(createWebPlatform).mockResolvedValue(platform);
  let verificationSignal: AbortSignal | undefined;
  const send = vi.spyOn(transport, 'send').mockImplementation(request => {
    if (request.url === '/api/v1/auth/me') {
      verificationSignal = request.signal;
      return new Promise(() => {});
    }
    return Promise.reject(new ApiError('offline', 'no internet'));
  });
  let runtime: Awaited<ReturnType<typeof createAppRuntime>> | undefined;
  try {
    const starting = createAppRuntime('https://reader.test');
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(verificationSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    runtime = await starting;
    expect(verificationSignal?.aborted).toBe(true);
    expect(useAuthStore.getState().session).toEqual(session);
    expect(useAuthStore.getState().verifiedUser).toBeNull();
    expect(await platform.kv.get('reader.session.v1')).toBe(JSON.stringify(session));
  } finally {
    runtime?.sync.stop(); useAuthStore.getState().setSession(null);
    vi.restoreAllMocks(); vi.useRealTimers();
  }
});

it.each(['online', 'revoked'] as const)('still verifies or rejects a saved login when the server answers: %s', async status => {
  const transport = new FakeTransport(), platform = makePlatform(transport);
  const session: Session = { user: { id: 'cached-user', username: 'reader', displayName: 'reader', role: 'admin', createdAt: 0 }, accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 };
  await platform.kv.set('reader.session.v1', JSON.stringify(session));
  vi.mocked(createWebPlatform).mockResolvedValue(platform);
  if (status === 'online') transport.json({ user: session.user });
  else transport.failWith(new ApiError('unauthorized', 'revoked', 'TOKEN_INVALID', 401));
  const runtime = await createAppRuntime('https://reader.test');
  try {
    expect(useAuthStore.getState().session).toEqual(status === 'online' ? session : null);
    expect(useAuthStore.getState().verifiedUser).toEqual(status === 'online' ? session.user : null);
    if (status === 'revoked') expect(await platform.kv.get('reader.session.v1')).toBeNull();
  } finally { runtime.sync.stop(); useAuthStore.getState().setSession(null); }
});
