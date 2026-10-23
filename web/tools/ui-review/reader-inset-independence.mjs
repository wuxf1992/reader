import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const output = new URL('../../../artifacts/ui-review/reader-inset-independence/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 }), origin = await server.listen();
const cases = [], errors = [];
try {
  for (const [engine, type] of Object.entries({ chromium, webkit }).filter(([name]) => !process.env.UI_REVIEW_ENGINE || name === process.env.UI_REVIEW_ENGINE)) {
    const browser = await type.launch({ headless: true });
    try {
      for (const width of [320, 390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
        page.on('pageerror', error => errors.push({ engine, width, message: error.message }));
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.goto(origin);
        await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click();
        await page.locator('.app-shell').waitFor();
        for (const safeBottom of [0, 34]) {
          await page.addStyleTag({ content: `:root { --safe-top:47px; --safe-bottom:${safeBottom}px; }` });
          const baseline = {};
          for (const inset of [0, 18, 80]) {
            await page.evaluate(async inset => {
              await window.readerApp.updateSettings({ paper: 'local-wechat-night', brightness: 1,
                pageInsets: { top: inset, bottom: inset, left: inset, right: inset },
                readoutTopLeft: 'chapter', readoutTopRight: 'time', readoutBottomLeft: 'progress', readoutBottomRight: 'time' });
            }, inset);
            await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
            await page.locator('book-content .book-flow p').first().waitFor();
            for (const state of ['visible', 'hidden']) {
              if (state === 'hidden') {
                await page.getByRole('button', { name: '工具', exact: true }).focus();
                await page.keyboard.press('Escape');
              }
              await page.waitForFunction(state => document.querySelector('.reader-screen')?.dataset.chrome === state, state);
              const result = await page.evaluate(({ safeBottom, inset }) => {
                const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
                const bars = ['.topbar', '.footer'].map(selector => ({ ...rect(selector), visible: getComputedStyle(document.querySelector(selector)).visibility === 'visible' }));
                const top = getComputedStyle(document.querySelector('.reading-indicator-top'));
                return { height: innerHeight, host: rect('.reader-route-host'), stage: rect('.stage-host'),
                  topEdge: { position: top.position, background: top.backgroundColor, filter: top.filter, backdropFilter: top.backdropFilter || top.webkitBackdropFilter, opacity: top.opacity, visibility: top.visibility },
                  strips: ['.reading-indicator-top', '.reading-indicator-bottom'].map(rect),
                  readouts: [...document.querySelectorAll('.reading-indicator span')].map(el => {
                    const r = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el);
                    const glyph = range.getBoundingClientRect();
                    return { mode: el.dataset.mode, text: el.textContent, inViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 47 && r.bottom <= innerHeight - safeBottom,
                      fits: glyph.top >= r.top - 1 && glyph.bottom <= r.bottom + 1 && (!['time', 'progress'].includes(el.dataset.mode) || el.scrollWidth <= el.clientWidth + 1),
                      outsideBars: bars.every(b => !b.visible || r.bottom <= b.top || r.top >= b.bottom) };
                  }) };
              }, { safeBottom, inset });
              assert.equal(result.host.height, 844);
              assert.equal(result.topEdge.position, 'fixed');
              assert.equal(result.topEdge.filter, 'none');
              assert.equal(result.topEdge.backdropFilter, 'none');
              assert.equal(result.topEdge.opacity, '1');
              assert.equal(result.topEdge.visibility, 'visible');
              assert.match(result.topEdge.background, /^rgb\(/, 'the fixed edge must have a fully opaque background');
              assert.equal(result.stage.bottom, result.host.bottom - inset);
              assert.ok(result.readouts.length === 4 && result.readouts.every(r => r.inViewport && r.fits && r.outsideBars), JSON.stringify(result));
              if (inset === 0) baseline[state] = result.strips;
              else assert.deepEqual(result.strips, baseline[state], 'body margins must never move screen information');
              cases.push({ engine, width, safeBottom, inset, state, ...result });
              if (width === 390 && safeBottom === 34 && state === 'hidden') await page.screenshot({ path: output + `${engine}-390-inset-${inset}.png` });
            }
            // Browser controls reducing the available height must not be overridden by a 100vh minimum.
            await page.addStyleTag({ content: '.reader-route-host { height: calc(100dvh - 80px); }' });
            assert.equal(await page.locator('.reader-route-host').evaluate(el => el.getBoundingClientRect().height), 764);
            await page.addStyleTag({ content: '.reader-route-host { height: 100dvh; }' });
            await page.setViewportSize({ width, height: 700 });
            await page.waitForFunction(() => document.querySelector('.reader-route-host')?.getBoundingClientRect().height === 700);
            await page.setViewportSize({ width, height: 844 });
            await page.evaluate(() => { location.hash = '#/shelf'; });
            await page.locator('.reader-screen').waitFor({ state: 'detached' });
            await page.locator('.app-shell').waitFor();
          }
        }
        await page.close();
        console.log(`${engine} ${width}: body margins, safe areas, toolbar and viewport checks passed`);
      }
    } finally { await browser.close(); }
  }
  // WebKit defers a ResizeObserver notification while the viewport is resized.
  assert.deepEqual(errors.filter(error => error.message !== 'ResizeObserver loop completed with undelivered notifications.'), []);
} finally {
  await writeFile(output + `results${process.env.UI_REVIEW_ENGINE ? '-' + process.env.UI_REVIEW_ENGINE : ''}.json`, JSON.stringify({ cases, errors }, null, 2));
  server.server.closeAllConnections(); await server.close();
}
