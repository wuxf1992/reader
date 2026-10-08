// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { FakeTransport, makePlatform } from './helpers/env.ts';
import { createAppRuntime } from '../src/app/runtime.ts';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import type { Book, Session } from '../src/api/types.ts';
vi.mock('../src/core/web-platform.ts', () => ({ createWebPlatform: vi.fn() }));
vi.mock('../src/features/media/services/player.ts', () => ({ MediaPlayer: class extends EventTarget { element = document.createElement('div'); reconnectNative() {} async stop() {} } }));
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
