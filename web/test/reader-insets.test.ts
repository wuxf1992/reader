import { expect, it } from 'vitest';
import { SettingsStore } from '../src/store/settings.ts';
import { MemoryKv } from './helpers/env.ts';

it('keeps the previous layout for old preferences and persists four independent insets', async () => {
  const kv = new MemoryKv();
  await kv.set('reader.settings.v1', JSON.stringify({ pageMargin: 2.5, theme: 'dark' }));
  const store = new SettingsStore(kv);
  expect(await store.load()).toMatchObject({ pageInsets: { top: 0, bottom: 0, left: 0, right: 0 }, pageMargin: 2.5 });
  await store.update({ pageInsets: { top: 24, bottom: 12, left: 6, right: 10 } });
  expect(await new SettingsStore(kv).load()).toMatchObject({
    pageInsets: { top: 24, bottom: 12, left: 6, right: 10 }, pageMargin: 2.5, theme: 'dark',
  });
});

it.each([null, 'bad', { top: -20, bottom: 1000, left: '24px', right: 5.7 }])(
  'repairs malformed stored insets without losing other preferences: %j', async pageInsets => {
    const kv = new MemoryKv();
    await kv.set('reader.settings.v1', JSON.stringify({ pageInsets, theme: 'dark' }));
    expect(await new SettingsStore(kv).load()).toMatchObject({ theme: 'dark',
      pageInsets: typeof pageInsets === 'object' && pageInsets !== null
        ? { top: 0, bottom: 80, left: 0, right: 6 } : { top: 0, bottom: 0, left: 0, right: 0 },
    });
  },
);

it('limits updated insets to finite pixel values', async () => {
  const kv = new MemoryKv(), store = new SettingsStore(kv);
  await store.load();
  expect(await store.update({ pageInsets: { top: NaN, bottom: Infinity, left: -4, right: 999 } }))
    .toMatchObject({ pageInsets: { top: 0, bottom: 0, left: 0, right: 80 } });
});
