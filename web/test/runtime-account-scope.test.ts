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
  const disconnect = runtime.connect();
  try {
    expect(transport.requests.some(request => request.url === '/api/v1/auth/me')).toBe(false);
    expect(useAuthStore.getState().session).toEqual(session);
    expect(useAuthStore.getState().verifiedUser).toBeNull();
    expect(await platform.kv.get('reader.session.v1')).toBe(JSON.stringify(session));
  } finally { disconnect(); useAuthStore.getState().setSession(null); }
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

it('returns the cached runtime before online validation and bounds the background request', async () => {
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
  let disconnect: (() => void) | undefined;
  try {
    runtime = await createAppRuntime('https://reader.test');
    expect(send).not.toHaveBeenCalled();
    disconnect = runtime.connect();
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(verificationSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(verificationSignal?.aborted).toBe(true);
    expect(useAuthStore.getState().session).toEqual(session);
    expect(useAuthStore.getState().verifiedUser).toBeNull();
    expect(await platform.kv.get('reader.session.v1')).toBe(JSON.stringify(session));
  } finally {
    disconnect?.(); runtime?.sync.stop(); useAuthStore.getState().setSession(null);
    vi.restoreAllMocks(); vi.useRealTimers();
  }
});

it.each(['online', 'revoked', 'forbidden', 'wrong-user', 'server'] as const)('still verifies or rejects a saved login when the server answers: %s', async status => {
  const transport = new FakeTransport(), platform = makePlatform(transport);
  const session: Session = { user: { id: 'cached-user', username: 'reader', displayName: 'reader', role: 'admin', createdAt: 0 }, accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 };
  await platform.kv.set('reader.session.v1', JSON.stringify(session));
  vi.mocked(createWebPlatform).mockResolvedValue(platform);
  if (status === 'online') transport.json({ user: session.user });
  else if (status === 'wrong-user') transport.json({ user: { ...session.user, id: 'another-account' } });
  else if (status === 'server') transport.failWith(new ApiError('server', 'gateway unavailable', '', 502));
  else if (status === 'revoked') transport.failWith(new ApiError('unauthorized', 'revoked', 'TOKEN_INVALID', 401));
  else transport.failWith(new ApiError('forbidden', 'verification refused', 'FORBIDDEN', 403));
  const runtime = await createAppRuntime('https://reader.test');
  const disconnect = runtime.connect();
  try {
    await vi.waitFor(() => expect(useAuthStore.getState().session).toEqual(status === 'online' || status === 'server' ? session : null));
    await vi.waitFor(() => expect(useAuthStore.getState().verifiedUser).toEqual(status === 'online' ? session.user : null));
    if (status !== 'online' && status !== 'server') expect(await platform.kv.get('reader.session.v1')).toBeNull();
  } finally { disconnect(); useAuthStore.getState().setSession(null); }
});

it.each(['disconnect', 'server', 'account', 'same-account-login'] as const)('discards a late startup verification after %s', async change => {
  const transport = new FakeTransport(), platform = makePlatform(transport);
  const session: Session = { user: { id: 'old', username: 'old', displayName: 'old', role: 'member', createdAt: 0 }, accessToken: 'old', refreshToken: 'old', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 };
  await platform.kv.set('reader.session.v1', JSON.stringify(session));
  vi.mocked(createWebPlatform).mockResolvedValue(platform);
  let finish!: (response: any) => void;
  let signal: AbortSignal | undefined;
  vi.spyOn(transport, 'send').mockImplementation(request => {
    if (request.url === '/api/v1/auth/me') { signal = request.signal; return new Promise(resolve => { finish = resolve; }); }
    if (request.url.endsWith('/login')) return Promise.resolve({ status: 200, headers: {}, json: { ...session, user: { ...session.user, id: change === 'account' ? 'new' : 'old', displayName: 'new login' } } });
    return Promise.reject(new ApiError('offline', 'fixture'));
  });
  const runtime = await createAppRuntime('https://reader.test'), disconnect = runtime.connect();
  try {
    await vi.waitFor(() => expect(finish).toBeDefined());
    if (change === 'disconnect') { disconnect(); expect(signal?.aborted).toBe(true); }
    else if (change === 'server') runtime.api.setBaseUrl('https://another.test');
    else {
      const next = await runtime.api.login('new', 'password12');
      useAuthStore.getState().setSession(next);
    }
    finish({ status: 200, headers: {}, json: { user: { ...session.user, role: 'admin' } } });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(useAuthStore.getState().verifiedUser).toBeNull();
    expect(runtime.api.currentSession()?.user.displayName).toBe(change === 'account' || change === 'same-account-login' ? 'new login' : 'old');
  } finally { disconnect(); useAuthStore.getState().setSession(null); }
});

it('hides a revoked cached login even when persisted credentials cannot be removed', async () => {
  const transport = new FakeTransport(), platform = makePlatform(transport);
  const session: Session = { user: { id: 'cached', username: 'cached', displayName: 'cached', role: 'member', createdAt: 0 }, accessToken: 'old', refreshToken: 'old', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 };
  await platform.kv.set('reader.session.v1', JSON.stringify(session));
  vi.mocked(createWebPlatform).mockResolvedValue(platform);
  const runtime = await createAppRuntime('https://reader.test');
  vi.spyOn(platform.kv, 'remove').mockRejectedValue(new Error('storage unavailable'));
  transport.respondWith(request => {
    if (request.url === '/api/v1/auth/me') throw new ApiError('unauthorized', 'revoked', 'TOKEN_INVALID', 401);
    throw new ApiError('offline', 'fixture');
  });
  const disconnect = runtime.connect();
  try {
    await vi.waitFor(() => expect(useAuthStore.getState().session).toBeNull());
    expect(runtime.api.currentSession()).toBeNull();
    expect(useAuthStore.getState().verifiedUser).toBeNull();
  } finally { disconnect(); vi.restoreAllMocks(); }
});
