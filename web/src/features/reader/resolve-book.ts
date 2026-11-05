import type { ReaderApi } from '../../api/client.ts';
import type { OfflineStore } from '../../store/offline.ts';
import type { PublicationCache } from '../../store/publications.ts';
import { ApiError } from '../../api/errors.ts';

export async function resolveReaderBook(api: Pick<ReaderApi, 'getBook'>, offline: OfflineStore, bookId: string, cache: Pick<PublicationCache, 'manifest'>) {
  const snapshot = offline.current;
  const cached = offline.books().find(book => book.id === bookId);
  if (cached) return cached;
  const book = await api.getBook(bookId).then(result => result.book).catch(async error => {
    if (!(error instanceof ApiError) || !error.isConnectivity) throw error;
    const manifest = await cache.manifest(bookId).catch(() => null);
    if (!manifest) throw error;
    return manifest.book;
  });
  if (offline.current !== snapshot) throw new ApiError('aborted', '阅读账号已切换');
  await offline.replaceBooks([book]).catch(() => undefined);
  return book;
}
