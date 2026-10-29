// @vitest-environment jsdom
import { Blob } from 'node:buffer';
import { expect, it } from 'vitest';
import { TextReader } from '../src/render/text.ts';
import type { ApiClient, BookDto } from '../src/net/api.ts';

it('preserves decoded tag and entity text when flushing the final streamed paragraph', async () => {
  const host = document.createElement('div');
  const api = { asset: async () => new Blob(['他说 &lt;b&gt; 是标签，&amp;lt; 是实体。']) } as unknown as ApiClient;
  const reader = new TextReader(host, api, { id: 'text' } as BookDto);
  try {
    await reader.open();
    expect(host.textContent).toBe('他说 <b> 是标签，&lt; 是实体。');
    expect(host.querySelector('b')).toBeNull();
  } finally { reader.destroy(); }
});
