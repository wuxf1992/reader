import { expect, it } from 'vitest';
import { OfflineStore, isOutboxEmpty } from '../src/store/offline.ts';
import { MemoryKv } from './helpers/env.ts';
import type { ContinueReadingItem } from '../src/api/types.ts';
const book = { id: 'b', title: 'Cached book', percentage: .4, chapterTitle: 'Chapter 2', lastReadAt: 20 } as ContinueReadingItem;
it('persists the last online continuation without inventing sync progress or changing the outbox', async () => {
  const kv = new MemoryKv(), store = new OfflineStore(kv);
  await store.setScope('account-a');
  await store.cacheContinueReading([book]);
  const reopened = new OfflineStore(kv); await reopened.setScope('account-a');
  expect(reopened.current.continueReading).toEqual([book]);
  expect(reopened.progressFor(book.id)).toBeUndefined();
  expect(isOutboxEmpty(reopened.current)).toBe(true);
  await reopened.setScope('account-b');
  expect(reopened.current.continueReading).toBeUndefined();
  await reopened.setScope('account-a');
  await reopened.removeBooks([book.id]);
  expect(reopened.current.continueReading).toEqual([]);
});
it('persists an authoritative empty response and keeps old cache formats readable', async () => {
  const kv = new MemoryKv(), store = new OfflineStore(kv);
  await store.load();
  expect(store.current.continueReading).toBeUndefined();
  await store.cacheContinueReading([book]);
  await store.cacheContinueReading([]);
  const reopened = new OfflineStore(kv); await reopened.load();
  expect(reopened.current.continueReading).toEqual([]);
});
