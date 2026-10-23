import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const output = new URL('../../../artifacts/ui-review/reader-control-cycle/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 }), origin = await server.listen();
const report = { cases: [], errors: [] };
async function snapshot(page) {
  return page.evaluate(() => {
    const edge = document.querySelector('.reading-indicator-top'), style = getComputedStyle(edge);
    const host = document.querySelector('book-content'), stage = document.querySelector('.stage');
    return { state: document.querySelector('.reader-screen').dataset.chrome,
      sameEdge: edge === window.reviewEdge, edgeTop: edge.getBoundingClientRect().top,
      fixed: style.position, background: style.backgroundColor, opacity: style.opacity, visibility: style.visibility,
      stage: stage.getBoundingClientRect().toJSON(), host: host.getBoundingClientRect().toJSON(),
      scrollTop: host.scrollTop, scrollLeft: host.scrollLeft,
      progress: document.querySelector('.reading-indicator-bottom [data-mode=progress]').textContent,
      shield: getComputedStyle(stage, '::after').content, touchAction: getComputedStyle(stage).touchAction };
  });
}
async function toggle(page, width, expected) {
  await page.evaluate(() => {
    window.edgeFrames = [];
    window.edgeSampling = true;
    const sample = () => {
      const edge = document.querySelector('.reading-indicator-top'), s = getComputedStyle(edge);
      window.edgeFrames.push({ top: edge.getBoundingClientRect().top, fixed: s.position, opacity: s.opacity, visibility: s.visibility, same: edge === window.reviewEdge });
      if (window.edgeSampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.click(width / 2, 400);
  await page.waitForFunction(state => document.querySelector('.reader-screen')?.dataset.chrome === state, expected);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const frames = await page.evaluate(() => { window.edgeSampling = false; return window.edgeFrames; });
  assert.ok(frames.length && frames.every(f => f.top === 0 && f.fixed === 'fixed' && f.opacity === '1' && f.visibility === 'visible' && f.same), JSON.stringify(frames));
  return frames;
}
async function swipe(page, width) {
  await page.mouse.move(width * .75, 400);
  await page.mouse.down();
  await page.mouse.move(width * .25, 400, { steps: 5 });
  await page.mouse.up();
}
async function settlePage(page) {
  await page.waitForFunction(() => !document.querySelector('book-content')?.hasAttribute('data-animating') && !document.querySelector('.reader-page-fade[data-fading]'));
}
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch({ headless: true });
    try {
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
        page.on('pageerror', error => report.errors.push({ engine, width, message: error.message }));
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.goto(origin + '/#/shelf');
        await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click();
        await page.locator('.app-shell').waitFor();
        const touch = engine === 'chromium' && width === 390 ? await page.context().newCDPSession(page) : null;
        await page.addStyleTag({ content: ':root { --safe-top:47px; --safe-bottom:34px; }' });
        for (const mode of ['scroll', 'paged']) {
          await page.evaluate(async mode => {
            await window.readerApp.updateSettings({ mode, paper: 'local-wechat-night', brightness: 1,
              readoutTopLeft: 'chapter', readoutTopRight: 'time', readoutBottomLeft: 'progress', readoutBottomRight: 'time' });
          }, mode);
          await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
          await page.locator('book-content .book-flow p').first().waitFor();
          await page.waitForFunction(() => Number(document.querySelector('.progress-scrubber')?.max) > 1);
          await page.evaluate(() => { window.reviewEdge = document.querySelector('.reading-indicator-top'); });
          const before = await snapshot(page);
          assert.equal(before.state, 'visible');
          const cycles = [];
          for (let cycle = 0; cycle < 3; cycle++) {
            const hide = await toggle(page, width, 'hidden');
            const hidden = await snapshot(page);
            assert.equal(hidden.shield, 'none');
            const show = await toggle(page, width, 'visible');
            const locked = await snapshot(page);
            assert.equal(locked.touchAction, 'none');
            assert.notEqual(locked.shield, 'none');
            assert.deepEqual(locked.host, before.host, 'controls must not resize or move the body');
            const frozen = { top: locked.scrollTop, left: locked.scrollLeft, progress: locked.progress };
            await page.mouse.click(width * .8, 400);
            await swipe(page, width);
            if (touch && cycle === 0) {
              await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width / 2, y: 500 }] });
              for (const y of [440, 380, 320, 260]) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width / 2, y }] });
              await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            }
            await page.mouse.move(width / 2, 400);
            await page.mouse.wheel(0, 600);
            await page.locator('.stage').evaluate(el => { el.tabIndex = -1; el.focus(); });
            await page.keyboard.press('PageDown');
            await page.waitForTimeout(300);
            const after = await snapshot(page);
            assert.deepEqual({ top: after.scrollTop, left: after.scrollLeft, progress: after.progress }, frozen, 'body tap, swipe, wheel and keyboard must remain blocked');
            cycles.push({ hide, show, locked: after });
          }
          // The controls themselves still navigate while the body is locked.
          const slider = page.getByRole('slider', { name: '章节内页数', exact: true });
          await slider.focus(); await page.keyboard.press('Home');
          await page.keyboard.press('ArrowRight');
          await page.waitForFunction(() => document.querySelector('.progress-scrubber').value === '2');
          await settlePage(page);
          const controlled = await snapshot(page);
          assert.equal(controlled.state, 'visible');
          await slider.focus(); await page.keyboard.press('Home');
          await page.waitForFunction(() => document.querySelector('.progress-scrubber').value === '1');
          await settlePage(page);
          await page.screenshot({ path: output + `${engine}-${width}-${mode}-visible.png` });
          await toggle(page, width, 'hidden');
          const unlocked = await snapshot(page);
          await page.mouse.click(width * .8, 400);
          await page.waitForFunction(before => document.querySelector('.reading-indicator-bottom [data-mode=progress]').textContent !== before, unlocked.progress);
          await settlePage(page);
          if (mode === 'scroll') {
            const top = await page.locator('book-content').evaluate(el => el.scrollTop);
            await page.mouse.move(width / 2, 400); await page.mouse.wheel(0, 350);
            await page.waitForFunction(top => document.querySelector('book-content').scrollTop > top, top);
          }
          await page.screenshot({ path: output + `${engine}-${width}-${mode}-hidden.png` });
          report.cases.push({ engine, width, mode, cycles, controlled, passed: true });
          await page.evaluate(() => { location.hash = '#/shelf'; });
          await page.locator('.reader-screen').waitFor({ state: 'detached' });
          console.log(`${engine} ${width} ${mode}: repeated control cycles, persistent fixed edge, body lock and control navigation passed`);
        }
        await touch?.detach();
        await page.close();
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(report.errors.filter(e => e.message !== 'ResizeObserver loop completed with undelivered notifications.'), []);
  report.passed = true;
} finally {
  await writeFile(output + 'results.json', JSON.stringify(report, null, 2));
  server.server.closeAllConnections(); await server.close();
}
