import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import { validateServices } from './service-host.mjs';

test('only bounded, plugin-owned runtime files can be launched as fixed non-root users', async t => {
  const directory = await mkdtemp('/tmp/reader-plugin-runtime-');
  await chmod(directory, 0o755);
  if (process.getuid() === 0) { const {chown} = await import('node:fs/promises'); await chown(directory, 100, 101); }
  t.after(() => rm(directory, { recursive: true, force: true }));
  const node = directory + '/browser.mjs';
  await writeFile(node, 'fixture');
  const request = { pluginId: 'reader.source.novelweb', directory,
    services: [{ runtime: 'node', entry: node, env: {} }] };
  assert.equal(await validateServices(request), request);
  await assert.rejects(validateServices({ ...request, pluginId: { toString: () => request.pluginId } }));
  await assert.rejects(validateServices({ ...request, directory: '/data' }));
  await assert.rejects(validateServices({ ...request, services: [{ ...request.services[0], runtime: 'root' }] }));
  await assert.rejects(validateServices({ ...request, services: [request.services[0], request.services[0]] }));
  await assert.rejects(validateServices({ ...request, services: [{ ...request.services[0], entry: '/etc/passwd' }] }));
  await symlink('/etc/passwd', directory + '/escape');
  await assert.rejects(validateServices({ ...request, services: [{ ...request.services[0], entry: directory + '/escape' }] }));
  await assert.rejects(validateServices({ ...request, services: [{ ...request.services[0], env: { PATH: 123 } }] }));
  await chmod(directory, 0o777);
  await assert.rejects(validateServices(request));
});
