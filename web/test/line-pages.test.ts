import { describe, expect, it } from 'vitest';
import { paginateLines, nearestTextPage, type TextLine } from '../src/ui/line-pages.ts';

function assertWholeOnce(lines: TextLine[], height: number): void {
  const pages = paginateLines(lines, height);
  const visible = lines.map(() => 0);
  for (const page of pages) for (const [i, line] of lines.entries()) {
    const end = page.offset + page.visibleHeight;
    if (line.top >= page.offset && line.bottom <= end) visible[i]!++;
    else expect(line.bottom <= page.offset || line.top >= end).toBe(true);
  }
  expect(visible).toEqual(lines.map(() => 1));
}

describe('whole-line pagination', () => {
  it('keeps variable headings and paragraph gaps whole without repeating text', () => {
    const lines = [{top:20,bottom:49}, ...Array.from({length:43}, (_,i) => {
      const top = 75 + i * 31.7 + Math.floor(i/3) * 10.4;
      return {top,bottom:top+23.9};
    })];
    for (const height of [187, 351, 723, 777]) assertWholeOnce(lines,height);
  });
  it('does not move a short last page backwards to fill the viewport', () => {
    const lines = Array.from({length:11},(_,i) => ({top:20+i*30,bottom:40+i*30}));
    const pages = paginateLines(lines,150);
    expect(pages.map(p=>p.offset)).toEqual([0,139,289]);
    expect(pages.at(-1)!.visibleHeight).toBe(52);
    assertWholeOnce(lines,150);
  });
  it('combines inline fragments on the same row', () => {
    expect(paginateLines([{top:20,bottom:40},{top:21,bottom:42},{top:50,bottom:70}],65))
      .toEqual([{offset:0,visibleHeight:43},{offset:49,visibleHeight:22}]);
  });
  it('keeps a single short chapter on its first page', () => {
    expect(paginateLines([{top:20,bottom:40}],700)).toEqual([{offset:0,visibleHeight:41}]);
  });
  it('ignores empty or invalid geometry', () => {
    expect(paginateLines([{top:0,bottom:0},{top:NaN,bottom:2}],700)).toEqual([]);
    expect(paginateLines([{top:20,bottom:40}],0)).toEqual([]);
  });
  it('makes progress even when a text row is taller than the viewport', () => {
    expect(paginateLines([{top:20,bottom:340},{top:350,bottom:370}],150)).toHaveLength(2);
  });
});

it('restores the nearest page despite saved fraction rounding', () => {
  const pages = [{offset:0,visibleHeight:700},{offset:731,visibleHeight:700},{offset:201000,visibleHeight:300}];
  const saved = Number((731 / 201000).toFixed(4));
  expect(nearestTextPage(pages,saved * 201000)).toBe(1);
});
