import { queryOptions } from '@tanstack/react-query';
import type { AppRuntime } from '../../../app/runtime.ts';
import type { ContinueReadingItem } from '../../../api/types.ts';
import { ApiError } from '../../../api/errors.ts';
import { combineAbortSignals } from '../../../core/abort.ts';

export function readingQuery(runtime: AppRuntime) {
  const baseUrl = runtime.api.baseUrl;
  const userId = runtime.api.currentSession()?.user.id;
  const sameScope = () => runtime.api.baseUrl === baseUrl && runtime.api.currentSession()?.user.id === userId;
  const cachedReading = (): ContinueReadingItem[] => {
    if (!userId || !sameScope()) return [];
    const local = runtime.offline.books().flatMap(book => {
      const progress = runtime.offline.progressFor(book.id);
      return progress ? [{ ...book, percentage: progress.percentage, chapterTitle: progress.chapterTitle, lastReadAt: progress.updatedAt }] : [];
    });
    return [...local, ...(runtime.offline.current.continueReading ?? [])]
      .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0)).slice(0, 1);
  };
  return queryOptions<ContinueReadingItem[]>({
    queryKey: ['home', 'reading', baseUrl, userId],
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: 'always',
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const combined = combineAbortSignals([signal, controller.signal]);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        // Keep a shared token refresh running; only bound this page's wait.
        const response = await Promise.race([
          runtime.api.continueReading(1, { signal: combined.signal, fresh: true }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              reject(new ApiError('offline', '读取在读的书超时', 'TIMEOUT'));
              controller.abort(new DOMException('request timed out', 'TimeoutError'));
            }, 8000);
          }),
        ]);
        if (sameScope()) void runtime.offline.cacheContinueReading(response).catch(() => undefined);
        return response;
      } catch (error) {
        if (!(error instanceof ApiError) || (!error.isConnectivity && error.kind !== 'server')) throw error;
        const cached = cachedReading();
        if (!cached.length) throw error;
        return cached;
      } finally { clearTimeout(timeout); combined.dispose(); }
    },
    placeholderData: () => {
      const cached = cachedReading();
      return cached.length ? cached : undefined;
    },
  });
}
