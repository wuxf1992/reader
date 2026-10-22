import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer } from './server.mjs';

const server = createReviewServer({ port: 0 });
const origin = await server.listen();
const output = '/tmp/reader-discovery-review';
const reports = [];
const descriptor = { id: 'novel', label: '网站与书源', capabilities: ['search', 'browse'] };
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
        await page.goto(origin);
        await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click();
        await page.locator('.shelf-screen').waitFor();
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
        assert.deepEqual(errors, []);
        reports.push({ browser: name, width, initialCatalogRequests: 0, explicitCatalogRequests: catalogs, navigationEntries: 200, passed: true });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify(reports));
} finally { server.server.closeAllConnections(); await server.close(); }
