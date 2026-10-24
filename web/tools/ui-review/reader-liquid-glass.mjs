import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';
const palette = process.env.READER_GLASS_THEME === 'night' ? 'wechat-night' : 'kraft-day';
const paletteLabel = palette === 'wechat-night' ? '微信夜间' : '牛皮纸';
const output = new URL('../../../artifacts/ui-review/reader-liquid-glass/visible-' + palette + '/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 }), origin = await server.listen();
const report = { cases: [], errors: [] };
async function closeDialog(page) {
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}
async function snapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.reader-screen'), host = root.querySelector('book-content');
    const style = getComputedStyle(root), bar = root.querySelector('.footer');
    return { mode: root.dataset.mode, theme: root.dataset.readingTheme, body: host.getBoundingClientRect().toJSON(),
      color: style.getPropertyValue('--reader-paper').trim(), brightness: style.getPropertyValue('--reader-brightness'),
      top: root.querySelector('.reading-indicator-top').getBoundingClientRect().top,
      progress: root.querySelector('.progress-scrubber').max,
      glass: [...root.querySelectorAll('.reader-glass-surface')].map(el => ({ strategy: el.dataset.glassStrategy, reason: el.dataset.glassReason,
        rect: el.getBoundingClientRect().toJSON(), pointer: getComputedStyle(el).pointerEvents,
        canvases: [...el.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height })) })),
      backdrop: getComputedStyle(bar).backdropFilter || getComputedStyle(bar).webkitBackdropFilter,
      scrollbar: host.scrollTop, background: getComputedStyle(bar).backgroundColor,
      readoutBackground: getComputedStyle(root.querySelector('.reading-indicator-top')).backgroundImage,
      footer: bar.getBoundingClientRect().toJSON(), overflow: document.documentElement.scrollWidth > innerWidth };
  });
}
async function pixelDifference(page, first, second, rect) {
  return page.evaluate(async ({ first, second, rect }) => {
    const load = async url => { const img = new Image(); img.src = url; await img.decode(); return img; };
    const [a, b] = await Promise.all([load(first), load(second)]);
    const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height;
    const ctx = canvas.getContext('2d');
    const x = Math.round(rect.x + rect.width / 2 - 50), y = Math.round(rect.y + 3);
    ctx.drawImage(a, 0, 0); const pa = ctx.getImageData(x, y, 100, 5).data;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(b, 0, 0); const pb = ctx.getImageData(x, y, 100, 5).data;
    let sum = 0; for (let i = 0; i < pa.length; i++) if (i % 4 !== 3) sum += Math.abs(pa[i] - pb[i]);
    return sum / (pa.length / 4 * 3);
  }, { first: 'data:image/png;base64,' + first.toString('base64'), second: 'data:image/png;base64,' + second.toString('base64'), rect });
}
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch({ headless: true });
    try {
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
        page.on('pageerror', e => report.errors.push({ engine, width, message: e.message }));
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.goto(origin + '/#/shelf');
        await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click();
        await page.locator('.app-shell').waitFor(); await page.waitForLoadState('networkidle');
        await page.evaluate(() => { location.hash = '#/me/theme'; });
        const toggle = page.getByRole('button', { name: '液态玻璃', exact: true });
        await toggle.waitFor(); assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
        await toggle.click(); await page.waitForFunction(() => document.documentElement.dataset.liquidGlass === 'true');
        await page.evaluate(async palette => { await window.readerApp.updateSettings({ theme: palette, readingTheme: 'local-' + palette, paper: 'theme' }); }, palette);
        await page.screenshot({ path: output + `${engine}-${width}-settings.png` });
        await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
        await page.locator('book-content .book-flow p').first().waitFor();
        const on = await snapshot(page);
        assert.equal(on.theme, 'local-' + palette); assert.equal(on.top, 0); assert.equal(on.overflow, false);
        assert.equal(on.glass.length, 0);
        assert.ok(on.backdrop.includes('blur(24px)'), JSON.stringify(on));
        assert.ok(on.readoutBackground.includes('linear-gradient'), 'readout keeps an opaque strip');
        assert.ok(on.background.includes('0.58'), on.background);
        const onShot = await page.screenshot({ path: output + `${engine}-${width}-glass.png` });
        const frozen = await page.locator('book-content').evaluate(el => el.scrollTop);
        await page.mouse.move(width / 2, 400); await page.mouse.wheel(0, 400);
        await page.waitForTimeout(100); assert.equal(await page.locator('book-content').evaluate(el => el.scrollTop), frozen);
        await page.getByRole('button', { name: '外观', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: '液态玻璃', exact: true }).getAttribute('aria-pressed'), 'true');
        const previews = () => page.locator('[aria-label="主题"] .theme-swatch').evaluateAll(buttons => buttons.filter(button => button.dataset.readingThemeOption !== 'app').map(button => {
          const chip = getComputedStyle(button.querySelector('.theme-swatch-chip'));
          return { id: button.dataset.readingThemeOption, background: chip.backgroundColor, color: chip.color, image: chip.backgroundImage };
        }));
        const beforePreviews = await previews();
        assert.ok(beforePreviews.find(p => p.id === 'local-kraft-day').image.includes('kraft-paper'));
        assert.ok(beforePreviews.find(p => p.id === 'local-parchment-day').image.includes('parchment-paper'));
        await page.locator('[aria-label="主题"]').getByRole('button', { name: '微信夜间', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.reader-screen').dataset.readingTheme === 'local-wechat-night');
        assert.deepEqual(await previews(), beforePreviews, 'every preview keeps its own colours and texture');
        await page.screenshot({ path: output + `${engine}-${width}-fixed-previews.png` });
        await page.locator('[aria-label="主题"]').getByRole('button', { name: paletteLabel, exact: true }).click();

        assert.equal(await page.locator('.reader-glass-surface').count(), 0);
        await page.getByRole('button', { name: '液态玻璃', exact: true }).click();
        await page.waitForFunction(() => document.documentElement.dataset.liquidGlass === 'false');
        await closeDialog(page);
        const off = await snapshot(page);
        assert.deepEqual(off.body, on.body); assert.equal(off.progress, on.progress); assert.equal(off.color, on.color); assert.equal(off.glass.length, 0);
        assert.equal(off.backdrop, 'none');
        const offShot = await page.screenshot({ path: output + `${engine}-${width}-solid.png` });
        const visibleDifference = await pixelDifference(page, onShot, offShot, on.footer);
        assert.ok(visibleDifference > 8, 'glass must visibly change the control surface: ' + visibleDifference);
        await page.getByRole('button', { name: '外观', exact: true }).click();
        await page.getByRole('button', { name: '液态玻璃', exact: true }).click(); await closeDialog(page);
        await page.waitForFunction(() => document.documentElement.dataset.liquidGlass === 'true');
        await page.mouse.click(width / 2, 400); await page.waitForFunction(() => document.querySelector('.reader-screen').dataset.chrome === 'hidden');
        assert.equal(await page.locator('.reader-glass-surface').count(), 0);
        assert.equal(await page.locator('.reading-indicator-top').evaluate(el => el.getBoundingClientRect().top), 0);
        await page.reload(); await page.locator('book-content .book-flow p').first().waitFor();
        await page.waitForFunction(() => document.documentElement.dataset.liquidGlass === 'true');
        assert.equal(await page.locator('.reader-screen').getAttribute('data-reading-theme'), 'local-' + palette);
        if (engine === 'chromium') {
          const session = await page.context().newCDPSession(page);
          await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
          await page.waitForFunction(() => !document.querySelector('.reader-glass-surface'));
          const reduced = await snapshot(page); assert.equal(reduced.backdrop, 'none');
        }
        report.cases.push({ engine, width, palette, visibleDifference, on, off, persisted: true });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(report.errors, []);
  await writeFile(output + 'report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cases: report.cases.map(c => ({ engine: c.engine, width: c.width, palette: c.palette, material: c.on.backdrop, visibleDifference: c.visibleDifference, persisted: c.persisted })), errors: report.errors }));
} finally { await server.close(); }
