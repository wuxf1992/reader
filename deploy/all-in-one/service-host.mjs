import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdir, chmod, chown, realpath, stat, writeFile, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = '/tmp/reader-plugin-services';
const runtimes = {
  node: { command: process.execPath, uid: 1001, gid: 1001 },
};

export async function validateServices(value) {
  assert.ok(value && typeof value.pluginId === 'string' && /^[\w.-]{1,100}$/.test(value.pluginId));
  assert.match(value.directory, /^\/tmp\/reader-plugin-runtime-[\w-]+$/);
  assert.equal(await realpath(value.directory), value.directory);
  const directory = await stat(value.directory);
  assert.equal(directory.uid, 100);
  assert.equal(directory.mode & 0o022, 0);
  assert.ok(Array.isArray(value.services) && value.services.length === 1);
  assert.deepEqual(value.services.map(s => s.runtime), ['node']);
  for (const service of value.services) {
    assert.ok(service.entry.startsWith(value.directory + '/'));
    assert.equal(await realpath(service.entry), service.entry);
    assert.ok((await stat(service.entry)).isFile());
    assert.ok(service.env && typeof service.env === 'object' && !Array.isArray(service.env));
    assert.ok(Object.keys(service.env).length <= 20);
    for (const [key, val] of Object.entries(service.env)) {
      assert.match(key, /^[A-Z][A-Z0-9_]{0,100}$/);
      assert.ok(typeof val === 'string' && val.length <= 8192);
    }
  }
  return value;
}

function kill(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

export async function createServiceHost() {
  await mkdir(root, { mode: 0o755 });
  let lease;
  let closing = false;
  let writing = Promise.resolve();
  const status = active => writing = writing.then(async () => {
    await writeFile(root + '/status.tmp', JSON.stringify({ active }), { mode: 0o644 });
    await rename(root + '/status.tmp', root + '/status.json');
  });
  await status(false);

  async function stopChildren(current) {
    const children = [...current.children];
    for (const child of children) kill(child, 'SIGTERM');
    const timer = setTimeout(() => { for (const child of children) kill(child, 'SIGKILL'); }, 10000);
    await Promise.all(children.map(child => child.finished));
    clearTimeout(timer);
  }

  function startChildren(current) {
    for (const service of current.request.services) {
      const runtime = runtimes[service.runtime];
      const args = [service.entry];
      const env = { PATH: process.env.PATH, ...service.env };
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
      }
      const child = spawn(runtime.command, args, { cwd: '/', uid: runtime.uid, gid: runtime.gid, env, stdio: 'inherit', detached: true });
      current.children.add(child);
      child.on('error', () => {});
      child.finished = new Promise(resolve => child.once('close', () => {
        current.children.delete(child);
        resolve();
        if (!current.stopping && !current.restarting) {
          current.restarting = true;
          void stopChildren(current).then(() => new Promise(r => setTimeout(r, 1000))).then(() => {
            current.restarting = false;
            if (!current.stopping) startChildren(current);
          }).catch(() => current.socket.destroy());
        }
      }));
    }
  }

  function stopLease(current) {
    return current.finished ??= (async () => {
      current.stopping = true;
      await stopChildren(current);
      // Cleanup runs as the plugin user; the host never runs plugin code as root.
      const cleanup = spawn(process.execPath, ['-e', 'require("node:fs").rmSync(process.argv[1],{recursive:true,force:true})', current.request.directory], { uid: 100, gid: 101, stdio: 'ignore' });
      await new Promise(resolve => { cleanup.once('error', resolve); cleanup.once('close', resolve); });
      if (lease === current) { lease = undefined; await status(false); }
    })();
  }

  const server = createServer(socket => {
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('error', () => {});
    let buffer = '';
    const accept = async chunk => {
      buffer += chunk;
      if (buffer.length > 32768) { socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      socket.removeListener('data', accept);
      try {
        const request = await validateServices(JSON.parse(buffer.trim()));
        if (closing || socket.destroyed) return;
        if (lease) { socket.end('busy\n'); return; }
        const current = { request, socket, children: new Set(), stopping: false, restarting: false };
        lease = current;
        socket.setTimeout(0);
        socket.once('close', () => { void stopLease(current); });
        await status(true);
        if (current.stopping || socket.destroyed) return;
        startChildren(current);
        socket.write('started\n');
      } catch { socket.end('invalid\n'); }
    };
    socket.setEncoding('utf8');
    socket.on('data', accept);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(root + '/control.sock', resolve);
  });
  await chmod(root + '/control.sock', 0o600);
  await chown(root + '/control.sock', 100, 101);
  return {
    async close() {
      closing = true;
      const stopped = new Promise(resolve => server.close(resolve));
      if (lease) { lease.socket.destroy(); await stopLease(lease); }
      await stopped;
    },
  };
}
