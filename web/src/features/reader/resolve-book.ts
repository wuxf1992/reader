import type { ReaderApi } from '../../api/client.ts';
import type { OfflineStore } from '../../store/offline.ts';

export async function resolveReaderBook(api: Pick<ReaderApi, 'getBook'>, offline: OfflineStore, bookId: string) {
  const cached = offline.books().find(book => book.id === bookId);
  if (cached) return cached;
  const book = (await api.getBook(bookId)).book;
  await offline.replaceBooks([book]).catch(() => undefined);
  return book;
}
