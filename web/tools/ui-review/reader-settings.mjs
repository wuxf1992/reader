import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';
const output = new URL('../../../artifacts/ui-review/reader-settings/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 }), origin = await server.listen(), cases = [];
const close = async page => { await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' }); };
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch({ headless: true });
    try {
      for (const [width, height] of [[320, 640], [390, 844], [1440, 768]]) {
        const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block', hasTouch: width < 701 });
        page.setDefaultTimeout(10000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.goto(origin + '/#/shelf'); await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin); await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12'); await page.locator('button[type=submit]').click();
        await page.locator('.app-shell').waitFor();
        await page.evaluate(() => window.readerApp.updateSettings({ mode: 'paged', fontScale: 1, brightness: 1 }));
        await page.evaluate(id => { location.hash = '#/book/' + id; }, BOOK_ID);
        await page.locator('book-content .book-flow p').first().waitFor();
        await page.locator('.stage').click({ position: { x: width / 2, y: height / 3 } });
        await page.getByRole('button', { name: '设置', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '阅读设置', exact: true }); await dialog.waitFor();
        await dialog.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
        assert.equal(await page.locator('.reader-rail').count(), 0);
        assert.deepEqual(await page.locator('.reader-actions .top-button-label').allTextContents(), ['目录', '夜间', '朗读', '设置']);
        const quick = await dialog.locator('.reader-font-size, .reader-quick-themes, .reader-settings-links').evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })));
        await page.screenshot({ path: output + `${engine}-${width}-initial.png` });
        assert.ok(quick.every(box => box.top >= 0 && box.bottom <= height), 'size and favorite colors are visible immediately: ' + JSON.stringify({engine,width,height,quick}));
        assert.equal(await dialog.getByRole('button', { name: '增大字号', exact: true }).isDisabled(), false);
        await dialog.getByRole('button', { name: '增大字号', exact: true }).click();
        await page.waitForFunction(() => window.readerApp.settings.current.fontScale === 1.05);
        await dialog.getByRole('button', { name: '减小字号', exact: true }).click();
        await page.waitForFunction(() => window.readerApp.settings.current.fontScale === 1);
        const brightness = dialog.getByRole('slider', { name: '页面亮度', exact: true });
        await brightness.evaluate(input => { input.value = '.75'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForFunction(() => window.readerApp.settings.current.brightness === .75);
        await dialog.getByRole('button', { name: '配色：牛皮纸', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.reader-screen')?.dataset.readingTheme === 'local-kraft-day');
        await page.screenshot({ path: output + `${engine}-${width}-quick.png` });
        await dialog.getByRole('button', { name: '字体与间距', exact: true }).click();
        await page.getByRole('combobox', { name: '字体', exact: true }).selectOption('system-ui, -apple-system, "Noto Sans SC", sans-serif');
        await page.getByRole('button', { name: '返回阅读设置', exact: true }).click();
        await page.getByRole('button', { name: /^翻页与点击/ }).click();
        assert.equal(await page.locator('.tap-zones-grid .tap-zone-cell').count(), 9);
        await page.screenshot({ path: output + `${engine}-${width}-paging.png` });
        await page.getByRole('button', { name: '返回阅读设置', exact: true }).click();
        await page.getByRole('button', { name: /^显示设置/ }).click();
        await page.getByRole('combobox', { name: '底部右侧', exact: true }).selectOption('progress');
        await close(page);
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByRole('button', { name: '更多配色', exact: true }).click();
        assert.equal(await page.locator('.theme-swatch').count(), 30);
        await close(page);
        if (width < 701) {
          await page.getByRole('button', { name: '设置', exact: true }).click();
          const sheet = page.getByRole('dialog', { name: '阅读设置', exact: true });
          await sheet.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
          const cdp = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
          const pull = async distance => {
            const box = await sheet.locator('h2').boundingBox(), x = box.x + 20, y = box.y + box.height / 2;
            if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x,y}] });
            else { await page.mouse.move(x,y); await page.mouse.down(); }
            for (let step = 1; step <= 5; step++) {
              const next = y + distance * step / 5;
              if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{x,y:next}] });
              else await page.mouse.move(x,next);
              await page.waitForTimeout(20);
            }
            if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            else await page.mouse.up();
          };
          await pull(20); assert.equal(await sheet.count(),1, 'a short pull stays open');
          await pull(160); await sheet.waitFor({state:'detached'});
          if (cdp) await cdp.detach();
        }
        await page.reload();
        await page.locator('book-content .book-flow p').first().waitFor();
        const saved = await page.evaluate(() => window.readerApp.settings.current);
        assert.equal(saved.fontScale, 1); assert.equal(saved.brightness, .75); assert.equal(saved.readoutBottomRight, 'progress');
        assert.equal(saved.fontFamily, 'system-ui, -apple-system, "Noto Sans SC", sans-serif');
        assert.equal(await page.locator('.reader-screen').getAttribute('data-reading-theme'), 'local-kraft-day');
        assert.equal(await page.locator('html').evaluate(el => el.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        cases.push({ engine, width, height, quickControlsVisible: true, settingsAppliedAndPersisted: true, themes: 30 });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile(output + 'report.json', JSON.stringify(cases, null, 2));
  console.log(JSON.stringify(cases));
} finally { await server.close(); }
