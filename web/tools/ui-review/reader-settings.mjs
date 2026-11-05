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
      for (const [width, height, standalone = false] of [[390, 844, true], [320, 640, true], [320, 640], [390, 844], [768, 1024], [1440, 768]]) {
        const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block', hasTouch: width < 701 });
        page.setDefaultTimeout(10000);
        if (standalone) await page.addInitScript(() => {
          const match = window.matchMedia.bind(window);
          window.matchMedia = query => {
            const result = match(query);
            if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true });
            return result;
          };
          addEventListener('DOMContentLoaded', () => {
            document.documentElement.style.setProperty('--safe-top', '47px');
            document.documentElement.style.setProperty('--safe-bottom', '34px');
          });
        });
        const shot = `${engine}-${width}${standalone ? '-pwa' : ''}`;
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.goto(origin + '/#/shelf'); await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin); await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12'); await page.locator('button[type=submit]').click();
        await page.locator('.app-shell').waitFor();
        await page.route('**/api/v1/library/continue?*', route => route.fulfill({ json: { items: [
          { id: BOOK_ID, title: '当前阅读', format: 'chapters', lastReadAt: 2, percentage: .4 },
          { id: 'older-reading', title: '上一本书', format: 'epub', lastReadAt: 1, percentage: .2 },
        ] } }));
        await page.evaluate(() => { location.hash = '#/'; });
        await page.locator('.home-resume[data-channel=read]').waitFor();
        assert.equal(await page.locator('.home-resume[data-channel=read]').count(), 1, 'home has only the latest reading card');
        assert.match(await page.locator('.home-resume[data-channel=read]').innerText(), /当前阅读/);
        await page.screenshot({ path: output + `${shot}-home.png` });
        await page.evaluate(() => window.readerApp.updateSettings({ mode: 'paged', fontScale: 1, brightness: 1 }));
        await page.evaluate(id => { location.hash = '#/book/' + id; }, BOOK_ID);
        await page.locator('book-content .book-flow p').first().waitFor();
        await page.locator('.stage').click({ position: { x: width / 2, y: height / 3 } });
        const spacing = await page.locator('.reader-actions').evaluate(row => {
          const rect = row.getBoundingClientRect(), buttons = [...row.children].map(button => button.getBoundingClientRect());
          return { width: rect.width, slots: buttons.map(button => ({ left: button.left - rect.left, right: button.right - rect.left, width: button.width })) };
        });
        assert.equal(spacing.slots.length, 4);
        assert.ok(spacing.slots.every(slot => Math.abs(slot.width - spacing.slots[0].width) < 1), 'footer buttons share available width');
        assert.ok(Math.abs(spacing.slots.at(-1).right - spacing.width) < 2, 'footer fills its last slot');
        await page.getByRole('button', { name: '设置', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '阅读设置', exact: true }); await dialog.waitFor();
        await dialog.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
        assert.equal(await page.locator('.reader-rail').count(), 0);
        const geometry = await page.evaluate(() => {
          const footer = document.querySelector('.reader-screen .footer'), style = getComputedStyle(footer);
          const progress = footer.querySelector('.progress-row').getBoundingClientRect(), actions = footer.querySelector('.reader-actions').getBoundingClientRect();
          const body = document.querySelector('.reader-settings .sheet-body'), last = body.lastElementChild.getBoundingClientRect();
          return { host: document.querySelector('.reader-settings').dataset.host ?? 'browser',
            unusedFooter: footer.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - progress.height - actions.height,
            paddingBottom: parseFloat(style.paddingBottom),
            indicatorGap: footer.getBoundingClientRect().top - document.querySelector('.reading-indicator-bottom').getBoundingClientRect().bottom,
            unusedBody: body.getBoundingClientRect().bottom - last.bottom - parseFloat(getComputedStyle(body).paddingBottom),
          };
        });
        console.log(JSON.stringify({ engine, width, height, standalone, geometry }));
        await page.screenshot({ path: output + `${shot}-geometry.png` });
        assert.ok(width > 1000 || Math.abs(geometry.unusedFooter) < 2, 'footer fits its actual rows without a blank fixed-height region');
        assert.ok(Math.abs(geometry.indicatorGap) < 2 || width > 1000, 'page status follows the actual footer height');
        assert.ok(width > 1000 || Math.abs(geometry.paddingBottom - (standalone ? 34 : 6.4)) < 1, 'safe area replaces ordinary bottom padding instead of adding to it');
        assert.ok(width > 700 || geometry.unusedBody < 2, 'short settings content does not stretch to fill the screen');
        assert.equal(geometry.host, standalone ? 'pwa' : 'browser');
        assert.deepEqual(await page.locator('.reader-actions .top-button-label').allTextContents(), ['目录', '朗读', '夜间', '设置']);
        const checkSettings = async name => {
          const layout = await page.getByRole('dialog').locator('.sheet-body').evaluate(body => {
            const bounds = body.getBoundingClientRect();
            return { overflow: body.scrollWidth > body.clientWidth + 1,
              controls: [...body.querySelectorAll('select, input[type=range], .segmented button, .switch')].map(control => {
                const rect = control.getBoundingClientRect();
                return { inside: rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, height: rect.height, segmented: control.closest('.segmented') !== null };
              }),
              switchAligned: [...body.querySelectorAll('.switch-field')].every(row => {
                const button = row.querySelector('.switch').getBoundingClientRect();
                return Math.abs(row.getBoundingClientRect().right - button.right) < 2;
              }),
            };
          });
          assert.equal(layout.overflow, false, name + ' has no horizontal overflow');
          assert.ok(layout.controls.every(control => control.inside && (!control.segmented || control.height >= 44)), name + ' controls fit and have usable targets');
          assert.ok(layout.switchAligned, name + ' switches align at the right');
          await page.screenshot({ path: output + `${shot}-${name}.png` });
        };
        const quick = await dialog.locator('.reader-font-size, .reader-quick-themes, .reader-settings-links').evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })));
        await page.screenshot({ path: output + `${shot}-initial.png` });
        assert.ok(quick.every(box => box.top >= 0 && box.bottom <= height), 'size and favorite colors are visible immediately: ' + JSON.stringify({engine,width,height,quick}));
        assert.equal(await dialog.getByRole('button', { name: '增大字号', exact: true }).isDisabled(), false);
        await dialog.getByRole('button', { name: '增大字号', exact: true }).click();
        await page.waitForFunction(() => window.readerApp.settings.current.fontScale === 1.05);
        assert.equal(await dialog.getByLabel('当前字号', { exact: true }).textContent(), '21');
        await dialog.getByRole('button', { name: '减小字号', exact: true }).click();
        await page.waitForFunction(() => window.readerApp.settings.current.fontScale === 1);
        const brightness = dialog.getByRole('slider', { name: '页面亮度', exact: true });
        await brightness.evaluate(input => { input.value = '.75'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForFunction(() => window.readerApp.settings.current.brightness === .75);
        await dialog.getByRole('button', { name: '配色：牛皮纸', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.reader-screen')?.dataset.readingTheme === 'local-kraft-day');
        await page.screenshot({ path: output + `${shot}-quick.png` });
        await checkSettings('quick-layout');
        await dialog.getByRole('button', { name: '字体与间距', exact: true }).click();
        await checkSettings('text-layout');
        await page.getByRole('combobox', { name: '字体', exact: true }).selectOption('system-ui, -apple-system, "Noto Sans SC", sans-serif');
        await page.getByRole('button', { name: '返回阅读设置', exact: true }).click();
        await page.getByRole('button', { name: /^翻页与点击/ }).click();
        assert.equal(await page.locator('.tap-zones-grid .tap-zone-cell').count(), 9);
        await checkSettings('paging-layout');
        await page.screenshot({ path: output + `${shot}-paging.png` });
        await page.getByRole('button', { name: '返回阅读设置', exact: true }).click();
        await page.getByRole('button', { name: /^显示设置/ }).click();
        await page.getByRole('combobox', { name: '底部右侧', exact: true }).selectOption('progress');
        await checkSettings('display-layout');
        await page.getByRole('button', { name: '返回阅读设置', exact: true }).click();
        await page.getByRole('button', { name: /^朗读设置/ }).click();
        await checkSettings('speech-layout');
        await close(page);
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByRole('button', { name: '更多配色', exact: true }).click();
        assert.equal(await page.locator('.theme-swatch').count(), 30);
        await close(page);
        if (standalone) {
          const initial = await page.locator('.reader-screen .footer').evaluate(el => el.getBoundingClientRect().height);
          await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '50px'));
          try { await page.waitForFunction(() => Math.abs(document.querySelector('.footer').getBoundingClientRect().top - document.querySelector('.reading-indicator-bottom').getBoundingClientRect().bottom) < 2); }
          catch (error) { console.log('safe-area diagnostics', await page.evaluate(() => {
            const footer = document.querySelector('.footer'), indicator = document.querySelector('.reading-indicator-bottom'), screen = document.querySelector('.reader-screen');
            return { chrome: screen.dataset.chrome, rootChrome: document.documentElement.dataset.readerChrome, hidden: footer.hidden, footerTop: footer.getBoundingClientRect().top, footerHeight: footer.getBoundingClientRect().height, indicatorBottom: indicator.getBoundingClientRect().bottom, variable: getComputedStyle(screen).getPropertyValue('--reader-footer-height'), safe: getComputedStyle(footer).getPropertyValue('--safe-bottom'), padding: getComputedStyle(footer).paddingBottom, observer: typeof ResizeObserver };
          })); throw error; }
          const expanded = await page.locator('.reader-screen .footer').evaluate(el => el.getBoundingClientRect().height);
          assert.ok(Math.abs(expanded - initial - 16) < 1, 'changing the safe area adds its height once');
          await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px'));
          await page.waitForFunction(() => Math.abs(document.querySelector('.footer').getBoundingClientRect().top - document.querySelector('.reading-indicator-bottom').getBoundingClientRect().bottom) < 2);
        }
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
        cases.push({ engine, width, height, standalone, geometry, oneReadingCard: true, equalFooterSlots: true, allSettingsFit: true, quickControlsVisible: true, settingsAppliedAndPersisted: true, themes: 30 });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile(output + 'report.json', JSON.stringify(cases, null, 2));
  console.log(JSON.stringify(cases));
} finally { await server.close(); }
