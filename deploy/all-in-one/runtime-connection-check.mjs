// Run in an isolated container without the real service host; mount the plugin at /plugin.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdir, readdir } from 'node:fs/promises';
import { ensureServices } from '/plugin/runtime.mjs';

await mkdir('/tmp/reader-plugin-services');
const server = createServer(socket => socket.once('data', () => socket.end()));
await new Promise(resolve => server.listen('/tmp/reader-plugin-services/control.sock', resolve));
let timer;
try {
  await assert.rejects(Promise.race([
    ensureServices(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('connection close hung')), 6000); }),
  ]), error => error.code === 'PLUGIN_RUNTIME_UNAVAILABLE');
  assert.equal((await readdir('/tmp')).filter(name => name.startsWith('reader-plugin-runtime-')).length, 0);
  console.log('PASS: launcher disconnect rejects promptly and cleans published files');
} finally {
  clearTimeout(timer);
  await new Promise(resolve => server.close(resolve));
}
