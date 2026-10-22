// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/store/settings.ts';
import { applyBrowserTheme, applyTheme, loadSettings, saveSettings } from '../src/ui/settings.ts';
import { DEFAULT_SETTINGS, readerCss } from '../src/render/theme.ts';
import { PALETTES, type ThemeMode } from '../src/render/theme.ts';
import { readFileSync } from 'node:fs';

const themes = Object.entries(PALETTES).map(([id, palette]) => [id as ThemeMode, palette.background] as const);

it('keeps the original WeChat dark colors alongside the new soft gray theme and parchment', () => {
  expect(PALETTES['wechat-night']).toEqual({ label: '微信夜间', name: '纯黑夜读', scheme: 'dark',
    background: '#000000', text: '#d8d4cc', muted: '#9a9fa8', surface: '#1a1a1a',
    line: '#33363b', accent: '#3897f1', onAccent: '#111111' });
  expect(PALETTES['wechat-soft-night']).toEqual({ label: '微信柔灰夜间', name: '柔灰夜读', scheme: 'dark',
    background: '#1b1b1b', text: '#b6b6b1', muted: '#94948f', surface: '#1f1f1f',
    line: '#3b3b39', accent: '#b0b0a8', onAccent: '#1b1b1b' });
  expect(PALETTES['parchment-day'].label).toBe('羊皮纸');
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.readerBrightness;
  delete document.documentElement.dataset.readerChrome;
  delete document.documentElement.dataset.readerScrim;
  document.head.innerHTML = '';
});

describe('Legado themes', () => {
  it.each(themes)('restores %s and applies its page and browser background', async (theme, background) => {
    const values = new Map<string, string>();
    const kv = { get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => { values.set(key, value); },
      remove: async (key: string) => { values.delete(key); } };
    const store = new SettingsStore(kv);
    await store.load();
    await store.update({ theme, fontScale: 1.3 });
    expect(await new SettingsStore(kv).load()).toMatchObject({ theme, fontScale: 1.3 });
    saveSettings({ ...DEFAULT_SETTINGS, theme });
    expect(loadSettings().theme).toBe(theme);
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff"><meta name="apple-mobile-web-app-status-bar-style" content="default">';
    applyTheme(document.documentElement, theme);
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.documentElement.style.colorScheme).toBe(PALETTES[theme].scheme);
    expect(document.documentElement.style.getPropertyValue('--reader-paper')).toBe(background);
    expect(document.querySelector('meta')?.getAttribute('content')).toBe(background);
    expect(readerCss('.book', { ...DEFAULT_SETTINGS, theme })).toContain(`--reader-bg: ${background};`);
  });

  it.each([{ theme: 'unknown' }, { theme: 'toString' }, { theme: '__proto__' }, { theme: null }, { theme: ['dark'] }])('falls back for invalid stored theme $theme', async ({ theme }) => {
    const store = new SettingsStore({ get: async () => JSON.stringify({ theme, fontScale: 1.3 }), set: async () => {}, remove: async () => {} });
    expect(await store.load()).toMatchObject({ theme: 'light', fontScale: 1.3 });
    localStorage.setItem('reader.settings', JSON.stringify({ theme }));
    expect(loadSettings().theme).toBe('light');
  });
});

it('keeps browser tint dimmed through theme updates and restores it outside the reader', () => {
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff">';
  const root = document.documentElement;
  root.dataset.readerBrightness = '0.5';
  applyTheme(root, 'kraft-day');
  expect(document.querySelector('meta')?.content).toBe('#6d614e');
  expect(root.style.getPropertyValue('--reader-paper')).toBe('#d9c29b');
  expect(root.style.getPropertyValue('--reader-browser-paper')).toBe('#6d614e');
  applyTheme(root, 'wechat-soft-night');
  expect(document.querySelector('meta')?.content).toBe('#0e0e0e');
  delete root.dataset.readerBrightness;
  applyBrowserTheme(root, 'wechat-soft-night');
  expect(document.querySelector('meta')?.content).toBe('#1b1b1b');
});

it('matches the visible header, returns to the page when hidden, and resets outside reading', () => {
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff">';
  const root = document.documentElement;
  root.dataset.readerBrightness = '0.5';
  root.dataset.readerChrome = 'visible';
  applyTheme(root, 'green');
  expect(document.querySelector('meta')?.content).toBe('#747974');
  expect(root.style.getPropertyValue('--reader-browser-paper')).toBe('#747974');
  expect(root.style.getPropertyValue('--reader-paper')).toBe('#d5ecd7');
  root.dataset.readerChrome = 'hidden';
  applyBrowserTheme(root, 'green');
  expect(document.querySelector('meta')?.content).toBe('#6b766c');
  root.dataset.readerChrome = 'visible';
  applyTheme(root, 'dark');
  expect(document.querySelector('meta')?.content).toBe('#0f1012');
  delete root.dataset.readerChrome; delete root.dataset.readerBrightness;
  applyBrowserTheme(root, 'dark');
  expect(document.querySelector('meta')?.content).toBe('#16171a');
});

it('matches the visible header under the settings backdrop and restores it when closed', () => {
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff">';
  const root = document.documentElement;
  root.dataset.readerChrome = 'visible'; root.dataset.readerBrightness = '0.5'; root.dataset.readerScrim = 'visible';
  root.style.setProperty('--reader-scrim-color', '#000000'); root.style.setProperty('--reader-scrim-opacity', '0.42');
  applyTheme(root, 'green');
  expect(document.querySelector('meta')?.content).toBe('#434643');
  root.dataset.readerScrim = 'hidden'; applyBrowserTheme(root, 'green');
  expect(document.querySelector('meta')?.content).toBe('#747974');
});

it.each([
  ['rose-pine-dawn-day', 'nord-night'],
  ['flexoki-day', 'flexoki-night'],
  ['everforest-day', 'everforest-night'],
  ['kraft-day', 'flexoki-night'],
  ['parchment-day', 'wechat-night'],
  ['parchment-day', 'wechat-soft-night'],
] as const)('remembers %s and %s when themes change from either settings screen', async (day, night) => {
  const values = new Map<string, string>();
  const kv = { get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value); }, remove: async () => {} };
  const store = new SettingsStore(kv);
  await store.load();
  await store.update({ theme: day });
  await store.update({ theme: night });
  expect(await new SettingsStore(kv).load()).toMatchObject({ theme: night,
    lastDayTheme: day, lastNightTheme: night });
});

it.each(['lastDayTheme', 'lastNightTheme'] as const)('rejects invalid remembered %s', async key => {
  for (const value of ['__proto__', 'unknown', null, ['dark'], key === 'lastDayTheme' ? 'nord-night' : 'solarized-day']) {
    const store = new SettingsStore({ get: async () => JSON.stringify({ [key]: value }), set: async () => {}, remove: async () => {} });
    expect((await store.load())[key]).toBe(key === 'lastDayTheme' ? 'light' : 'dark');
  }
});

it.each([[0, 0.5], [-1, 0.5], [0.35, 0.5], [0.75, 0.75], [2, 1], [null, 1], ['0.1', 1]])(
  'restores brightness %s without allowing a black screen', async (brightness, expected) => {
    const store = new SettingsStore({ get: async () => JSON.stringify({ brightness }), set: async () => {}, remove: async () => {} });
    expect((await store.load()).brightness).toBe(expected);
  });

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const rgb = hex.slice(1).match(/../g)!.map(channel => {
      const value = parseInt(channel, 16) / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + .05) / (values[1]! + .05);
}

it.each(Object.entries(PALETTES))('%s keeps text, captions and actions readable', (_, palette) => {
  for (const background of [palette.background, palette.surface]) {
    for (const foreground of [palette.text, palette.muted, palette.accent]) {
      expect(contrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(contrast(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
});

it('restores a night background before the application bundle and ignores invalid cached colors', () => {
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff"><meta name="apple-mobile-web-app-status-bar-style" content="default">';
  const html = readFileSync('index.html', 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  applyTheme(document.documentElement, 'nord-night');
  document.documentElement.removeAttribute('style');
  new Function(script)();
  expect(document.documentElement.style.getPropertyValue('--reader-paper')).toBe('#2e3440');
  expect(document.documentElement.style.colorScheme).toBe('dark');
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#2e3440');
  document.documentElement.removeAttribute('style');
  localStorage.setItem('reader.theme-color', 'url(https://example.com)');
  new Function(script)();
  expect(document.documentElement.style.getPropertyValue('--reader-paper')).toBe('');
});

it('restores the dimmed browser background at startup and rejects an invalid cached tint', () => {
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff"><meta name="apple-mobile-web-app-status-bar-style" content="default">';
  const script = readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1]!;
  document.documentElement.dataset.readerBrightness = '0.5';
  applyTheme(document.documentElement, 'kraft-day');
  document.documentElement.removeAttribute('style');
  new Function(script)();
  expect(document.documentElement.style.getPropertyValue('--reader-browser-paper')).toBe('#6d614e');
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#6d614e');
  localStorage.setItem('reader.browser-color', 'url(https://example.com)');
  new Function(script)();
  expect(document.documentElement.style.getPropertyValue('--reader-browser-paper')).toBe('#d9c29b');
});


it('migrates an existing day theme and rejects invalid remembered settings', async () => {
  const store = new SettingsStore({ get: async () => JSON.stringify({ theme: 'sepia',
    readerSections: { readout: false, text: 'false', theme: null } }), set: async () => {}, remove: async () => {} });
  expect(await store.load()).toMatchObject({ lastDayTheme: 'sepia',
    readerSections: { readout: false, text: true, theme: true, paging: true } });
  const invalid = new SettingsStore({ get: async () => JSON.stringify({ theme: 'dark', lastDayTheme: 'dark' }),
    set: async () => {}, remove: async () => {} });
  expect((await invalid.load()).lastDayTheme).toBe('light');
});
