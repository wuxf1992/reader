import { describe, expect, it } from 'vitest';
import { mergePages } from '../src/features/sources/pages/SourceCatalogPage.tsx';

describe('source catalog page helpers', () => {
  it('merges streamed result batches by ref and keeps pagination metadata', () => {
    const first = mergePages(undefined, { items: [{ ref: 'a', title: 'A' }], nextCursor: 'next-1' });
    const second = mergePages(first, { items: [{ ref: 'a', title: 'A updated', latestChapter: '第 2 章' }, { ref: 'b', title: 'B' }], nextCursor: 'next-2', batch: { completed: 2, total: 3 } });
    expect(second.items).toEqual([{ ref: 'a', title: 'A updated', latestChapter: '第 2 章' }, { ref: 'b', title: 'B' }]);
    expect(second.nextCursor).toBe('next-2');
    expect(second.batch?.completed).toBe(2);
  });
});

it('reorders arriving batches by original relevance, source priority and title', async () => {
  const { groupSourceResults } = await import('../src/ui/source-results.ts');
  const entry = (ref: string, title: string, searchOrder: [number, number]) => ({ ref, title, authors: ['作者'], metadata: { searchOrder } });
  const slowExact = entry('legacy-exact', '剑来', [1, 0]);
  const first = mergePages(undefined, { items: [entry('related', '剑来续篇', [3, 0]), entry('native-related', '剑来外传', [2, 0])] });
  const second = mergePages(first, { items: [slowExact], nextCursor: 'next' });
  expect(second.items.map(item => item.ref)).toEqual(['legacy-exact', 'native-related', 'related']);
  const third = mergePages(second, { items: [entry('native-shen', '剑来', [0, 1])] });
  const fourth = mergePages(third, { items: [entry('native-qb5', '剑来', [0, 0]), entry('alpha', '阿书', [3, 0]), { ...slowExact, latestChapter: '新章节' }] });
  expect(fourth.items.map(item => item.ref)).toEqual(['native-qb5', 'native-shen', 'legacy-exact', 'native-related', 'alpha', 'related']);
  expect(groupSourceResults(fourth.items, true)[0]!.entries.map(item => item.ref)).toEqual(['native-qb5', 'native-shen', 'legacy-exact']);
  expect(fourth.items.find(item => item.ref === slowExact.ref)?.latestChapter).toBe('新章节');
  expect(first.items.map(item => item.ref)).toEqual(['native-related', 'related']);
});

it('keeps unranked providers in supplied order and ignores invalid sort metadata', () => {
  const entries = [{ ref: 'b', title: '乙书' }, { ref: 'a', title: '阿书', metadata: { searchOrder: ['bad', null] } }];
  expect(mergePages(undefined, { items: entries }).items).toEqual(entries);
});

it('keeps a previewed chapter count when later streamed metadata updates the same reference', async () => {
  const { withChapterCount } = await import('../src/ui/source-results.ts');
  const first = mergePages(undefined, { items: [{ ref: 'a', title: '书', metadata: { searchOrder: [1, 0] } }, { ref: 'b', title: '书' }], nextCursor: 'continue' });
  const counted = withChapterCount(first, 'a', 205);
  expect(counted?.nextCursor).toBe('continue');
  const merged = mergePages(counted, { items: [{ ref: 'a', title: '书', metadata: { searchOrder: [0, 1] } }], nextCursor: 'next' });
  expect(merged.items[0]?.metadata).toEqual({ chapterCount: 205, searchOrder: [0, 1] });
  expect(merged.items[1]?.metadata).toBeUndefined();
});
