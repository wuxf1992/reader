import { Trie, type DictGroup } from 'opencc-js/core';
import { configs } from 'opencc-js/preset';
import { anchorFor, anchorOffset, textNodes, type TextAnchor } from '../ui/text-anchor.ts';
import type { ChineseVariant } from '../shared/chinese-variant.ts';
export type { ChineseVariant } from '../shared/chinese-variant.ts';

const tries = new Map<string, Trie[]>();
function conversion(variant: Exclude<ChineseVariant, 'original'>): Trie[] {
  let chain = tries.get(variant);
  if (!chain) {
    const config = (variant === 'simplified' ? configs.t2s! : configs.s2t!) as typeof configs[string] & { normalizationChain: readonly DictGroup[] };
    chain = [...config.normalizationChain, ...config.conversionChain].map(group => {
      const trie = new Trie(); trie.loadDictGroup(group); return trie;
    });
    tries.set(variant, chain);
  }
  return chain;
}

export function chineseText(text: string, variant: ChineseVariant): string {
  return variant === 'original' ? text : conversion(variant).reduce((value, trie) => trie.convert(value), text);
}

export function chineseSearchQueries(query: string, variant: ChineseVariant): string[] {
  return variant === 'original' ? [query] : [...new Set([query, chineseText(query, 'simplified'), chineseText(query, 'traditional')])];
}

interface Edit { sourceStart: number; sourceEnd: number; displayStart: number; displayEnd: number }
interface TextPart { source: string; display: string; edits: Edit[][] }

// Only length-changing replacements need an offset map; most Chinese text stays one character per character.
function convertPart(source: string, variant: ChineseVariant): TextPart {
  let display = source;
  const edits: Edit[][] = [];
  for (const trie of variant === 'original' ? [] : conversion(variant)) {
    const stage: Edit[] = [], output: string[] = [];
    let target = 0, i = 0;
    for (const segment of trie.segment(display)) {
      const end = i + segment.length;
      const value = trie.convert(segment);
      if (end - i !== value.length) stage.push({ sourceStart: i, sourceEnd: end, displayStart: target, displayEnd: target + value.length });
      output.push(value); target += value.length; i = end;
    }
    display = output.join(''); edits.push(stage);
  }
  return { source, display, edits };
}

function mapOffset(offset: number, edits: Edit[], reverse: boolean, end: boolean): number {
  let delta = 0;
  for (const edit of edits) {
    const fromStart = reverse ? edit.displayStart : edit.sourceStart, fromEnd = reverse ? edit.displayEnd : edit.sourceEnd;
    const toStart = reverse ? edit.sourceStart : edit.displayStart, toEnd = reverse ? edit.sourceEnd : edit.displayEnd;
    if (offset <= fromStart) return offset + delta;
    if (offset < fromEnd) return end ? toEnd : toStart;
    delta = toEnd - fromEnd;
  }
  return offset + delta;
}

/** Keeps annotations and corrections anchored to the source, including non-reversible conversions. */
export class ChineseChapterText {
  private readonly parts: TextPart[];
  private readonly source: string;
  private readonly display: string;

  constructor(root: HTMLElement, variant: ChineseVariant) {
    this.parts = textNodes(root).map(node => {
      const part = convertPart(node.data, variant);
      node.data = part.display; return part;
    });
    this.source = this.parts.map(part => part.source).join('');
    this.display = this.parts.map(part => part.display).join('');
  }

  sourceAnchor(anchor: TextAnchor): TextAnchor {
    return anchorFor(anchor.sectionId, this.source, this.offset(anchor.start, true, false), this.offset(anchor.end, true, true));
  }

  sourceOffset(offset: number): number { return this.offset(offset, true, false); }
  displayOffset(offset: number): number { return this.offset(offset, false, false); }

  displayAnchor(anchor: TextAnchor): TextAnchor | null {
    const start = anchorOffset(this.source, anchor);
    return start === null ? null : anchorFor(anchor.sectionId, this.display,
      this.offset(start, false, false), this.offset(start + anchor.quote.length, false, true));
  }

  private offset(offset: number, reverse: boolean, end: boolean): number {
    let from = 0, to = 0;
    for (const part of this.parts) {
      const fromText = reverse ? part.display : part.source, toText = reverse ? part.source : part.display;
      if (offset <= from + fromText.length) {
        let mapped = Math.max(0, offset - from);
        for (const stage of reverse ? [...part.edits].reverse() : part.edits) mapped = mapOffset(mapped, stage, reverse, end);
        return to + mapped;
      }
      from += fromText.length; to += toText.length;
    }
    return to;
  }
}
