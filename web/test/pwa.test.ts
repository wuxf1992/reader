// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerPwa, watchPwaUpdates, updatePwa } from '../src/core/pwa.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let registration: ServiceWorkerRegistration;
let serviceWorker: ServiceWorkerContainer;
let dispose: (() => void) | undefined;
const register = vi.fn();
beforeEach(() => {
  registration = Object.assign(new EventTarget(), { waiting: null, installing: null, update: vi.fn().mockResolvedValue(undefined) }) as unknown as ServiceWorkerRegistration;
  serviceWorker = Object.assign(new EventTarget(), { register, controller: {} }) as unknown as ServiceWorkerContainer;
  register.mockResolvedValue(registration);
  vi.useFakeTimers();
  vi.stubEnv('PROD', true);
  vi.stubEnv('BASE_URL', './');
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { serviceWorker, onLine: true });
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
});
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  register.mockClear();
});

function pendingUpdate() {
  const postMessage = vi.fn();
  Object.defineProperty(registration, 'waiting', { value: { postMessage }, configurable: true });
  return postMessage;
}

it('waits for successful persistence before activating and reloads only once after control changes', async () => {
  const postMessage = pendingUpdate();
  let saved!: () => void;
  const save = vi.fn(() => new Promise<void>((resolve) => { saved = resolve; }));
  const reload = vi.fn();
  dispose = watchPwaUpdates(registration, save, reload);
  document.querySelector<HTMLButtonElement>('.pwa-update button')!.click();
  expect(postMessage).not.toHaveBeenCalled();
  saved();
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
  expect(reload).not.toHaveBeenCalled();
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});

it('keeps the old page when saving fails and allows retry', async () => {
  const postMessage = pendingUpdate();
  const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
  const reload = vi.fn();
  dispose = watchPwaUpdates(registration, save, reload);
  const button = document.querySelector<HTMLButtonElement>('.pwa-update button')!;
  button.click();
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
  button.click();
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
});

it('uses the current runtime local-save hook instead of waiting for network flush', async () => {
  const postMessage = pendingUpdate();
  const saveBeforeUpdate = vi.fn().mockResolvedValue(undefined);
  const networkFlush = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal('readerApp', { saveBeforeUpdate });
  vi.stubGlobal('__readerFlush', networkFlush);
  dispose = watchPwaUpdates(registration);
  document.querySelector<HTMLButtonElement>('.pwa-update button')!.click();
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
  expect(saveBeforeUpdate).toHaveBeenCalledTimes(1);
  expect(networkFlush).not.toHaveBeenCalled();
});

it('offers updates that finish downloading after registration', () => {
  dispose = watchPwaUpdates(registration);
  expect(document.querySelector('.pwa-update')).toBeNull();
  const worker = new EventTarget();
  Object.defineProperty(registration, 'installing', { value: worker });
  registration.dispatchEvent(new Event('updatefound'));
  pendingUpdate();
  worker.dispatchEvent(new Event('statechange'));
  expect(document.querySelector('.pwa-update button')?.textContent).toBe('立即更新');
});

it('does not reload when another tab activates, and saves before manual refresh', async () => {
  pendingUpdate();
  const save = vi.fn().mockResolvedValue(undefined), reload = vi.fn();
  dispose = watchPwaUpdates(registration, save, reload);
  Object.defineProperty(registration, 'waiting', { value: null, configurable: true });
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('.pwa-update button')!.click();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledTimes(1);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('allows retry if worker activation times out', async () => {
  pendingUpdate();
  dispose = watchPwaUpdates(registration, async () => {}, vi.fn());
  const button = document.querySelector<HTMLButtonElement>('.pwa-update button')!;
  button.click(); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe('重试更新');
});

it('registers the worker relative to the deployed document and bypasses the HTTP cache', () => {
  registerPwa();
  const base = new URL('./', document.baseURI);
  expect(register).toHaveBeenCalledWith(new URL('sw.js', base), {
    scope: base.pathname, updateViaCache: 'none',
  });
});

it('starts offline caching without waiting for images or other load events', () => {
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
  registerPwa();
  expect(register).toHaveBeenCalledTimes(1);
});

it('does not register in development', () => {
  vi.stubEnv('PROD', false);
  registerPwa();
  expect(register).not.toHaveBeenCalled();
});

it('does not register in the Android shell', () => {
  vi.stubGlobal('ReaderAndroid', {});
  registerPwa();
  expect(register).not.toHaveBeenCalled();
});

it('keeps ordinary HTTP and unsupported browsers usable', () => {
  vi.stubGlobal('isSecureContext', false);
  registerPwa();
  expect(register).not.toHaveBeenCalled();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {});
  expect(registerPwa).not.toThrow();
});

it('ships standalone launch metadata and a first-paint startup shell', () => {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.webmanifest'), 'utf8'));
  expect(manifest.display).toBe('standalone');
  expect(manifest.display_override).toContain('standalone');
  // The page draws nothing in a title-bar area, so the overlay would hide the drag
  // region and put the window controls over the content.
  expect(manifest.display_override).not.toContain('window-controls-overlay');
  // Any `orientation` overrides the phone's rotation lock: Chrome maps `any` to the full
  // sensor. Without the key the installed app follows the system auto-rotate switch.
  expect(manifest).not.toHaveProperty('orientation');
  // Android masks launcher icons; without a maskable one it shrinks ours into a disc.
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(true);
  expect(manifest.launch_handler.client_mode).toBe('navigate-existing');
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  expect(html).toContain('id="app-startup"');
  expect(html).toContain('apple-touch-startup-image');
});

it('reports failed registration without an unhandled rejection', async () => {
  const error = new Error('storage unavailable');
  register.mockRejectedValueOnce(error);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  registerPwa();
  await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('离线应用缓存注册失败', error));
});


function manualUpdate() {
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  Object.assign(serviceWorker, { getRegistration: vi.fn().mockResolvedValue(registration) });
  const saveBeforeUpdate = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('readerApp', { saveBeforeUpdate });
  return { reload, saveBeforeUpdate };
}

it('manual check reports the latest version without saving or reloading', async () => {
  const { reload, saveBeforeUpdate } = manualUpdate();
  await expect(updatePwa()).resolves.toBe('已是最新版本');
  expect(registration.update).toHaveBeenCalledTimes(1);
  expect(saveBeforeUpdate).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('manual update waits for download and local save before activation', async () => {
  const { reload, saveBeforeUpdate } = manualUpdate();
  const worker = Object.assign(new EventTarget(), { state: 'installing' });
  Object.defineProperty(registration, 'installing', { value: worker, configurable: true });
  let saved!: () => void;
  saveBeforeUpdate.mockImplementation(() => new Promise<void>(resolve => { saved = resolve; }));
  const updating = updatePwa();
  await vi.waitFor(() => expect(registration.update).toHaveBeenCalledTimes(1));
  expect(saveBeforeUpdate).not.toHaveBeenCalled();
  const postMessage = pendingUpdate();
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  await vi.waitFor(() => expect(saveBeforeUpdate).toHaveBeenCalledTimes(1));
  expect(postMessage).not.toHaveBeenCalled();
  saved();
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
  expect(reload).not.toHaveBeenCalled();
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  await expect(updating).resolves.toBe('正在更新…');
  expect(reload).toHaveBeenCalledTimes(1);
});

it('manual update can apply an already downloaded version offline and keeps the page if saving fails', async () => {
  const { reload, saveBeforeUpdate } = manualUpdate();
  Object.assign(navigator, { onLine: false });
  const postMessage = pendingUpdate();
  saveBeforeUpdate.mockRejectedValueOnce(new Error('disk full'));
  await expect(updatePwa()).rejects.toThrow('disk full');
  expect(registration.update).not.toHaveBeenCalled();
  expect(postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  postMessage.mockImplementation(() => serviceWorker.dispatchEvent(new Event('controllerchange')));
  await expect(updatePwa()).resolves.toBe('正在更新…');
  expect(reload).toHaveBeenCalledTimes(1);
});

it('manual update refreshes an old page after another tab has activated the worker', async () => {
  const { reload, saveBeforeUpdate } = manualUpdate();
  dispose = watchPwaUpdates(registration, saveBeforeUpdate, reload);
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  await expect(updatePwa()).resolves.toBe('正在更新…');
  expect(saveBeforeUpdate).toHaveBeenCalledTimes(1);
  expect(reload).toHaveBeenCalledTimes(1);
});

it.each(['redundant', 'timeout'])('manual download %s keeps the current page and removes its listener', async state => {
  const { reload, saveBeforeUpdate } = manualUpdate();
  const worker = Object.assign(new EventTarget(), { state: 'installing' });
  const removed = vi.spyOn(worker, 'removeEventListener');
  Object.defineProperty(registration, 'installing', { value: worker, configurable: true });
  const result = expect(updatePwa()).rejects.toThrow(/新版下载/);
  await vi.waitFor(() => expect(registration.update).toHaveBeenCalledTimes(1));
  if (state === 'timeout') await vi.advanceTimersByTimeAsync(60_000);
  else { worker.state = 'redundant'; worker.dispatchEvent(new Event('statechange')); }
  await result;
  expect(removed).toHaveBeenCalledWith('statechange', expect.any(Function));
  expect(saveBeforeUpdate).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('manual update reports offline, unsupported and unready environments without resetting caches', async () => {
  const { reload } = manualUpdate();
  Object.assign(navigator, { onLine: false });
  await expect(updatePwa()).resolves.toBe('请联网后重试');
  expect(registration.update).not.toHaveBeenCalled();
  Object.assign(serviceWorker, { getRegistration: vi.fn().mockResolvedValue(undefined) });
  await expect(updatePwa()).resolves.toBe('更新服务尚未就绪，请稍后重试');
  vi.stubGlobal('isSecureContext', false);
  await expect(updatePwa()).resolves.toBe('当前环境不支持网页更新');
  vi.stubGlobal('ReaderAndroid', {});
  await expect(updatePwa()).resolves.toBe('请通过安装包更新应用');
  expect(reload).not.toHaveBeenCalled();
});


it('manual check times out a stalled network request without saving or reloading', async () => {
  const { reload, saveBeforeUpdate } = manualUpdate();
  vi.mocked(registration.update).mockImplementation(() => new Promise(() => {}));
  const result = expect(updatePwa()).rejects.toThrow('检查更新超时');
  await vi.advanceTimersByTimeAsync(60_000);
  await result;
  expect(saveBeforeUpdate).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
