import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer } from './server.mjs';

const server = createReviewServer({ port: 0 });
const origin = await server.listen();
const output = '/tmp/reader-discovery-review';
const reports = [];
const descriptor = { id: 'novel', label: '网站与书源', capabilities: ['search', 'browse', 'content.manifest'] };
await mkdir(output, { recursive: true });
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
        const errors = []; let catalogs = 0;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.route('**/api/v1/sources', route => route.fulfill({ json: { sources: [{ id: 'demo', name: '网站与书源', enabled: true, isDefault: true, sourceType: 'novel', descriptor }] } }));
        await page.route('**/api/v1/sources/types', route => route.fulfill({ json: { types: [descriptor] } }));
        await page.route('**/api/v1/sources/demo/browse*', route => {
          catalogs++;
          return route.fulfill({ json: { title: '书海 / 发现', items: [], navigation: Array.from({ length: 200 }, (_, index) => ({ title: '示例书源 ' + (index + 1), ref: 'explore:' + index })) } });
        });
        const entry = { ref: 'detail-book', title: '目录测试书籍', authors: ['测试作者'], shelfBookId: 'already-added', description: '简介'.repeat(120), options: [{ id: 'read', label: '加入书架' }] };
        let directoryRequests = 0;
        await page.route('**/api/v1/sources/demo/search', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: results\ndata: ' + JSON.stringify({ items: [entry] }) + '\n\nevent: done\ndata: {}\n\n' }));
        await page.route('**/api/v1/sources/demo/entries?*', route => route.fulfill({ json: entry }));
        await page.route('**/api/v1/sources/demo/publications/detail-book/manifest', route => {
          directoryRequests++;
          return route.fulfill({ json: { items: Array.from({ length: 205 }, (_, seq) => ({ id: String(seq), seq, kind: 'chapter', title: `第${seq + 1}章 内容` })) } });
        });
        await page.goto(origin);
        await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click();
        await page.locator('.app-shell').waitFor();
        await page.evaluate(async () => { await window.readerApp.updateSettings({ theme: 'parchment-day' }); location.hash = '#/sources'; });
        const toggle = page.getByRole('button', { name: '书海 / 发现', exact: true });
        await toggle.waitFor();
        assert.equal(catalogs, 0, 'entering the page does not fetch discovery');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('.source-navigation').count(), 0);
        assert.equal(await page.locator('.catalog-empty, .catalog-summary').count(), 0);
        await page.screenshot({ path: `${output}/${name}-${width}-entry.png` });
        await toggle.click();
        await page.locator('.source-navigation button').last().waitFor();
        assert.equal(catalogs, 1);
        assert.equal(await page.locator('.source-navigation button').count(), 200);
        assert.equal(await page.locator('.catalog-empty, .catalog-summary').count(), 0, 'navigation is not an empty book search');
        assert.equal(await page.locator('.sources-body').evaluate(element => element.scrollWidth > element.clientWidth), false);
        await page.screenshot({ path: `${output}/${name}-${width}-expanded.png` });
        await page.getByRole('button', { name: '收起书海 / 发现', exact: true }).click();
        assert.equal(await page.locator('.source-navigation').count(), 0);
        assert.equal(catalogs, 1, 'collapsing does not request another catalog');
        await page.locator('.source-keyword input').fill('目录测试');
        await page.getByRole('button', { name: '搜索', exact: true }).click();
        await page.locator('.catalog-source-count').click();
        const group = page.getByRole('dialog', { name: '书源列表', exact: true });
        await group.getByRole('button', { name: '详情', exact: true }).click();
        const detail = page.getByRole('dialog', { name: entry.title, exact: true });
        await detail.getByRole('button', { name: '已加入书架', exact: true }).waitFor();
        assert.equal(await detail.getByRole('button', { name: '已加入书架', exact: true }).isDisabled(), true);
        await detail.getByRole('button', { name: '展开完整简介', exact: true }).click();
        assert.equal(await detail.locator('.book-detail-description').textContent(), entry.description);
        assert.equal(directoryRequests, 0, 'directory loads on demand');
        await detail.getByRole('button', { name: '查看目录', exact: true }).click();
        const directory = page.getByRole('dialog', { name: '章节目录', exact: true });
        await directory.locator('li').last().waitFor();
        assert.equal(await directory.locator('li').count(), 205);
        assert.equal(await directory.locator('li').first().textContent(), '第205章 内容');
        await directory.getByRole('button', { name: '正序', exact: true }).click();
        assert.equal(await directory.locator('li').first().textContent(), '第1章 内容');
        assert.equal(await directory.evaluate(node => node.scrollWidth > node.clientWidth), false);
        await page.screenshot({ path: `${output}/${name}-${width}-directory.png` });
        await page.keyboard.press('Escape');
        await directory.waitFor({ state: 'detached' });
        assert.equal(await detail.isVisible(), true, 'Escape retains the parent detail');
        assert.equal(await group.count(), 1);
        await detail.getByRole('button', { name: '查看目录', exact: true }).click();
        await directory.locator('li').last().waitFor();
        assert.equal(directoryRequests, 1, 'opening again uses the cached directory');
        await directory.getByRole('button', { name: '关闭', exact: true }).click();
        await detail.getByRole('button', { name: '关闭', exact: true }).click();
        assert.equal(await group.isVisible(), true);
        await group.getByRole('button', { name: '关闭', exact: true }).click();
        assert.deepEqual(errors, []);
        reports.push({ browser: name, width, initialCatalogRequests: 0, explicitCatalogRequests: catalogs, navigationEntries: 200, passed: true });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify(reports));
} finally { server.server.closeAllConnections(); await server.close(); }
