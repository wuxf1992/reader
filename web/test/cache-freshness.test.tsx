// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ReaderApi } from '../src/api/client.ts';
import { createAppQueryClient } from '../src/shared/query/query-client.ts';
import { shelfQuery } from '../src/features/shelf/queries/shelf.queries.ts';
import { SourceBookDetails } from '../src/features/sources/components/SourceBookDetails.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import type { AppRuntime } from '../src/app/runtime.ts';
import { render } from '../src/shared/ui/render-root.ts';
import { useCover } from '../src/ui/use-cover.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';

async function setup() {
  const transport = new FakeTransport(), platform = makePlatform(transport);
  const session = { user: { id: 'audit', username: 'audit', displayName: 'audit', role: 'member', createdAt: 0 }, accessToken: 'fixture', refreshToken: 'fixture', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 } as const;
  const api = new ReaderApi(platform, { load: async () => session, save: async () => {}, clear: async () => {} });
  api.setBaseUrl('https://audit.test'); await api.restore();
  return { api, transport };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['title', 'author', 'added'] as const)('refreshes a %s shelf through the internal API cache while preserving the outer cache', async sort => {
  vi.useFakeTimers();
  const { api, transport } = await setup(), client = createAppQueryClient();
  let title = 'old';
  transport.respondWith(() => ({ status: 200, headers: {}, json: { items: [{ id: 'one', title, author: '' }], total: 1, page: 1, pageSize: 60 } }));
  const runtime = { api, offline: { books: () => [], replaceBooks: async () => {} } } as unknown as AppRuntime;
  try {
    expect((await client.fetchQuery(shelfQuery(runtime, 1, sort))).items[0]!.title).toBe('old');
    title = 'updated on another device';
    await client.invalidateQueries({ queryKey: ['shelf'], refetchType: 'none' });
    expect((await client.fetchQuery(shelfQuery(runtime, 1, sort))).items[0]!.title).toBe('updated on another device');
    expect(transport.requests).toHaveLength(2);
    await client.fetchQuery(shelfQuery(runtime, 1, sort));
    expect(transport.requests).toHaveLength(2);
    vi.setSystemTime(Date.now() + 61_000);
    await client.fetchQuery(shelfQuery(runtime, 1, sort));
    expect(transport.requests).toHaveLength(3);
  } finally { client.clear(); }
});

it('shares persisted cover bytes between source details and other views before validation returns', async () => {
  const { api, transport } = await setup(), client = createAppQueryClient();
  const url = '/api/v1/books/one/cover';
  transport.respondWith(() => ({ status: 200, headers: { etag: '"one"' }, bytes: new Uint8Array([1]) }));
  await api.coverBytes(url);
  const releases: Array<(value: any) => void> = [];
  transport.respondWith(() => new Promise(resolve => releases.push(resolve)));
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = () => 'blob:audit'; static override revokeObjectURL = () => {}; });
  function Probe() { const src = useCover(api, url); return <aside className="audit-control">{src && <img src={src} />}</aside>; }
  const root = document.createElement('div'); document.body.append(root);
  const runtime = { api } as AppRuntime;
  const noop = () => {};
  try {
    act(() => render(<RuntimeContext.Provider value={runtime}><QueryClientProvider client={client}><MemoryRouter>
      <SourceBookDetails entry={{ ref: 'one', title: 'One', coverUrl: url, shelfBookId: 'one' }} sourceId="source" sourceName="Source" inShelf canPreview={false} onChapterCount={noop} onDirectoryOpenChange={noop} />
      <Probe />
    </MemoryRouter></QueryClientProvider></RuntimeContext.Provider>, root));
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    await vi.waitFor(() => expect(root.querySelector('.audit-control img')).not.toBeNull());
    expect(root.querySelector('.source-book-detail img')).not.toBeNull();
    expect(transport.requests).toHaveLength(2);
    await act(async () => { for (const release of releases) release({ status: 304, headers: {} }); });
    await vi.waitFor(() => expect(root.querySelector('.source-book-detail img')).not.toBeNull());
  } finally { act(() => render(null, root)); root.remove(); client.clear(); }
});
