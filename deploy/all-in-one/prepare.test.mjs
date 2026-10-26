import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, stat, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('prepares the Docker context and leaves it intact when the source is incomplete', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reader-runtime-prepare-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = join(root, 'plugin'), source = join(plugin, 'deploy/all-in-one');
  const destination = join(root, 'reader');
  await mkdir(source, { recursive: true }); await mkdir(destination);
  await writeFile(join(plugin, 'plugin.json'), JSON.stringify({ id: 'reader.source.novelweb' }));
  const files = ['Dockerfile', 'compose.yaml', 'entrypoint.sh', 'healthcheck.mjs', 'lifecycle-check.py',
    'runtime-connection-check.mjs', 'service-host.mjs', 'service-host.test.mjs', 'smoke.mjs', 'supervisor.mjs'];
  for (const file of files) await writeFile(join(source, file), 'fixture ' + file);
  const script = join(destination, 'prepare.mjs');
  await copyFile(new URL('./prepare.mjs', import.meta.url), script);
  execFileSync(process.execPath, [script, plugin]);
  assert.equal(await readFile(join(destination, 'Dockerfile'), 'utf8'), 'fixture Dockerfile');
  assert.equal(await readFile(join(destination, 'service-host.mjs'), 'utf8'), 'fixture service-host.mjs');
  assert.equal((await stat(join(destination, 'entrypoint.sh'))).mode & 0o777, 0o755);
  await writeFile(join(source, 'Dockerfile'), 'incomplete update'); await rm(join(source, 'service-host.mjs'));
  assert.throws(() => execFileSync(process.execPath, [script, plugin], { stdio: 'pipe' }));
  assert.equal(await readFile(join(destination, 'Dockerfile'), 'utf8'), 'fixture Dockerfile');
});
