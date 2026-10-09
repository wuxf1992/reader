import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const themes = [
  ['wechat-day', '微信阅读 - 日间', '#f4f5f7', '#ffffff', '#3897f1', 'light', 'wechat-night'],
  ['wechat-night', '微信阅读 - 夜间', '#000000', '#1a1a1a', '#3897f1', 'dark', 'wechat-day'],
  ['houmo-day', '厚墨 - 日间', '#f9f2e8', '#f9f2e8', '#404048', 'light', 'houmo-night'],
  ['houmo-night', '厚墨 - 夜间', '#333949', '#333949', '#00bbca', 'dark', 'houmo-day'],
];
const output = '/tmp/reader-themes-review';
const server = createReviewServer({ port: 5205 });
const origin = await server.listen();
const reports = [];
await mkdir(output, { recursive: true });
try {
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const errors = [];
      let reloading = false, cancelledSyncOnReload = 0;
      page.on('pageerror', error => {
        if (reloading && error.message.includes('/api/v1/sync due to access control checks.')) { cancelledSyncOnReload++; return; }
        errors.push(error.message);
      });
      await page.route('https://wuxf.top/**', route => route.abort());
      await page.goto(origin);
      await page.getByText('更换服务地址', { exact: true }).click();
      await page.locator('input[type=url]').fill(origin);
      await page.locator('input[autocomplete=username]').fill('review');
      await page.locator('input[type=password]').fill('password12');
      await page.locator('button[type=submit]').click();
      await page.locator('.book-card:not(.skeleton)').first().waitFor();
      await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
      await page.locator('.book-host').waitFor();
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
        for (const [id, , paper, surface, accent, scheme, opposite] of themes) {
          await page.getByRole('button', { name: '界面', exact: true }).click();
          await page.locator('.panel').evaluate(async panel => { await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
          assert.ok(await page.locator('.panel-body .section-title').evaluateAll(headings => headings.every(heading => getComputedStyle(heading).position === 'static')), 'settings headings scroll with their content');
          const movement = await page.locator('.panel-body').evaluate(async body => {
            const title = body.querySelector('.section-title');
            body.scrollTop = 0;
            await new Promise(requestAnimationFrame);
            const top = title.getBoundingClientRect().top;
            body.scrollTop = 100;
            await new Promise(requestAnimationFrame);
            const delta = top - title.getBoundingClientRect().top;
            const scroll = body.scrollTop;
            body.scrollTop = 0;
            return { delta, scroll };
          });
          assert.ok(Math.abs(movement.delta - movement.scroll) < 1, `heading must move by the scroll distance: ${engineName} ${width} ${id} ${JSON.stringify(movement)}`);
          const family = id.startsWith('wechat-') ? '微信阅读' : '厚墨';
          const group = page.getByRole('group', { name: family, exact: true });
          assert.equal(await group.locator('button').count(), 2);
          const native = page.getByRole('group', { name: '内置', exact: true });
          assert.deepEqual(await native.locator('button').allTextContents(), ['白', '米黄', '浅绿', '夜间']);
          for (const row of [native, group]) {
            assert.ok(await row.locator('button').evaluateAll(buttons => buttons.every(button => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 1)), 'theme buttons stay on one row');
          }
          const option = group.getByRole('button', { name: scheme === 'dark' ? '夜间' : '日间', exact: true });
          await option.click();
          await page.waitForFunction(id => document.documentElement.dataset.theme === id, id);
          assert.equal(await option.getAttribute('aria-pressed'), 'true');
          const colors = await page.evaluate(() => {
            const css = getComputedStyle(document.documentElement);
            const panel = document.querySelector('.panel');
            return { paper: css.getPropertyValue('--reader-paper').trim(), surface: css.getPropertyValue('--reader-surface').trim(), accent: css.getPropertyValue('--reader-accent').trim(), scheme: css.colorScheme, meta: document.querySelector('meta[name="theme-color"]').content,
              pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
              panelOverflow: panel.scrollWidth > panel.clientWidth + 1 };
          });
          assert.deepEqual(colors, { paper, surface, accent, scheme, meta: paper, pageOverflow: false, panelOverflow: false });
          const fit = await group.locator('button').evaluateAll(buttons => buttons.every(button => {
            const r = button.getBoundingClientRect();
            return r.width >= 44 && r.height >= 44 && button.scrollWidth <= button.clientWidth + 1;
          }));
          if (!fit) { console.log(engineName, width, await group.locator('button').evaluateAll(buttons => buttons.map(button => ({ text: button.textContent, width: button.getBoundingClientRect().width, scroll: button.scrollWidth, client: button.clientWidth })))); await page.screenshot({ path: `${output}/${engineName}-fit-failure.png` }); }
          assert.ok(fit, 'theme names must fit on phone and desktop');
          if (width === 390) {
            await page.locator('.panel-body').evaluate(body => {
              const heading = [...body.querySelectorAll('.section-title')].find(title => title.textContent === '主题');
              body.scrollTop += heading.getBoundingClientRect().top - body.getBoundingClientRect().top;
            });
            await page.screenshot({ path: `${output}/${engineName}-${id}.png` });
          }
          await page.evaluate(async () => { await window.__readerFlush?.(); });
          reloading = true;
          await page.reload();
          await page.locator('.book-host').waitFor();
          reloading = false;
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), id);
          const rail = page.locator('.reader-rail .rail-button');
          assert.deepEqual(await rail.evaluate(button => { const css = getComputedStyle(button); return { border: css.borderTopWidth, background: css.backgroundColor, shadow: css.boxShadow, width: button.getBoundingClientRect().width }; }), { border: '0px', background: 'rgba(0, 0, 0, 0)', shadow: 'none', width: 48 });
          if (width === 390) await page.screenshot({ path: `${output}/${engineName}-${id}-rail.png` });
          assert.equal(await rail.getAttribute('aria-label'), scheme === 'dark' ? '日间' : '夜间');
          await rail.click();
          await page.waitForFunction(id => document.documentElement.dataset.theme === id, opposite);
          await rail.click();
          await page.waitForFunction(id => document.documentElement.dataset.theme === id, id);
          reports.push({ engine: engineName, width, theme: id, restored: true, pairedToggle: true, colors });
        }
      }
      // ponytail: allow one known resize-only observer warning; investigate if it repeats.
      const resizeWarnings = errors.filter(error => error === 'ResizeObserver loop completed with undelivered notifications.');
      assert.ok(resizeWarnings.length <= 1);
      assert.deepEqual(errors.filter(error => !resizeWarnings.includes(error)), []);
      console.log(engineName, { resizeWarnings: resizeWarnings.length, cancelledSyncOnReload });
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(`Passed ${reports.length} theme checks; screenshots: ${output}`);
} finally { await server.close(); }
