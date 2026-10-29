import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID, CHAPTERS } from './server.mjs';

const server = createReviewServer({ port: 0 }), origin = await server.listen();
const output = new URL('../../../artifacts/ui-review/offline-sync/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const width of [390, 1120]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
        let mode = 'online';
        try {
          await context.route('https://wuxf.top/**', route => route.abort());
          await context.route('**/api/v1/sync*', route => {
            if (new URL(route.request().url()).pathname !== '/api/v1/sync') return route.continue();
            if (mode === 'offline') return route.abort('failed');
            if (mode === 'gateway') return route.fulfill({ status: 502, json: { error: { code: 'BAD_GATEWAY', message: '同步服务暂不可用' } } });
            return route.continue();
          });
          const page = await context.newPage();
          const errors = []; page.on('pageerror', error => errors.push(error.message));
          await page.goto(origin + '/#/shelf');
          await page.getByText('更换服务地址', { exact: true }).click();
          await page.locator('input[type=url]').fill(origin);
          await page.locator('input[autocomplete=username]').fill('review');
          await page.locator('input[type=password]').fill('password12');
          await page.locator('button[type=submit]').click();
          await page.locator('.shelf-screen').waitFor();
          await page.evaluate(async () => { await window.readerApp.updateSettings({ autoCache: false }); });
          await page.getByRole('link', { name: /剑来 第1卷/ }).first().click();
          const chapter = () => page.waitForFunction(text => document.querySelector('book-content')?.shadowRoot?.textContent?.includes(text), CHAPTERS[0].title);
          await chapter();
          await page.evaluate(async () => { await window.readerApp.saveBeforeUpdate(); window.readerApp.sync.schedule(0); });
          await page.waitForFunction(() => window.readerApp.sync.status().state === 'idle' && !window.readerApp.sync.pendingRequest);
          const retry = () => page.evaluate(async () => { for (let index = 0; index < 3; index++) await window.readerApp.sync.syncNow(); });
          const notices = text => page.locator('.global-notice:not(.notyf__toast--disappear)').filter({ hasText: text });

          // Wi-Fi can remain online even when the server cannot be reached.
          assert.equal(await page.evaluate(() => navigator.onLine), true);
          mode = 'offline';
          await page.evaluate(async () => { await window.readerApp.sync.syncNow(); });
          await notices('离线').waitFor();
          await page.screenshot({ path: output + `${engine}-${width}-offline.png` });
          await notices('离线').waitFor({ state: 'detached', timeout: 9000 });
          await page.evaluate(async book => {
            const { offline } = window.readerApp;
            const progress = offline.progressFor(book);
            await offline.setProgress({ ...progress, updatedAt: progress.updatedAt + 1 });
          }, BOOK_ID);
          await retry();
          assert.equal(await notices('离线').count(), 0, 'retries and dirty progress must not reopen an expired offline toast');
          assert.equal(await page.evaluate(book => window.readerApp.offline.current.dirtyProgress.includes(book), BOOK_ID), true);
          await chapter();

          mode = 'online';
          await page.evaluate(async () => { await window.readerApp.sync.syncNow(); });
          assert.equal(await page.evaluate(() => window.readerApp.sync.status().state), 'idle');
          assert.equal(await page.evaluate(book => window.readerApp.offline.current.dirtyProgress.includes(book), BOOK_ID), false);
          mode = 'gateway';
          await page.evaluate(async () => { await window.readerApp.sync.syncNow(); });
          await notices('同步服务暂不可用').waitFor();
          await notices('同步服务暂不可用').getByRole('button', { name: '关闭提示' }).click();
          await notices('同步服务暂不可用').waitFor({ state: 'detached' });
          await retry();
          assert.equal(await notices('同步服务暂不可用').count(), 0, 'retries must respect manual dismissal of the same server error');

          mode = 'online';
          await page.evaluate(async () => { await window.readerApp.sync.syncNow(); });
          mode = 'offline';
          await page.evaluate(async () => { await window.readerApp.sync.syncNow(); });
          await notices('离线').waitFor();
          await chapter();
          assert.deepEqual(errors, []);
          results.push({ engine, width, expiredNoticeStaysClosed: true, dismissedErrorStaysClosed: true, progressRetainedAndDelivered: true, newOutageAnnounced: true });
          console.log(`PASS ${engine} ${width}: quiet retries, local progress, recovery and new outage`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  await writeFile(output + 'verification.json', JSON.stringify(results, null, 2) + '\n');
} finally { await server.close(); }
