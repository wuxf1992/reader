// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startupStage } from '../src/core/startup.ts';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const script = html.match(/<script id="reader-startup-status">([\s\S]*?)<\/script>/)![1]!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');
  new Function(script)();
});
afterEach(() => {
  startupStage('ready');
  document.body.replaceChildren();
  vi.useRealTimers();
});

it('shows the actual waiting operation, completed-step percentage and elapsed time before the app loads', () => {
  const progress = document.querySelector<HTMLProgressElement>('progress')!;
  expect(progress.value).toBe(0);
  expect(document.getElementById('app-startup-stage')?.textContent).toContain('主程序');
  vi.advanceTimersByTime(1500);
  expect(document.getElementById('app-startup-elapsed')?.textContent).toBe('已用 1.5 秒');
  startupStage('storage');
  expect(progress.value).toBe(1);
  expect(document.getElementById('app-startup-count')?.textContent).toBe('步骤进度 1/6 · 17%');
  expect(document.querySelector('[data-stage="resources"]')?.textContent).toContain('完成 · 1.5 秒');
  vi.advanceTimersByTime(2500);
  expect(document.querySelector('[data-stage="storage"]')?.textContent).toContain('进行中 · 2.5 秒');
  expect(document.getElementById('app-startup-stage')?.textContent).toContain('本地存储');
  expect(progress.value).toBe(1);
});

it('does not advance a stalled stage and names it after a long wait', () => {
  startupStage('storage');
  vi.advanceTimersByTime(10000);
  expect(document.querySelector<HTMLProgressElement>('progress')?.value).toBe(1);
  expect(document.getElementById('app-startup-note')?.textContent).toContain('仍在打开本地存储');
  window.dispatchEvent(new CustomEvent('reader-startup', { detail: { stage: 'unknown' } }));
  expect(document.querySelector<HTMLProgressElement>('progress')?.value).toBe(1);
});

it('keeps the failing stage and recovery control without continuing the timer or claiming completion', () => {
  startupStage('storage');
  startupStage('settings');
  startupStage('failed', '阅读设置无法读取');
  expect(document.querySelector('[data-stage="settings"]')?.getAttribute('data-state')).toBe('failed');
  expect(document.getElementById('app-startup-note')?.textContent).toBe('阅读设置无法读取');
  expect(document.getElementById('app-startup-retry')?.hidden).toBe(false);
  const elapsed = document.getElementById('app-startup-elapsed')?.textContent;
  vi.advanceTimersByTime(10000);
  expect(document.getElementById('app-startup-elapsed')?.textContent).toBe(elapsed);
  expect(document.querySelector<HTMLProgressElement>('progress')?.value).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('reports an entry-script failure even when the app module never executes', () => {
  const resource = document.createElement('script');
  resource.src = '/assets/client-failed.js';
  document.body.append(resource);
  resource.dispatchEvent(new Event('error'));
  expect(document.getElementById('app-startup-note')?.textContent).toContain('界面资源加载失败');
  expect(document.getElementById('app-startup-retry')?.hidden).toBe(false);
});

it('removes the startup UI and timer as soon as the existing startup work finishes', () => {
  for (const stage of ['storage', 'settings', 'session', 'offline', 'render', 'ready'] as const) startupStage(stage);
  expect(document.getElementById('app-startup')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
