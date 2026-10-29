// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

vi.mock('opencc-js/preset', () => { throw new Error('Conversion dictionaries must stay out of startup settings'); });

it('restores and exposes Chinese variant choices without loading conversion dictionaries', async () => {
  const { SettingsStore } = await import('../src/store/settings.ts');
  const { ShelfSettingsSheet } = await import('../src/ui/shelf-settings.tsx');
  const store = new SettingsStore({ get: async () => JSON.stringify({ chineseVariant: 'traditional' }), set: async () => {}, remove: async () => {} });
  expect((await store.load()).chineseVariant).toBe('traditional');
  expect(typeof ShelfSettingsSheet).toBe('function');
});
