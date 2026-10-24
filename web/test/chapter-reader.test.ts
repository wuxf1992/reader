// @vitest-environment jsdom
import { noticeText } from './helpers/notices.ts';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { ReaderApi } from '../src/api/client.ts';
import { ApiError } from '../src/api/errors.ts';
import type { Book, BookContent, Manifest, Session } from '../src/api/types.ts';
import { OfflineStore } from '../src/store/offline.ts';
import { PublicationCache, publicationScope } from '../src/store/publications.ts';
import { DEFAULT_APP_SETTINGS, SettingsStore, type AppSettings } from '../src/store/settings.ts';
import type { ReaderView } from '../src/ui/reader-view.ts';
import { ReaderScreen } from '../src/ui/reader-screen.tsx';
import { App } from '../src/app.ts';
import type { SyncEngine } from '../src/core/sync.ts';
import { FakeTransport, MemoryBlobs, MemoryKv, makePlatform } from './helpers/env.ts';
import { anchorFor } from '../src/ui/text-anchor.ts';
import { applyTheme } from '../src/ui/settings.ts';

const book: Book = {
  id: 'book-1', title: '远程小说', author: '作者', publisher: '', language: 'zh', isbn: '',
  description: '', series: '', seriesIndex: null, tags: [], pubdate: '', format: 'chapters',
  coverUrl: null, fileSize: 0, pageCount: null, source: '', manualFields: [], updatedAt: 1,
};
const session: Session = {
  user: { id: 'u1', username: 'one', displayName: '一', role: 'member', createdAt: 0 },
  accessToken: 'access', accessTokenExpiresAt: 9e15, refreshToken: 'refresh', refreshTokenExpiresAt: 9e15,
};

function content(ids: string[], revision = 'r1'): BookContent {
  return {
    kind: 'text', total: ids.length, revision,
    groups: [{ id: 'all', seq: 0, offset: 0, count: ids.length, title: '全部章节' }],
    items: ids.map((id, seq) => ({
      id, seq, title: `章节 ${id}`, href: `chapter:${id}`, resourceRef: `resource:${revision}:${id}`,
      kind: 'chapter', format: 'html', mediaType: 'text/plain; charset=utf-8',
    })),
  };
}

function manifest(value: BookContent): Manifest {
  return { book, contentUrl: '', coverUrl: null, files: [], ...value, content: value };
}

beforeAll(() => {
  window.matchMedia ??= () => ({matches:false,addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList);
  window.scrollTo = () => {};
  HTMLDialogElement.prototype.showModal ??= function() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function() { this.removeAttribute('open'); };
  vi.stubGlobal('Blob', NodeBlob);
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  URL.createObjectURL ??= () => 'blob:test';
  URL.revokeObjectURL ??= () => undefined;
});

const screens: ReaderScreen[] = [];
afterEach(() => {
  for (const screen of screens.splice(0)) screen.dispose();
  document.body.replaceChildren();
});

async function setup(kv = new MemoryKv(), blobs = new MemoryBlobs(), userId = 'u1', server = 'http://one.test', settings: Partial<AppSettings> = {}) {
  const transport = new FakeTransport();
  const platform = makePlatform(transport, kv, blobs);
  const api = new ReaderApi(platform, {
    async load() { return { ...session, user: { ...session.user, id: userId } }; },
    async save() {}, async clear() {},
  });
  api.setBaseUrl(server);
  await api.restore();
  const offline = new OfflineStore(kv);
  await offline.setScope(publicationScope(server, userId));
  const onSignedOut = vi.fn();
  const sync = {
    status: () => ({ state: 'idle', pending: false, message: '', lastSyncAt: null }),
    onStatus: vi.fn((_listener: (status: ReturnType<SyncEngine['status']>) => void) => () => undefined),
    schedule: vi.fn(),
  } as unknown as SyncEngine;
  const onSettingsChange = vi.fn();
  const screen = new ReaderScreen({ api, offline, sync, platform, settings: { ...DEFAULT_APP_SETTINGS, autoCache: false, ...settings, ...(settings.theme && !settings.paper ? { paper: `local-${settings.theme}` as const, paperFollowsDark: false } : {}) },
    onBack() {}, onSettingsChange, onSignedOut });
  screens.push(screen);
  document.body.append(screen.element);
  return { screen, api, offline, transport, platform, onSignedOut, onSettingsChange, sync };
}

function serve(transport: FakeTransport, current: BookContent, next = current) {
  transport.respondWith((request) => {
    if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(current) };
    if (request.url.includes('/search?')) return { status:200,headers:{},json:{hits:current.items.map(item=>({title:item.title,excerpt:'正文',anchor:{sectionId:item.href,start:0,end:2,quote:'正文',prefix:'',suffix:''}})),scanned:current.total,total:current.total,failures:[],limited:false} };
    if (request.url.endsWith('/refresh')) return { status: 200, headers: {}, json: next };
    if (request.url.includes('/assets?')) {
      const ref = new URL(request.url, 'http://test').searchParams.get('ref');
      return { status: 200, headers: {}, bytes: new TextEncoder().encode(`${ref}\n\n<script>alert(1)</script> 正文`) };
    }
    return { status: 200, headers: {}, json: { progress: null } };
  });
}

it('applies the global text choice immediately, preserves the chapter, TTS and raw cached text, and survives another book and offline reload', async () => {
  const kv = new MemoryKv(), blobs = new MemoryBlobs();
  const env = await setup(kv, blobs);
  const current = content(['a', 'b']);
  const raw = '头发发展，干净干活，皇后后来。';
  env.transport.respondWith(request => {
    if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(current) };
    if (request.url.includes('/assets?')) return { status: 200, headers: {}, bytes: new TextEncoder().encode(raw) };
    return { status: 200, headers: {}, json: { progress: null } };
  });
  await env.screen.open(book);
  const reader = env.screen as unknown as { view: ReaderView; goToSection(index: number): Promise<void> };
  await reader.goToSection(1);
  await act(() => click(env.screen, '外观'));
  await act(() => click(env.screen, '繁体'));
  await vi.waitFor(() => expect(body(env.screen)?.querySelector('.book-flow')?.textContent).toContain('頭髮發展，乾淨幹活，皇后後來。'));
  expect(reader.view.position().sectionId).toBe('chapter:b');
  expect(reader.view.speechChunks.map(chunk => chunk.text).join('')).toContain('頭髮發展');
  expect(reader.view.showTextAnchor(anchorFor('chapter:b', raw, 0, 4))).toBe(true);
  expect(env.onSettingsChange).toHaveBeenLastCalledWith({ chineseVariant: 'traditional' });
  const store = new SettingsStore(kv); await store.load(); await store.update(env.onSettingsChange.mock.calls.at(-1)![0]);
  const cache = new PublicationCache(kv, blobs, publicationScope('http://one.test', 'u1'));
  expect(new TextDecoder().decode((await cache.resource(book.id, current.items[1]!.resourceRef!))!)).toBe(raw);
  await env.screen.open({ ...book, id: 'another-book' });
  expect(body(env.screen)?.querySelector('.book-flow')?.textContent).toContain('頭髮發展');
  env.screen.dispose(); screens.splice(screens.indexOf(env.screen), 1);
  const restored = await setup(kv, blobs, 'u1', 'http://one.test', await new SettingsStore(kv).load());
  restored.transport.failWith(new Error('offline')); await restored.screen.open(book);
  expect(body(restored.screen)?.querySelector('.book-flow')?.textContent).toContain('頭髮發展');
  await act(() => click(restored.screen, '外观'));
  await act(() => click(restored.screen, '原文'));
  await vi.waitFor(() => expect(body(restored.screen)?.querySelector('.book-flow')?.textContent).toContain(raw));
});

it('searches the source in both scripts, displays converted results and navigates with original anchors', async () => {
  const env = await setup(undefined, undefined, 'u1', 'http://one.test', { chineseVariant: 'traditional' });
  const current = content(['a']);
  const raw = '头发发展，干净干活。';
  const anchor = anchorFor('chapter:a', raw, 0, 2);
  env.transport.respondWith(request => {
    if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(current) };
    if (request.url.includes('/assets?')) return { status: 200, headers: {}, bytes: new TextEncoder().encode(raw) };
    if (request.url.includes('/search?')) {
      const query = new URL(request.url, 'http://test').searchParams.get('q');
      return { status: 200, headers: {}, json: { hits: query === '头发' ? [{ title: '头发章节', excerpt: raw, anchor }] : [], scanned: 1, total: 1, failures: [], limited: false } };
    }
    return { status: 200, headers: {}, json: { progress: null } };
  });
  await env.screen.open(book); await act(() => click(env.screen, '工具'));
  const input = env.screen.element.querySelector<HTMLInputElement>('input[placeholder="输入要查找的文字"]')!;
  await act(() => { input.value = '頭髮'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(() => click(env.screen, '搜索全文'));
  await vi.waitFor(() => expect(env.screen.element.querySelector('.reading-tool-results')?.textContent).toContain('頭髮發展'));
  expect(env.transport.requests.filter(request => request.url.includes('/search?')).map(request => new URL(request.url, 'http://test').searchParams.get('q'))).toEqual(['頭髮', '头发']);
  expect(env.screen.element.querySelectorAll('.reading-tool-results li')).toHaveLength(1);
  const view = (env.screen as unknown as { view: ReaderView }).view;
  const show = vi.spyOn(view, 'showTextAnchor');
  await act(() => env.screen.element.querySelector<HTMLButtonElement>('.reading-tool-results button')!.click());
  await vi.waitFor(() => expect(show).toHaveReturnedWith(true));
  expect(show).toHaveBeenCalledWith(anchor);
});

function body(screen: ReaderScreen): ShadowRoot | null | undefined {
  return screen.element.querySelector('book-content')?.shadowRoot;
}

async function click(screen: ReaderScreen, label: string): Promise<void> {
  const button = [...screen.element.querySelectorAll('button')].find((candidate) =>
    candidate.getAttribute('aria-label') === label || candidate.textContent?.trim().endsWith(label));
  expect(button, label).toBeDefined();
  button!.click();
  await Promise.resolve();
}

describe('chapter publication reading', () => {
  it('ignores an old progress response after the reader closes and the offline account changes', async () => {
    const env = await setup(); serve(env.transport, content(['a', 'b']));
    let finish!: (value: { bookId: string; locator: string; percentage: number; chapterTitle: string; device: string; updatedAt: number }) => void;
    vi.spyOn(env.api, 'getProgress').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const opening = env.screen.open(book);
    await vi.waitFor(() => expect(finish).toBeDefined());
    env.screen.dispose(); screens.splice(screens.indexOf(env.screen), 1);
    await env.offline.setScope('another-account');
    finish({ bookId: book.id, locator: 'r1:0.0000:chapter:b', percentage: 0.5, chapterTitle: 'private chapter', device: 'phone', updatedAt: 10 });
    await opening;
    expect(env.offline.progressFor(book.id)).toBeUndefined();
    expect(env.offline.outbox().progress).toEqual([]);
  });

  it.each(['chapters', 'epub'] as const)('opens the farther local position in %s even when the server position has a newer timestamp', async format => {
    const env = await setup(); serve(env.transport, content(['a', 'b']));
    const local = { bookId: book.id, locator: 'r1:0.0000:chapter:b', percentage: 0.5,
      chapterTitle: 'b', device: 'phone', updatedAt: 10 };
    const remote = { ...local, locator: 'r1:0.0000:chapter:a', percentage: 0, updatedAt: Date.now() + 1000 };
    await env.offline.setProgress(local);
    await env.offline.markDelivered(env.offline.outbox(), 1);
    vi.spyOn(env.api, 'getProgress').mockResolvedValue(remote);
    await env.screen.open({ ...book, format });
    expect(body(env.screen)?.textContent).toContain('resource:r1:b');
    expect(env.offline.progressFor(book.id)?.locator).toBe(local.locator);
    expect(env.offline.progressFor(book.id)!.updatedAt).toBeGreaterThan(remote.updatedAt);
    expect(env.sync.schedule).toHaveBeenCalled();
    await env.screen.flushProgress();
    expect(env.offline.progressFor(book.id)!.updatedAt).toBeGreaterThan(remote.updatedAt + 1);
  });

  it('does not save a temporary opening position while waiting for remote progress', async () => {
    const env = await setup(); serve(env.transport, content(['a', 'b']));
    const old = { bookId: book.id, locator: 'r1:0.0000:chapter:b', percentage: 0.5,
      chapterTitle: 'b', device: 'phone', updatedAt: 10 };
    await env.offline.setProgress(old);
    let finish!: (value: typeof old) => void;
    vi.spyOn(env.api, 'getProgress').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const opening = env.screen.open(book);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await new Promise(resolve => setTimeout(resolve, 1700));
    const duringOpen = env.offline.progressFor(book.id);
    finish({ ...old, updatedAt: 20 }); await opening;
    expect(duringOpen).toEqual(old);
  });

  it.each([{ localTime: 10, chapter: 'b' }, { localTime: 30, chapter: 'a' }])(
    'opens the latest position when the local timestamp is $localTime', async ({ localTime, chapter }) => {
    const env = await setup();
    await env.offline.setProgress({ bookId: book.id, locator: 'r1:0.0000:chapter:a', percentage: 0,
      chapterTitle: 'a', device: 'phone', updatedAt: localTime });
    env.transport.respondWith(request => {
      if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(content(['a', 'b'])) };
      if (request.url.includes('/assets?')) return { status: 200, headers: {}, bytes: new TextEncoder().encode(new URL(request.url, 'http://one.test').searchParams.get('ref')!) };
      return { status: 200, headers: {}, json: { progress: { bookId: book.id, locator: 'r1:0.0000:chapter:b', percentage: 0.5,
        chapterTitle: 'b', device: 'new phone', updatedAt: 20 } } };
    });
    await env.screen.open(book);
    expect(body(env.screen)?.textContent).toContain(`resource:r1:${chapter}`);
  });

  it('flushes the visible chapter before app background sync, without waiting for the reading debounce', async () => {
    const env = await setup();
    serve(env.transport, content(['a', 'b']));
    await env.screen.open(book);
    // Exercise the actual App lifecycle flush and actual ReaderScreen/OfflineStore.
    let savedLocator: string | undefined;
    const sync = { flush: vi.fn(async () => {
      const persisted = new OfflineStore(env.platform.kv);
      await persisted.setScope(publicationScope(env.api.baseUrl, 'u1'));
      savedLocator = persisted.current.progress[book.id]?.locator;
    }) };
    await App.prototype.flush.call({ reader: env.screen, offline: env.offline, sync } as unknown as App);
    expect(sync.flush).toHaveBeenCalledOnce();
    expect(savedLocator).toContain('chapter:a');
    expect(env.offline.current.progress[book.id]?.locator).toContain('chapter:a');
  });

  it('keeps the local reading position when the progress service is unavailable', async () => {
    const env = await setup(); serve(env.transport, content(['a', 'b']));
    await env.offline.setProgress({ bookId: book.id, locator: 'r1:0.0000:chapter:b', percentage: 0.5,
      chapterTitle: 'b', device: 'phone', updatedAt: 10 });
    vi.spyOn(env.api, 'getProgress').mockRejectedValue(new ApiError('offline', 'offline'));
    await env.screen.open(book);
    expect(body(env.screen)?.textContent).toContain('resource:r1:b');
  });

  it('switches from the contents panel only after chapter selection and preserves the old view on failure', async () => {
    const env = await setup(); let failSwitch = true;
    env.transport.respondWith(request => {
      if (request.url.endsWith('/source-options')) return { status: 200, headers: {}, json: { canSwitch: true } };
      if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(content(['a', 'b'])) };
      if (request.url.endsWith('/alternatives')) return { status: 200, headers: {}, stream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: results\ndata: ' + JSON.stringify({ items: [{ ref: 'other-book', title: '同一本书', authors: ['作者'], sourceName: '其它书源', latestChapter: '最新章节' }] }) + '\n\nevent: done\ndata: {}\n\n')); controller.close(); } }) };
      if (request.url.endsWith('/switch-preview')) return { status: 200, headers: {}, json: { chapters: [{ id: 'x', title: '另一个章节' }] } };
      if (request.url.endsWith('/switch-source')) return failSwitch
        ? { status: 502, headers: {}, json: { error: { code: 'SOURCE_ERROR', message: '正文获取失败' } } }
        : { status: 200, headers: {}, json: { content: content(['x', 'y'], 'r2'), href: 'chapter:x' } };
      if (request.url.includes('/assets?')) return { status: 200, headers: {}, bytes: new TextEncoder().encode(new URL(request.url, 'http://test').searchParams.get('ref')!) };
      return { status: 200, headers: {}, json: { progress: null } };
    });
    await env.screen.open(book); await click(env.screen, '目录'); await click(env.screen, '切换书源');
    await vi.waitFor(() => expect(env.screen.element.querySelector('.source-switch-card')?.textContent).toContain('其它书源')); await click(env.screen, '查看此源目录：其它书源');
    await vi.waitFor(() => expect(env.screen.element.querySelector('section[aria-label="切换书源"] select')).not.toBeNull());
    const submit = [...env.screen.element.querySelectorAll('button')].find(button => button.textContent === '确认换源并阅读')!;
    expect(submit.disabled).toBe(true);
    const select = env.screen.element.querySelector<HTMLSelectElement>('section[aria-label="切换书源"] select')!;
    select.value = 'x'; select.dispatchEvent(new Event('change', { bubbles: true }));
    const quality = vi.spyOn(env.api, 'switchQuality');
    quality.mockRejectedValueOnce(new ApiError('bad_request', '空章不能读取', 'EMPTY_CHAPTER', 400));
    await click(env.screen, '检测所选章节 / 重试');
    await vi.waitFor(() => expect(env.screen.element.textContent).toContain('空章不能读取'));
    quality.mockResolvedValueOnce({ chapterId: 'x', title: '另一个章节', latestChapter: '末章', characters: 100, images: 0, bytes: 300, elapsedMs: 10 });
    await click(env.screen, '检测所选章节 / 重试');
    await vi.waitFor(() => expect(env.screen.element.textContent).toContain('100 字符'));
    expect(body(env.screen)?.textContent).toContain('resource:r1:a');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(env.screen.element.querySelector('dialog[aria-label="选择阅读章节"]')?.textContent).not.toContain('100 字符');
    let finish!: (value: {chapterId:string;title:string;latestChapter:string;characters:number;images:number;bytes:number;elapsedMs:number}) => void;
    quality.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await click(env.screen, '检测所选章节 / 重试');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(quality.mock.calls.at(-1)?.[3]?.signal?.aborted).toBe(true);
    finish({chapterId:'x',title:'迟到结果',latestChapter:'末章',characters:999,images:0,bytes:999,elapsedMs:1});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(env.screen.element.querySelector('dialog[aria-label="选择阅读章节"]')?.textContent).not.toContain('999 字符');
    await click(env.screen, '确认换源并阅读');
    await vi.waitFor(() => expect(noticeText()).toContain('正文获取失败'));
    expect(body(env.screen)?.textContent).toContain('resource:r1:a');
    expect(env.screen.element.querySelector('section[aria-label="切换书源"]')?.textContent).toContain('最新章节');
    failSwitch = false; await click(env.screen, '确认换源并阅读');
    await vi.waitFor(() => expect(body(env.screen)?.textContent).toContain('resource:r2:x'));
    await vi.waitFor(() => expect(env.offline.current.progress[book.id]?.locator).toContain('chapter:x'));
    expect(noticeText()).toContain('已切换书源');
  });
  it('renders cached rich chapters with images without requesting an external origin, including offline reopening', async () => {
    const kv = new MemoryKv(); const blobs = new MemoryBlobs();
    const first = await setup(kv, blobs);
    const rich = content(['rich']); rich.kind = 'reflowable';
    delete rich.items[0]!.format; rich.items[0]!.mediaType = 'text/html; charset=utf-8';
    const html = '<h2>插图章节</h2><p>含有<strong>强调</strong>的正文。</p><img alt="插图" src="data:image/png;base64,iVBORw0KGgo=">';
    first.transport.respondWith((request) => {
      if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(rich) };
      if (request.url.includes('/assets?')) return { status: 200, headers: {}, bytes: new TextEncoder().encode(html) };
      return { status: 200, headers: {}, json: { progress: null } };
    });
    await first.screen.open(book);
    expect(body(first.screen)?.querySelector('strong')?.textContent).toBe('强调');
    expect(body(first.screen)?.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/);
    first.screen.dispose(); screens.splice(screens.indexOf(first.screen), 1); await first.offline.flush();
    const second = await setup(kv, blobs); second.transport.failWith(new ApiError('offline', 'offline'));
    await second.screen.open(book);
    expect(body(second.screen)?.querySelector('h2')?.textContent).toBe('插图章节');
    expect(body(second.screen)?.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/);
    expect(second.transport.requests.some((request) => request.url.includes('/assets?'))).toBe(false);
  });
  it('ignores delayed chapter callbacks after disposal and an offline account switch', async () => {
    const env = await setup();
    let release!: () => void;
    let started!: () => void;
    const bodyGate = new Promise<void>((resolve) => { release = resolve; });
    const bodyStarted = new Promise<void>((resolve) => { started = resolve; });
    env.transport.respondWith(async (request) => {
      if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(content(['a'])) };
      if (request.url.includes('/assets?')) {
        started();
        await bodyGate;
        return { status: 200, headers: {}, bytes: new TextEncoder().encode('delayed private chapter') };
      }
      return { status: 200, headers: {}, json: { progress: null } };
    });
    const opening = env.screen.open(book);
    await bodyStarted;
    env.screen.dispose();
    screens.splice(screens.indexOf(env.screen), 1);
    await env.offline.setScope('other-account');
    release();
    await opening;
    expect(env.offline.current.progress).toEqual({});
    expect(env.screen.element.isConnected).toBe(false);
  });
  it('caches the complete manifest and read text, reopens offline, and renders markup as literal text', async () => {
    const kv = new MemoryKv();
    const blobs = new MemoryBlobs();
    const first = await setup(kv, blobs);
    serve(first.transport, content(['a', 'b']));
    await first.screen.open(book);
    expect(body(first.screen)?.textContent).toContain('<script>alert(1)</script>');
    expect(body(first.screen)?.querySelector('script')).toBeNull();
    expect(first.transport.requests.some((request) => /\/(toc|items)$/.test(request.url))).toBe(false);
    first.screen.dispose();
    screens.splice(screens.indexOf(first.screen), 1);
    await first.offline.flush();

    const second = await setup(kv, blobs);
    second.transport.failWith(new ApiError('offline', 'offline'));
    await second.screen.open(book);
    expect(body(second.screen)?.textContent).toContain('resource:r1:a');
    await click(second.screen, '目录');
    expect(second.screen.element.querySelectorAll('.toc-list li')).toHaveLength(2);
    await click(second.screen, '2章节 b');
    await vi.waitFor(() => expect(noticeText()).toContain('这一章尚未缓存'));
    expect(body(second.screen)?.textContent).toContain('resource:r1:a');
    expect(body(second.screen)?.textContent).not.toContain('resource:r1:b');
  });

  it('refreshes by stable href, preserving the chapter after insertion and keeping old content on failure', async () => {
    const { screen, offline, transport } = await setup();
    await offline.setProgress({ bookId: book.id, locator: 'r1:0.2500:chapter:b', chapterTitle: '章节 b',
      percentage: 0.6, device: 'test', updatedAt: Date.now() });
    serve(transport, content(['a', 'b']), content(['new', 'a', 'b'], 'r2'));
    await screen.open(book);
    expect(body(screen)?.textContent).toContain('resource:r1:b');
    await click(screen, '目录');
    await click(screen, '刷新目录');
    await vi.waitFor(() => expect(noticeText()).toContain('新增 1 章'));
    expect(body(screen)?.textContent).toContain('resource:r2:b');
    expect(screen.element.querySelector('[aria-current="true"]')?.closest('li')?.getAttribute('data-section')).toBe('chapter:b');
    expect(screen.element.querySelectorAll('.toc-list li')).toHaveLength(3);

    transport.failWith(new ApiError('server', 'plugin unavailable', 'PLUGIN_DISABLED', 503));
    await click(screen, '刷新目录');
    await vi.waitFor(() => expect(noticeText()).toContain('已保留当前章节'));
    expect(body(screen)?.textContent).toContain('resource:r2:b');
    expect(screen.element.querySelectorAll('.toc-list li')).toHaveLength(3);
  });

  it('finishes an unchanged directory refresh without rebuilding or reloading the current chapter', async () => {
    const { screen, transport } = await setup();
    serve(transport, content(['a', 'b']));
    await screen.open(book);
    await click(screen, '目录');
    const view = screen.element.querySelector('book-content');
    const requestsBefore = transport.requests.filter(request => request.url.includes('/assets?')).length;
    await click(screen, '刷新目录');
    await vi.waitFor(() => expect(noticeText()).toContain('暂无新章节'));
    expect(screen.element.querySelector('book-content')).toBe(view);
    expect(transport.requests.filter(request => request.url.includes('/assets?'))).toHaveLength(requestsBefore);
    expect(body(screen)?.textContent).toContain('resource:r1:a');
  });

  it.each([400, 401, 403, 404])('does not fall back to cached content after an HTTP %i response', async (status) => {
    const env = await setup();
    const cache = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u1'));
    await cache.putManifest(book.id, manifest(content(['a'])));
    await cache.putResource(book.id, 'resource:r1:a', new TextEncoder().encode('private chapter'));
    env.transport.json({ error: { code: 'DENIED', message: 'Denied' } }, status);
    await env.screen.open(book);
    expect(body(env.screen)?.textContent ?? '').not.toContain('private chapter');
    expect(env.transport.requests.some((request) => request.url.includes('/assets?'))).toBe(false);
    if (status === 401) expect(env.onSignedOut).toHaveBeenCalled();
  });

  it('reads actual scoped cache on every directory open, including downloads and clearing', async () => {
    const env = await setup(); serve(env.transport, content(['a', 'b', 'c']));
    const cache = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u1'));
    const other = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u2'));
    await other.putResource(book.id, 'resource:r1:c', new TextEncoder().encode('另一账号正文'));
    await cache.putResource('another-book', 'resource:r1:c', new TextEncoder().encode('另一本书正文'));
    await cache.putResource(book.id, 'resource:old:c', new TextEncoder().encode('旧版本正文'));
    await env.screen.open(book);
    const cached = () => [...env.screen.element.querySelectorAll('.toc-list li')]
      .filter(row => row.querySelector('.toc-cached')).map(row => row.getAttribute('data-section'));
    await click(env.screen, '目录');
    await vi.waitFor(() => expect(cached()).toEqual(['chapter:a']));
    await click(env.screen, '目录');
    await cache.putResource(book.id, 'resource:r1:b', new TextEncoder().encode('手动下载的正文'));
    await click(env.screen, '目录');
    await vi.waitFor(() => expect(cached()).toEqual(['chapter:a', 'chapter:b']));
    await click(env.screen, '目录');
    await cache.removeBook(book.id);
    await click(env.screen, '目录');
    await vi.waitFor(() => expect(cached()).toEqual([]));
    expect(body(env.screen)?.textContent).toContain('resource:r1:a');
  });

  it('does not mark displayed chapters when the cache write fails', async () => {
    const env = await setup(); serve(env.transport, content(['a', 'b']));
    vi.spyOn(env.platform.blobs, 'put').mockRejectedValueOnce(new Error('storage full'));
    await env.screen.open(book);
    await click(env.screen, '目录');
    await vi.waitFor(() => expect(env.screen.element.querySelectorAll('.toc-list li')).toHaveLength(2));
    expect(env.screen.element.querySelector('.toc-cached')).toBeNull();
    expect(body(env.screen)?.textContent).toContain('resource:r1:a');
  });

  it('separates cached manifests, chapter bytes and progress between accounts and servers', async () => {
    const kv = new MemoryKv();
    const blobs = new MemoryBlobs();
    const one = new PublicationCache(kv, blobs, publicationScope('http://one.test/', 'u1'));
    await one.putManifest(book.id, manifest(content(['a'])));
    await one.putResource(book.id, 'ref', new TextEncoder().encode('private'));
    for (const [server, user] of [['http://one.test', 'u2'], ['http://two.test', 'u1']]) {
      const other = new PublicationCache(kv, blobs, publicationScope(server!, user!));
      expect(await other.manifest(book.id)).toBeNull();
      expect(await other.resource(book.id, 'ref')).toBeNull();
    }
    const scope = new OfflineStore(kv);
    await scope.setScope(publicationScope('http://one.test', 'u1'));
    await scope.setProgress({ bookId: book.id, locator: 'chapter:a', percentage: 0.2, chapterTitle: '', device: '', updatedAt: 1 });
    await scope.setScope(publicationScope('http://one.test', 'u2'));
    expect(await scope.getProgress(book.id)).toBeUndefined();
    await scope.setScope(publicationScope('http://one.test', 'u1'));
    expect((await scope.getProgress(book.id))?.locator).toBe('chapter:a');
  });
});

it('refreshes only the current chapter, updates offline cache and preserves text after errors', async () => {
  const env = await setup(); const value = content(['a']); value.sourceName = '示例源'; value.items[0]!.sourceUrl = 'https://example.test/a';
  let fail = false, refreshes = 0;
  env.transport.respondWith(request => {
    if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(value) };
    if (request.url.endsWith('/refresh-chapter')) {
      refreshes++;
      return fail ? { status: 502, headers: {}, json: { error: { code: 'SOURCE_ERROR', message: 'offline' } } }
        : { status: 200, headers: {}, bytes: new TextEncoder().encode('已更新的章节正文') };
    }
    if (request.url.includes('/assets?')) return { status: 200, headers: {}, bytes: new TextEncoder().encode('原来的正文') };
    return { status: 200, headers: {}, json: {} };
  });
  await env.screen.open(book);
  expect(body(env.screen)?.textContent).toContain('原来的正文');
  expect(env.screen.element.querySelector('.reader-source-info')?.textContent).toContain('示例源');
  expect(env.screen.element.querySelector('.reader-source-info a')?.getAttribute('href')).toBe('https://example.test/a');
  await click(env.screen, '刷新当前章节');
  await vi.waitFor(() => expect(body(env.screen)?.textContent).toContain('已更新的章节正文'));
  fail = true; await click(env.screen, '刷新当前章节');
  await vi.waitFor(() => expect(noticeText()).toContain('刷新正文失败'));
  expect(body(env.screen)?.textContent).toContain('已更新的章节正文'); expect(refreshes).toBe(2);
  const cache = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u1'));
  expect(new TextDecoder().decode((await cache.resource(book.id, 'resource:r1:a'))!)).toContain('已更新的章节正文');
});

describe('legacy offline migration', () => {
  it('claims a restored session once and preserves pending progress, notes, deletes and the original backup', async () => {
    const kv = new MemoryKv();
    const legacy = new OfflineStore(kv);
    await legacy.setProgress({ bookId: 'b', locator: 'r1:0.5000:chapter:a', percentage: 0.5, chapterTitle: '', device: '', updatedAt: 1 });
    await legacy.upsertNotes([{ id: 'n', bookId: 'b', locator: 'x', type: 'note', text: '待同步', comment: '', color: '', updatedAt: 1 }]);
    await legacy.deleteNote('old');
    const backup = await kv.get('reader.offline.v1');
    const migrated = new OfflineStore(kv);
    await migrated.setScope('server/account-1', { claimLegacy: true });
    expect(migrated.outbox()).toEqual(legacy.outbox());
    expect(await kv.get('reader.offline.v1')).toBe(backup);
    const second = new OfflineStore(kv);
    await second.setScope('server/account-2', { claimLegacy: true });
    expect(second.outbox()).toEqual({ progress: [], notes: [], deletes: [] });
  });

  it('does not give a fresh login legacy data when its session is restored on the next launch', async () => {
    const kv = new MemoryKv();
    await kv.set('reader.offline.v1', JSON.stringify({ progress: { secret: { locator: 'private' } } }));
    const fresh = new OfflineStore(kv);
    await fresh.setScope('new-account');
    const reopened = new OfflineStore(kv);
    await reopened.setScope('new-account', { claimLegacy: true });
    expect(reopened.current.progress).toEqual({});
  });
});

it('opens tools, searches the whole book, navigates and returns, and persists a bookmark', async () => {
 const env = await setup(); serve(env.transport,content(['a','b'])); await env.screen.open(book);
 await click(env.screen,'工具'); await vi.waitFor(()=>expect(env.screen.element.textContent).toContain('搜索全文'));
 const input = env.screen.element.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
 input.value = '正文'; input.dispatchEvent(new Event('input',{bubbles:true}));
 await vi.waitFor(()=>expect(env.screen.element.querySelector<HTMLButtonElement>('form button')?.disabled).toBe(false));
 await click(env.screen,'搜索全文');
 await vi.waitFor(()=>expect(env.screen.element.querySelectorAll('.reading-tool-results li')).toHaveLength(2));
 const results = env.screen.element.querySelectorAll<HTMLButtonElement>('.reading-tool-results li button'); results[1]!.click();
 await vi.waitFor(()=>expect(body(env.screen)?.textContent).toContain('resource:r1:b'));
 await vi.waitFor(()=>expect(env.screen.element.querySelector('dialog')).toBeNull());
 await click(env.screen,'工具'); await click(env.screen,'返回原阅读位置');
 await vi.waitFor(()=>expect(body(env.screen)?.textContent).toContain('resource:r1:a'));
 await vi.waitFor(()=>expect(env.screen.element.querySelector('dialog')).toBeNull());
 await click(env.screen,'工具'); await click(env.screen,'笔记');
 expect(env.screen.element.querySelector('.reading-note-editor')).toBeNull();
 await click(env.screen,'添加当前位置书签');
 await vi.waitFor(()=>expect(env.offline.notesFor(book.id)).toHaveLength(1));
 expect(env.offline.notesFor(book.id)[0]?.type).toBe('bookmark');
 await vi.waitFor(()=>expect(env.screen.element.querySelectorAll('.reading-note-list li')).toHaveLength(1));
 await click(env.screen,'编辑');
 await vi.waitFor(()=>expect(env.screen.element.querySelector('textarea[aria-label="批注"]')).not.toBeNull());
 const comment=env.screen.element.querySelector<HTMLTextAreaElement>('textarea[aria-label="批注"]')!;
 await act(() => { comment.value='稍后再读';comment.dispatchEvent(new Event('input',{bubbles:true})); });
 await click(env.screen,'保存修改');
 await vi.waitFor(()=>expect(env.offline.notesFor(book.id)[0]?.comment).toBe('稍后再读'));
 await vi.waitFor(()=>expect(env.screen.element.querySelector('.reading-note-editor')).toBeNull());
 await act(() => click(env.screen,'删除笔记'));
 expect(env.offline.notesFor(book.id)).toHaveLength(1);
 await act(() => document.querySelector<HTMLButtonElement>('dialog[role=alertdialog] .sheet-cancel')!.click());
 await vi.waitFor(()=>expect(document.querySelector('dialog[role=alertdialog]')).toBeNull());
 expect(env.offline.notesFor(book.id)).toHaveLength(1);
 await act(() => click(env.screen,'删除笔记'));await act(() => document.querySelector<HTMLButtonElement>('dialog[role=alertdialog] .sheet-footer .primary')!.click());
 await vi.waitFor(()=>expect(env.offline.notesFor(book.id)).toHaveLength(0));
});

it('persists a deliberate page turn before the idle-save timer', async () => {
  const kv = new MemoryKv();
  const env = await setup(kv, undefined, 'u1', 'http://one.test', { mode: 'paged' }); serve(env.transport, content(['a'])); await env.screen.open(book);
  const reader = env.screen as unknown as { view: ReaderView; turnPage(direction: 'next'): Promise<void>; onPosition(position: ReturnType<ReaderView['position']>): void };
  const position = { ...reader.view.position(), within: 0.6, percentage: 0.6, locator: 'r1:0.6000@1200:chapter:a' };
  const next = vi.spyOn(reader.view, 'next').mockImplementation(async () => { reader.onPosition(position); return true; });
  try {
    await reader.turnPage('next');
    const reloaded = new OfflineStore(kv);
    await reloaded.setScope(publicationScope('http://one.test', 'u1'));
    expect(reloaded.progressFor(book.id)?.locator).toBe(position.locator);
  } finally { next.mockRestore(); }
});

it('samples the latest scroll position when saving before a pending scroll event', async () => {
  const kv = new MemoryKv();
  const env = await setup(kv); serve(env.transport, content(['a'])); await env.screen.open(book);
  const reader = env.screen as unknown as { view: ReaderView };
  const position = { ...reader.view.position(), within: 0.6, percentage: 0.6, locator: 'r1:0.6000@1200:chapter:a' };
  const sample = vi.spyOn(reader.view, 'position').mockReturnValue(position);
  try {
    await env.screen.flushProgress();
    const reloaded = new OfflineStore(kv);
    await reloaded.setScope(publicationScope('http://one.test', 'u1'));
    expect(reloaded.progressFor(book.id)?.locator).toBe(position.locator);
  } finally { sample.mockRestore(); }
});

it('preserves page-turn order while a chapter is still loading', async () => {
  const env = await setup(); serve(env.transport, content(['a','b'])); await env.screen.open(book);
  const reader = env.screen as unknown as { view: ReaderView; turnPage(direction:'next'|'previous'):Promise<void> };
  let finish!: (moved:boolean) => void;
  const order: string[] = [];
  const next = vi.spyOn(reader.view,'next').mockImplementation(() => {order.push('next');return new Promise(resolve => {finish=resolve;});});
  const previous = vi.spyOn(reader.view,'previous').mockImplementation(async () => {order.push('previous');return true;});
  try {
    const first=reader.turnPage('next'); await vi.waitFor(()=>expect(next).toHaveBeenCalledOnce());
    const second=reader.turnPage('previous'); await Promise.resolve();
    expect(previous).not.toHaveBeenCalled();
    finish(true);await Promise.all([first,second]);expect(order).toEqual(['next','previous']);
  } finally { next.mockRestore();previous.mockRestore(); }
});
it('allows a queued reverse turn after a chapter load fails', async () => {
  const env = await setup(); serve(env.transport, content(['a','b'])); await env.screen.open(book);
  const reader = env.screen as unknown as { view: ReaderView; turnPage(direction:'next'|'previous'):Promise<void> };
  const next=vi.spyOn(reader.view,'next').mockRejectedValue(new Error('Chapter unavailable'));
  const previous=vi.spyOn(reader.view,'previous').mockResolvedValue(true);
  try {await Promise.all([reader.turnPage('next'),reader.turnPage('previous')]);expect(previous).toHaveBeenCalledOnce();}
  finally {next.mockRestore();previous.mockRestore();}
});

it('cancels queued page turns after an explicit chapter selection', async () => {
  const env=await setup();serve(env.transport,content(['a','b','c']));await env.screen.open(book);
  const reader=env.screen as unknown as {view:ReaderView;turnPage(direction:'next'|'previous'):Promise<void>;goToSection(index:number):Promise<void>};
  let finish!:(moved:boolean)=>void;
  const next=vi.spyOn(reader.view,'next').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const previous=vi.spyOn(reader.view,'previous').mockResolvedValue(true);
  try {
    const first=reader.turnPage('next');await vi.waitFor(()=>expect(finish).toBeDefined());
    const queued=reader.turnPage('previous');await reader.goToSection(1);
    finish(true);await Promise.all([first,queued]);
    expect(previous).not.toHaveBeenCalled();expect(reader.view.position().sectionId).toBe('chapter:b');
  }finally{next.mockRestore();previous.mockRestore();}
});

it('keeps the latest directory selection busy when an earlier local chapter finishes', async () => {
  const env = await setup(); serve(env.transport, content(['a', 'b', 'c'])); await env.screen.open(book);
  const reader = env.screen as unknown as { view: ReaderView; chrome: { pendingChapterRef?: string; tocOpen: boolean }; goToChapterRef(ref: string): Promise<void> };
  const finish: Array<() => void> = [];
  const open = vi.spyOn(reader.view, 'open').mockImplementation(() => new Promise<void>(resolve => { finish.push(resolve); }));
  try {
    reader.chrome.tocOpen = true;
    const first = reader.goToChapterRef('chapter:b');
    const second = reader.goToChapterRef('chapter:c');
    expect(open).toHaveBeenCalledTimes(2);
    finish[0]!(); await first;
    expect(reader.chrome.pendingChapterRef).toBe('chapter:c');
    expect(reader.chrome.tocOpen).toBe(true);
    finish[1]!(); await second;
    expect(reader.chrome.pendingChapterRef).toBeUndefined();
    expect(reader.chrome.tocOpen).toBe(false);
  } finally { open.mockRestore(); }
});

describe('automatic chapter caching', () => {
  it('caches only the configured upcoming chapters and marks persisted chapters in the contents', async () => {
    const env = await setup(undefined, undefined, undefined, undefined, { autoCache: true, autoCacheChapters: 3 });
    serve(env.transport, content(['a', 'b', 'c', 'd', 'e']));
    const cache = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u1'));
    await env.screen.open(book);
    await vi.waitFor(async () => expect((await cache.entries()).map(item => item.ref)).toEqual(['resource:r1:a', 'resource:r1:b', 'resource:r1:c', 'resource:r1:d']));
    expect(body(env.screen)?.textContent).toContain('resource:r1:a');
    await click(env.screen, '目录');
    await vi.waitFor(() => expect(env.screen.element.querySelectorAll('.toc-cached')).toHaveLength(4));
    expect(env.transport.countMatching(request => request.url.includes('/assets?'))).toBe(4);
    expect(await new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u2')).entries()).toEqual([]);
  });

  it('continues outside the tools panel and stops a pending write when disabled', async () => {
    const env = await setup(); serve(env.transport, content(['a', 'b', 'c'])); await env.screen.open(book);
    const cache = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u1'));
    let finish!: (value: Blob) => void;
    const asset = vi.spyOn(env.api, 'asset').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await click(env.screen, '工具'); await click(env.screen, '离线缓存');
    const toggle = () => env.screen.element.querySelector<HTMLInputElement>('.reading-cache-auto input')!;
    await act(() => toggle().click());
    await vi.waitFor(() => expect(asset).toHaveBeenCalledOnce());
    await click(env.screen, '关闭');
    finish(new Blob(['chapter b']));
    await vi.waitFor(() => expect(asset).toHaveBeenCalledTimes(2));
    expect(await cache.resource(book.id, 'resource:r1:b')).toBeTruthy();
    await click(env.screen, '工具'); await click(env.screen, '离线缓存');
    expect(toggle().checked).toBe(true);
    await act(() => toggle().click());
    expect(asset.mock.calls[1]![2]?.signal?.aborted).toBe(true);
    finish(new Blob(['chapter c'])); await new Promise(resolve => setTimeout(resolve, 20));
    expect(await cache.resource(book.id, 'resource:r1:c')).toBeNull();
    expect(body(env.screen)?.textContent).toContain('resource:r1:a');
  });

  it('cancels stale requests on a chapter jump and departure', async () => {
    const env = await setup(undefined, undefined, undefined, undefined, { autoCache: true, autoCacheChapters: 1 });
    serve(env.transport, content(['a', 'b', 'c', 'd']));
    let finish!: (value: Blob) => void;
    const realAsset = env.api.asset.bind(env.api);
    const asset = vi.spyOn(env.api, 'asset').mockImplementation((id, ref, options) => ref === 'resource:r1:b'
      ? new Promise(resolve => { finish = resolve; }) : realAsset(id, ref, options));
    await env.screen.open(book);
    await vi.waitFor(() => expect(finish).toBeDefined());
    const old = asset.mock.calls.find(call => call[1] === 'resource:r1:b')![2]!.signal!;
    await click(env.screen, '目录'); await click(env.screen, '章节 c');
    await vi.waitFor(() => expect(body(env.screen)?.textContent).toContain('resource:r1:c'));
    expect(old.aborted).toBe(true);
    finish(new Blob(['obsolete']));
    const cache = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u1'));
    await vi.waitFor(async () => expect(await cache.resource(book.id, 'resource:r1:d')).toBeTruthy());
    expect(await cache.resource(book.id, 'resource:r1:b')).toBeNull();
    await click(env.screen, '工具'); await click(env.screen, '离线缓存');
    const select = env.screen.element.querySelector<HTMLSelectElement>('.reading-cache-auto select')!;
    select.value = '3'; await act(() => { select.dispatchEvent(new Event('change', { bubbles: true })); });
    env.screen.dispose();
    for (const call of asset.mock.calls.filter(call => call[2]?.signal)) expect(call[2]!.signal!.aborted).toBe(true);
    screens.splice(screens.indexOf(env.screen), 1);
  });

  it('stops on a failed cache write and preserves the current text', async () => {
    const blobs = new MemoryBlobs(); const env = await setup(undefined, blobs, undefined, undefined, { autoCache: true });
    serve(env.transport, content(['a', 'b', 'c']));
    const realPut = blobs.put.bind(blobs);
    vi.spyOn(blobs, 'put').mockImplementation((key, bytes) => decodeURIComponent(key).includes('resource:r1:b') ? Promise.reject(new Error('quota full')) : realPut(key, bytes));
    await env.screen.open(book); await click(env.screen, '工具'); await click(env.screen, '离线缓存');
    await vi.waitFor(() => expect(env.screen.element.textContent).toContain('预缓存暂停：quota full'));
    expect(env.transport.countMatching(request => request.url.includes('/assets?'))).toBe(2);
    expect(body(env.screen)?.textContent).toContain('resource:r1:a');
    await click(env.screen, '关闭'); await click(env.screen, '目录');
    await vi.waitFor(() => expect(env.screen.element.querySelectorAll('.toc-cached')).toHaveLength(1));
  });

  it('skips prefetch while offline', async () => {
    const env = await setup(undefined, undefined, undefined, undefined, { autoCache: true });
    serve(env.transport, content(['a', 'b'])); env.platform.setOnline(false);
    await env.screen.open(book); await click(env.screen, '工具'); await click(env.screen, '离线缓存');
    await vi.waitFor(() => expect(env.screen.element.textContent).toContain('当前网络下暂停预缓存'));
    expect(env.transport.countMatching(request => request.url.includes('/assets?'))).toBe(1);
  });
});

it('pre-caches across metadata windows without moving the reader, skips saved bodies, and resumes online', async () => {
  const env = await setup(undefined, undefined, undefined, undefined, { autoCache: true });
  const value = content(['a', 'b', 'c', 'd']);
  value.groups = [{ id: 'one', seq: 0, offset: 0, count: 2, title: '一' }, { id: 'two', seq: 1, offset: 2, count: 2, title: '二' }];
  const first = { ...value, items: value.items.slice(0, 2) }, second = { ...value, items: value.items.slice(2) };
  const cache = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u1'));
  await cache.putResource(book.id, 'resource:r1:b', new TextEncoder().encode('already saved'));
  serve(env.transport, first);
  const items = vi.spyOn(env.api, 'items').mockResolvedValue(second);
  env.platform.setOnline(false); await env.screen.open(book);
  expect(env.transport.countMatching(request => request.url.includes('/assets?'))).toBe(1);
  env.platform.setOnline(true);
  await vi.waitFor(async () => expect(await cache.resource(book.id, 'resource:r1:d')).toBeTruthy());
  expect(items).toHaveBeenCalledOnce(); expect(items.mock.calls[0]![1]).toBe(1);
  expect(env.transport.countMatching(request => request.url.includes('/assets?'))).toBe(3);
  expect(body(env.screen)?.textContent).toContain('resource:r1:a');
  expect(await cache.window(book.id, 1)).toEqual(second);
});

it('cancels pending pre-cache before clearing the current book', async () => {
  const env = await setup(undefined, undefined, undefined, undefined, { autoCache: true });
  serve(env.transport, content(['a', 'b']));
  const realAsset = env.api.asset.bind(env.api);
  let finish!: (value: Blob) => void;
  const asset = vi.spyOn(env.api, 'asset').mockImplementation((id, ref, options) => ref === 'resource:r1:b'
    ? new Promise(resolve => { finish = resolve; }) : realAsset(id, ref, options));
  await env.screen.open(book); await vi.waitFor(() => expect(finish).toBeDefined());
  await click(env.screen, '工具'); await click(env.screen, '离线缓存');
  await vi.waitFor(() => expect(env.screen.element.textContent).toContain('清理缓存'));
  await click(env.screen, '清理缓存');
  await vi.waitFor(() => expect(document.querySelector('dialog[aria-label="清理缓存"]')).toBeTruthy());
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '确认清理')!;
  await act(() => confirm.click());
  const cache = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u1'));
  await vi.waitFor(async () => expect(await cache.entries()).toEqual([]));
  expect(asset.mock.calls.find(call => call[1] === 'resource:r1:b')![2]!.signal!.aborted).toBe(true);
  finish(new Blob(['late body'])); await new Promise(resolve => setTimeout(resolve, 20));
  expect(await cache.entries()).toEqual([]);
  expect(body(env.screen)?.textContent).toContain('resource:r1:a');
});

it('updates cache markers when the directory opens before the visible chapter finishes saving', async () => {
  const env = await setup(); serve(env.transport, content(['a', 'b']));
  let finish!: (value: Blob) => void;
  vi.spyOn(env.api, 'asset').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const opening = env.screen.open(book);
  await vi.waitFor(() => expect(finish).toBeDefined());
  await click(env.screen, '目录');
  await vi.waitFor(() => expect(env.screen.element.querySelectorAll('.toc-list button')).toHaveLength(2));
  expect(env.screen.element.querySelectorAll('.toc-cached')).toHaveLength(0);
  finish(new Blob(['visible body'])); await opening;
  await vi.waitFor(() => expect(env.screen.element.querySelectorAll('.toc-cached')).toHaveLength(1));
  expect(env.screen.element.querySelector('.toc-cached')?.closest('button')?.textContent).toContain('章节 a');
});


it('applies brightness to the whole reading screen on load and slider updates', async () => {
  const env = await setup(undefined, undefined, 'u1', 'http://one.test', { brightness: 0 });
  serve(env.transport, content(['a'])); await env.screen.open(book);
  expect(env.screen.element.style.getPropertyValue('--reader-brightness')).toBe('0.5');
  expect(document.documentElement.dataset.readerBrightness).toBe('0.5');
  await click(env.screen, '外观');
  const slider = env.screen.element.querySelector<HTMLInputElement>('[aria-label="页面亮度"]')!;
  await act(() => { slider.value = '0.75'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(env.screen.element.style.getPropertyValue('--reader-brightness')).toBe('0.75');
  expect(document.documentElement.dataset.readerBrightness).toBe('0.75');
  expect(env.screen.element.querySelector<HTMLElement>('.stage')?.style.getPropertyValue('--reader-brightness')).toBe('');
  env.screen.dispose();
  screens.splice(screens.indexOf(env.screen), 1);
  expect(document.documentElement.dataset.readerBrightness).toBeUndefined();
  expect(document.documentElement.style.getPropertyValue('--reader-browser-paper')).toBe('');
});

it('matches the saved page theme and system tint before the first content loads', async () => {
  const root = document.documentElement;
  const meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta);
  applyTheme(root, 'light');
  const env = await setup(undefined, undefined, 'u1', 'http://one.test', { theme: 'dark', brightness: 0.5 });
  try {
    expect(env.screen.element.style.getPropertyValue('--color-surface')).toBe('#1e2024');
    expect(env.screen.element.style.getPropertyValue('--reader-browser-paper')).toBe('');
    expect(env.screen.element.dataset.readingTheme).toBe('local-dark');
    expect(env.screen.element.dataset.paper).toBeUndefined();
    expect(root.dataset.theme).toBe('light');
    expect(meta.content).toBe('#0f1012');
    const reader = env.screen as unknown as { updateSetting(patch: Partial<AppSettings>): Promise<void> };
    await reader.updateSetting({ theme: 'green' });
    expect(env.screen.element.style.getPropertyValue('--color-surface')).toBe('#e8f2e8');
    expect(meta.content).toBe('#747974');
  } finally { meta.remove(); }
});

it('toggles glass without reapplying body settings or changing its saved palette', async () => {
  const env = await setup(undefined, undefined, 'u1', 'http://one.test', { theme: 'wechat-night' });
  serve(env.transport, content(['a'])); await env.screen.open(book);
  const reader = env.screen as unknown as { view: { applySettings(settings: unknown): void }; updateSetting(patch: Partial<AppSettings>): Promise<void> };
  const apply = vi.spyOn(reader.view, 'applySettings');
  await reader.updateSetting({ liquidGlass: true });
  expect(apply).not.toHaveBeenCalled();
  expect(env.onSettingsChange).toHaveBeenLastCalledWith({ liquidGlass: true });
  expect(env.screen.element.dataset.readingTheme).toBe('local-wechat-night');
  await click(env.screen, '外观');
  expect(env.screen.element.querySelector('[aria-label="液态玻璃"]')?.getAttribute('aria-pressed')).toBe('true');
});

it('blocks body tap, swipe and keyboard paging while controls are visible and restores them after closing', async () => {
  const env = await setup(undefined, undefined, 'u1', 'http://one.test', { mode: 'paged' });
  serve(env.transport, content(['a', 'b'])); await env.screen.open(book);
  const reader = env.screen as unknown as { turnPage(direction: 'next' | 'previous'): Promise<void>; onTapZone(zone: 'previous' | 'next' | 'toggle-chrome'): void };
  const turn = vi.spyOn(reader, 'turnPage').mockResolvedValue();
  const stage = env.screen.element.querySelector<HTMLElement>('.stage')!;
  stage.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 600, width: 300, height: 600, toJSON() {} });
  const swipe = () => {
    for (const [type, x] of [['pointerdown', 250], ['pointerup', 50]] as const) {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { clientX: x, clientY: 300, pointerType: 'touch', button: 0 });
      stage.dispatchEvent(event);
    }
  };
  const pageKey = () => {
    const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    stage.dispatchEvent(event);
    return event;
  };
  reader.onTapZone('next'); reader.onTapZone('previous'); swipe();
  expect(pageKey().defaultPrevented).toBe(true);
  expect(turn).not.toHaveBeenCalled();
  reader.onTapZone('toggle-chrome');
  expect(env.screen.element.dataset.chrome).toBe('hidden');
  reader.onTapZone('next'); swipe(); pageKey();
  expect(turn).toHaveBeenCalledTimes(3);
  reader.onTapZone('toggle-chrome'); turn.mockClear();
  reader.onTapZone('next'); swipe(); pageKey();
  expect(turn).not.toHaveBeenCalled();
});

it('updates system tint as controls open and close, including theme and brightness changes and leaving the reader', async () => {
  const meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta);
  const env = await setup(undefined, undefined, 'u1', 'http://one.test', { theme: 'green', brightness: 0.5 });
  const reader = env.screen as unknown as { setChromeVisible(visible: boolean): void; updateSetting(patch: Partial<AppSettings>): Promise<void> };
  try {
    serve(env.transport, content(['a'])); await env.screen.open(book);
    expect(meta.content).toBe('#747974');
    reader.setChromeVisible(false);
    expect(meta.content).toBe('#6b766c');
    reader.setChromeVisible(true);
    expect(meta.content).toBe('#747974');
    await reader.updateSetting({ brightness: 1 });
    expect(meta.content).toBe('#e8f2e8');
    await reader.updateSetting({ theme: 'dark' });
    expect(meta.content).toBe('#1e2024');
    env.screen.dispose(); screens.splice(screens.indexOf(env.screen), 1);
    expect(document.documentElement.dataset.readerChrome).toBeUndefined();
    expect(meta.content).toBe('#FDF9F6');
  } finally { meta.remove(); }
});

it.each(['sepia', 'green'] as const)('restores %s after a night toggle and reopening the reader', async theme => {
  const env = await setup(undefined, undefined, 'u1', 'http://one.test', { theme });
  serve(env.transport, content(['a'])); await env.screen.open(book);
  await click(env.screen, '夜间');
  expect(env.onSettingsChange).toHaveBeenLastCalledWith({ theme: 'dark', readingTheme: 'local-dark', paper: 'theme', paperFollowsDark: false, lastDayTheme: theme, lastNightTheme: 'dark' });
  const kv = new MemoryKv(), store = new SettingsStore(kv);
  await store.load(); await store.update(env.onSettingsChange.mock.calls.at(-1)![0]);
  const restored = await new SettingsStore(kv).load();
  const next = await setup(undefined, undefined, 'u1', 'http://one.test', restored);
  serve(next.transport, content(['a'])); await next.screen.open(book);
  await click(next.screen, '日间');
  expect(next.onSettingsChange).toHaveBeenLastCalledWith({ theme, readingTheme: `local-${theme}`, paper: 'theme', paperFollowsDark: false, lastDayTheme: theme, lastNightTheme: 'dark' });
});

it('keeps automatic sync quiet while preserving failures and offline feedback', async () => {
  const env = await setup(); serve(env.transport, content(['a'])); await env.screen.open(book);
  const update = vi.mocked(env.sync.onStatus).mock.calls[0]![0];
  const status = { state: 'syncing' as const, pending: true, message: '', lastSyncAt: null };
  vi.spyOn(env.sync, 'status').mockReturnValue(status); update(status);
  expect(noticeText()).not.toContain('同步中');
  vi.mocked(env.sync.status).mockReturnValue({ ...status, state: 'error', message: '同步失败' }); update(env.sync.status());
  expect(noticeText()).toContain('同步失败');
  vi.mocked(env.sync.status).mockReturnValue({ ...status, state: 'offline' }); update(env.sync.status());
  expect(noticeText()).toContain('进度待同步');
});


it('remembers each settings section independently across reopening and reload', async () => {
  const env = await setup(); serve(env.transport, content(['a'])); await env.screen.open(book);
  await click(env.screen, '外观');
  const section = [...env.screen.element.querySelectorAll<HTMLDetailsElement>('details')]
    .find(details => details.querySelector('summary')?.textContent === '页眉页脚顶部与底部显示的信息')!;
  section.open = false;
  section.dispatchEvent(new Event('toggle'));
  await vi.waitFor(() => expect(env.onSettingsChange).toHaveBeenCalled());
  const saved = env.onSettingsChange.mock.calls.at(-1)![0];
  expect(saved.readerSections).toEqual({ readout: false, text: true, theme: true, paging: true });
  await click(env.screen, '外观'); await click(env.screen, '外观');
  expect([...env.screen.element.querySelectorAll<HTMLDetailsElement>('details')]
    .find(details => details.querySelector('summary')?.textContent === '页眉页脚顶部与底部显示的信息')?.open).toBe(false);
  const kv = new MemoryKv(), store = new SettingsStore(kv);
  await store.load(); await store.update(saved);
  const next = await setup(undefined, undefined, 'u1', 'http://one.test', await new SettingsStore(kv).load());
  serve(next.transport, content(['a'])); await next.screen.open(book); await click(next.screen, '外观');
  const details = [...next.screen.element.querySelectorAll<HTMLDetailsElement>('details')];
  expect(details.map(item => item.querySelector('summary')?.textContent)).toEqual(['主题', '更多排版页边距 · 对齐 · 字体', '页眉页脚顶部与底部显示的信息']);
  expect(details.map(item => item.open)).toEqual([true, true, false]);
  const readout = details[2]!; readout.open = true; readout.dispatchEvent(new Event('toggle'));
  await vi.waitFor(() => expect(next.onSettingsChange).toHaveBeenCalledWith({ readerSections: { readout: true, text: true, theme: true, paging: true } }));
});
