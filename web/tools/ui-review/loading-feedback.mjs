import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const output = process.env.UI_REVIEW_DIR || '/tmp/reader-loading-review';
const server = createReviewServer({ port: 5201 });
const origin = await server.listen();
await mkdir(output, { recursive: true });
const reports = [];
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let delay = 400;
      const type = { id: 'opds', pluginId: 'reader.opds', builtin: true, label: '测试书源', version: '1', capabilities: ['browse', 'search'] };
      const source = { id: 'source-1', name: '测试小说源', pluginId: 'reader.opds', sourceType: 'opds', enabled: true, descriptor: type, config: {} };
      await page.route(/\/api\/v1\/sources(?:\/|$|\?)/, async route => {
        const path = new URL(route.request().url()).pathname;
        let data = {};
        if (path.endsWith('/search')) {
          await new Promise(resolve => setTimeout(resolve, delay));
          await route.fulfill({ contentType: 'text/event-stream', body: 'event: results\ndata: {"items":[{"ref":"one","title":"测试结果"}]}\n\nevent: done\ndata: {}\n\n' }).catch(() => {});
          return;
        }
        if (path.endsWith('/pages/settings')) {
          await new Promise(resolve => setTimeout(resolve, delay));
          data = { title: '测试书源配置', forms: [{ id: 'save', submit: '保存', fields: [] }] };
        } else if (path.endsWith('/types')) data = { types: [type] };
        else if (path.endsWith('/sources')) data = { sources: [source] };
        else if (path.endsWith('/search-filters')) data = [];
        else if (path.endsWith('/credentials')) data = { state: 'unknown', checkedAt: null, available: false, fields: [] };
        else if (path.endsWith('/subscriptions')) data = { subscriptions: [] };
        else if (path.endsWith('/browse')) data = { items: [] };
        await route.fulfill({ json: data });
      });
      await page.route('**/api/v1/plugins', route => route.fulfill({ json: { plugins: [] } }));
      await page.route('**/api/v1/subscriptions', route => route.fulfill({ json: { subscriptions: [] } }));
      await page.route('https://wuxf.top/**', route => route.abort());
      await page.route('**/assets/client.js*', async route => {
        await new Promise(resolve => setTimeout(resolve, 400)); await route.continue();
      });
      await page.goto(origin, { waitUntil: 'commit' });
      await page.waitForFunction(() => document.querySelector('.app-startup-loading') && getComputedStyle(document.querySelector('.app-startup-loading')).opacity === '1');
      await page.getByText('更换服务地址', { exact: true }).click();
      await page.locator('input[type=url]').fill(origin);
      await page.locator('input[autocomplete=username]').fill('review');
      await page.locator('input[type=password]').fill('password12');
      await page.locator('button[type=submit]').click();
      await page.locator('.book-card:not(.skeleton)').first().waitFor({ timeout: 8000 }).catch(async error => {
        console.log((await page.locator('body').innerText()).slice(0, 500), errors, server.seen.slice(-12)); throw error;
      });

      await page.evaluate(() => { location.hash = '#/sources'; });
      await page.locator('select[aria-label="选择来源"]').selectOption('source-1', { timeout: 8000 }).catch(async error => {
        console.log((await page.locator('body').innerText()).slice(-500), errors, server.seen.slice(-12)); throw error;
      });
      await page.getByLabel('搜索书籍', { exact: true }).fill('测试');
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await page.locator('.search-progress .busy-spinner').waitFor();
      assert.equal(await page.getByRole('button', { name: '停止搜索', exact: true }).isEnabled(), true);
      await page.screenshot({ path: `${output}/${name}-search.png` });
      await page.getByRole('button', { name: '停止搜索', exact: true }).click();
      assert.equal(await page.locator('.search-progress .busy-spinner').count(), 0);
      await page.waitForTimeout(450);
      assert.equal(await page.locator('.catalog-book').count(), 0, 'aborted search must not restore late results');

      delay = 0;
      await page.evaluate(() => {
        window.busyFlashes = 0;
        window.busyObserver = new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node instanceof Element && (node.matches('.busy-spinner') || node.querySelector('.busy-spinner'))) window.busyFlashes++;
          }
        });
        window.busyObserver.observe(document.querySelector('.sources-body'), { subtree: true, childList: true });
      });
      await page.getByRole('button', { name: '搜索选项', exact: true }).click();
      await page.getByRole('menuitem', { name: '重新搜索', exact: true }).click();
      await page.locator('.catalog-book').waitFor();
      assert.equal(await page.evaluate(() => window.busyFlashes), 0, 'fast search must not flash');
      await page.evaluate(() => window.busyObserver.disconnect());

      delay = 400;
      await page.evaluate(() => { location.hash = '#/sources/source-1/settings'; });
      await page.locator('.sources-body .busy-indicator').waitFor();
      await page.getByRole('button', { name: '保存', exact: true }).waitFor();
      const save = page.getByRole('button', { name: '保存', exact: true });
      const width = (await save.boundingBox()).width;
      await save.click();
      await save.locator('.busy-spinner').waitFor();
      assert.equal(await save.getAttribute('aria-busy'), 'true');
      assert.equal((await save.boundingBox()).width, width, 'button must not resize while busy');
      await page.screenshot({ path: `${output}/${name}-button.png` });
      await page.waitForFunction(() => document.querySelector('button[type=submit]')?.getAttribute('aria-busy') === 'false');

      const colors = {};
      for (const theme of ['light', 'sepia', 'dark']) {
        colors[theme] = await page.evaluate(theme => {
          document.documentElement.dataset.theme = theme;
          const main = document.querySelector('.sources-body');
          main.style.overflow = 'scroll'; main.style.height = '160px';
          const filler = document.createElement('div'); filler.style.height = '600px'; main.append(filler);
          return { scrollbar: getComputedStyle(main).scrollbarColor, scheme: getComputedStyle(main).colorScheme };
        }, theme);
        await page.screenshot({ path: `${output}/${name}-${theme}.png` });
      }
      assert.equal(colors.light.scheme, 'light'); assert.equal(colors.dark.scheme, 'dark');
      if (colors.light.scrollbar) assert.notEqual(colors.light.scrollbar, colors.dark.scrollbar);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const animation = await page.evaluate(() => {
        const spinner = document.createElement('span'); spinner.className = 'busy-spinner'; document.body.append(spinner);
        const name = getComputedStyle(spinner).animationName; spinner.remove(); return name;
      });
      assert.equal(animation, 'none');

      await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
      await page.locator('.reader-screen').waitFor();
      await page.getByRole('button', { name: '目录', exact: true }).click();
      await page.locator('.toc-list button').first().waitFor();
      await page.locator('.toc-list button').nth(1).click();
      await page.waitForFunction(() => !document.querySelector('.toc-list'));
      await page.evaluate(() => { location.hash = '#/shelf'; });
      await page.locator('.shelf-sort').waitFor();
      const sortControl = page.locator('.shelf-sort');
      assert.deepEqual(await sortControl.locator('option').evaluateAll(options => options.map(option => option.value)), ['recent', 'added', 'title', 'author']);
      assert.deepEqual(await sortControl.evaluate(el => ({ height: el.getBoundingClientRect().height, fontSize: getComputedStyle(el).fontSize })), { height: 44, fontSize: '16px' });
      await page.setViewportSize({ width: 1280, height: 800 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `${output}/${name}-desktop.png` });
      assert.deepEqual(errors, []);
      reports.push({ engine: name, viewports: ['390x844', '1280x800'], startupFeedback: true, stoppedSearchCleared: true, fastSearchDidNotFlash: true, stableButtonWidth: true, reducedMotion: true, tocNavigation: true, nativeShelfSort: true, colors });
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify(reports, null, 2));
} finally { await server.close(); }
