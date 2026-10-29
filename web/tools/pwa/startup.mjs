import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID, CHAPTERS } from '../ui-review/server.mjs';

// Keep navigator.onLine true while the server stops responding, as on Wi-Fi
// without internet. This also avoids WebKit's broken setOffline navigation.
const server = createReviewServer({ port: 0 });
const handlers = server.server.listeners('request');
server.server.removeAllListeners('request');
let mode = 'online';
const pending = new Set();
server.server.on('request', (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (mode === 'unreachable') { response.destroy(); return; }
  if (mode === 'gateway') { response.writeHead(502); response.end('Bad Gateway'); return; }
  if ((mode === 'hanging' && path === '/api/v1/auth/me')
    || (mode === 'hanging-all' && path.startsWith('/api/'))
    || (mode === 'hanging-shelf' && path === '/api/v1/books')
    || (mode === 'hanging-manifest' && path.endsWith('/manifest'))
    || (mode === 'hanging-overrides' && path.endsWith('/reading-overrides'))
    || (mode === 'hanging-refresh' && path === '/api/v1/auth/refresh')) {
    pending.add(response);
    response.on('close', () => pending.delete(response));
    return;
  }
  for (const handler of handlers) handler.call(server.server, request, response);
});
const origin = await server.listen();
async function chapterVisible(page, index) {
  try {
    await page.waitForFunction(text => document.querySelector('book-content')?.shadowRoot?.textContent?.includes(text), CHAPTERS[index].title, { timeout: 8000 });
  } catch (error) {
    console.error('Offline failure diagnostics', { mode, expected: CHAPTERS[index].title, state: await page.evaluate(book => ({
      url: location.href, screen: document.body.innerText.slice(-1000),
      chapter: document.querySelector('book-content')?.shadowRoot?.textContent?.slice(-300),
      progress: window.readerApp?.offline.progressFor(book),
      cachedBooks: window.readerApp?.offline.books().length,
    }), BOOK_ID) });
    throw error;
  }
}
async function readCachedNovel(page) {
  await page.getByText('剑来 第1卷', { exact: true }).first().click();
  await chapterVisible(page, 1);
  if (await page.locator('.reader-screen').getAttribute('data-chrome') === 'hidden') await page.locator('.stage').click({ position: { x: 195, y: 350 } });
  await page.getByRole('button', { name: '上一章', exact: true }).click();
  await chapterVisible(page, 0);
  await page.getByRole('button', { name: '下一章', exact: true }).click();
  await chapterVisible(page, 1);
  await page.evaluate(async () => { await window.readerApp.saveBeforeUpdate(); });
  const progress = await page.evaluate(book => window.readerApp.offline.progressFor(book), BOOK_ID);
  assert(progress.locator.includes('chapter:1'), 'offline reading position is saved locally');
}
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    mode = 'online';
    const profile = await mkdtemp(join(tmpdir(), `reader-offline-${engine}-`));
    const options = { headless: true, viewport: { width: 390, height: 844 } };
    let context = await type.launchPersistentContext(profile, options);
    try {
      let page = await context.newPage();
      await context.route('https://wuxf.top/**', route => route.abort());
      await page.goto(origin + '/#/shelf');
      await page.getByText('更换服务地址', { exact: true }).click();
      await page.locator('input[type=url]').fill(origin);
      await page.locator('input[autocomplete=username]').fill('review');
      await page.locator('input[type=password]').fill('password12');
      await page.locator('button[type=submit]').click();
      await page.locator('.app-shell').waitFor();
      await page.waitForFunction(book => window.readerApp.offline.books().some(item => item.id === book), BOOK_ID);
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve =>
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
        await window.readerApp.offline.flush();
      });
      await page.evaluate(async () => { await window.readerApp.updateSettings({ autoCache: false }); });
      await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
      await chapterVisible(page, 0);
      if (await page.locator('.reader-screen').getAttribute('data-chrome') === 'hidden') await page.locator('.stage').click({ position: { x: 195, y: 350 } });
      await page.getByRole('button', { name: '下一章', exact: true }).click();
      await chapterVisible(page, 1);
      await page.evaluate(async () => { await window.__readerFlush(); });
      await page.close();
      mode = 'hanging';
      page = await context.newPage();
      const start = Date.now();
      await page.goto(origin + '/#/shelf', { waitUntil: 'domcontentloaded' });
      await page.locator('.app-shell').waitFor({ timeout: 5000 });
      const startupMs = Date.now() - start;
      assert(startupMs < 1500, `cached shell must render before the verification timeout, took ${startupMs}ms`);
      console.log(`PASS ${engine}: cached shell ${startupMs}ms while login verification hangs`);
      assert.equal(await page.locator('#app-startup').count(), 0);
      assert.equal(await page.evaluate(() => window.readerApp.api.currentSession()?.user.id), 'u1');
      assert.equal(await page.evaluate(() => !!window.readerApp && document.querySelector('.app-shell') !== null), true);
      await page.close();
      for (const response of pending) response.destroy();
      mode = 'unreachable';
      page = await context.newPage();
      await page.goto(origin + '/#/shelf');
      await page.locator('.app-shell').waitFor({ timeout: 5000 });
      assert.equal(await page.locator('#app-startup').count(), 0);
      await page.getByText('剑来 第1卷', { exact: true }).first().waitFor({ timeout: 5000 });
      assert.equal(await page.evaluate(() => window.readerApp.api.currentSession()?.user.id), 'u1');
      assert.equal(await page.evaluate(() => navigator.onLine), true);
      await readCachedNovel(page);
      // A real offline event pauses Query's default online-only scheduling.
      // Keep WebKit's network emulation out of navigation; the server is unreachable.
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.evaluate(() => { location.hash = '#/shelf?sort=title'; });
      await page.getByText('剑来 第1卷', { exact: true }).first().waitFor({ timeout: 5000 });
      await readCachedNovel(page);
      for (const fault of ['hanging-shelf', 'hanging-manifest', 'hanging-overrides', 'hanging-all']) {
        await page.close();
        for (const response of pending) response.destroy();
        mode = fault;
        page = await context.newPage();
        await page.goto(origin + '/#/shelf', { waitUntil: 'domcontentloaded' });
        await page.locator('.app-shell').waitFor({ timeout: 5000 });
        await page.getByText('剑来 第1卷', { exact: true }).first().waitFor({ timeout: 5000 });
        await readCachedNovel(page);
        assert.equal(await page.getByText('书架加载失败', { exact: true }).count(), 0);
        console.log(`PASS ${engine}: ${fault}, cached shelf, chapter navigation and durable local progress`);
      }
      await page.evaluate(async () => {
        const kv = window.readerApp.platform.kv;
        const session = JSON.parse(await kv.get('reader.session.v1'));
        session.accessTokenExpiresAt = 0;
        await kv.set('reader.session.v1', JSON.stringify(session));
      });
      await page.close();
      for (const response of pending) response.destroy();
      mode = 'hanging-refresh';
      page = await context.newPage();
      await page.goto(origin + '/#/shelf');
      await page.getByText('剑来 第1卷', { exact: true }).first().waitFor({ timeout: 5000 });
      await readCachedNovel(page);
      await page.close();
      for (const response of pending) response.destroy();
      mode = 'gateway';
      page = await context.newPage();
      await page.goto(origin + '/#/shelf');
      await page.getByText('剑来 第1卷', { exact: true }).first().waitFor({ timeout: 5000 });
      await readCachedNovel(page);
      mode = 'unreachable';
      if (engine === 'chromium') {
        await page.close();
        await context.setOffline(true);
        page = await context.newPage();
        await page.goto(origin + '/#/shelf');
        await page.locator('.app-shell').waitFor({ timeout: 5000 });
        await page.getByText('剑来 第1卷', { exact: true }).first().waitFor({ timeout: 5000 });
        assert.equal(await page.evaluate(() => navigator.onLine), false);
        await readCachedNovel(page);
      }
      await context.close();
      // Restart the whole browser process, preserving only committed disk storage.
      mode = 'unreachable';
      context = await type.launchPersistentContext(profile, options);
      page = await context.newPage();
      await page.goto(origin + '/#/shelf');
      await page.getByText('剑来 第1卷', { exact: true }).first().waitFor({ timeout: 5000 });
      await readCachedNovel(page);
      console.log(`PASS ${engine}: browser process restart offline, offline event, hanging token refresh, 502 with expired access token; cached shelf, chapters and saved position`);
    } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  }
} finally {
  for (const response of pending) response.destroy();
  await server.close();
}
