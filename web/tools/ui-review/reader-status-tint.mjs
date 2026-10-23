import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const output = '/tmp/reader-ios-status-review';
const server = createReviewServer({ port: 0 });
const origin = await server.listen();
const reports = [];
const transitions = [];

async function toggleChrome(page, width, state, record) {
  if (record) await page.evaluate(() => {
    window.tintFrames = new Promise(resolve => {
      const frames = [], start = performance.now();
      const sample = () => {
        const root = document.documentElement, header = getComputedStyle(document.querySelector('.topbar'));
        frames.push({ state: root.dataset.readerChrome, visibility: header.visibility, opacity: header.opacity,
          root: getComputedStyle(root).backgroundColor, body: getComputedStyle(document.body).backgroundColor });
        if (performance.now() - start < 250) requestAnimationFrame(sample);
        else resolve(frames);
      };
      requestAnimationFrame(sample);
    });
  });
  await page.mouse.click(width / 2, 422);
  await page.waitForFunction(state => document.documentElement.dataset.readerChrome === state, state);
  if (!record) return;
  const frames = (await page.evaluate(() => window.tintFrames)).filter(frame => frame.state === state);
  assert.ok(frames.length > 0);
  for (const frame of frames) {
    assert.equal(frame.visibility, state, 'header visibility changes on the first frame of the new tint');
    assert.equal(frame.opacity, state === 'visible' ? '1' : '0', 'no intermediate header paint after the tint changes');
    assert.equal(frame.root, frame.body);
  }
  transitions.push({ width, state, frames });
}
await mkdir(output, { recursive: true });
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
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
        await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.remove());
        if (width === 390) await page.addStyleTag({ content: ':root { --safe-top: 47px; --safe-bottom: 34px; }' });
        for (const theme of ['green', 'dark', 'kraft-day', 'parchment-day']) {
          await page.evaluate(async theme => { await window.readerApp.updateSettings({ theme, brightness: 1 }); }, theme);
          await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
          await page.locator('book-content .book-flow p').first().waitFor();
          for (const brightness of [1, 0.75, 0.5]) {
            await page.getByRole('button', { name: '外观', exact: true }).click();
            await page.getByRole('slider', { name: '页面亮度', exact: true }).evaluate((slider, value) => {
              slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true }));
            }, brightness);
            await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
            for (const state of ['visible', 'hidden']) {
              if (state === 'hidden') await toggleChrome(page, width, state, theme === 'green' && brightness === 1);
              await page.waitForFunction(state => document.documentElement.dataset.readerChrome === state && document.querySelector('.reader-screen')?.dataset.chrome === state, state);
              const tint = await page.evaluate(({ brightness, state }) => {
                const root = document.documentElement, style = getComputedStyle(root);
                const source = style.getPropertyValue(state === 'visible' ? '--reader-surface' : '--reader-paper').trim();
                const expected = '#' + source.slice(1).match(/../g).map(channel => Math.round(parseInt(channel, 16) * brightness).toString(16).padStart(2, '0')).join('');
                const header = getComputedStyle(document.querySelector('.topbar'));
                return { expected, actual: style.getPropertyValue('--reader-browser-paper').trim(),
                  body: getComputedStyle(document.body).backgroundColor, bodyTexture: getComputedStyle(document.body).backgroundImage,
                  root: style.backgroundColor, header: header.backgroundColor, position: header.position,
                  blur: header.backdropFilter, webkitBlur: header.webkitBackdropFilter,
                  top: document.querySelector('.topbar').getBoundingClientRect().top };
              }, { brightness, state });
              assert.equal(tint.actual, tint.expected, `${name} ${width} ${theme} ${brightness} ${state}`);
              const rgb = 'rgb(' + tint.expected.slice(1).match(/../g).map(channel => parseInt(channel, 16)).join(', ') + ')';
              assert.equal(tint.body, rgb, 'Safari document fallback matches the requested color without theme-color');
              assert.equal(tint.root, rgb);
              assert.equal(tint.bodyTexture, 'none');
              assert.equal(tint.position, 'fixed');
              assert.ok(!tint.blur || tint.blur === 'none');
              assert.ok(!tint.webkitBlur || tint.webkitBlur === 'none');
              if (state === 'visible') assert.ok(Math.abs(tint.top) < 1, 'the solid header touches the viewport edge');
              let pixelDelta = null;
              if (state === 'visible') {
                const screenshot = (await page.screenshot({ animations: 'disabled' })).toString('base64');
                const pixel = await page.evaluate(async screenshot => {
                  const image = new Image(); image.src = 'data:image/png;base64,' + screenshot; await image.decode();
                  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
                  const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
                  const bar = document.querySelector('.topbar').getBoundingClientRect();
                  return [...context.getImageData(Math.round(bar.left + 3), Math.round(bar.top + 3), 1, 1).data].slice(0, 3);
                }, screenshot);
                const expected = tint.actual.slice(1).match(/../g).map(channel => parseInt(channel, 16));
                pixelDelta = Math.max(...pixel.map((channel, i) => Math.abs(channel - expected[i])));
                // WebKit's 8-bit alpha compositing may round channels by two levels.
                assert.ok(pixelDelta <= 2, JSON.stringify({ name, width, theme, brightness, state, tint, pixel, expected }));
              }
              if (theme === 'green' && brightness === 1) await page.screenshot({ path: `${output}/${name}-${width}-${state}.png` });
              reports.push({ browser: name, width, theme, brightness, state, color: tint.actual, bodyColor: tint.body, metaRemoved: true, simulatedSafeArea: width === 390, pixelDelta, passed: true });
            }
            await toggleChrome(page, width, 'visible', theme === 'green' && brightness === 1);
          }
          await page.evaluate(() => { location.hash = '#/shelf'; });
          await page.locator('.app-shell').waitFor();
          await page.waitForFunction(() => document.documentElement.dataset.readerChrome === undefined);
          assert.equal(await page.evaluate(() => document.documentElement.dataset.readerChrome), undefined);
        }
        assert.deepEqual(errors, []);
        console.log(`${name} ${width}: all themes, brightness levels and control states passed`);
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  await writeFile(`${output}/transitions.json`, JSON.stringify(transitions, null, 2) + '\n');
  console.log(`Passed ${reports.length} browser theme-color checks, including rendered-header pixels.`);
} finally { server.server.closeAllConnections(); await server.close(); }
