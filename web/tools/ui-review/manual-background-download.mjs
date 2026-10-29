import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit, devices } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const server = createReviewServer({ port: 0 }), origin = await server.listen();
const output = new URL('../../../artifacts/ui-review/manual-background-download/', import.meta.url).pathname;
const items = Array.from({ length: 10 }, (_, seq) => ({ id: `c${seq}`, seq, title: `第 ${seq + 1} 章`, kind: 'chapter', mediaType: 'text/plain; charset=utf-8', href: `chapter:${seq}`, resourceRef: `resource:r1:${seq}`, format: 'html' }));
const content = { kind: 'reflowable', revision: 'r1', total: items.length, groups: [{ id: 'chapters', seq: 0, title: '章节', count: items.length, offset: 0 }], items };
const reports = [];
await mkdir(output, { recursive: true });
try {
  for (const [engineName, engine, phone] of [['chromium', chromium, devices['Pixel 7']], ['webkit', webkit, devices['iPhone 13']]]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ ...phone, serviceWorkers: 'block' });
      let release, waiting = Promise.resolve(), heldRef = '', held = false;
      const requests = [], errors = [];
      const waitHeld = async page => { const deadline = Date.now() + 10000; while (!held && Date.now() < deadline) await page.waitForTimeout(10); assert(held, 'the pending download reaches the held resource'); };
      const hold = ref => { heldRef = ref; held = false; waiting = new Promise(resolve => { release = resolve; }); };
      try {
        await context.route('https://wuxf.top/**', route => route.abort());
        await context.route('**/api/v1/**', async route => {
          const url = new URL(route.request().url()), path = url.pathname;
          if (path === `/api/v1/books/${BOOK_ID}/assets`) {
            const ref = url.searchParams.get('ref'); requests.push(ref);
            if (ref === heldRef) { held = true; await waiting; }
            return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: `第 ${Number(ref.split(':').at(-1)) + 1} 章\n\n下载测试正文。` }).catch(() => {});
          }
          if (path === `/api/v1/books/${BOOK_ID}/toc`) return route.fulfill({ json: { toc: items.map(item => ({ href: item.href, title: item.title, level: 0, spine: item.seq })) } });
          if (path === `/api/v1/books/${BOOK_ID}/items`) return route.fulfill({ json: content });
          if (path === '/api/v1/books' || path === `/api/v1/books/${BOOK_ID}` || path === `/api/v1/books/${BOOK_ID}/manifest`) {
            const response = await route.fetch(), data = await response.json();
            if (data.items) data.items = data.items.map(book => book.id === BOOK_ID ? { ...book, format: 'chapters' } : book);
            if (data.book?.id === BOOK_ID) data.book.format = 'chapters';
            if (path.endsWith('/manifest')) Object.assign(data, { format: 'chapters', total: items.length, content });
            return route.fulfill({ response, json: data });
          }
          return route.continue();
        });
        const page = await context.newPage(); page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/#/shelf');
        await page.getByText('更换服务地址', { exact: true }).click(); await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review'); await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click(); await page.locator('.shelf-screen').waitFor();
        await page.evaluate(async () => { window.readerApp.sync.stop(); await window.readerApp.updateSettings({ autoCache: false }); });
        const open = async () => {
          await page.evaluate(id => { location.hash = '#/book/' + id; }, BOOK_ID);
          await page.waitForFunction(() => document.querySelector('book-content')?.shadowRoot?.textContent?.includes('下载测试正文'));
        };
        const tools = async () => {
          if (await page.locator('.reader-screen').getAttribute('data-chrome') === 'hidden') {
            const box = await page.locator('book-content').boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          }
          await page.getByRole('button', { name: '工具', exact: true }).click();
          await page.getByRole('button', { name: '离线缓存', exact: true }).click();
        };
        const dialog = page.getByRole('dialog', { name: '阅读工具', exact: true });
        const close = async () => { await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); };
        await open(); await tools(); hold('resource:r1:1');
        await dialog.getByRole('button', { name: '下载 / 继续', exact: true }).click();
        await page.waitForFunction(() => window.readerApp.downloads.running('review-book')); await waitHeld(page);
        await close();
        assert.equal(await page.evaluate(() => window.readerApp.downloads.running('review-book')), true);
        await page.evaluate(() => { location.hash = '#/shelf'; }); await page.locator('.shelf-screen').waitFor();
        assert.equal(await page.evaluate(() => window.readerApp.downloads.running('review-book')), true);
        release();
        await page.waitForFunction(() => !window.readerApp.downloads.running('review-book'));
        assert.equal(requests.length, 10, 'visible chapter is reused and each remaining chapter is fetched once');
        await open(); await tools(); await dialog.getByText('所选章节已可离线阅读 · 10/10', { exact: true }).waitFor();
        await page.screenshot({ path: output + `${engineName}-complete.png` });
        await dialog.locator('summary').filter({ hasText: '存储管理与配额' }).click();
        await dialog.getByRole('button', { name: '清理缓存', exact: true }).click();
        await page.getByRole('alertdialog', { name: '清理缓存', exact: true }).getByRole('button', { name: '确认清理', exact: true }).click();
        await dialog.getByRole('button', { name: '清理缓存', exact: true }).waitFor({ state: 'detached' });
        await dialog.getByLabel('起始章', { exact: true }).fill('2'); hold('resource:r1:3');
        await dialog.getByRole('button', { name: '下载 / 继续', exact: true }).click(); await waitHeld(page);
        await dialog.getByText('正在下载 · 2/9', { exact: true }).waitFor();
        await page.reload(); release();
        await page.waitForFunction(() => document.querySelector('book-content')?.shadowRoot?.textContent?.includes('下载测试正文'));
        await tools();
        // WebKit can persist the reload's network error before the document disappears.
        try { await dialog.getByRole('status').filter({ hasText: /· 2\/9$/ }).waitFor(); }
        catch (error) { console.error(engineName, 'recovery diagnostics', await page.locator('body').innerText(), errors); await page.screenshot({ path: output + `${engineName}-failure.png` }); throw error; }
        assert.equal(await dialog.getByLabel('起始章', { exact: true }).inputValue(), '2');
        assert.equal(await dialog.getByRole('button', { name: '暂停', exact: true }).count(), 0, 'an interrupted task waits for explicit resume');
        assert.equal(await dialog.getByRole('button', { name: '下载 / 继续', exact: true }).isEnabled(), true);
        const completedCount = requests.filter(ref => ref === 'resource:r1:1').length;
        await dialog.getByRole('button', { name: '下载 / 继续', exact: true }).click();
        await dialog.getByText('所选章节已可离线阅读 · 9/9', { exact: true }).waitFor();
        assert.equal(requests.filter(ref => ref === 'resource:r1:1').length, completedCount, 'resume reuses completed resources');
        await close();
        await context.route('**/api/v1/**', route => route.abort());
        await page.reload();
        await page.waitForFunction(() => document.querySelector('book-content')?.shadowRoot?.textContent?.includes('下载测试正文'));
        await tools(); await dialog.getByText('所选章节已可离线阅读 · 9/9', { exact: true }).waitFor();
        assert.deepEqual(errors, []);
        reports.push({ engine: engineName, toolsDismissal: true, shelfNavigation: true, noDuplicateResources: true, interruptedRangeRestored: true, resumeReusesResources: true, offlineReopen: true });
        console.log(`${engineName}: manual background downloads, recovery and offline reopen passed`);
      } finally { release?.(); await context.close(); }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
await writeFile(output + 'metrics.json', JSON.stringify(reports, null, 2) + '\n');
