import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit, devices } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const output = '/tmp/reader-mobile-dialog-review';
const server = createReviewServer({ port: 5204 });
const origin = await server.listen();
const reports = [], issues = [];
await mkdir(output, { recursive: true });
try {
  for (const [name, engine, device] of [['chromium', chromium, devices['Pixel 7']], ['webkit', webkit, devices['iPhone 13']]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ ...device, serviceWorkers: 'block' });
      page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const button = text => page.getByRole('button', { name: text, exact: true });
      await page.route('https://wuxf.top/**', route => route.abort());
      await page.route('**/api/v1/admin/users', route => route.fulfill({ json: { users: [{ id: 'u1', username: 'review', displayName: '评测', role: 'admin', createdAt: 0, disabled: false }] } }));
      await page.route('**/api/v1/admin/registration', route => route.fulfill({ json: { mode: 'closed', invites: [] } }));
      await page.route('**/api/v1/opds/credentials', route => route.fulfill({ json: { credentials: [], catalogUrl: origin + '/opds' } }));
      const type = { pluginId: 'reader.opds', id: 'opds', label: '测试书源', version: '1', capabilities: ['browse', 'search'], credentialKeys: [{ key: 'password', label: '站点密码' }], configSchema: { properties: Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['field' + i, { type: 'string', title: '连接配置项 ' + (i + 1) }])) } };
      const sources = Array.from({ length: 20 }, (_, i) => ({ id: 'source-' + i, name: '测试书源 ' + (i + 1), pluginId: type.pluginId, sourceType: type.id, enabled: true, descriptor: type, config: {} }));
      await page.route('**/api/v1/sources/types', route => route.fulfill({ json: { types: [type] } }));
      await page.route('**/api/v1/sources', route => route.fulfill({ json: { sources } }));
      await page.route('**/api/v1/sources/*/credentials', route => route.fulfill({ json: { state: 'unknown', checkedAt: null, available: true, fields: [{ key: 'password', configured: false }] } }));
      await page.route('**/api/v1/sources/*/browse*', route => route.fulfill({ json: { items: [] } }));
      await page.route('**/api/v1/sources/*/search-filters', route => route.fulfill({ json: [] }));
      await page.route('**/api/v1/plugins', route => route.fulfill({ json: { plugins: [] } }));
      await page.route('**/api/v1/subscriptions', route => route.fulfill({ json: { subscriptions: [] } }));
      await page.goto(origin);
      await page.getByText('更换服务地址', { exact: true }).click();
      await page.locator('input[type=url]').fill(origin);
      await page.locator('input[autocomplete=username]').fill('review');
      await page.locator('input[type=password]').fill('password12');
      await page.locator('button[type=submit]').click();
      await page.locator('.app-shell').waitFor();

      async function check(label, panel, close, scroller) {
        await panel.waitFor();
        for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
          await page.setViewportSize({ width, height });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await panel.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); });
          const geometry = await panel.evaluate(el => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, overflow: el.scrollWidth > el.clientWidth + 1 };
          });
          const problems = [];
          if (geometry.left < -1 || geometry.right > geometry.width + 1) problems.push('horizontal overflow');
          if (geometry.top < -1 || geometry.bottom > geometry.height + 1) problems.push('vertical overflow');
          if (geometry.overflow) problems.push('content overflow');
          if (close) {
            const visible = await close.evaluate(el => {
              const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return r.top >= 0 && r.bottom <= innerHeight + 1 && el.contains(hit);
            });
            if (!visible) problems.push('close button clipped or covered');
          }
          if (scroller) {
            const scrollable = await scroller.evaluate(el => {
              el.scrollTop = el.scrollHeight;
              return el.scrollHeight <= el.clientHeight + 1 || el.scrollTop > 0;
            });
            if (!scrollable) problems.push('long content cannot scroll');
            await scroller.evaluate(el => { el.scrollTop = 0; });
          }
          const result = { engine: name, label, width, height, geometry, problems };
          reports.push(result);
          if (problems.length) { issues.push(`${name} ${label} ${width}x${height}: ${problems.join(', ')}`); await page.screenshot({ path: `${output}/${name}-${label}-${width}-failure.png` }); }
        }
        await page.setViewportSize({ width: 390, height: 844 });
      }
      const modal = title => page.getByRole('dialog', { name: title, exact: true });
      async function checkModal(label, title, scroller = '.sheet-body') {
        const panel = modal(title);
        await check(label, panel, panel.getByRole('button', { name: '关闭', exact: true }), panel.locator(scroller));
        await panel.getByRole('button', { name: '关闭', exact: true }).click();
      }
      await page.getByRole('button', { name: /^书架设置/ }).click();
      const shelf = modal('书架设置');
      await check('shelf-settings', shelf, shelf.getByRole('button', { name: '关闭', exact: true }), shelf.locator('.sheet-body'));
      await button('连接外部阅读器').click();
      await checkModal('opds', '连接外部阅读器');
      await modal('书架设置').getByRole('button', { name: '关闭', exact: true }).click();
      await button('系统设置').click();
      await button('新增用户').click();
      await checkModal('system-settings', '系统设置');

      await page.locator('.book-more').first().click();
      const pick = page.locator('.dialog.sheet');
      await check('book-actions', pick, pick.getByRole('button', { name: '取消', exact: true }), pick.locator('.dialog-list'));
      await pick.getByRole('button', { name: '从书架拿掉', exact: true }).click();
      const confirm = page.locator('.swal2-popup');
      await check('confirmation', confirm, button('取消'), null);
      await button('取消').click();

      await page.evaluate(() => { location.hash = '#/library/files'; });
      await button('新建文件夹').click();
      const prompt = page.locator('.dialog-overlay .dialog');
      await check('folder-name', prompt, prompt.getByRole('button', { name: '取消', exact: true }), null);
      await prompt.getByRole('button', { name: '取消', exact: true }).click();
      await page.locator('.manager-more').first().click();
      await button('改资料').click();
      const metadata = page.locator('.dialog:has(.dialog-fields)');
      await check('metadata', metadata, metadata.getByRole('button', { name: '取消', exact: true }), metadata.locator('.dialog-fields'));
      await metadata.getByRole('button', { name: '取消', exact: true }).click();

      await page.evaluate(() => { location.hash = '#/sources'; });
      await page.getByRole('tab', { name: '书源管理', exact: true }).click();
      await button('添加来源').click();
      await checkModal('source-editor', '添加来源');
      await button('书源登录').first().click();
      await checkModal('source-login', '测试书源 1 · 书源登录');
      await page.getByRole('tab', { name: '搜书', exact: true }).click();
      await page.locator('select[aria-label="选择来源"]').selectOption('source-0');
      await button('选择来源').click();
      await check('source-picker', page.getByRole('listbox', { name: '选择来源', exact: true }), null, page.locator('.source-picker .searchable-select-options'));
      await page.getByRole('listbox', { name: '选择来源', exact: true }).getByRole('option', { name: '测试书源 1', exact: true }).click();

      await page.evaluate(id => { location.hash = '#/book/' + id; }, BOOK_ID);
      await button('书籍信息').click();
      await checkModal('book-info', '书籍信息');
      for (const [trigger, title] of [['设置', '阅读设置'], ['界面', '界面'], ['朗读', '朗读']]) {
        await button(trigger).click();
        const panel = page.getByRole('group', { name: title, exact: true });
        await check('reader-' + trigger, panel, panel.getByRole('button', { name: '关闭', exact: true }), panel.locator('.sheet-body'));
        await panel.getByRole('button', { name: '关闭', exact: true }).click();
      }
      await button('工具').click();
      await button('笔记').click();
      await checkModal('reading-tools', '阅读工具', '.reading-tool-panel');
      // ponytail: WebKit does not expose programmatic shadow-text selection here; check on a real iPhone.
      if (name === 'chromium') {
      await page.locator('book-content').evaluate(host => {
        const node = host.shadowRoot.querySelector('p').firstChild;
        const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, Math.min(8, node.length));
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      });
      const toolbar = page.getByRole('toolbar', { name: '选中文字操作', exact: true });
      await check('selection-toolbar', toolbar, toolbar.getByRole('button', { name: '关闭选区工具', exact: true }), null);
      await toolbar.getByRole('button', { name: '批注', exact: true }).click();
      await checkModal('annotation-editor', '添加批注');
      }
      // ponytail: rapid viewport changes can emit WebKit reflow warnings; unexpected errors still fail.
      const resizeWarnings = errors.filter(error => error === 'ResizeObserver loop completed with undelivered notifications.');
      assert.deepEqual(errors.filter(error => !resizeWarnings.includes(error)), []);
      console.log(name, 'checked', reports.filter(report => report.engine === name).length, 'layouts; resize warnings:', resizeWarnings.length);
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ reports, issues }, null, 2) + '\n');
  console.log(JSON.stringify({ checks: reports.length, issues }));
  assert.deepEqual(issues, []);
} finally { await server.close(); }
