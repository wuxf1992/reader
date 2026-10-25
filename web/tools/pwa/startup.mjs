import assert from 'node:assert/strict';
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
  if (mode === 'hanging' && path === '/api/v1/auth/me') {
    pending.add(response);
    response.on('close', () => pending.delete(response));
    return;
  }
  for (const handler of handlers) handler.call(server.server, request, response);
});
const origin = await server.listen();
async function chapterVisible(page, index) {
  await page.waitForFunction(text => document.querySelector('book-content')?.shadowRoot?.textContent?.includes(text), CHAPTERS[index].title, { timeout: 8000 });
}
async function readCachedNovel(page) {
  await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
  await chapterVisible(page, 1);
  await page.getByRole('button', { name: '上一章', exact: true }).click();
  await chapterVisible(page, 0);
  await page.getByRole('button', { name: '下一章', exact: true }).click();
  await chapterVisible(page, 1);
  await page.evaluate(async () => { await window.__readerFlush(); });
  const progress = await page.evaluate(book => window.readerApp.offline.progressFor(book), BOOK_ID);
  assert(progress.locator.includes('chapter:1'), 'offline reading position is saved locally');
}
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    mode = 'online';
    const browser = await type.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
      await page.getByRole('button', { name: '下一章', exact: true }).click();
      await chapterVisible(page, 1);
      await page.evaluate(async () => { await window.__readerFlush(); });
      await page.close();
      mode = 'hanging';
      page = await context.newPage();
      const start = Date.now();
      await page.goto(origin + '/#/shelf', { waitUntil: 'domcontentloaded' });
      await page.locator('.app-shell').waitFor({ timeout: 5000 });
      assert(Date.now() - start < 5000, 'server verification must not block startup indefinitely');
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
      console.log(`PASS ${engine}: cached shell, authenticated shelf and previously read novel cold-start offline; cached chapter navigation and saved position`);
    } finally { await browser.close(); }
  }
} finally {
  for (const response of pending) response.destroy();
  await server.close();
}
