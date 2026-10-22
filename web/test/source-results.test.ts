import { expect, it } from 'vitest';
import { groupSourceResults, sourceChapterCount, sourceChapterLabel } from '../src/ui/source-results.ts';

it('groups normalized titles and author sets but preserves each unique reference', () => {
  const entries = [
    { ref: 'a', title: 'Ａ书', authors: ['作者甲', '作者乙'] },
    { ref: 'b', title: 'A 书', authors: ['作者乙', '作者甲'] },
    { ref: 'c', title: 'A书', authors: ['另一作者'] },
    { ref: 'd', title: 'A书' }, { ref: 'e', title: 'A书', authors: [' '] },
  ];
  const groups = groupSourceResults([...entries, entries[0]!], true);
  expect(groups).toHaveLength(4);
  expect(groups[0]!.entries.map(entry => entry.ref)).toEqual(['a', 'b']);
  expect(groupSourceResults(entries, false)).toHaveLength(5);
});

it('merges the same author’s 高塔之上 punctuation variants without mixing another author’s book', () => {
  const entries = [
    { ref: 'a', title: '高塔之上！', authors: ['风风忙忙'] },
    { ref: 'b', title: '高塔之上', authors: ['风风忙忙'] },
    { ref: 'c', title: '《高塔之上》', authors: ['风风忙忙'] },
    { ref: 'd', title: '高塔之上', authors: ['诗停云'] },
    { ref: 'e', title: '高塔之上' },
  ];
  const initial = groupSourceResults([entries[0]!], true);
  const groups = groupSourceResults(entries, true);
  expect(groups).toHaveLength(3);
  expect(groups[0]!.key).toBe(initial[0]!.key);
  expect(groups[0]!.entries.map(entry => entry.ref)).toEqual(['a', 'b', 'c']);
  expect(groups[1]!.entries.map(entry => entry.ref)).toEqual(['d']);
  expect(groupSourceResults(entries, false)).toHaveLength(5);
});

it('accepts chapter totals but never infers a count from the latest chapter title', () => {
  expect(sourceChapterLabel({ ref: 'a', title: '书', latestChapter: '第999章' })).toBe('章数待获取');
  expect(sourceChapterLabel({ ref: 'a', title: '书', metadata: { chapterCount: 205 } })).toBe('共 205 章');
  for (const chapterCount of [-1, 1.5, '205', NaN, Infinity]) expect(sourceChapterCount({ ref: 'a', title: '书', metadata: { chapterCount } })).toBeUndefined();
});
