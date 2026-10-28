import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AppRuntime } from '../../../app/runtime.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { sortBooks } from '../../../ui/shelf-order.ts';
import { ApiError } from '../../../api/errors.ts';
import type { ReadingState } from '../../../api/types.ts';
import { withOfflineTimeout } from '../../../core/offline-timeout.ts';

/**
 * What narrows the shelf besides the search: 在读 / 想读 / 已读, and one 分组 — a
 * series or a tag, the two groupings the books themselves carry.
 */
export interface ShelfFilters { status?: ReadingState; series?: string; tag?: string }

export function shelfQuery(runtime: AppRuntime, page = 1, sort: 'recent' | 'added' | 'title' | 'author' = 'recent', search = '', filters: ShelfFilters = {}) {
  const baseUrl = runtime.api.baseUrl;
  const userId = runtime.api.currentSession()?.user.id;
  return queryOptions({
    queryKey: ['shelf', baseUrl, userId, page, sort, search, filters.status ?? '', filters.series ?? '', filters.tag ?? ''],
    staleTime: sort === 'recent' ? 0 : 60_000,
    queryFn: async ({ signal }) => {
      try {
        const response = await withOfflineTimeout(runtime.api.listBooks({
      scope: 'shelf', page, pageSize: 60, sort, order: sort === 'title' || sort === 'author' ? 'asc' : 'desc', search: search.trim(),
      ...(filters.status ? { status: filters.status } : {}), ...(filters.series ? { series: filters.series } : {}), ...(filters.tag ? { tag: filters.tag } : {}),
        }, { signal }), runtime.offline.books().length > 0);
        // replaceBooks upserts by id, so filtered pages preserve other cached books.
        if (runtime.api.baseUrl === baseUrl && runtime.api.currentSession()?.user.id === userId) {
          await runtime.offline.replaceBooks(response.items).catch(() => undefined);
        }
        return response;
      } catch (error) {
        if (!(error instanceof ApiError) || (!error.isConnectivity && error.kind !== 'server') || runtime.api.baseUrl !== baseUrl || runtime.api.currentSession()?.user.id !== userId) throw error;
        const term = search.trim().toLocaleLowerCase();
        const all = runtime.offline.books();
        if (!all.length) throw error;
        const books = all.filter(book => `${book.title} ${book.author}`.toLocaleLowerCase().includes(term)
          && (!filters.status || book.readingState === filters.status)
          && (!filters.series || book.series === filters.series)
          && (!filters.tag || book.tags?.includes(filters.tag)));
        const sorted = sortBooks(books, sort, new Map(books.map(book => [book.id, runtime.offline.progressFor(book.id)?.updatedAt ?? 0])));
        return { items: sorted.slice((page - 1) * 60, page * 60), total: books.length, page, pageSize: 60 };
      }
    },
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[1] === runtime.api.baseUrl
      && previousQuery.queryKey[2] === userId && previousQuery.queryKey[3] === page ? previousData : undefined,
  });
}

export function useShelf(page = 1, sort: 'recent' | 'added' | 'title' | 'author' = 'recent', search = '', filters: ShelfFilters = {}) {
  return useQuery(shelfQuery(useRuntime(), page, sort, search, filters));
}

/** Series and tags on this account's shelf: the choices behind 分组. */
export function useShelfGroups(enabled: boolean) {
  const runtime = useRuntime();
  return useQuery({
    queryKey: ['shelf-groups', runtime.api.baseUrl, runtime.api.currentSession()?.user.id],
    queryFn: ({ signal }) => runtime.api.facets({ signal }),
    enabled,
  });
}
