import '../styles/pwa.css';

const activatedUpdates = new WeakSet<ServiceWorkerRegistration>();

/** Native shells and development builds keep their existing loading lifecycle. */
export function registerPwa(): void {
  if (!import.meta.env.PROD || window.ReaderAndroid || !window.isSecureContext
    || !['http:', 'https:'].includes(location.protocol) || !('serviceWorker' in navigator)) return;

  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  void navigator.serviceWorker.register(new URL('sw.js', base), {
    scope: base.pathname,
    updateViaCache: 'none',
  }).then((registration) => watchPwaUpdates(registration)).catch((error: unknown) => {
    // PWA availability must not prevent ordinary online reading.
    console.warn('离线应用缓存注册失败', error);
  });
}

async function saveBeforeUpdate(): Promise<void> {
  if (window.readerApp) await window.readerApp.saveBeforeUpdate();
  else await window.__readerFlush?.();
}

/** Both update controls save locally before allowing a worker to take over. */
async function activatePwaUpdate(registration: ServiceWorkerRegistration, save: () => Promise<void>): Promise<void> {
  await save();
  const worker = registration.waiting;
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
    };
    const changed = () => { cleanup(); resolve(); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('更新未完成，请重试')); }, 15_000);
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    try { worker.postMessage({ type: 'SKIP_WAITING' }); }
    catch (error) { cleanup(); reject(error); }
  });
}

/** A manual check can also wait for the new shell to finish downloading. */
export async function updatePwa(): Promise<string> {
  if (window.ReaderAndroid) return '请通过安装包更新应用';
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return '当前环境不支持网页更新';
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return '更新服务尚未就绪，请稍后重试';
  if (!registration.waiting) {
    if (!navigator.onLine) return '请联网后重试';
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('检查更新超时，请稍后重试')), 60_000);
      void registration.update().then(() => { clearTimeout(timeout); resolve(); }, error => { clearTimeout(timeout); reject(error); });
    });
    const worker = registration.installing;
    if (worker) await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); worker.removeEventListener('statechange', changed); };
      const changed = () => {
        if (worker.state === 'installed' || worker.state === 'activated') { cleanup(); resolve(); }
        else if (worker.state === 'redundant') { cleanup(); reject(new Error('新版下载失败，请重试')); }
      };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('新版下载未完成，请稍后重试')); }, 60_000);
      worker.addEventListener('statechange', changed);
      changed();
    });
  }
  if (!registration.waiting && !activatedUpdates.has(registration)) return '已是最新版本';
  await activatePwaUpdate(registration, saveBeforeUpdate);
  location.reload();
  return '正在更新…';
}

/** Keep activation opt-in, including when another tab activates the new worker. */
export function watchPwaUpdates(
  registration: ServiceWorkerRegistration,
  save: () => Promise<void> = saveBeforeUpdate,
  reload: () => void = () => location.reload(),
): () => void {
  const banner = document.createElement('aside');
  banner.className = 'pwa-update';
  banner.setAttribute('aria-label', '应用更新');
  const message = document.createElement('span');
  message.setAttribute('role', 'status');
  message.textContent = '新版本已准备好';
  const button = document.createElement('button');
  button.className = 'button primary';
  button.type = 'button';
  button.textContent = '立即更新';
  banner.append(message, button);
  let updating = false;
  let reloaded = false;
  let installing: ServiceWorker | null = null;
  const show = () => {
    if (registration.waiting && navigator.serviceWorker.controller && !banner.isConnected) document.body.append(banner);
  };
  const finish = () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  };
  const failed = () => {
    updating = false;
    button.disabled = false;
    button.textContent = '重试更新';
    message.textContent = '更新未完成，请重试';
  };
  const onControllerChange = () => {
    // First installation only claims the page; it is not an update.
    activatedUpdates.add(registration);
    if (!updating && banner.isConnected) message.textContent = '新版本已启用，刷新后使用';
  };
  button.addEventListener('click', () => {
    if (updating) return;
    updating = true;
    button.disabled = true;
    message.textContent = '正在保存阅读进度…';
    void activatePwaUpdate(registration, async () => {
      await save();
      message.textContent = '正在更新…';
    }).then(finish, failed);
  });
  const onStateChange = () => show();
  const onUpdateFound = () => {
    installing?.removeEventListener('statechange', onStateChange);
    installing = registration.installing;
    installing?.addEventListener('statechange', onStateChange);
    show();
  };
  const check = () => {
    if (document.visibilityState !== 'visible') return;
    show();
    void registration.update().catch(() => { /* Offline: try again on return. */ });
  };
  // Only changes after initial control represent upgrades of an existing page.
  let controlled = !!navigator.serviceWorker.controller;
  const controllerChange = () => {
    if (controlled) onControllerChange();
    controlled = true;
  };
  navigator.serviceWorker.addEventListener('controllerchange', controllerChange);
  registration.addEventListener('updatefound', onUpdateFound);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  const interval = setInterval(check, 60 * 60 * 1000);
  onUpdateFound();
  return () => {
    clearInterval(interval);
    banner.remove();
    installing?.removeEventListener('statechange', onStateChange);
    registration.removeEventListener('updatefound', onUpdateFound);
    navigator.serviceWorker.removeEventListener('controllerchange', controllerChange);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('online', check);
  };
}
