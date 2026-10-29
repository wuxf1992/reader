// @vitest-environment jsdom
import { render } from '../src/shared/ui/render-root.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { ThemeController, defaultThemePreference, migrateLegacyTheme, migrateAppearance, readThemePreference, resolveAppTheme, resolveReadingTheme, saveThemePreference, selectTheme, selectedTheme, selectThemeMode, themeOptions, themeSummary, themeTokens, type AppThemeId } from '../src/shared/theme/theme.ts';
import { PALETTES } from '../src/render/theme.ts';
import { ThemeSettings } from '../src/shared/theme/theme-settings.tsx';
import { useSettingsStore } from '../src/shared/stores/settings.store.ts';
import { DEFAULT_APP_SETTINGS } from '../src/store/settings.ts';

const root = document.createElement('div'); document.body.append(root);
afterEach(() => {
  act(() => render(null, root)); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  useSettingsStore.getState().replace({ ...DEFAULT_APP_SETTINGS });
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.theme; delete document.documentElement.dataset.mode;
});
function stubSystem(initial: boolean) {
  const events = new EventTarget(), state = { dark: initial };
  vi.stubGlobal('matchMedia', () => ({ get matches() { return state.dark; }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) }));
  return { set(dark: boolean) { state.dark = dark; events.dispatchEvent(new Event('change')); } };
}
const pressed = (label: string) => root.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-pressed');
const click = (label: string) => act(() => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());

it('defaults to one system-following theme for the app and reader', () => {
  expect(readThemePreference('new')).toEqual(defaultThemePreference);
  expect(themeSummary(readThemePreference('new'))).toBe('跟随系统');
  expect(resolveAppTheme(defaultThemePreference, true)).toEqual(resolveReadingTheme(defaultThemePreference, true));
});
it('carries old app theme choices and pairs over without touching other preferences', () => {
  for (const [old, theme, mode] of [['sand', 'warm', 'light'], ['midnight', 'warm', 'dark'], ['ocean', 'blue', 'light'], ['forest', 'green', 'light'], ['graphite', 'blue', 'dark'], ['rose', 'warm', 'light']])
    expect(migrateLegacyTheme(old!, undefined)).toMatchObject({ theme, mode });
  expect(migrateLegacyTheme('system', { light: 'forest', dark: 'graphite' }).system).toEqual({ light: 'green', dark: 'blue' });
  expect(migrateLegacyTheme('toString', { light: '__proto__' })).toEqual(defaultThemePreference);
  localStorage.setItem('reader.media.theme.v1:a', 'graphite');
  localStorage.setItem('reader.media.preferences.v1:a', '{"density":"comfortable"}');
  expect(resolveAppTheme(readThemePreference('a'), false)).toEqual({ theme: 'blue', mode: 'dark' });
  expect(readThemePreference('b')).toEqual(defaultThemePreference);
  expect(localStorage.getItem('reader.media.preferences.v1:a')).toBe('{"density":"comfortable"}');
});
it('imports the actual old reading choice once and keeps day/night memory', () => {
  localStorage.setItem('reader.theme.v2:a', JSON.stringify({ ...defaultThemePreference, reading: 'gray' }));
  migrateAppearance('a', { readingTheme: 'local-nord-night', lastDayTheme: 'kraft-day', lastNightTheme: 'nord-night' });
  expect(readThemePreference('a')).toMatchObject({ theme: 'local-nord-night', mode: 'dark', system: { light: 'local-kraft-day', dark: 'local-nord-night' } });
  saveThemePreference('a', selectTheme(readThemePreference('a'), 'blue'));
  migrateAppearance('a', { readingTheme: 'local-dark' });
  expect(readThemePreference('a').theme).toBe('blue');
  expect(readThemePreference('b')).toEqual(defaultThemePreference);
});
it('imports old global reading/paper choices and does not let stale device data override later choices', () => {
  localStorage.setItem('reader.theme.v2:a', JSON.stringify({ ...defaultThemePreference, reading: 'paper-warm' }));
  migrateAppearance('a', {});
  expect(readThemePreference('a')).toMatchObject({ theme: 'paper-warm', mode: 'light' });
  migrateAppearance('b', { paper: 'night' });
  expect(readThemePreference('b').theme).toBe('paper-night');
  saveThemePreference('a', selectTheme(readThemePreference('a'), 'local-wechat-night'));
  localStorage.setItem('reader.theme.v2:a', JSON.stringify({ reading: 'paper-white' }));
  expect(readThemePreference('a').theme).toBe('local-wechat-night');
});
it.each(Object.entries(PALETTES))('%s preserves all colours throughout the app and reader', (id, palette) => {
  const theme = `local-${id}` as AppThemeId;
  const preference = selectTheme(defaultThemePreference, theme);
  const resolved = resolveAppTheme(preference, false);
  expect(resolveReadingTheme(preference, true)).toEqual(resolved);
  expect(resolved.mode).toBe(palette.scheme);
  expect(themeTokens(resolved)).toMatchObject({ bg: palette.background, ink: palette.text, surface: palette.surface, muted: palette.muted, line: palette.line, brand: palette.accent, onBrand: palette.onAccent });
  saveThemePreference('palettes', preference);
  expect(readThemePreference('palettes').theme).toBe(theme);
  expect(themeOptions.filter(option => option.value === theme)).toHaveLength(1);
});
it('switches remembered day/night colours and follows OS changes without a fixed-colour mismatch', () => {
  let preference = selectTheme(defaultThemePreference, 'local-kraft-day');
  preference = selectTheme(preference, 'local-wechat-night');
  expect(selectedTheme(selectThemeMode(preference, 'light'), true)).toBe('local-kraft-day');
  preference = selectThemeMode(preference, 'system');
  expect(themeTokens(resolveAppTheme(preference, false)).bg).toBe(PALETTES['kraft-day'].background);
  expect(themeTokens(resolveAppTheme(preference, true)).bg).toBe(PALETTES['wechat-night'].background);
});
it('rejects malformed values, prototype keys and fixed-colour presets in the wrong system slot', () => {
  localStorage.setItem('reader.appearance.v1:a', JSON.stringify({ theme: 'toString', mode: 'dim', system: { light: 'local-dark', dark: 'paper-white' } }));
  expect(readThemePreference('a')).toEqual(defaultThemePreference);
  saveThemePreference('a', { theme: 'local-kraft-day', mode: 'dark' });
  expect(readThemePreference('a').mode).toBe('light');
  localStorage.setItem('reader.appearance.v1:a', '{bad json');
  expect(readThemePreference('a')).toEqual(defaultThemePreference);
});
it('updates root tokens, follows the OS, handles other tabs and clears colours on account teardown', () => {
  const system = stubSystem(false), changed = vi.fn(), controller = new ThemeController('a', changed);
  saveThemePreference('a', selectTheme(defaultThemePreference, 'local-kraft-day'));
  expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe(PALETTES['kraft-day'].background);
  saveThemePreference('a', selectTheme(readThemePreference('a'), 'local-wechat-night'));
  saveThemePreference('a', { mode: 'system' }); system.set(true);
  expect(controller.current.preset).toBe('local-wechat-night');
  saveThemePreference('b', { theme: 'blue', mode: 'light' });
  expect(controller.current.preset).toBe('local-wechat-night');
  localStorage.setItem('reader.appearance.v1:a', JSON.stringify({ ...defaultThemePreference, theme: 'blue', mode: 'dark' }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'reader.appearance.v1:a' }));
  expect(controller.current).toEqual({ theme: 'blue', mode: 'dark' });
  controller.dispose(); changed.mockClear(); system.set(false);
  expect(changed).not.toHaveBeenCalled();
  expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('');
  expect(document.documentElement.dataset.theme).toBeUndefined();
});
it('offers all custom colours from the global entry and keeps mode and selection in agreement', async () => {
  stubSystem(false);
  await act(async () => render(<ThemeSettings scope="a" />, root));
  expect(pressed('跟随系统')).toBe('true');
  expect(root.querySelectorAll('.theme-swatch')).toHaveLength(themeOptions.length);
  await click('牛皮纸'); expect(pressed('日间')).toBe('true');
  expect(readThemePreference('a').theme).toBe('local-kraft-day');
  await click('微信夜间'); expect(pressed('夜间')).toBe('true');
  await click('日间'); expect(pressed('牛皮纸')).toBe('true');
  await click('跟随系统');
  expect(root.querySelector('select[aria-label="夜间配色"]')).not.toBeNull();
  expect(root.querySelector('[role=status]')?.textContent).toBe('主题已保存');
});
it('keeps glass separate and reports storage failures without changing the selected theme', async () => {
  const update = vi.fn(patch => useSettingsStore.getState().update(patch));
  await act(async () => render(<ThemeSettings scope="a" onReaderSettings={update} />, root));
  await click('液态玻璃'); expect(update).toHaveBeenLastCalledWith({ liquidGlass: true });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  await click('牛皮纸');
  expect(root.querySelector('[role=alert]')?.textContent).toContain('无法保存主题');
  expect(readThemePreference('a')).toEqual(defaultThemePreference);
});
