import { describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/store/settings.ts';
import type { KeyValueStore } from '../src/core/platform.ts';

/** A KeyValueStore over a Map, for SettingsStore.load(). */
function memory(initial: Record<string, string>): KeyValueStore {
  const values = new Map(Object.entries(initial));
  return { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { values.set(key, value); }, remove: async (key: string) => { values.delete(key); } };
}
const load = (stored: object) => new SettingsStore(memory({ 'reader.settings.v1': JSON.stringify(stored) })).load();

describe('reading paper setting', () => {
  it('defaults to the theme, following the system dark mode', async () => {
    const settings = await new SettingsStore(memory({})).load();
    expect([settings.paper, settings.paperFollowsDark]).toEqual(['theme', true]);
  });

  it('brings the pre-V3 page theme back as the matching paper, once', async () => {
    expect((await load({ theme: 'sepia' })).readingTheme).toBe('local-sepia');
    expect((await load({ theme: 'green' })).readingTheme).toBe('local-green');
    expect((await load({ theme: 'dark' })).readingTheme).toBe('local-dark');
    expect((await load({ theme: 'light' })).readingTheme).toBe('local-light');
    // A paper chosen since wins over the old value.
    expect((await load({ theme: 'dark', paper: 'white' })).readingTheme).toBe('paper-white');
  });

  it('ignores an unknown paper or a malformed switch', async () => {
    const settings = await load({ paper: 'sepia', paperFollowsDark: 'yes' });
    expect([settings.paper, settings.paperFollowsDark]).toEqual(['theme', true]);
  });
});

it('preserves custom palette paper, brightness and day/night memory across upgrades', async () => {
  const settings = await load({ theme: 'nord-night', lastDayTheme: 'kraft-day', brightness: 0.6 });
  expect(settings).toMatchObject({ theme: 'nord-night', paper: 'theme', readingTheme: 'local-nord-night', paperFollowsDark: false, lastDayTheme: 'kraft-day', lastNightTheme: 'nord-night', brightness: 0.6 });
});

it('keeps the unified theme after saving and does not restore the stale paper', async () => {
  const kv = memory({ 'reader.settings.v1': JSON.stringify({ theme: 'wechat-night', paper: 'local-wechat-night', fontScale: 1.2, brightness: .6, pageInsets: { bottom: 18 } }) });
  const store = new SettingsStore(kv);
  expect(await store.load()).toMatchObject({ readingTheme: 'local-wechat-night', paper: 'theme', fontScale: 1.2, brightness: .6, pageInsets: { bottom: 18 } });
  await store.update({ readingTheme: 'app', paper: 'theme' });
  expect(await new SettingsStore(kv).load()).toMatchObject({ readingTheme: 'app', paper: 'theme', fontScale: 1.2, brightness: .6 });
});
