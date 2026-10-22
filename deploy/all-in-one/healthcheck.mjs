import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { active } = JSON.parse(await readFile('/tmp/reader-plugin-services/status.json', 'utf8'));

await Promise.all([
  ['http://127.0.0.1:5888/api/v1/health', async response => assert.ok(response.ok)],
  ['http://reader-browser:8081/user-agent', async response => {
    assert.ok(response.ok);
    assert.match(await response.text(), /^Mozilla\//);
  }],
].filter((_, index) => index === 0 || active).map(async ([url, check]) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  try { await check(response); } finally { await response.body?.cancel().catch(() => {}); }
}));
