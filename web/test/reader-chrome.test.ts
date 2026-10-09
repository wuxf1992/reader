import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
/**
 * The reader's chrome, as a function of its state.
 *
 * Two of the reported defects live entirely in this tree, and both are the kind a
 * screenshot review cannot separate from a styling problem:
 *
 *  - the quick-action rail held five sheet-opening destinations, so it was a second
 *    settings panel floating over the text (竖排工具栏去掉 目录、字体、行距、边距、设置);
 *  - the read-aloud bar's controls were a single flex row, so on a phone the last
 *    of them — stop — was pushed off the right edge and the reader could not stop
 *    the voice at all (没法停止).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement as h } from 'react';
import { ReaderChrome, type ChromeState, type ChromeHandlers } from '../src/ui/reader-chrome.tsx';

afterEach(async () => {
  await act(async () => { for (const element of [...document.body.children]) render(null, element); });
  document.body.replaceChildren();
});

function chromeState(overrides: Partial<ChromeState> = {}): ChromeState {
  return {
    title: '书',
    author: '',
    chromeVisible: true,
    statusText: '',
    statusState: 'idle',
    progress: 0.2,
    chapterLabel: '第 1 章',
    tocOpen: false,
    settingsOpen: false,
    toc: [],
    currentSectionId: '',
    pageInChapter: 1,
    chapterPages: 3,
    chapterIndex: 1,
    chapterCount: 10,
    navigating: false,
    tts: {
      active: false,
      state: 'idle',
      label: '',
      chip: '从头朗读',
      index: 0,
      total: 0,
      sentenceIndex: -1,
      sentenceTotal: 0,
    },
    layout: 'reflowable',
    format: 'epub',
    mode: 'scroll',
    fontScale: 1,
    lineHeight: 'inherit',
    theme: 'light',
    fit: 'contain',
    fontFamily: 'inherit',
    pageMargin: 1.5,
    textAlign: 'inherit',
    brightness: 1,
    pageAnimation: 'slide',
    tapZone: 'standard',
    txtEncoding: '',
    txtIndent: 2,
    txtParagraphGap: 0.55,
    comicDirection: 'ltr',
    ttsRate: 1,
    ttsPitch: 1,
    ttsVolume: 1,
    ttsVoice: '',
    ttsAutoAdvance: true,
    ttsEngine: 'auto',
    showFitRow: false,
    showDirectionRow: false,
    showEncodingRow: false,
    showTxtRows: false,
    showEngineRow: false,
    showPitchRow: true,
    showVoiceRow: true,
    speechUnavailable: false,
    engineOptions: [{ value: 'auto', label: '自动' }],
    voices: [{ value: '', label: '跟随系统' }],
    ...overrides,
  } as ChromeState;
}

/** Every handler is a no-op: this file asserts the tree, not the behaviour. */
function handlers(): ChromeHandlers {
  const noop = (): void => undefined;
  return {
    onBack: noop,
    toggleToc: noop,
    toggleSettings: noop,
    onSetting: noop,
    onSpeechSetting: noop,
    onVoice: noop,
    onSpeakFromHere: noop,
    onSwitchEngine: noop,
    onTocEntry: noop,
    onChapter: noop,
    onScrubPage: noop,
    onTurnPage: noop,
    onSpeechToggle: noop,
    onSpeechPrevious: noop,
    onSpeechNext: noop,
    onSpeechScrub: noop,
    onStopSpeech: noop,
  } as unknown as ChromeHandlers;
}

describe('ReaderChrome', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });

  function paint(state: Partial<ChromeState>): HTMLElement {
    const stage = document.createElement('div');
    stage.className = 'stage';
    render(h(ReaderChrome, { state: chromeState(state), stage, handlers: handlers() }), container);
    return container;
  }

  it('shows delayed loading only on the selected chapter and clears it when navigation ends', () => {
    vi.useFakeTimers();
    const toc = [{ id: 'one', label: '第一章', depth: 0, spine: 0 }, { id: 'two', label: '第二章', depth: 0, spine: 1 }];
    try {
      act(() => { paint({ tocOpen: true, toc, navigating: true, pendingChapterRef: 'two' }); });
      const first = container.querySelector<HTMLButtonElement>('[data-section=one] button')!;
      const second = container.querySelector<HTMLButtonElement>('[data-section=two] button')!;
      expect(first.disabled).toBe(true); expect(second.getAttribute('aria-busy')).toBe('true');
      expect(container.querySelector('.busy-spinner')).toBeNull();
      act(() => { vi.advanceTimersByTime(100); });
      expect(first.querySelector('.busy-spinner')).toBeNull();
      expect(second.querySelector('.busy-spinner')).not.toBeNull();
      act(() => { paint({ tocOpen: true, toc, navigating: false }); });
      expect(container.querySelector('.busy-spinner')).toBeNull();
      expect(second.disabled).toBe(false);
    } finally { act(() => { render(null, container); }); vi.useRealTimers(); }
  });

  it('centres the current chapter inside the list without scrolling the app', () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const heights = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('panel-body') ? 320 : 40;
    });
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const body = this.closest('.panel-body');
      const index = this.matches('.toc-list button') ? this.querySelector('.toc-index')?.textContent : null;
      return { top: 1000 + (index ? (Number(index) - 1) * 40 - body!.scrollTop : 0) } as DOMRect;
    });
    try {
      const toc = Array.from({ length: 50 }, (_, i) => ({ id: 'ch' + i, label: '第 ' + (i + 1) + ' 章', depth: 0, spine: i }));
      paint({ tocOpen: false, toc, currentSectionId: 'ch41' });
      let tree = paint({ tocOpen: true, toc, currentSectionId: 'ch41' });
      expect(tree.querySelector('.panel-body')?.scrollTop).toBe(1500);
      expect(tree.querySelector('[aria-current="true"] .toc-label')?.textContent).toBe('第 42 章');
      tree = paint({ tocOpen: true, toc, currentSectionId: 'ch30' });
      expect(tree.querySelector('.panel-body')?.scrollTop).toBe(1060);
      paint({ tocOpen: false, toc, currentSectionId: 'ch41' });
      tree = paint({ tocOpen: true, toc, currentSectionId: 'ch41' });
      expect(tree.querySelector('.panel-body')?.scrollTop).toBe(1500);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
      heights.mockRestore();
      rects.mockRestore();
    }
  });

  it('marks only cached chapters and keeps the chapter name separate', () => {
    const tree = paint({ tocOpen: true, currentSectionId: 'one', toc: [
      { id: 'one', label: '第一章', depth: 0, spine: 0, cached: true },
      { id: 'two', label: '第二章', depth: 0, spine: 1, cached: false },
    ] });
    expect(tree.querySelector('[data-section="one"] .toc-cached')?.textContent).toBe('已缓存');
    expect(tree.querySelector('[data-section="one"] .toc-label')?.textContent).toBe('第一章');
    expect(tree.querySelector('[data-section="two"] .toc-cached')).toBeNull();
  });

  it('places contents before tools in the bottom toolbar', () => {
    const stage = document.createElement('div');
    render(h(ReaderChrome, { state: chromeState(), stage,
      handlers: { ...handlers(), onTools: () => {} } }), container);
    const labels = [...container.querySelectorAll('.reader-actions button')].map(button => button.textContent?.trim());
    expect(labels.indexOf('目录')).toBeLessThan(labels.indexOf('工具'));
    expect(labels.indexOf('目录')).toBeGreaterThanOrEqual(0);
  });

  it('keeps only the page-local controls on the rail', () => {
    // 主题 / 字号 / 听书. The five that were removed all open or reach the settings
    // sheet, so having them on the rail as well made it a worse copy of that sheet
    // floating over the text.
    const tree = paint({});
    const rail = tree.querySelector('.reader-rail');
    expect(rail).not.toBeNull();
    const labels = [...(rail?.querySelectorAll('.rail-button') ?? [])].map((button) =>
      button.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['夜间']);
    for (const gone of ['目录', '字体', '行距', '页边距', '阅读设置']) {
      expect(labels).not.toContain(gone);
    }
  });

  it.each([
    ['wechat-day', '微信阅读', '日间', 'wechat-night', '夜间'],
    ['wechat-night', '微信阅读', '夜间', 'wechat-day', '日间'],
    ['houmo-day', '厚墨', '日间', 'houmo-night', '夜间'],
    ['houmo-night', '厚墨', '夜间', 'houmo-day', '日间'],
  ] as const)('selects %s and switches within the same theme family', (theme, family, label, opposite, action) => {
    const callbacks = { ...handlers(), onSetting: vi.fn() };
    const stage = document.createElement('div');
    render(h(ReaderChrome, { state: chromeState({ theme, settingsOpen: true, settingsTab: 'appearance' }), stage, handlers: callbacks }), container);
    const native = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="内置"] button')];
    expect(native.map(button => button.textContent)).toEqual(['白', '米黄', '浅绿', '夜间']);
    const options = [...container.querySelectorAll<HTMLButtonElement>(`[aria-label="${family}"] button`)];
    expect(options).toHaveLength(2);
    const selected = options.find(button => button.textContent === label)!;
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    selected.click();
    expect(callbacks.onSetting).toHaveBeenLastCalledWith({ theme });
    const rail = container.querySelector<HTMLButtonElement>('.reader-rail .rail-button')!;
    expect(rail.getAttribute('aria-label')).toBe(action);
    rail.click();
    expect(callbacks.onSetting).toHaveBeenLastCalledWith({ theme: opposite });
  });

  it('offers refresh only in the chapter publication contents panel and disables it while busy', () => {
    expect(paint({ tocOpen: true }).textContent).not.toContain('刷新目录');
    let tree = paint({ tocOpen: true, canRefresh: true });
    expect([...tree.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '刷新目录')?.disabled).toBe(false);
    tree = paint({ tocOpen: true, canRefresh: true, refreshing: true });
    expect([...tree.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '刷新目录')?.disabled).toBe(true);
  });

  it('uses chapter pages for the slider even when the book has many fixed pages', () => {
    const tree = paint({ layout: 'fixed', chapterIndex: 50, chapterCount: 100, chapterPages: 1, pageInChapter: 1 });
    const slider = tree.querySelector<HTMLInputElement>('.progress-scrubber')!;
    expect(slider.max).toBe('1');
    expect(slider.value).toBe('1');
    expect(slider.disabled).toBe(true);
    expect(slider.getAttribute('aria-label')).toBe('章节内页数');
  });

  it('separates appearance and behavior settings and omits text controls for comics', () => {
    let tree = paint({ settingsOpen: true, settingsTab: 'appearance' });
    expect(tree.querySelector('.panel')?.textContent).toContain('浅绿');
    expect(tree.querySelector('.panel')?.textContent).not.toContain('点击区域');
    tree = paint({ settingsOpen: true, settingsTab: 'behavior' });
    expect(tree.querySelector('.panel')?.textContent).toContain('点击区域');
    expect(tree.querySelector('.panel')?.textContent).not.toContain('字号');
    tree = paint({ settingsOpen: true, settingsTab: 'appearance', layout: 'fixed' });
    expect(tree.querySelector('.panel')?.textContent).not.toContain('字号');
  });

  it('draws every read-aloud control, including stop, in their own row', () => {
    const tree = paint({
      settingsOpen: true, settingsTab: 'speech',
      tts: {
        active: true,
        state: 'playing',
        label: '正文',
        chip: '3/10',
        index: 2,
        total: 10,
        sentenceIndex: 2,
        sentenceTotal: 10,
      },
    });
    const bar = tree.querySelector('.tts-bar');
    expect(bar).not.toBeNull();
    // The controls are one row of their own, so they divide the width evenly and
    // none of them is clipped — which is what made 停止 unreachable.
    const controls = bar?.querySelector('.tts-controls');
    expect(controls).not.toBeNull();
    const labels = [...(controls?.querySelectorAll('button') ?? [])].map((button) =>
      button.getAttribute('aria-label'),
    );
    expect(labels).toContain('停止朗读');
    expect(labels).toContain('暂停朗读');
    expect(labels).toContain('上一句');
    expect(labels).toContain('下一句');
    // The sentence and its scrubber are the second row, so the sentence can never
    // push a control out of the bar.
    expect(bar?.querySelector('.tts-progress .tts-range')).not.toBeNull();
  });

  it('stops the voice with a square, not an ✕', () => {
    // ✕ read as "close this bar", which is not what stop does: the reader who wanted
    // the voice to stop pressed it, the bar disappeared, and the book kept reading.
    const tree = paint({
      settingsOpen: true, settingsTab: 'speech',
      tts: {
        active: true,
        state: 'playing',
        label: '正文',
        chip: '1/2',
        index: 0,
        total: 2,
        sentenceIndex: 0,
        sentenceTotal: 2,
      },
    });
    const stop = [...tree.querySelectorAll('.tts-controls button')].find(
      (button) => button.getAttribute('aria-label') === '停止朗读',
    );
    expect(stop?.getAttribute('class')).toContain('tts-stop');
  });
});
