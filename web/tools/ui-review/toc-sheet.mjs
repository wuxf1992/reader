import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit, devices } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const output = '/tmp/reader-toc-sheet-review';
const server = createReviewServer({ port: 5203 });
const origin = await server.listen();
const reports = [];
const items = Array.from({ length: 80 }, (_, seq) => ({
  id: `c${seq}`, seq, title: `第 ${seq + 1} 章`, kind: 'chapter',
  mediaType: 'text/plain; charset=utf-8', href: `chapter:${seq}`, format: 'html',
}));
await mkdir(output, { recursive: true });
try {
  for (const [engineName, engine, phone] of [['chromium', chromium, devices['Pixel 7']], ['webkit', webkit, devices['iPhone 13']]]) {
    const browser = await engine.launch();
    try {
      for (const [layout, options] of [['phone', phone], ['desktop', { viewport: { width: 1280, height: 800 } }]]) {
        const page = await browser.newPage({ ...options, serviceWorkers: 'block' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.route(new RegExp(`/api/v1/books/${BOOK_ID}/(manifest|toc|items|assets)(\\?|$)`), async route => {
          const path = new URL(route.request().url()).pathname;
          if (path.endsWith('/assets')) return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: '测试章节\n\n目录动画测试正文。' });
          if (path.endsWith('/toc')) return route.fulfill({ json: { toc: items.map(item => ({ href: item.href, title: item.title, level: 0, spine: item.seq })) } });
          const content = { kind: 'reflowable', total: items.length, groups: [{ id: 'chapters', seq: 0, title: '章节', count: items.length, offset: 0 }], items };
          if (path.endsWith('/items')) return route.fulfill({ json: content });
          const manifest = await (await route.fetch()).json();
          await route.fulfill({ json: { ...manifest, total: items.length, content } });
        });
        await page.goto(origin);
        await page.evaluate(() => new Promise((resolve, reject) => {
          const request = indexedDB.open('reader');
          request.onsuccess = () => {
            const db = request.result, transaction = db.transaction('kv', 'readwrite');
            transaction.objectStore('kv').put(JSON.stringify({ autoCache: false }), 'reader.settings.v1');
            transaction.oncomplete = () => { db.close(); resolve(); };
            transaction.onerror = () => reject(transaction.error);
          };
          request.onerror = () => reject(request.error);
        }));
        await page.reload();
        await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click();
        await page.locator('.app-shell').waitFor();
        await page.evaluate(id => { location.hash = '#/book/' + id; }, BOOK_ID);
        await page.getByRole('button', { name: '目录', exact: true }).waitFor();
        await page.waitForFunction(() => document.querySelector('book-content')?.shadowRoot?.textContent.includes('目录动画测试正文'));
        await page.evaluate(() => {
          window.tocFrames = [];
          new MutationObserver(() => {
            const panel = document.querySelector('.sheet[aria-label="目录"]');
            if (!panel || window.tocFrames.length) return;
            const sample = () => {
              const rect = panel.getBoundingClientRect(), css = getComputedStyle(panel);
              const translation = css.transform === 'none' ? 0 : new DOMMatrix(css.transform).m42;
              window.tocFrames.push({ top: rect.top, baseBottom: rect.bottom - translation, viewport: innerHeight, appScroll: document.querySelector('#app').scrollTop, rootScroll: document.documentElement.scrollTop, bodyScroll: document.body.scrollTop });
              if (panel.isConnected && window.tocFrames.length < 25) requestAnimationFrame(sample);
            };
            sample();
          }).observe(document.body, { childList: true, subtree: true });
        });
        const panel = page.getByRole('dialog', { name: '目录', exact: true });
        for (const chapter of [1, 42]) {
          await page.evaluate(() => { window.tocFrames = []; });
          await page.getByRole('button', { name: '目录', exact: true }).click();
          await page.waitForFunction(() => window.tocFrames.length === 25);
          const frames = await page.evaluate(() => window.tocFrames);
          for (const frame of frames) {
            assert.equal(frame.appScroll, 0, 'opening the contents must not scroll the app');
            assert.equal(frame.rootScroll, 0); assert.equal(frame.bodyScroll, 0);
            if (layout === 'phone') assert.ok(Math.abs(frame.baseBottom - frame.viewport) < 1, 'the sheet must remain bottom anchored');
          }
          if (layout === 'phone') {
            assert.ok(frames[0].top > frames[0].viewport - 30, 'the first frame must start below the screen');
            for (let i = 1; i < frames.length; i++) assert.ok(frames[i].top <= frames[i - 1].top + 1, 'the sheet must rise without jumping back down');
          }
          const current = panel.locator('[aria-current="true"]');
          assert.equal(await current.locator('.toc-label').innerText(), `第 ${chapter} 章`);
          await current.locator('.toc-cached').waitFor();
          assert.equal(await current.locator('.toc-cached').innerText(), '已缓存');
          assert.equal(await panel.locator('.toc-cached').count(), chapter === 1 ? 1 : 2);
          assert.equal(await panel.locator('.toc-list button').nth(79).locator('.toc-cached').count(), 0);
          assert.ok(await current.evaluate(button => {
            const mark = button.querySelector('.toc-cached'), a = mark.getBoundingClientRect(), b = button.getBoundingClientRect();
            return a.right <= b.right && a.left > button.querySelector('.toc-index').getBoundingClientRect().right
              && getComputedStyle(mark).whiteSpace === 'nowrap' && document.documentElement.scrollWidth <= innerWidth;
          }), 'cache mark stays on the right without overflowing the chapter row');

          if (chapter === 42) {
            const centred = await current.evaluate(el => {
              const body = el.closest('.sheet-body'), a = el.getBoundingClientRect(), b = body.getBoundingClientRect();
              return Math.abs(a.top + el.clientHeight / 2 - b.top - body.clientHeight / 2) < 2;
            });
            assert.ok(centred, 'the later chapter must be centred within the list');
            await page.screenshot({ path: `${output}/${engineName}-${layout}.png` });
            await panel.getByRole('button', { name: '关闭', exact: true }).click();
          } else await panel.locator('.toc-list button').nth(41).click();
          await panel.waitFor({ state: 'detached' });
        }
        const startupAbort = '/wuxf.top/reader/api/v1/instance due to access control checks.';
        assert.deepEqual(errors.filter(error => error !== startupAbort), []);
        assert.ok(errors.length <= 1, 'only the deliberately blocked startup probe may warn');
        reports.push({ engine: engineName, layout, noOuterScroll: true, repeatedOpen: true, currentChapterCentred: true, cachedChaptersMarked: true, uncachedChaptersUnmarked: true, upwardEntry: layout === 'phone', blockedStartupProbeWarnings: errors.length });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify(reports));
} finally { await server.close(); }
