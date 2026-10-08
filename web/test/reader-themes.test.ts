// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/store/settings.ts';
import { applyTheme, loadSettings, saveSettings } from '../src/ui/settings.ts';
import { DEFAULT_SETTINGS, readerCss } from '../src/render/theme.ts';

const themes = [
  ['wechat-day', '#f4f5f7'],
  ['wechat-night', '#000000'],
  ['houmo-day', '#f9f2e8'],
  ['houmo-night', '#333949'],
] as const;

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
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
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff">';
    applyTheme(document.documentElement, theme);
    expect(document.documentElement.dataset.theme).toBe(theme);
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
