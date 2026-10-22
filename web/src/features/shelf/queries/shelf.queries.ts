import { queryOptions, useQuery } from '@tanstack/react-query';
import { sortBooks } from '../../../ui/shelf-order.ts';
import { ApiError } from '../../../api/errors.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
export function shelfQuery(runtime: ReturnType<typeof useRuntime>, page = 1, sort: 'recent' | 'added' | 'title' | 'author' = 'recent', search = '') {
  const userId = runtime.api.currentSession()?.user.id;
  return queryOptions({ queryKey: ['shelf', runtime.api.baseUrl, userId, page, sort, search], staleTime: sort === 'recent' ? 0 : 60_000, queryFn: async ({ signal }) => {
    try {
      const response = await runtime.api.listBooks({ scope: 'shelf', page, pageSize: 60, sort, order: sort === 'title' || sort === 'author' ? 'asc' : 'desc', search: search.trim() }, { signal });
      if (runtime.api.currentSession()?.user.id === userId) await runtime.offline.replaceBooks(response.items).catch(() => undefined);
      return response;
    } catch (error) {
      if (!(error instanceof ApiError) || !error.isConnectivity || runtime.api.currentSession()?.user.id !== userId) throw error;
      const term = search.trim().toLocaleLowerCase();
      const books = runtime.offline.books().filter(book => `${book.title} ${book.author}`.toLocaleLowerCase().includes(term));
      if (!books.length) throw error;
      const sorted = sortBooks(books, sort, new Map(books.map(book => [book.id, runtime.offline.progressFor(book.id)?.updatedAt ?? 0])));
      return { items: sorted.slice((page - 1) * 60, page * 60), total: books.length, page, pageSize: 60 };
    }
  } });
}
export function useShelf(page = 1, sort: 'recent' | 'added' | 'title' | 'author' = 'recent', search = '') { return useQuery(shelfQuery(useRuntime(), page, sort, search)); }
