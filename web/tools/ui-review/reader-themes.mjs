import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { PALETTES } from '../../src/render/theme.ts';
import { createReviewServer, BOOK_ID } from './server.mjs';

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
      let reloading = false;
      page.on('pageerror', error => {
        if (reloading && error.message.includes('/api/v1/sync due to access control checks.')) return;
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
      const remembered = { light: 'light', dark: 'dark' };
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
        for (const [id, palette] of Object.entries(PALETTES)) {
          await page.getByRole('button', { name: '界面', exact: true }).click();
          const panel = page.locator('.panel');
          await panel.evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
          if (id === 'light') {
            assert.ok(await page.locator('.panel-body .section-title').evaluateAll(headings => headings.every(heading => getComputedStyle(heading).position === 'static')));
            assert.ok(await page.locator('.panel-body').evaluate(async body => {
              const title = body.querySelector('.section-title');
              body.scrollTop = 0;
              const top = title.getBoundingClientRect().top;
              body.scrollTop = 100;
              await new Promise(requestAnimationFrame);
              const fits = Math.abs(top - title.getBoundingClientRect().top - body.scrollTop) < 1;
              body.scrollTop = 0;
              return fits;
            }), 'headings scroll with panel content');
          }
          await page.getByRole('button', { name: palette.scheme === 'dark' ? '夜间模式' : '日间模式', exact: true }).click();
          const group = page.getByRole('group', { name: palette.scheme === 'dark' ? '夜间主题' : '日间主题', exact: true });
          const option = group.getByRole('button', { name: palette.label, exact: true });
          await option.click();
          remembered[palette.scheme] = id;
          await page.waitForFunction(id => document.documentElement.dataset.theme === id, id);
          assert.equal(await option.getAttribute('aria-pressed'), 'true');
          assert.equal(await group.locator('[aria-pressed=true]').count(), 1);
          const colors = await page.evaluate(() => {
            const css = getComputedStyle(document.documentElement);
            const panel = document.querySelector('.panel');
            return { paper: css.getPropertyValue('--reader-paper').trim(), surface: css.getPropertyValue('--reader-surface').trim(), accent: css.getPropertyValue('--reader-accent').trim(), scheme: css.colorScheme,
              meta: document.querySelector('meta[name="theme-color"]').content, mantineBody: css.getPropertyValue('--mantine-color-body').trim(),
              pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
              panelOverflow: panel.scrollWidth > panel.clientWidth + 1 };
          });
          assert.deepEqual(colors, { paper: palette.background, surface: palette.surface, accent: palette.accent, scheme: palette.scheme, meta: palette.background, mantineBody: palette.background, pageOverflow: false, panelOverflow: false });
          const modeStyle = await page.locator('.theme-modes [aria-pressed=true]').evaluate(button => {
            const css = getComputedStyle(button);
            return { background: css.backgroundColor, color: css.color, checked: button.querySelectorAll('.icon').length };
          });
          const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(channel => parseInt(channel, 16)).join(', ')})`;
          assert.deepEqual(modeStyle, { background: rgb(palette.surface), color: rgb(palette.text), checked: 2 });
          const texture = await page.evaluate(() => ({
            page: getComputedStyle(document.querySelector('.stage')).backgroundImage,
            paper: getComputedStyle(document.querySelector('.stage'), '::before').backgroundImage,
            header: getComputedStyle(document.querySelector('.topbar')).backgroundImage,
            bars: [...document.querySelectorAll('.footer, .reading-indicator')].map(node => getComputedStyle(node).backgroundImage),
            option: getComputedStyle(document.querySelector('.theme-option[aria-pressed=true]')).backgroundImage,
            texturedOptions: [...document.querySelectorAll('.theme-option')].filter(option => getComputedStyle(option).backgroundImage !== 'none').map(option => option.dataset.themeOption),
          }));
          assert.deepEqual(texture.texturedOptions, palette.scheme === 'light' ? ['parchment-day', 'kraft-day'] : []);
          if (id === 'kraft-day' || id === 'parchment-day') {
            assert.ok(texture.page.includes(id === 'kraft-day' ? 'kraft-paper.webp' : 'parchment-paper.webp'));
            assert.equal(texture.option, texture.page);
            assert.equal(texture.paper, texture.page);
            assert.equal(texture.header, 'none', 'the solid header matches the iOS status bar');
            assert.ok(texture.bars.every(image => image === texture.page), 'footer and immersive readouts share the paper texture');
            const material = await page.evaluate(async ({ image, foregrounds }) => {
              const img = new Image(); img.src = image.match(/url\(["']?(.*?)["']?\)/)[1]; await img.decode();
              const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
              const context = canvas.getContext('2d'); context.drawImage(img, 0, 0, 64, 64);
              const data = context.getImageData(0, 0, 64, 64).data;
              const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
              const inks = foregrounds.map(hex => luminance(hex.slice(1).match(/../g).map(channel => parseInt(channel, 16))));
              let minimum = Infinity, maximum = 0, contrast = Infinity;
              for (let i = 0; i < data.length; i += 4) {
                const light = luminance([data[i], data[i + 1], data[i + 2]]);
                minimum = Math.min(minimum, light); maximum = Math.max(maximum, light);
                for (const ink of inks) contrast = Math.min(contrast, (Math.max(light, ink) + .05) / (Math.min(light, ink) + .05));
              }
              return { variation: maximum - minimum, contrast };
            }, { image: texture.page, foregrounds: [palette.text, palette.muted] });
            assert.ok(material.variation > .02, 'paper has real grain instead of a flat fill');
            assert.ok(material.contrast >= 4.5, `text remains readable on paper grain: ${material.contrast}`);
            const brightness = page.getByRole('slider', { name: '页面亮度', exact: true });
            await brightness.focus(); await page.keyboard.press('Home');
            assert.equal(await page.locator('.reader-screen').evaluate(screen => getComputedStyle(screen, '::after').opacity), '0.5');
            const dimmed = '#' + palette.background.slice(1).match(/../g).map(channel => Math.round(parseInt(channel, 16) * .5).toString(16).padStart(2, '0')).join('');
            assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), dimmed);
            assert.equal(await page.locator('html').evaluate(node => getComputedStyle(node).backgroundColor), rgb(dimmed));
            await page.keyboard.press('End');
          } else assert.equal(texture.page, 'none');
          assert.ok(await group.locator('button').evaluateAll(buttons => buttons.every(button => {
            const r = button.getBoundingClientRect();
            return r.width >= 44 && r.height >= 44 && button.scrollWidth <= button.clientWidth + 1;
          })), `${width}: theme names fit and controls remain touchable`);
          if (width !== 320 && (width === 390 || id === 'kraft-day' || id === 'parchment-day' || id === 'wechat-night' || id === 'rose-pine-dawn-day' || id === 'nord-night')) {
            await page.locator('.global-notice .notyf__dismiss-btn').evaluateAll(buttons => buttons.forEach(button => button.click()));
            await page.locator('.panel-body').evaluate(body => { body.scrollTop = 0; });
            await page.screenshot({ path: `${output}/${engineName}-${width}-${id}.png` });
          }
          await page.evaluate(async () => { await window.__readerFlush?.(); });
          reloading = true;
          await page.reload();
          await page.locator('.book-host').waitFor();
          reloading = false;
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), id);
          if (['kraft-day', 'parchment-day', 'wechat-night'].includes(id) && width !== 320) {
            await page.locator('.global-notice .notyf__dismiss-btn').evaluateAll(buttons => buttons.forEach(button => button.click()));
            await page.screenshot({ path: `${output}/${engineName}-${width}-${id}-reading.png`, animations: 'disabled' });
          }
          const rail = page.locator('.reader-rail .rail-button');
          assert.deepEqual(await rail.evaluate(button => { const css = getComputedStyle(button); return { border: css.borderTopWidth, background: css.backgroundColor, shadow: css.boxShadow, width: button.getBoundingClientRect().width }; }), { border: '0px', background: 'rgba(0, 0, 0, 0)', shadow: 'none', width: 48 });
          assert.equal(await rail.getAttribute('aria-label'), palette.scheme === 'dark' ? '日间' : '夜间');
          await rail.click();
          const opposite = remembered[palette.scheme === 'dark' ? 'light' : 'dark'];
          await page.waitForFunction(id => document.documentElement.dataset.theme === id, opposite);
          await rail.click();
          await page.waitForFunction(id => document.documentElement.dataset.theme === id, id);
          reports.push({ engine: engineName, width, theme: id, restored: true, rememberedToggle: true, colors });
        }
        console.log(engineName, width, 'passed');
      }
      await page.evaluate(() => { location.hash = '#/shelf'; });
      await page.getByRole('button', { name: /^书架设置/ }).click();
      await page.getByRole('button', { name: '日间模式', exact: true }).click();
      await page.getByRole('button', { name: '玫瑰晨光', exact: true }).click();
      await page.getByRole('button', { name: '夜间模式', exact: true }).click();
      await page.getByRole('button', { name: '北境极夜', exact: true }).click();
      await page.getByRole('button', { name: '日间模式', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'rose-pine-dawn-day');
      const mode = page.getByRole('button', { name: '夜间模式', exact: true });
      await mode.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'nord-night');
      assert.equal(await page.locator('html').getAttribute('data-mantine-color-scheme'), 'dark');
      await page.screenshot({ path: `${output}/${engineName}-settings.png` });
      const resizeWarnings = errors.filter(error => error === 'ResizeObserver loop completed with undelivered notifications.');
      assert.ok(resizeWarnings.length <= 1);
      assert.deepEqual(errors.filter(error => !resizeWarnings.includes(error)), []);
      // Hold the bundle to inspect the real startup screen before React mounts.
      await page.route('**/assets/client.js*', route => route.abort());
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await page.locator('#app-startup').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(46, 52, 64)');
      assert.equal(await page.locator('html').evaluate(node => getComputedStyle(node).colorScheme), 'dark');
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(`Passed ${reports.length} theme checks; screenshots: ${output}`);
} finally { await server.close(); }
