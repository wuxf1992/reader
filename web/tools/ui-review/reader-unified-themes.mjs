import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { resolveTheme, themeOptions, themeTokens } from '../../src/shared/theme/theme.ts';
import { createReviewServer, BOOK_ID } from './server.mjs';
const output = new URL('../../../artifacts/ui-review/reader-unified-themes/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 }), origin = await server.listen();
const report = { cases: [], errors: [], navigationAbortWarnings: [], failedRequests: [] };
const rgb = hex => 'rgb(' + hex.slice(1).match(/../g).map(c => parseInt(c, 16)).join(', ') + ')';
async function route(page, path) { await page.evaluate(path => { location.hash = '#' + path; }, path); }
async function openBook(page) {
  await route(page, '/book/' + BOOK_ID);
  await page.locator('book-content .book-flow p').first().waitFor();
}
async function showChrome(page) {
  if (await page.locator('html').getAttribute('data-reader-chrome') === 'hidden') {
    const { width, height } = page.viewportSize();
    await page.mouse.click(width / 2, height / 2);
    await page.waitForFunction(() => document.documentElement.dataset.readerChrome === 'visible');
  }
}
async function appearance(page) {
  await showChrome(page);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  const font = page.getByRole('slider', { name: '字号', exact: true });
  await page.waitForFunction(() => { const box = document.querySelector('input[aria-label="字号"]')?.getBoundingClientRect(); return box && box.y >= 0 && box.bottom <= innerHeight; });
  const box = await font.boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= page.viewportSize().height, 'font size is visible before scrolling');
  const fold = page.locator('details').filter({ has: page.locator('[aria-label="主题配色"]') });
  await page.screenshot({ path: output + `${page.viewportSize().width}-${page.context().browser().browserType().name()}-appearance-first-screen.png` });
  if (!await fold.evaluate(el => el.open)) await fold.locator('summary').click();
}
async function closeDialog(page) {
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}
try {
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const width of [390, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 768 }, serviceWorkers: 'block' });
        let reloading = false;
        page.on('requestfailed', request => { if (request.url().startsWith(origin + '/api/')) report.failedRequests.push({ engine, width, reloading, url: request.url(), error: request.failure()?.errorText }); });
        page.on('pageerror', error => {
          const entry = { engine, width, reloading, message: error.message };
          if (engine === 'webkit' && reloading && error.message === `/${new URL(origin).host}/api/v1/books?scope=shelf&page=1&pageSize=60&sort=recent&order=desc due to access control checks.`) report.navigationAbortWarnings.push(entry);
          else report.errors.push(entry);
        });
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.goto(origin + '/#/shelf');
        await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click();
        await page.locator('.app-shell').waitFor();
        await page.waitForLoadState('networkidle');
        // Simulate an existing installation upgrading, before its first unified-theme migration.
        await page.evaluate(async () => {
          await window.readerApp.platform.kv.set('reader.settings.v1', JSON.stringify({ theme: 'kraft-day', paper: 'local-kraft-day', paperFollowsDark: false,
            lastDayTheme: 'kraft-day', lastNightTheme: 'wechat-night', brightness: .65, fontScale: 1.15, pageInsets: { bottom: 18 } }));
          for (const key of Object.keys(localStorage)) if (key.startsWith('reader.appearance.v1:')) localStorage.removeItem(key);
        });
        reloading = true;
        await page.reload(); await page.locator('.app-shell').waitFor(); await page.waitForLoadState('networkidle');
        reloading = false;
        await route(page, '/me/theme');
        await page.locator('.theme-settings').waitFor();
        assert.equal(await page.getByRole('button', { name: '牛皮纸', exact: true }).getAttribute('aria-pressed'), 'true');
        await page.getByRole('button', { name: '微信夜间', exact: true }).click();
        assert.equal(await page.locator('html').getAttribute('data-mode'), 'dark');
        await openBook(page);
        assert.equal(await page.locator('.reader-screen').getAttribute('data-reading-theme'), 'local-wechat-night');
        await appearance(page);
        await page.screenshot({ path: output + `${engine}-${width}-appearance.png` });
        const cases = [];
        for (const option of themeOptions) {
          await page.locator('[aria-label="主题配色"]').getByRole('button', { name: option.label, exact: true }).click();
          await page.waitForFunction(id => document.querySelector('.reader-screen')?.dataset.readingTheme === id, option.value);
          const mode = await page.locator('html').getAttribute('data-mode');
          const resolved = resolveTheme(option.value, mode), expected = themeTokens(resolved);
          const actual = await page.evaluate(() => {
            const screen = document.querySelector('.reader-screen'), css = getComputedStyle(screen);
            return { mode: screen.dataset.mode, bg: css.getPropertyValue('--color-bg').trim(), ink: css.getPropertyValue('--color-ink').trim(),
              rootBg: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
              dialogBg: getComputedStyle(screen.querySelector('dialog')).backgroundColor,
              selected: screen.querySelectorAll('[aria-label="主题配色"] [aria-pressed=true]').length,
              overflow: document.documentElement.scrollWidth > innerWidth,
              readerColor: getComputedStyle(screen.querySelector('book-content').shadowRoot.querySelector('.book-flow')).color };
          });
          assert.equal(actual.mode, resolved.mode); assert.equal(actual.bg.toLowerCase(), expected.bg.toLowerCase());
          assert.equal(actual.rootBg.toLowerCase(), expected.bg.toLowerCase());
          assert.equal(actual.ink.toLowerCase(), expected.ink.toLowerCase()); assert.equal(actual.selected, 1);
          assert.equal(actual.dialogBg, rgb(expected.surface)); assert.equal(actual.readerColor, rgb(expected.ink));
          assert.equal(actual.overflow, false); cases.push({ theme: option.value, ...actual });
        }
        await page.locator('[aria-label="主题配色"]').getByRole('button', { name: '牛皮纸', exact: true }).click();
        await page.locator('[aria-label="主题配色"]').getByRole('button', { name: '微信夜间', exact: true }).click();
        await closeDialog(page); await page.reload();
        await page.locator('book-content .book-flow p').first().waitFor();
        assert.equal(await page.locator('.reader-screen').getAttribute('data-reading-theme'), 'local-wechat-night');
        await showChrome(page);
        await page.getByRole('button', { name: '日间', exact: true }).click();
        assert.equal(await page.locator('.reader-screen').getAttribute('data-reading-theme'), 'local-kraft-day');
        await page.screenshot({ path: output + `${engine}-${width}-kraft-reader.png` });
        await route(page, '/me/theme'); await page.locator('.theme-settings').waitFor();
        assert.equal(await page.getByRole('button', { name: '牛皮纸', exact: true }).getAttribute('aria-pressed'), 'true');
        await page.getByRole('button', { name: '跟随系统', exact: true }).click();
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
        await openBook(page);
        assert.equal(await page.locator('.reader-screen').getAttribute('data-reading-theme'), 'local-wechat-night');
        await page.emulateMedia({ colorScheme: 'light' });
        await page.waitForFunction(() => document.querySelector('.reader-screen')?.dataset.readingTheme === 'local-kraft-day');
        await route(page, '/me/theme'); await page.locator('.theme-settings').waitFor();
        await page.screenshot({ path: output + `${engine}-${width}-global-themes.png` });
        const saved = await page.evaluate(() => window.readerApp.settings.current);
        assert.equal(saved.brightness, .65); assert.equal(saved.fontScale, 1.15); assert.equal(saved.pageInsets.bottom, 18);
        console.log(engine, width, 'shared themes passed');
        report.cases.push({ engine, width, migrated: true, persisted: true, sharedAcrossRoutes: true, systemPair: true, themes: cases });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile(output + 'report.json', JSON.stringify(report, null, 2));
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ cases: report.cases.length, themeSelections: report.cases.reduce((sum, c) => sum + c.themes.length, 0), errors: report.errors, navigationAbortWarnings: report.navigationAbortWarnings.length }));
} finally { await server.close(); }
