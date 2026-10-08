import { expect, it } from 'vitest';
import { SettingsStore } from '../src/store/settings.ts';
import { MemoryKv } from './helpers/env.ts';

it('defaults to three upcoming chapters and persists device preferences', async () => {
  const kv = new MemoryKv(), store = new SettingsStore(kv);
  expect(await store.load()).toMatchObject({ autoCache: true, autoCacheChapters: 3 });
  await store.update({ autoCache: false, autoCacheChapters: 10 });
  expect(await new SettingsStore(kv).load()).toMatchObject({ autoCache: false, autoCacheChapters: 10 });
});

it.each([0, 51, 1.5, '3', null])('repairs invalid stored chapter count %s', async count => {
  const kv = new MemoryKv();
  await kv.set('reader.settings.v1', JSON.stringify({ autoCache: 'false', autoCacheChapters: count, theme: 'sepia' }));
  expect(await new SettingsStore(kv).load()).toMatchObject({ autoCache: true, autoCacheChapters: 3, theme: 'sepia' });
});
