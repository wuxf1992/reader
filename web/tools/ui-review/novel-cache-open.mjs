import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID, CHAPTERS } from './server.mjs';

const server = createReviewServer({ port: 0 }), origin = await server.listen();
const output = new URL('../../../artifacts/ui-review/novel-cache-open/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const width of [390, 1120]) {
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: 'block' });
        let phase = 'online', remote = null, release;
        let gate = Promise.resolve(), responses = 0;
        const errors = [];
        const hold = () => { responses = 0; gate = new Promise(resolve => { release = resolve; }); };
        try {
          await context.route('https://wuxf.top/**', route => route.abort());
          await context.route('**/api/v1/**', async route => {
            const path = new URL(route.request().url()).pathname;
            const metadata = path === `/api/v1/books/${BOOK_ID}/manifest` || path === `/api/v1/books/${BOOK_ID}/reading-overrides` || path === `/api/v1/sync/progress/${BOOK_ID}`;
            const currentGate = gate;
            if (metadata) await currentGate;
            if (path === `/api/v1/sync/progress/${BOOK_ID}`) {
              responses++; return route.fulfill({ json: { progress: remote } });
            }
            if (path === '/api/v1/books' || path === `/api/v1/books/${BOOK_ID}/manifest`) {
              const response = await route.fetch(); const data = await response.json();
              if (data.items) data.items = data.items.map(book => book.id === BOOK_ID ? { ...book, format: 'chapters' } : book);
              if (data.book?.id === BOOK_ID) data.book.format = 'chapters';
              if (metadata) responses++;
              return route.fulfill({ response, json: data });
            }
            if (metadata) responses++;
            return route.continue();
          });
          const page = await context.newPage(); page.setDefaultTimeout(10000);
          page.on('pageerror', error => errors.push(error.message));
          await page.goto(origin + '/#/shelf'); await page.getByText('更换服务地址', { exact: true }).click();
          await page.locator('input[type=url]').fill(origin); await page.locator('input[autocomplete=username]').fill('review');
          await page.locator('input[type=password]').fill('password12'); await page.locator('button[type=submit]').click();
          await page.locator('.shelf-screen').waitFor();
          await page.evaluate(async () => { window.readerApp.sync.stop(); await window.readerApp.updateSettings({ autoCache: false }); });
          const chapter = index => page.waitForFunction(text => document.querySelector('book-content')?.shadowRoot?.textContent?.includes(text), CHAPTERS[index].title);
          const open = () => page.getByRole('link', { name: /剑来 第1卷/ }).first().click();
          const shelf = async () => {
            await page.evaluate(async () => { await window.readerApp.saveBeforeUpdate(); location.hash = '#/shelf'; });
            await page.locator('.shelf-screen').waitFor();
            await page.evaluate(async () => { await window.readerApp.offline.flush(); });
          };
          await open(); await chapter(0);
          if (await page.locator('.reader-screen').getAttribute('data-chrome') === 'hidden') {
            const box = await page.locator('book-content').boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          }
          await page.getByRole('button', { name: '下一章', exact: true }).click(); await chapter(1); await shelf();
          phase = 'hanging'; hold();
          const start = Date.now(); await open();
          await page.waitForFunction(text => document.querySelector('book-content')?.shadowRoot?.textContent?.includes(text), CHAPTERS[1].title, { timeout: 1000 });
          const cachedOpenMs = Date.now() - start;
          assert(cachedOpenMs < 1000, 'cached novel must open before a network timeout');
          assert.equal(responses, 0, 'no metadata validation response has been released');
          release(); await page.waitForTimeout(100); await shelf();
          for (const accept of [false, true]) {
            phase = accept ? 'accept' : 'decline';
            const local = await page.evaluate(book => window.readerApp.offline.progressFor(book), BOOK_ID);
            remote = { ...local, locator: 'r1:0.0000:chapter:0', percentage: 0, chapterTitle: CHAPTERS[0].title, device: 'another phone', updatedAt: local.updatedAt + 60000 };
            hold(); await open(); await chapter(1); assert.equal(responses, 0); release();
            const dialog = page.getByRole('alertdialog', { name: '发现更新的阅读位置' }); await dialog.waitFor();
            await chapter(1);
            await dialog.evaluate(async element => {
              await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });
            for (const label of ['继续当前阅读', '跳到最新位置']) {
              const box = await dialog.getByRole('button', { name: label, exact: true }).boundingBox();
              assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= (width === 390 ? 844 : 900), `${label} must be reachable in the viewport`);
            }
            const layout = await dialog.evaluate(element => {
              const body = element.querySelector('.sheet-body');
              return { height: element.getBoundingClientRect().height, bodyHeight: body.clientHeight, textHeight: body.scrollHeight };
            });
            assert(layout.textHeight <= layout.bodyHeight + 1, 'the position comparison must be fully visible');
            assert(layout.height < (width === 390 ? 844 : 900) / 2, 'a short confirmation must fit its content');
            assert.equal(await dialog.locator('.notyf__toast').filter({ hasText: '已恢复到上次阅读位置' }).count(), 0, 'the resume toast must not cover this question');
            await page.screenshot({ path: output + `${engine}-${width}-${phase}.png` });
            if (!accept) {
              await page.keyboard.press('PageDown'); await chapter(1);
              await dialog.getByRole('button', { name: '继续当前阅读', exact: true }).click();
              await dialog.waitFor({ state: 'detached' }); await chapter(1);
            } else {
              await dialog.getByRole('button', { name: '跳到最新位置', exact: true }).click(); await chapter(0);
            }
            await page.waitForFunction(stamp => window.readerApp.offline.progressFor('review-book').updatedAt > stamp, remote.updatedAt);
            if (!accept) await shelf();
          }
          assert.deepEqual(errors, []);
          results.push({ engine, width, cachedOpenMs, cacheShownBeforeValidation: true, declineKeepsLocal: true, acceptJumpsToNewerPosition: true });
          console.log(`${engine} ${width}: cached open ${cachedOpenMs}ms before metadata responses; both progress choices passed`);
        } finally { release?.(); await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
await writeFile(output + 'metrics.json', JSON.stringify(results, null, 2) + '\n');
