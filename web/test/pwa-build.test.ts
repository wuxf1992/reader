import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pwa } from '../tools/pwa/build.ts';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
it('uses matching versioned URLs in HTML and offline cache, and changes them when assets change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reader-pwa-build-')); directories.push(dir);
  await mkdir(join(dir, 'assets'));
  const index = '<script src="./assets/client.js"></script><link href="./assets/index.css" rel="stylesheet">';
  await writeFile(join(dir, 'assets/client.js'), 'console.log("old")');
  await writeFile(join(dir, 'assets/index.css'), 'body { color: black; }');
  await writeFile(join(dir, 'index.html'), index);
  const plugin = pwa();
  const build = plugin.writeBundle as (options: {dir: string}) => Promise<void>;
  await build({dir});
  const html = await readFile(join(dir, 'index.html'), 'utf8');
  const worker = await readFile(join(dir, 'sw.js'), 'utf8');
  const urls = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(match => match[1]);
  expect(urls).toHaveLength(2);
  for (const url of urls) { expect(url).toMatch(/\?v=[a-f0-9]{20}$/); expect(worker).toContain(JSON.stringify(url)); }
  await writeFile(join(dir, 'assets/client.js'), 'console.log("new")');
  await writeFile(join(dir, 'index.html'), index);
  await build({dir});
  expect(await readFile(join(dir, 'index.html'), 'utf8')).not.toBe(html);
  expect(await readFile(join(dir, 'sw.js'), 'utf8')).not.toBe(worker);
  // The native shell still has its fixed entry point.
  expect(await readFile(join(dir, 'assets/client.js'), 'utf8')).toBe('console.log("new")');
});
