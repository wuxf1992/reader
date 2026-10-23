import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID, ILLUSTRATED_ID } from './server.mjs';

const output = '/tmp/reader-brightness-review';
const server = createReviewServer({ port: 0 });
const origin = await server.listen();
const reports = [];
await mkdir(output, { recursive: true });
try {
  for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await browserType.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://wuxf.top/**', route => route.abort());
      await page.goto(origin);
      await page.getByText('更换服务地址', { exact: true }).click();
      await page.locator('input[type=url]').fill(origin);
      await page.locator('input[autocomplete=username]').fill('review');
      await page.locator('input[type=password]').fill('password12');
      await page.locator('button[type=submit]').click();
      await page.locator('.app-shell').waitFor();
      await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
      await page.locator('.book-host').waitFor();

      const openSettings = () => page.getByRole('button', { name: '外观', exact: true }).click();
      const closeSettings = () => page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
      async function brightness(value) {
        await openSettings();
        const slider = page.getByRole('slider', { name: '页面亮度', exact: true });
        assert.equal(await slider.getAttribute('min'), '0.5');
        await slider.evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
        assert.equal(await slider.getAttribute('aria-valuetext'), `${value * 100}%`);
        await closeSettings();
        await page.locator('.sheet').waitFor({ state: 'detached' });
      }
      async function samples() {
        const points = await page.locator('.book-host').evaluate(host => {
          const r = host.getBoundingClientRect();
          const points = [120, r.height / 2, r.height - 160].map(y => ({ x: Math.round(r.left + 8), y: Math.round(r.top + y) }));
          const hidden = document.querySelector('.reader-screen').dataset.chrome === 'hidden';
          for (const selector of hidden ? ['.reading-indicator-top', '.reading-indicator-bottom'] : ['.topbar', '.footer']) {
            const bar = document.querySelector(selector).getBoundingClientRect();
            points.push({ x: Math.round(bar.left + 3), y: Math.round(bar.top + bar.height / 2) });
          }
          return points;
        });
        const png = (await page.screenshot({ animations: 'disabled' })).toString('base64');
        return page.evaluate(async ({ png, points }) => {
          const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
          const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
          return points.map(({ x, y }) => {
            const [r, g, b] = context.getImageData(x, y, 1, 1).data;
            return (r + g + b) / 3;
          });
        }, { png, points });
      }
      const geometry = () => page.locator('.book-host').evaluate(host => {
        const flow = host.shadowRoot.querySelector('.book-flow');
        return { y: host.scrollTop, x: flow.scrollLeft, page: document.querySelector('.progress-scrubber').value, height: host.clientHeight };
      });
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        for (const theme of ['light', 'dark', 'kraft-day']) {
          await openSettings();
          await page.getByRole('button', { name: theme === 'dark' ? '夜间模式' : '日间模式', exact: true }).click();
          await page.getByRole('button', { name: theme === 'dark' ? '静夜' : theme === 'kraft-day' ? '牛皮纸' : '素白', exact: true }).click();
          await closeSettings();
          await brightness(1);
          const layers = await page.locator('.reader-screen').evaluate(screen => {
            const mask = getComputedStyle(screen, '::after');
            return { mask: Number(mask.zIndex), pointer: mask.pointerEvents,
              bar: Number(getComputedStyle(screen.querySelector('.topbar')).zIndex),
              rail: Number(getComputedStyle(screen.querySelector('.reader-rail')).zIndex),
              panel: Number(getComputedStyle(screen).getPropertyValue('--reader-layer-panel')),
              stageMask: getComputedStyle(screen.querySelector('.stage'), '::after').content };
          });
          assert.ok(layers.mask > layers.bar && layers.mask > layers.rail && layers.mask < layers.panel);
          assert.equal(layers.pointer, 'none');
          assert.equal(layers.stageMask, 'none', 'the book is not dimmed twice');
          const full = await samples();
          await page.locator('.book-host').evaluate(host => { host.scrollTop = host.scrollHeight / 2; });
          await page.waitForFunction(() => document.querySelector('.book-host').scrollTop > 100);
          const position = await geometry();
          for (const value of [.75, .5]) {
            await brightness(value);
            const next = await geometry();
            assert.equal(next.height, position.height, 'brightness preserves page geometry');
            assert.ok(Math.abs(next.y - position.y) <= 1, 'brightness preserves reading position');
            const pixels = await samples();
            for (let i = 0; i < pixels.length; i++) {
              const ratio = pixels[i] / full[i];
              assert.ok(Math.abs(ratio - value) < .06, `${engine} ${width} ${theme}: expected visible brightness ${value}, got ${ratio}`);
              assert.ok(pixels[i] > 5, 'minimum never produces a black page');
            }
            reports.push({ engine, width, theme, value, pixels });
          }
          await page.screenshot({ path: `${output}/${engine}-${width}-${theme}-minimum-scrolled.png`, animations: 'disabled' });
          await openSettings();
          const slider = page.getByRole('slider', { name: '页面亮度', exact: true });
          await slider.focus(); await page.keyboard.press('End');
          assert.equal(await slider.inputValue(), '1');
          await closeSettings();
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => document.querySelector('.reader-screen').dataset.chrome === 'hidden');
          const readoutsFull = (await samples()).slice(-2);
          await page.mouse.click(width / 2, (width === 390 ? 844 : 800) / 2);
          await brightness(.5);
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => document.querySelector('.reader-screen').dataset.chrome === 'hidden');
          const readoutsDim = (await samples()).slice(-2);
          readoutsDim.forEach((value, index) => assert.ok(Math.abs(value / readoutsFull[index] - .5) < .06, 'immersive readouts dim with the page'));
          await page.screenshot({ path: `${output}/${engine}-${width}-${theme}-minimum-immersive.png`, animations: 'disabled' });
          await page.mouse.click(width / 2, (width === 390 ? 844 : 800) / 2);
          await page.getByRole('button', { name: '设置', exact: true }).click();
          await page.getByRole('group', { name: '翻页方式', exact: true }).getByRole('button', { name: '翻页', exact: true }).click();
          await closeSettings();
          await brightness(.5);
          assert.equal(await page.locator('.reader-screen').evaluate(screen => getComputedStyle(screen, '::after').opacity), '0.5');
          await page.getByRole('button', { name: '设置', exact: true }).click();
          await page.getByRole('group', { name: '翻页方式', exact: true }).getByRole('button', { name: '滚动', exact: true }).click();
          await closeSettings();
        }
        console.log(engine, width, 'pixel brightness and paging passed');
      }
      for (const book of [ILLUSTRATED_ID, 'review-comic']) {
        console.log(engine, 'loading', book);
        await page.goto(`${origin}/#/book/${book}`);
        await page.locator('.book-host').waitFor();
        if (book === 'review-comic') await page.locator('.book-host[data-layout="fixed"]').waitFor();
        await page.waitForFunction(() => document.querySelector('.book-host')?.shadowRoot.querySelector('img')?.naturalWidth > 0, undefined, { timeout: 10_000 }).catch(async error => {
          console.log(await page.locator('body').innerText());
          throw error;
        });
        await brightness(.5);
        assert.equal(await page.locator('.reader-screen').evaluate(screen => {
          const mask = getComputedStyle(screen, '::after');
          return mask.opacity === '0.5' && mask.pointerEvents === 'none';
        }), true, 'images share the fixed brightness mask');
      }
      await page.evaluate(async () => { await window.readerApp.settings.update({ brightness: 0 }); });
      await page.reload(); await page.locator('.book-host').waitFor();
      await openSettings();
      assert.equal(await page.getByRole('slider', { name: '页面亮度', exact: true }).inputValue(), '0.5');
      const unexpected = errors.filter(error => error !== 'ResizeObserver loop completed with undelivered notifications.' && !error.includes('/api/v1/sync due to access control checks.'));
      assert.deepEqual(unexpected, []);
      console.log(engine, 'brightness, scrolling, paging, images and saved minimum passed');
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(`Passed ${reports.length} pixel brightness checks`);
} finally { server.server.closeAllConnections(); await server.close(); }
