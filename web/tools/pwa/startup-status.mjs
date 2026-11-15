import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer } from '../ui-review/server.mjs';

// The deliberately stalled module also keeps WebKit's fonts.ready pending.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const output = process.env.STARTUP_REVIEW_DIR || '/tmp/reader-startup-status';
await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 }), origin = await server.listen(), reports = [];
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [390, 1120]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: width === 390 ? 'light' : 'dark', serviceWorkers: 'block', reducedMotion: 'reduce' });
        try {
          await context.route('https://wuxf.top/**', route => route.abort());
          await context.addInitScript(() => {
            const open = indexedDB.open.bind(indexedDB);
            indexedDB.open = (...args) => {
              const request = open(...args);
              request.addEventListener('success', event => {
                event.stopImmediatePropagation();
                window.releaseStartupStorage = () => request.dispatchEvent(new Event('success'));
              }, { once: true });
              return request;
            };
          });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          let release;
          const held = new Promise(resolve => { release = resolve; });
          await page.route('**/assets/client-*.js', async route => { await held; await route.continue().catch(() => {}); });
          await page.goto(origin, { waitUntil: 'commit' });
          await page.getByText('步骤进度 0/6 · 0%', { exact: true }).waitFor();
          await page.waitForFunction(() => document.getElementById('app-startup-elapsed').textContent !== '已用 0.0 秒');
          await page.screenshot({ path: `${output}/${name}-${width}-resources.png` });
          release();
          await page.getByText('步骤进度 1/6 · 17%', { exact: true }).waitFor();
          await page.waitForTimeout(750);
          assert.equal(await page.locator('progress').getAttribute('value'), '1');
          assert.match(await page.locator('[data-stage=storage]').innerText(), /进行中/);
          assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.app-startup-loading'), '::before').animationName), 'none');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.screenshot({ path: `${output}/${name}-${width}-storage.png` });
          await page.evaluate(() => window.releaseStartupStorage());
          await page.locator('#app-startup').waitFor({ state: 'detached', timeout: 8000 });
          await page.locator('input[autocomplete=username]').waitFor();
          assert.deepEqual(errors, []);
          reports.push({ engine: name, width, resourceWait: true, storageWait: true, percentageNotTimed: true, reducedMotion: true, completedWithoutExtraDelay: true, status: 'passed' });
        } finally { await context.close(); }
      }
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        await page.route('**/assets/client-*.js', route => route.abort());
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: '重新加载' }).waitFor();
        assert.match(await page.locator('#app-startup-note').innerText(), /界面资源加载失败/);
        assert.equal(await page.locator('progress').getAttribute('value'), '0');
        await page.screenshot({ path: `${output}/${name}-resource-failure.png` });
        reports.push({ engine: name, width: 390, entryFailureBeforeModuleExecutes: true, recoveryVisible: true, status: 'passed' });
      } finally { await context.close(); }
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify(reports, null, 2));
} finally { await server.close(); }
