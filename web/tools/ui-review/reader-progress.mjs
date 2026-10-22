import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const server = createReviewServer({ port: 0 });
const origin = await server.listen();
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
        let remote = null;
        let pullProgress = true;
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.route(/\/api\/v1\/sync(?:\?.*)?$/, async route => {
          const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
          for (const progress of body?.progress ?? []) {
            if (!remote || progress.updatedAt >= remote.updatedAt) remote = progress;
          }
          await route.fulfill({ json: { accepted: body?.progress?.length ?? 0, rejected: 0,
            serverTime: Date.now(), progress: remote && (body || pullProgress) ? [remote] : [], notes: [] } });
        });
        await page.route(`**/api/v1/sync/progress/${BOOK_ID}`, route => route.fulfill({ json: { progress: remote } }));
        await page.goto(origin);
        await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click();
        await page.locator('.book-card:not(.skeleton)').first().waitFor();
        await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
        await page.locator('.book-host').waitFor();
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByRole('group', { name: '翻页方式', exact: true }).getByRole('button', { name: '翻页', exact: true }).click();
        await page.locator('.panel').getByRole('button', { name: '关闭', exact: true }).click();
        async function seek(pageNumber) {
          await page.locator('.progress-scrubber').evaluate((slider, value) => {
            slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true }));
          }, pageNumber);
          await page.waitForFunction(value => document.querySelector('.progress-page')?.textContent.includes(`第 ${value}/`), pageNumber);
          await page.evaluate(() => window.__readerFlush());
          return page.evaluate(book => window.readerApp.offline.progressFor(book), BOOK_ID);
        }
        const first = await seek(1);
        let saved = await seek(3);
        assert.ok(saved.percentage > first.percentage);
        for (const viaPull of [true, false]) {
          await page.evaluate(() => window.readerApp.sync.stop());
          pullProgress = viaPull;
          remote = { ...first, updatedAt: Date.now() + 60_000 };
          const behindTimestamp = remote.updatedAt;
          const uploaded = page.waitForResponse(response => {
            const request = response.request();
            return response.ok() && request.method() === 'POST'
              && new URL(request.url()).pathname === '/api/v1/sync'
              && request.postDataJSON().progress?.some(progress => progress.locator === saved.locator && progress.updatedAt > behindTimestamp);
          }, { timeout: 10_000 });
          void uploaded.catch(() => undefined);
          await page.reload();
          await page.locator('.book-host').waitFor();
          await page.waitForFunction(() => document.querySelector('.progress-page')?.textContent.includes('第 3/'));
          const local = await page.evaluate(book => window.readerApp.offline.progressFor(book), BOOK_ID);
          assert.equal(local.locator, saved.locator, `${name} ${width}: reload keeps the local page`);
          await uploaded;
          assert.equal(remote.locator, saved.locator, 'the server catches up to the local position');
          console.log(name, width, viaPull ? 'sync pull' : 'direct progress', 'keeps page 3 and repairs the server');
        }
        saved = await seek(4);
        assert.equal(remote.locator, saved.locator, 'reading can advance after repairing a future server timestamp');
        assert.ok(saved.percentage > first.percentage);
        const reread = await seek(1);
        assert.equal(remote.locator, reread.locator, 'an intentional local backward turn still saves normally');
        assert.equal(reread.locator, first.locator);
        await page.close();
      }
    } finally { await browser.close(); }
  }
  console.log('Passed 8 stale-server reopen checks plus continued-reading and backward-reading checks.');
} finally { server.server.closeAllConnections(); await server.close(); }
