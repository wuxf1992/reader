import { readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(process.argv[2] ?? fileURLToPath(new URL('../../../reader-novel-web-js/', import.meta.url)));
const destination = dirname(fileURLToPath(import.meta.url));
if (JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8')).id !== 'reader.source.novelweb') {
  throw new Error('Expected a reader-novel-web plugin checkout');
}
const files = ['Dockerfile', 'compose.yaml', 'entrypoint.sh', 'healthcheck.mjs', 'lifecycle-check.py',
  'runtime-connection-check.mjs', 'service-host.mjs', 'service-host.test.mjs', 'smoke.mjs', 'supervisor.mjs'];
// Read the complete source before replacing any local build files.
const contents = await Promise.all(files.map(file => readFile(join(source, 'deploy/all-in-one', file))));
for (const [index, file] of files.entries()) await writeFile(join(destination, file), contents[index]);
await chmod(join(destination, 'entrypoint.sh'), 0o755);
console.log('Prepared plugin runtime from ' + source);
