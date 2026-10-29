import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit, devices } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const output = '/tmp/reader-cache-features-review';
const server = createReviewServer({ port: 5204 });
const origin = await server.listen(), reports = [];
const items = Array.from({ length: 10 }, (_, seq) => ({ id: `c${seq}`, seq, title: `第 ${seq + 1} 章`, kind: 'chapter', mediaType: 'text/plain; charset=utf-8', href: `chapter:${seq}`, resourceRef: `resource:r1:${seq}`, format: 'html' }));
await mkdir(output, { recursive: true });
try {
  for (const [engineName, engine, phone] of [['chromium', chromium, devices['Pixel 7']], ['webkit', webkit, devices['iPhone 13']]]) {
    const browser = await engine.launch();
    try {
      for (const [layout, options] of [['phone', phone], ['desktop', { viewport: { width: 1280, height: 800 } }]]) {
        const page = await browser.newPage({ ...options, serviceWorkers: 'block' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        let release, blocked = false;
        const waiting = new Promise(resolve => { release = resolve; });
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.route(/\/api\/v1\/books\?/, async route => {
          const value = await (await route.fetch()).json();
          await route.fulfill({ json: { ...value, items: value.items.map(book => ({ ...book, format: 'chapters' })) } });
        });
        await page.route(new RegExp(`/api/v1/books/${BOOK_ID}$`), async route => {
          const value = await (await route.fetch()).json();
          await route.fulfill({ json: { ...value, book: { ...value.book, format: 'chapters' } } });
        });
        await page.route(new RegExp(`/api/v1/books/${BOOK_ID}/(manifest|toc|items|assets)(\\?|$)`), async route => {
          const url = new URL(route.request().url());
          if (url.pathname.endsWith('/assets')) {
            if (url.searchParams.get('ref') === 'resource:r1:1') { blocked = true; await waiting; }
            return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: '测试章节\n\n预缓存测试正文。' });
          }
          if (url.pathname.endsWith('/toc')) return route.fulfill({ json: { toc: items.map(item => ({ href: item.href, title: item.title, level: 0, spine: item.seq })) } });
          const content = { kind: 'reflowable', revision: 'r1', total: items.length, groups: [{ id: 'chapters', seq: 0, title: '章节', count: items.length, offset: 0 }], items };
          if (url.pathname.endsWith('/items')) return route.fulfill({ json: content });
          const manifest = await (await route.fetch()).json();
          await route.fulfill({ json: { ...manifest, book: { ...manifest.book, format: 'chapters' }, format: 'chapters', total: items.length, content } });
        });
        await page.goto(origin);
        await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click();
        await page.locator('.app-shell').waitFor();
        await page.evaluate(id => { location.hash = '#/book/' + id; }, BOOK_ID);
        await page.waitForFunction(() => document.querySelector('book-content')?.shadowRoot?.textContent?.includes('预缓存测试正文'));
        if (await page.locator('.reader-screen').getAttribute('data-chrome') === 'hidden') await page.locator('.stage').click({ position: { x: 195, y: 350 } });
        await page.getByRole('button', { name: '工具', exact: true }).click();
        await page.getByRole('button', { name: '离线缓存', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '阅读工具' });
        const toggle = dialog.getByRole('checkbox', { name: '提前缓存后续章节' });
        const count = dialog.getByLabel('预缓存章节数');
        assert.equal(await toggle.isChecked(), true);
        assert.equal(await count.inputValue(), '3');
        await dialog.getByText('正在预缓存 1/3 章', { exact: true }).waitFor();
        assert.equal(blocked, true);
        await page.screenshot({ path: `${output}/${engineName}-${layout}.png` });
        const box = await dialog.boundingBox(); assert.ok(box.y > 5, 'there is an outside area to dismiss the tools');
        await page.mouse.click(2, 2);
        await dialog.waitFor({ state: 'detached' });
        // A pending chapter must survive dismissal; it finishes while the directory is visible.
        await page.getByRole('button', { name: '目录', exact: true }).click();
        const panel = page.getByRole('dialog', { name: '目录', exact: true });
        await panel.locator('.toc-cached').first().waitFor();
        assert.equal(await panel.locator('.toc-cached').count(), 1);
        release();
        await page.waitForFunction(() => document.querySelectorAll('.toc-cached').length === 4);
        assert.equal(await panel.locator('.toc-list button').nth(9).locator('.toc-cached').count(), 0);
        await panel.getByRole('button', { name: '关闭', exact: true }).click();
        await page.getByRole('button', { name: '工具', exact: true }).click();
        await page.getByRole('button', { name: '离线缓存', exact: true }).click();
        await dialog.getByText('后续 3 章已缓存', { exact: true }).waitFor();
        await count.selectOption('5');
        await dialog.getByText('后续 5 章已缓存', { exact: true }).waitFor();
        await toggle.uncheck();
        await dialog.getByText('自动预缓存已关闭', { exact: true }).waitFor();
        assert.equal(await count.isDisabled(), true);
        await page.reload();
        await page.waitForFunction(() => document.querySelector('book-content')?.shadowRoot?.textContent?.includes('预缓存测试正文'));
        if (await page.locator('.reader-screen').getAttribute('data-chrome') === 'hidden') await page.locator('.stage').click({ position: { x: 195, y: 350 } });
        await page.getByRole('button', { name: '工具', exact: true }).click();
        await page.getByRole('button', { name: '离线缓存', exact: true }).click();
        assert.equal(await toggle.isChecked(), false); assert.equal(await count.inputValue(), '5');
        assert.ok(await dialog.evaluate(el => {
          const b = el.getBoundingClientRect(), header = el.querySelector('.sheet-header').getBoundingClientRect();
          return b.width <= innerWidth && b.bottom <= innerHeight + 1 && header.top >= 0 && document.documentElement.scrollWidth <= innerWidth;
        }), 'tools keep their header visible and fit the viewport');
        await page.mouse.click(2, 2); await dialog.waitFor({ state: 'detached' });
        const unexpected = errors.filter(error => !error.startsWith('ResizeObserver loop') && error !== '/127.0.0.1:5204/api/v1/sync due to access control checks.');
        assert.deepEqual(unexpected, []); assert.ok(errors.length <= 1);
        reports.push({ engine: engineName, layout, outsideTapCloses: true, defaultsToThree: true, continuesAfterDismissal: true, directoryUpdatesWhileOpen: true, settingsRestored: true, uncachedUnmarked: true, viewportFits: true, resizeWarnings: errors.filter(error => error.startsWith('ResizeObserver loop')).length, navigationAbortWarnings: errors.filter(error => error.includes('/api/v1/sync due to access control')).length });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify(reports));
} finally { await server.close(); }
