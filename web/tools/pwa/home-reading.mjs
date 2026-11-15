import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from '../ui-review/server.mjs';

const output = process.env.HOME_READING_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 });
const handlers = server.server.listeners('request');
server.server.removeAllListeners('request');
let mode = 'online';
const pending = new Set();
server.server.on('request', (request, response) => {
  if (new URL(request.url, 'http://localhost').pathname === '/api/v1/library/continue') {
    if (mode === 'hanging') {
      pending.add(response);
      response.on('close', () => pending.delete(response));
      return;
    }
    if (mode === 'empty') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"items":[]}');
      return;
    }
  }
  for (const handler of handlers) handler.call(server.server, request, response);
});
const origin = await server.listen();
const results = [];
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch({ headless: true });
    try {
      for (const cached of [true, false]) {
        mode = 'online';
        const context = await browser.newContext({ viewport: cached ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
        try {
          await context.route('https://wuxf.top/**', route => route.abort());
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.goto(origin + '/#/shelf');
          await page.getByText('更换服务地址', { exact: true }).click();
          await page.locator('input[type=url]').fill(origin);
          await page.locator('input[autocomplete=username]').fill('review');
          await page.locator('input[type=password]').fill('password12');
          await page.locator('button[type=submit]').click();
          await page.locator('.app-shell').waitFor();
          await page.waitForFunction(book => window.readerApp.offline.books().some(item => item.id === book), BOOK_ID);
          if (cached) await page.evaluate(async book => {
            await window.readerApp.offline.reconcileProgress({ bookId: book, locator: 'chapter:1', percentage: .42, chapterTitle: '本地保存的第二章', device: 'test', updatedAt: Date.now() });
          }, BOOK_ID);
          mode = 'hanging';
          const start = Date.now();
          await page.goto(origin + '/#/');
          // Reload clears Query's memory cache and exercises startup from durable storage.
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('.app-shell').waitFor({ timeout: 5000 });
          const card = page.locator('.home-resume[data-channel=read]');
          let visibleMs;
          if (cached) {
            await card.waitFor({ timeout: 1500 });
            visibleMs = Date.now() - start;
            assert(visibleMs < 2000, `cached continuation should appear immediately, took ${visibleMs}ms`);
            assert((await card.innerText()).includes('已读 42%'));
            assert.equal(await page.getByText('正在读取在读的书…', { exact: true }).count(), 0);
            await page.waitForFunction(() => window.readerApp.queryClient.getQueryState(['home', 'reading', window.readerApp.api.baseUrl, 'u1'])?.fetchStatus === 'idle', null, { timeout: 10_000 });
            assert.equal(await card.count(), 1);
            if (output) await page.screenshot({ path: `${output}/${engine}-cached.png` });
            mode = 'empty';
            await page.evaluate(() => window.readerApp.queryClient.invalidateQueries({ queryKey: ['home', 'reading'] }));
            await card.waitFor({ state: 'hidden' });
            assert.deepEqual(await page.evaluate(() => window.readerApp.queryClient.getQueryData(['home', 'reading', window.readerApp.api.baseUrl, 'u1'])), []);
            assert.equal(await card.count(), 0);
          } else {
            await page.getByText('正在读取在读的书…', { exact: true }).waitFor();
            await page.getByText('在读的书读取失败', { exact: true }).waitFor({ timeout: 10_000 });
            assert.equal(await card.count(), 0);
            if (output) await page.screenshot({ path: `${output}/${engine}-retry.png` });
            mode = 'online';
            await page.getByRole('button', { name: '重试', exact: true }).click();
            await card.waitFor();
            assert.equal(await card.getAttribute('href'), '#/book/' + BOOK_ID);
          }
          assert.equal(await page.locator('#app-startup').count(), 0);
          assert.equal(await page.locator('[role=progressbar]').count(), 0);
          assert.deepEqual(errors, []);
          const result = { engine, cached, visibleMs, status: 'passed' };
          results.push(result);
          console.log('PASS', JSON.stringify(result));
        } finally {
          await context.close();
          for (const response of pending) response.destroy();
        }
      }
    } finally { await browser.close(); }
  }
  if (output) await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2) + '\n');
} finally {
  for (const response of pending) response.destroy();
  await server.close();
}
