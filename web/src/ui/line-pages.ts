/** Text geometry in the chapter's vertical coordinate space. */
export interface TextLine { top: number; bottom: number }
export interface TextPage { offset: number; visibleHeight: number }

/** Split actual lines, allowing paragraph gaps and headings to have different heights. */
export function paginateLines(boxes: readonly TextLine[], height: number): TextPage[] {
  if (!(height > 0)) return [];
  const lines: TextLine[] = [];
  for (const box of [...boxes].filter(b => Number.isFinite(b.top) && Number.isFinite(b.bottom) && b.bottom > b.top)
    .sort((a, b) => a.top - b.top)) {
    const previous = lines.at(-1);
    // Inline fragments (emphasis, search highlights) share a row. Count it once.
    if (previous && box.top < previous.bottom - 0.5) previous.bottom = Math.max(previous.bottom, box.bottom);
    else lines.push({ ...box });
  }
  const pages: TextPage[] = [];
  for (let first = 0; first < lines.length;) {
    const line = lines[first]!;
    const offset = pages.length === 0 && line.bottom <= height - 1 ? 0 : Math.max(0, Math.floor(line.top - 1));
    let next = first + 1;
    while (next < lines.length && lines[next]!.bottom <= offset + height - 1) next++;
    const last = lines[next - 1]!;
    // Leave paper below the last whole line. Never expose the first part of the next.
    const boundary = Math.min(offset + height, Math.ceil(last.bottom + 1), lines[next]?.top ?? Infinity);
    pages.push({ offset, visibleHeight: Math.max(1, boundary - offset) });
    first = next;
  }
  return pages;
}

/** Saved fractions are rounded. Restore the closest boundary, not the preceding page. */
export function nearestTextPage(pages: readonly TextPage[], offset: number): number {
  let nearest = 0;
  for (let i = 1; i < pages.length; i++) {
    if (Math.abs(pages[i]!.offset - offset) < Math.abs(pages[nearest]!.offset - offset)) nearest = i;
  }
  return nearest;
}
