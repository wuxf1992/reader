// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ChineseChapterText, chineseSearchQueries, chineseText, type ChineseVariant } from '../src/render/chinese.ts';
import { anchorFor, anchorRange, textNodes } from '../src/ui/text-anchor.ts';
import { MemoryKv } from './helpers/env.ts';
import { SettingsStore } from '../src/store/settings.ts';

describe('Chinese text variants', () => {
  it('converts phrases in both directions and leaves original text intact', () => {
    const simplified = '头发发展，干净干活，皇后后来。';
    const traditional = '頭髮發展，乾淨幹活，皇后後來。';
    expect(chineseText(simplified, 'traditional')).toBe(traditional);
    expect(chineseText(traditional, 'simplified')).toBe(simplified);
    expect(chineseText('😀神你 English <b>原文</b>', 'original')).toBe('😀神你 English <b>原文</b>');
  });

  it('changes only text nodes, preserves markup and maps selections to the actual source', () => {
    const root = document.createElement('div');
    root.innerHTML = '<style>.头发{color:red}</style><p id="头发" title="头发">头发<b>发展</b></p><p>頭髮</p>';
    const source = textNodes(root).map(node => node.data).join('');
    const converted = new ChineseChapterText(root, 'traditional');
    expect(root.querySelector('p')?.textContent).toBe('頭髮發展');
    expect(root.querySelector('style')?.textContent).toContain('.头发');
    expect(root.querySelector('p')?.id).toBe('头发');
    expect(root.querySelector('p')?.title).toBe('头发');
    const shown = textNodes(root).map(node => node.data).join('');
    const first = converted.sourceAnchor(anchorFor('s', shown, 0, 4));
    expect(first.quote).toBe('头发发展');
    expect(first).toEqual(anchorFor('s', source, 0, 4));
    const alreadyTraditional = converted.sourceAnchor(anchorFor('s', shown, 4, 6));
    expect(alreadyTraditional.quote).toBe('頭髮');
    expect(anchorRange(root, converted.displayAnchor(first)!)?.toString()).toBe('頭髮發展');
    expect(converted.displayAnchor({ ...first, quote: '不存在', prefix: '', suffix: '' })).toBeNull();
  });

  it.each(['simplified', 'traditional'] as ChineseVariant[])('keeps anchors across length-changing Unicode normalization in %s', variant => {
    const root = document.createElement('div');
    root.innerHTML = '<p>😀你頭髮</p><p>后续𠮷字</p>';
    const original = textNodes(root).map(node => node.data).join('');
    const converted = new ChineseChapterText(root, variant);
    const displayed = textNodes(root).map(node => node.data).join('');
    expect(displayed.length).toBe(original.length - 1);
    for (const [start, end] of [[2, 4], [4, 6], [4, original.length], [6, original.length]]) {
      const sourceAnchor = anchorFor('s', original, start!, end!);
      const displayAnchor = converted.displayAnchor(sourceAnchor)!;
      expect(anchorRange(root, displayAnchor)?.toString()).toBe(displayAnchor.quote);
      expect(converted.sourceAnchor(displayAnchor)).toEqual(sourceAnchor);
      expect(converted.displayOffset(start!)).toBe(displayAnchor.start);
      expect(converted.sourceOffset(displayAnchor.start)).toBe(start);
    }
  });

  it('tries both common scripts for converted reading and avoids duplicate searches', () => {
    expect(chineseSearchQueries('头发', 'traditional')).toEqual(['头发', '頭髮']);
    expect(chineseSearchQueries('頭髮', 'simplified')).toEqual(['頭髮', '头发']);
    expect(chineseSearchQueries('abc', 'traditional')).toEqual(['abc']);
    expect(chineseSearchQueries('头发', 'original')).toEqual(['头发']);
  });

  it('persists one device-wide preference and repairs invalid or older preferences', async () => {
    const kv = new MemoryKv(), store = new SettingsStore(kv);
    expect((await store.load()).chineseVariant).toBe('original');
    await store.update({ chineseVariant: 'traditional' });
    expect((await new SettingsStore(kv).load()).chineseVariant).toBe('traditional');
    for (const value of [null, 'tw', {}, 1]) {
      await kv.set('reader.settings.v1', JSON.stringify({ chineseVariant: value, theme: 'sepia' }));
      expect(await new SettingsStore(kv).load()).toMatchObject({ chineseVariant: 'original', theme: 'sepia' });
    }
  });
});
