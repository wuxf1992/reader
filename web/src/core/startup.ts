type StartupStage = 'storage' | 'settings' | 'session' | 'offline' | 'render' | 'ready' | 'failed';

/** The first-paint screen exists before the application module finishes loading. */
export function startupStage(stage: StartupStage, message = ''): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('reader-startup', { detail: { stage, message } }));
}
