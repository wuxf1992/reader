// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { onlineManager as apiOnlineManager } from '@tanstack/query-core';
import { onlineManager as appOnlineManager, type QueryClient } from '@tanstack/react-query';
import { createAppQueryClient } from '../src/shared/query/query-client.ts';
import { ReaderApi } from '../src/api/client.ts';
import { ApiError } from '../src/api/errors.ts';
import { shelfQuery } from '../src/features/shelf/queries/shelf.queries.ts';
import type { AppRuntime } from '../src/app/runtime.ts';
import type { Book } from '../src/api/types.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';

let client: QueryClient | undefined;
afterEach(() => { client?.clear(); apiOnlineManager.setOnline(true); appOnlineManager.setOnline(true); });

it('reaches the local shelf fallback after a browser offline event, through both query layers', async () => {
  const transport = new FakeTransport();
  transport.failWith(new ApiError('offline', 'no network'));
  const api = new ReaderApi(makePlatform(transport), { load: async () => null, save: async () => {}, clear: async () => {} });
  const books = [{ id: 'cached', title: '离线书籍', author: '作者' }] as Book[];
  const runtime = { api, offline: { books: () => books, progressFor: () => null } } as unknown as AppRuntime;
  const queryClient = client = createAppQueryClient();
  apiOnlineManager.setOnline(false);
  appOnlineManager.setOnline(false);
  const result = await Promise.race([
    queryClient.fetchQuery(shelfQuery(runtime)),
    new Promise(resolve => setTimeout(() => resolve('query paused instead of reading local books'), 1000)),
  ]);
  expect(result).toMatchObject({ items: books, total: 1 });
  expect(transport.requests).toHaveLength(1);
});
