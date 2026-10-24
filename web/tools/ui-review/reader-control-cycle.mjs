import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const output = new URL('../../../artifacts/ui-review/reader-system-edge/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 }), origin = await server.listen();
const report = { cases: [], errors: [], nativeSupport: [] };
async function snapshot(page) {
  return page.evaluate(() => {
    const edge = document.querySelector('.reading-indicator-top'), style = getComputedStyle(edge);
    const sampler = document.querySelector('.reader-system-edge'), samplingStyle = getComputedStyle(sampler);
    const host = document.querySelector('book-content'), stage = document.querySelector('.stage');
    return { state: document.querySelector('.reader-screen').dataset.chrome,
      sameEdge: edge === window.reviewEdge, edgeTop: edge.getBoundingClientRect().top,
      fixed: style.position, background: style.backgroundColor, opacity: style.opacity, visibility: style.visibility,
      sampler: { same: sampler === window.reviewSampler, count: document.querySelectorAll('.reader-system-edge').length,
        rect: sampler.getBoundingClientRect().toJSON(), position: samplingStyle.position, background: samplingStyle.backgroundColor,
        z: samplingStyle.zIndex, clip: samplingStyle.backgroundClip || samplingStyle.webkitBackgroundClip,
        pointerEvents: samplingStyle.pointerEvents, opacity: samplingStyle.opacity, childCount: sampler.childNodes.length,
        expectedColor: getComputedStyle(document.documentElement).getPropertyValue('--reader-browser-paper').trim() },
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
      const sampler = document.querySelector('.reader-system-edge'), samplingStyle = getComputedStyle(sampler), r = sampler.getBoundingClientRect();
      window.edgeFrames.push({ top: edge.getBoundingClientRect().top, fixed: s.position, opacity: s.opacity, visibility: s.visibility, same: edge === window.reviewEdge,
        samplerSame: sampler === window.reviewSampler, samplerTop: r.top, samplerHeight: r.height, samplerWidth: r.width, samplerZ: samplingStyle.zIndex });
      if (window.edgeSampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.click(width / 2, 400);
  await page.waitForFunction(state => document.querySelector('.reader-screen')?.dataset.chrome === state, expected);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const frames = await page.evaluate(() => { window.edgeSampling = false; return window.edgeFrames; });
  assert.ok(frames.length && frames.every(f => f.top === 0 && f.fixed === 'fixed' && f.opacity === '1' && f.visibility === 'visible' && f.same), JSON.stringify(frames));
  assert.ok(frames.every(f => f.samplerSame && f.samplerTop === 0 && f.samplerHeight === 11 && f.samplerWidth === width && f.samplerZ === '2147483647'), JSON.stringify(frames));
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
        const support = await page.evaluate(() => ({ touchCallout: CSS.supports('-webkit-touch-callout', 'none'), textClip: CSS.supports('background-clip', 'text') }));
        report.nativeSupport.push({ engine, width, ...support, forcedCSSBranch: !support.touchCallout, systemBlurTested: false });
        // Desktop WebKit has no iOS CSS feature or UIKit compositor. Exercise the
        // emitted rule explicitly for geometry; this does not test the OS blur.
        if (!support.touchCallout) {
          const rule = await page.evaluate(() => {
            for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) {
              if (!(rule instanceof CSSSupportsRule) || !rule.conditionText.includes('-webkit-touch-callout')) continue;
              for (const child of rule.cssRules) if (child.selectorText === '.reader-system-edge') return child.cssText;
            }
            throw new Error('missing emitted iOS sampling rule');
          });
          await page.addStyleTag({ content: rule });
        }
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
          await page.evaluate(() => { window.reviewEdge = document.querySelector('.reading-indicator-top'); window.reviewSampler = document.querySelector('.reader-system-edge'); });
          if (width === 390 && mode === 'scroll') {
            for (const brightness of [.5, 1]) {
              await page.getByRole('button', { name: '外观', exact: true }).click();
              await page.getByRole('slider', { name: '页面亮度', exact: true }).evaluate((el, value) => {
                el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true }));
              }, brightness);
              await page.waitForFunction(value => Number(document.documentElement.dataset.readerBrightness) === value, brightness);
              await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
              await page.getByRole('dialog').waitFor({ state: 'detached' });
              const sampler = (await snapshot(page)).sampler;
              assert.ok(sampler.same);
              const expected = 'rgb(' + sampler.expectedColor.slice(1).match(/../g).map(c => parseInt(c, 16)).join(', ') + ')';
              assert.equal(sampler.background, expected, 'sampler includes brightness and restored dialog tint');
            }
          }
          const before = await snapshot(page);
          assert.equal(before.sampler.position, 'fixed');
          assert.equal(before.sampler.childCount, 0);
          assert.equal(before.sampler.clip, 'text');
          assert.equal(before.sampler.pointerEvents, 'none');
          assert.equal(before.sampler.count, 1);
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
            const rgb = before => 'rgb(' + before.slice(1).match(/../g).map(c => parseInt(c, 16)).join(', ') + ')';
            assert.equal(after.sampler.background, rgb(after.sampler.expectedColor));
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
          if (width === 390 && mode === 'scroll') {
            await page.locator('.reader-system-edge').evaluate(el => { el.style.backgroundColor = '#ff00ff'; });
            await page.screenshot({ path: output + `${engine}-clip-no-paint.png` });
            await page.locator('.reader-system-edge').evaluate(el => { el.style.removeProperty('background-color'); });
          }
          report.cases.push({ engine, width, mode, cycles, controlled, passed: true });
          await page.evaluate(() => { location.hash = '#/shelf'; });
          await page.locator('.reader-screen').waitFor({ state: 'detached' });
          assert.equal(await page.locator('.reader-system-edge').count(), 0);
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
