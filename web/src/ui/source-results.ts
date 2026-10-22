import type { SourceEntry, SourcePage } from '../api/sources.ts';

export interface SourceResultGroup { key: string; entry: SourceEntry; entries: SourceEntry[] }
const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const normalizeTitle = (value: string) => normalize(value).replace(/[《》「」『』·：:，,。.!！?？()（）]/gu, '');

/** Group display rows, retaining every opaque reference for detail and acquisition. */
export function groupSourceResults(items: SourceEntry[], merge: boolean): SourceResultGroup[] {
  const groups = new Map<string, SourceResultGroup>(), refs = new Set<string>();
  for (const entry of items) {
    if (refs.has(entry.ref)) continue;
    refs.add(entry.ref);
    const title = normalizeTitle(entry.title), authors = [...new Set((entry.authors ?? []).map(normalize).filter(Boolean))].sort();
    // An absent author is not evidence that two identically named books are the same work.
    const key = merge && title && authors.length ? JSON.stringify(['book', title, authors]) : JSON.stringify(['entry', entry.ref]);
    let group = groups.get(key);
    if (!group) { group = { key, entry, entries: [] }; groups.set(key, group); }
    group.entries.push(entry);
  }
  return [...groups.values()];
}

/** The provider supplies query relevance; never interpret opaque book references. */
export function sortSourceResults(items: SourceEntry[]): SourceEntry[] {
  const order = (entry: SourceEntry) => {
    const value = entry.metadata?.searchOrder;
    return Array.isArray(value) && value.length === 2 && value.every(Number.isSafeInteger) ? value as [number, number] : undefined;
  };
  return items.sort((a, b) => {
    const left = order(a), right = order(b);
    return (left?.[0] ?? 4) - (right?.[0] ?? 4)
      || (left && right ? a.title.localeCompare(b.title, 'zh-CN') || left[1] - right[1] : 0);
  });
}

export function sourceChapterCount(entry: SourceEntry): number | undefined {
  const count = entry.metadata?.chapterCount;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}
export function sourceChapterLabel(entry: SourceEntry): string {
  const count = sourceChapterCount(entry);
  return count === undefined ? '章数待获取' : `共 ${count} 章`;
}
export function withChapterCount(page: SourcePage | undefined, ref: string, count: number): SourcePage | undefined {
  return page && { ...page, items: page.items.map(entry => entry.ref === ref ? { ...entry, metadata: { ...entry.metadata, chapterCount: count } } : entry) };
}
