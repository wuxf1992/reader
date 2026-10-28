import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit, devices } from 'playwright';
import { BOOK_ID, ILLUSTRATED_ID, createReviewServer } from './server.mjs';

const output = new URL('../../../artifacts/ui-review/reader-touch/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 }), origin = await server.listen();
const results = [];
const state = page => page.evaluate(() => {
  const host = document.querySelector('book-content'), flow = host.shadowRoot.querySelector('.book-flow');
  const current = document.querySelector('.reader-page-drag > :last-child');
  return { chrome: document.querySelector('.reader-screen').dataset.chrome, page: Number(document.querySelector('.progress-scrubber').value),
    layout: host.dataset.pageLayout, top: host.scrollTop, left: flow.scrollLeft,
    drag: current?.style.transform ?? null, previews: document.querySelectorAll('.reader-page-snapshot').length,
    rect: host.getBoundingClientRect().toJSON(), overflow: document.documentElement.scrollWidth > innerWidth };
});
async function toggle(page) {
  const box = await page.locator('book-content').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function input(page, cdp, type, x, y) {
  if (cdp) return cdp.send('Input.dispatchTouchEvent', { type: { pointerdown: 'touchStart', pointermove: 'touchMove', pointerup: 'touchEnd', pointercancel: 'touchCancel' }[type],
    touchPoints: ['pointerup', 'pointercancel'].includes(type) ? [] : [{ x, y }] });
  await page.locator('book-content .book-flow').dispatchEvent(type, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, composed: true });
}
async function drag(page, cdp, distance, duration, cancel = false) {
  const box = await page.locator('book-content').boundingBox();
  const x = box.x + box.width * .7, y = box.y + box.height / 2;
  await input(page, cdp, 'pointerdown', x, y);
  for (let step = 1; step <= 5; step++) {
    await input(page, cdp, 'pointermove', x + distance * step / 5, y);
    await page.waitForTimeout(duration / 5);
  }
  const during = await state(page);
  await input(page, cdp, cancel ? 'pointercancel' : 'pointerup', x + distance, y);
  await page.waitForFunction(() => !document.querySelector('.reader-page-drag'));
  return { during, after: await state(page) };
}
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch({ headless: true });
    try {
      for (const width of [390, 1120]) {
        const context = await browser.newContext({ ...(width === 390 ? devices['iPhone 13'] : { viewport: { width, height: 900 } }), serviceWorkers: 'block' });
        try {
          const page = await context.newPage(); page.setDefaultTimeout(10000);
          const errors = []; page.on('pageerror', error => errors.push(error.message));
          await page.route('https://wuxf.top/**', route => route.abort());
          await page.route('**/api/v1/books/review-illustrated/assets*', route => {
            if (!new URL(route.request().url()).searchParams.get('ref')?.endsWith('.xhtml')) return route.continue();
            return route.fulfill({ contentType: 'application/xhtml+xml', body: '<html><head><style>p{line-height:1.7;margin-block:.8em}</style></head><body><h2>分栏 EPUB</h2>'
              + Array.from({ length: 50 }, (_, i) => `<p>第${i + 1}段。这是一段有出版方排版的正文，用来核对跟手预览和真实页码。保留不同段落与<strong>强调文字</strong>，翻页后继续阅读。</p>`).join('') + '</body></html>' });
          });
          await page.goto(origin + '/#/shelf'); await page.getByText('更换服务地址', { exact: true }).click();
          await page.locator('input[type=url]').fill(origin); await page.locator('input[autocomplete=username]').fill('review');
          await page.locator('input[type=password]').fill('password12'); await page.locator('button[type=submit]').click(); await page.locator('.app-shell').waitFor();
          const cdp = engine === 'chromium' && width === 390 ? await context.newCDPSession(page) : null;
          if (cdp) {
            await page.evaluate(async () => window.readerApp.updateSettings({ mode: 'scroll' }));
            await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
            await page.locator('book-content .book-flow p').first().waitFor();
            await page.waitForFunction(() => document.querySelector('book-content')?.dataset.paginated === 'false');
            await toggle(page); assert.equal((await state(page)).chrome, 'visible');
            const beforeScroll = await state(page);
            const x = 195, y = 400;
            await input(page, cdp, 'pointerdown', x, y);
            for (const nextY of [370, 330, 290, 250]) {
              await input(page, cdp, 'pointermove', x, nextY); await page.waitForTimeout(30);
            }
            await input(page, cdp, 'pointerup', x, 250);
            await page.waitForFunction(top => document.querySelector('book-content').scrollTop > top + 50, beforeScroll.top);
            const afterScroll = await state(page);
            assert.equal(afterScroll.chrome, 'hidden');
            await page.keyboard.press('PageDown');
            await page.waitForFunction(top => document.querySelector('book-content').scrollTop > top, afterScroll.top);
            results.push({ engine, width, input: 'Chromium CDP native scroll and keyboard focus', beforeScroll, afterScroll });
            await page.evaluate(() => { location.hash = '#/shelf'; });
            await page.locator('.shelf-screen').waitFor();
          }

          for (const [book, layout] of [[BOOK_ID, 'screens'], [ILLUSTRATED_ID, 'columns']]) {
            await page.evaluate(async () => window.readerApp.updateSettings({ mode: 'paged', pageAnimation: 'slide' }));
            await page.evaluate(book => { location.hash = '#/book/' + book; }, book);
            await page.locator('book-content .book-flow p').first().waitFor();
            await page.waitForFunction(layout => document.querySelector('book-content')?.dataset.pageLayout === layout && Number(document.querySelector('.progress-scrubber')?.max) > 2, layout);
            await page.waitForTimeout(200);
            const before = await state(page); assert.equal(before.chrome, 'hidden'); assert.equal(before.layout, layout); assert.equal(before.overflow, false);
            await page.screenshot({ path: output + `${engine}-${width}-${layout}-reading.png` });
            const short = await drag(page, cdp, -60, 450);
            assert.ok(short.during.drag?.includes('-60px'), JSON.stringify(short));
            assert.equal(short.during.page, before.page); assert.equal(short.after.page, before.page);
            assert.deepEqual([short.after.top, short.after.left], [before.top, before.left]);
            const cancelled = await drag(page, cdp, -160, 180, true);
            assert.equal(cancelled.after.page, before.page); assert.equal(cancelled.after.previews, 0);
            const next = await drag(page, cdp, -Math.max(160, width * .4), 180);
            assert.equal(next.during.page, before.page); assert.equal(next.after.page, before.page + 1);
            await page.screenshot({ path: output + `${engine}-${width}-${layout}-turned.png` });
            const previous = await drag(page, cdp, Math.max(160, width * .4), 180);
            assert.equal(previous.after.page, before.page);
            await toggle(page); const visible = await state(page); assert.equal(visible.chrome, 'visible');
            assert.deepEqual(visible.rect, previous.after.rect, 'showing controls must preserve page geometry');
            const box = await page.locator('book-content').boundingBox();
            await page.mouse.click(box.x + box.width * .85, box.y + box.height / 2);
            await page.waitForFunction(before => Number(document.querySelector('.progress-scrubber').value) === before + 1, before.page);
            assert.equal((await state(page)).chrome, 'hidden');
            await toggle(page); await page.getByRole('button', { name: '外观', exact: true }).click();
            await page.getByRole('dialog').waitFor();
            await page.screenshot({ path: output + `${engine}-${width}-${layout}-settings.png` });
            const blocked = await state(page); await drag(page, null, -160, 180);
            assert.equal((await state(page)).page, blocked.page);
            await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' });
            results.push({ engine, width, layout, input: cdp ? 'Chromium CDP touch stream' : 'DOM PointerEvent touch stream', before, short, cancelled, next, previous });
            await page.evaluate(() => { location.hash = '#/shelf'; }); await page.locator('.app-shell').waitFor();
          }
          const unexpected = errors.filter(error => !error.includes('ResizeObserver loop completed'));
          assert.deepEqual(unexpected, []); results.push({ engine, width, observedErrors: errors });
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  console.log('PASS: novel/EPUB drag follow, spring-back, cancellation, one-page turns, controls, dialogs, mobile and desktop in Chromium/WebKit');
} finally { await server.close(); await writeFile(output + 'report.json', JSON.stringify(results, null, 2)); }
