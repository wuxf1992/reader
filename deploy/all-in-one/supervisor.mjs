import { spawn } from 'node:child_process';
import { createServiceHost } from './service-host.mjs';

const host = await createServiceHost();

const services = [
  { name: 'reader', command: process.argv.slice(2), cwd: '/app', uid: 100, gid: 101 },
];
const children = new Set();
let stopping = false;
let exitCode = 0;
let hostClosed = false;
const finish = () => { if (!children.size && hostClosed) process.exit(exitCode); };

function signal(child, name) {
  if (!child.pid) return;
  try { process.kill(-child.pid, name); }
  catch (error) { if (error.code !== 'ESRCH') console.error(error); }
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  void host.close().then(() => { hostClosed = true; finish(); });
  for (const child of children) signal(child, 'SIGTERM');
  // Leave time for Reader to flush SQLite and Chromium to close.
  setTimeout(() => {
    for (const child of children) signal(child, 'SIGKILL');
  }, 45000).unref();
  finish();
}

for (const service of services) {
  const [command, ...args] = service.command;
  const child = spawn(command, args, {
    cwd: service.cwd, uid: service.uid, gid: service.gid,
    env: { ...process.env, ...service.env }, stdio: 'inherit', detached: true,
  });
  children.add(child);
  child.once('error', error => {
    console.error(`${service.name} failed to start: ${error.message}`);
    shutdown(1);
  });
  child.once('close', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${service.name} stopped (${code ?? signal}); restarting the container`);
      shutdown(1);
    }
    finish();
  });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => shutdown(0));
