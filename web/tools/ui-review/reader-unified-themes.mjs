import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { PALETTES } from '../../src/render/theme.ts';
import { defaultThemePreference, readingThemeOptions, resolveReadingTheme, themeTokens } from '../../src/shared/theme/theme.ts';
import { createReviewServer, BOOK_ID } from './server.mjs';
const output = new URL('../../../artifacts/ui-review/reader-unified-themes/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 }), origin = await server.listen();
const report = { cases: [], errors: [] };
const rgb = hex => 'rgb(' + hex.slice(1).match(/../g).map(c => parseInt(c, 16)).join(', ') + ')';
async function openBook(page) {
  await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
  await page.locator('book-content .book-flow p').first().waitFor();
}
async function appearance(page) {
  await page.getByRole('button', { name: '外观', exact: true }).click();
  const fold = page.locator('details').filter({ has: page.locator('[aria-label="主题"]') });
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
        await page.waitForLoadState('networkidle');
        await page.evaluate(async () => {
          await window.readerApp.platform.kv.set('reader.settings.v1', JSON.stringify({ theme: 'kraft-day', paper: 'local-kraft-day', paperFollowsDark: false,
            lastDayTheme: 'kraft-day', lastNightTheme: 'wechat-night', brightness: .65, fontScale: 1.15, pageInsets: { bottom: 18 } }));
        });
        await page.reload(); await page.locator('.app-shell').waitFor();
        const migrated = await page.evaluate(() => window.readerApp.settings.current);
        assert.equal(migrated.readingTheme, 'local-kraft-day'); assert.equal(migrated.paper, 'theme');
        assert.equal(migrated.fontScale, 1.15); assert.equal(migrated.brightness, .65); assert.equal(migrated.pageInsets.bottom, 18);
        await openBook(page);
        assert.equal(await page.locator('.reader-screen').getAttribute('data-reading-theme'), 'local-kraft-day');
        assert.ok((await page.locator('.reader-screen').evaluate(el => getComputedStyle(el).getPropertyValue('--reader-paper-texture'))).includes('kraft-paper'));
        const appBefore = await page.locator('html').evaluate(el => ({ ...el.dataset }));
        await appearance(page);
        assert.equal(await page.locator('[aria-label="纸色"], [aria-label="明暗"], .theme-picker').count(), 0);
        const cases = [];
        for (const option of readingThemeOptions) {
          await page.locator('[aria-label="主题"]').getByRole('button', { name: option.label, exact: true }).click();
          await page.waitForFunction(id => document.querySelector('.reader-screen')?.dataset.readingTheme === id, option.value);
          const reading = resolveReadingTheme({ ...defaultThemePreference, reading: option.value }, false), expected = themeTokens(reading);
          const actual = await page.evaluate(() => {
            const screen = document.querySelector('.reader-screen'), css = getComputedStyle(screen);
            const chrome = getComputedStyle(screen.querySelector('.topbar')), dialog = getComputedStyle(screen.querySelector('dialog'));
            return { mode: screen.dataset.mode, paper: screen.dataset.paper, bg: css.getPropertyValue('--color-bg').trim(), ink: css.getPropertyValue('--color-ink').trim(),
              surface: css.getPropertyValue('--color-surface').trim(), read: css.getPropertyValue('--color-ch-read').trim(),
              chromeBg: chrome.backgroundColor, dialogBg: dialog.backgroundColor,
              selected: screen.querySelectorAll('[aria-label="主题"] [aria-pressed=true]').length,
              overflow: document.documentElement.scrollWidth > innerWidth,
              readerColor: getComputedStyle(screen.querySelector('book-content').shadowRoot.querySelector('.book-flow')).color };
          });
          assert.equal(actual.mode, reading.mode); assert.equal(actual.bg.toLowerCase(), expected.bg.toLowerCase());
          assert.equal(actual.ink.toLowerCase(), expected.ink.toLowerCase()); assert.equal(actual.surface.toLowerCase(), expected.surface.toLowerCase());
          assert.equal(actual.read.toLowerCase(), expected.ch.read.fill.toLowerCase()); assert.equal(actual.selected, 1);
          assert.equal(actual.dialogBg, rgb(expected.surface)); assert.equal(actual.readerColor, rgb(expected.ink));
          assert.equal(actual.overflow, false); assert.equal(actual.paper, undefined);
          cases.push({ theme: option.value, ...actual });
        }
        await page.locator('[aria-label="主题"]').getByRole('button', { name: '牛皮纸', exact: true }).click();
        await page.locator('[aria-label="主题"]').getByRole('button', { name: '微信夜间', exact: true }).click();
        await page.screenshot({ path: output + `${engine}-${width}-night-chooser.png` });
        await closeDialog(page);
        await page.reload(); await page.locator('book-content .book-flow p').first().waitFor();
        assert.equal(await page.locator('.reader-screen').getAttribute('data-reading-theme'), 'local-wechat-night');
        assert.equal(await page.locator('.reader-screen').getAttribute('data-mode'), 'dark');
        const appAfter = await page.locator('html').evaluate(el => ({ theme: el.dataset.theme, mode: el.dataset.mode }));
        assert.deepEqual(appAfter, { theme: appBefore.theme, mode: appBefore.mode });
        await page.getByRole('button', { name: '日间', exact: true }).click();
        assert.equal(await page.locator('.reader-screen').getAttribute('data-reading-theme'), 'local-kraft-day');
        await page.screenshot({ path: output + `${engine}-${width}-kraft-reader.png` });
        await appearance(page);
        await page.locator('[aria-label="主题"]').getByRole('button', { name: '跟随应用', exact: true }).click();
        assert.equal(await page.locator('.reader-screen').evaluate(el => el.style.getPropertyValue('--color-bg')), '');
        await closeDialog(page); await page.reload(); await page.locator('book-content .book-flow p').first().waitFor();
        assert.equal(await page.locator('.reader-screen').getAttribute('data-reading-theme'), 'app');
        const saved = await page.evaluate(() => window.readerApp.settings.current);
        assert.equal(saved.brightness, .65); assert.equal(saved.fontScale, 1.15); assert.equal(saved.pageInsets.bottom, 18);
        report.cases.push({ engine, width, migrated: true, persisted: true, appUnchanged: true, themes: cases });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(report.errors, []);
  await writeFile(output + 'report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cases: report.cases.length, themeSelections: report.cases.reduce((sum, c) => sum + c.themes.length, 0), errors: report.errors }));
} finally { await server.close(); }
