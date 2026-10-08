import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const output = '/tmp/reader-bookmark-sheet-review';
const server = createReviewServer({ port: 5202 });
const origin = await server.listen();
await mkdir(output, { recursive: true });
const reports = [];
const bottom = dialog => dialog.evaluate(el => {
  const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
  const translation = css.transform === 'none' ? 0 : new DOMMatrix(css.transform).m42;
  return { bottom: rect.bottom - translation, top: rect.top - translation, width: rect.width, height: rect.height, viewport: innerHeight, viewportWidth: innerWidth, animation: css.animationName };
});
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('https://wuxf.top/**', route => route.abort());
      await page.goto(origin);
      await page.getByText('更换服务地址', { exact: true }).click();
      await page.locator('input[type=url]').fill(origin);
      await page.locator('input[autocomplete=username]').fill('review');
      await page.locator('input[type=password]').fill('password12');
      await page.locator('button[type=submit]').click();
      await page.locator('.book-card:not(.skeleton)').first().waitFor();
      await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
      await page.getByRole('button', { name: '工具', exact: true }).waitFor();
      await page.locator('.book-host').waitFor();
      await page.evaluate(() => {
        window.sheetFrames = [];
        let sampled = false;
        new MutationObserver(() => {
          const dialog = document.querySelector('.reading-tools-modal[open]');
          if (!dialog || sampled) return;
          sampled = true;
          const sample = () => {
            const rect = dialog.getBoundingClientRect(), css = getComputedStyle(dialog);
            const translation = css.transform === 'none' ? 0 : new DOMMatrix(css.transform).m42;
            window.sheetFrames.push({ top: rect.top, bottom: rect.bottom, baseTop: rect.top - translation, baseBottom: rect.bottom - translation, viewport: innerHeight });
            if (window.sheetFrames.length < 20) requestAnimationFrame(sample);
          };
          sample();
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
      });
      await page.getByRole('button', { name: '工具', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '阅读工具', exact: true });
      await dialog.waitFor({ timeout: 5000 }).catch(async error => { console.error(errors, (await page.locator('body').innerText()).slice(-1800), await page.locator('dialog').count()); await page.screenshot({ path: `${output}/${name}-failure.png` }); throw error; });
      await page.waitForFunction(() => window.sheetFrames.length === 20);
      const frames = await page.evaluate(() => window.sheetFrames);
      for (const frame of frames) {
        assert.ok(Math.abs(frame.baseBottom - frame.viewport) < 1, 'every frame must be anchored at the bottom');
        assert.ok(frame.top >= frame.baseTop - 1, 'the panel must enter from below its resting position');
      }
      const phone = await bottom(dialog);
      assert.equal(phone.animation, 'sheet-in');
      assert.ok(Math.abs(phone.width - phone.viewportWidth) < 1, 'the phone panel must span the viewport');
      await page.getByRole('button', { name: '笔记', exact: true }).click();
      await page.getByRole('button', { name: '书签', exact: true }).click();
      assert.ok(Math.abs((await bottom(dialog)).bottom - 844) < 1, 'changing tabs must keep the bottom fixed');
      await page.screenshot({ path: `${output}/${name}-bookmarks.png` });
      assert.deepEqual(errors, []);
      await page.setViewportSize({ width: 844, height: 390 });
      await dialog.locator('.reading-tool-panel').evaluate(el => { const filler = document.createElement('div'); filler.style.height = '1500px'; el.append(filler); });
      const landscape = await bottom(dialog);
      assert.ok(Math.abs(landscape.bottom - 390) < 1 && landscape.height <= 390 * .78 + 1);
      assert.ok(await dialog.locator('.reading-tool-panel').evaluate(el => el.scrollHeight > el.clientHeight), 'long bookmarks must scroll inside the panel');
      assert.equal(await dialog.getByRole('button', { name: '关闭弹窗' }).isVisible(), true);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: '工具', exact: true }).click(); await dialog.waitFor();
      assert.equal((await bottom(dialog)).animation, 'none');
      await page.setViewportSize({ width: 1280, height: 800 });
      const desktop = await bottom(dialog);
      assert.ok(desktop.width < desktop.viewportWidth - 30 && Math.abs((desktop.top + desktop.bottom) / 2 - 400) < 2, 'desktop remains centred');
      // ponytail: tolerate one resize-only reader reflow warning; investigate if it repeats.
      const resizeWarnings = errors.filter(e => e === 'ResizeObserver loop completed with undelivered notifications.');
      assert.ok(resizeWarnings.length <= 1);
      assert.deepEqual(errors.filter(e => !resizeWarnings.includes(e)), []);
      reports.push({ engine: name, resizeWarnings: resizeWarnings.length, firstFrameBottomAnchored: true, upwardEntry: true, bookmarksBottomAnchored: true, landscapeScrollable: true, reducedMotion: true, desktopCentred: true });
    } catch (error) {
      console.error(name, error.message);
      throw error;
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify(reports));
} finally { await server.close(); }
