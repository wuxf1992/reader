import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID, CHAPTERS } from './server.mjs';

const server = createReviewServer({ port: 0 }), origin = await server.listen();
const output = new URL('../../../artifacts/ui-review/reader-text-fidelity/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const literal = '他说 <b> 是标签，&lt; 是实体。';
const raw = `<p>${CHAPTERS[0].title}</p><p>他说 &lt;b&gt; 是标签，&amp;lt; 是实体。</p><p>段落末尾。</p>`;
const rich = `<p>${CHAPTERS[1].title}</p><img alt="插图" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII="><table><tr><td>表格内容</td></tr></table>`;
const results = [];
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch({ headless: true });
    try {
      for (const width of [390, 1120]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
        let offline = false;
        try {
          await context.route('https://wuxf.top/**', route => route.abort());
          await context.route('**/api/v1/**', async route => {
            if (offline) return route.abort();
            const url = new URL(route.request().url());
            if (url.pathname === '/api/v1/books') {
              const response = await route.fetch(), data = await response.json();
              data.items = data.items.map(book => book.id === BOOK_ID ? { ...book, format: 'chapters' } : book);
              return route.fulfill({ response, json: data });
            }
            if (url.pathname === `/api/v1/books/${BOOK_ID}/manifest`) {
              const response = await route.fetch(), data = await response.json();
              const items = list => list.map(({ format, ...item }) => ({ ...item, mediaType: 'text/html' }));
              data.book.format = 'chapters'; data.format = 'chapters';
              data.content.items = items(data.content.items);
              return route.fulfill({ response, json: data });
            }
            if (url.pathname === `/api/v1/books/${BOOK_ID}/assets`) {
              return route.fulfill({ contentType: 'text/html', body: /(?:chapter(?:-full)?:)1$/.test(url.searchParams.get('ref') ?? '') ? rich : raw });
            }
            return route.continue();
          });
          const page = await context.newPage(), errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.goto(origin + '/#/shelf');
          await page.getByText('更换服务地址', { exact: true }).click();
          await page.locator('input[type=url]').fill(origin);
          await page.locator('input[autocomplete=username]').fill('review');
          await page.locator('input[type=password]').fill('password12');
          await page.locator('button[type=submit]').click();
          await page.locator('.shelf-screen').waitFor();
          await page.evaluate(async () => { window.readerApp.sync.stop(); await window.readerApp.updateSettings({ autoCache: false }); });
          await page.getByRole('link', { name: /剑来 第1卷/ }).first().click();
          const text = () => page.locator('book-content .book-flow').innerText();
          await page.waitForFunction(value => document.querySelector('book-content')?.shadowRoot?.textContent?.includes(value), literal);
          assert((await text()).includes(literal));
          assert.equal(await page.locator('book-content b').count(), 0);
          if (await page.locator('.reader-screen').getAttribute('data-chrome') === 'hidden') await page.locator('.stage').click({ position: { x: width / 2, y: 350 } });
          await page.getByRole('button', { name: '下一章', exact: true }).click();
          await page.locator('book-content td').waitFor();
          assert.equal(await page.locator('book-content img[alt="插图"]').count(), 1);
          assert.equal(await page.locator('book-content td').innerText(), '表格内容');
          await page.getByRole('button', { name: '上一章', exact: true }).click();
          await page.waitForFunction(value => document.querySelector('book-content')?.shadowRoot?.textContent?.includes(value), literal);
          await page.evaluate(async () => { await window.readerApp.saveBeforeUpdate(); location.hash = '#/shelf'; });
          await page.locator('.shelf-screen').waitFor(); offline = true;
          await page.getByRole('link', { name: /剑来 第1卷/ }).first().click();
          await page.waitForFunction(value => document.querySelector('book-content')?.shadowRoot?.textContent?.includes(value), literal);
          await page.screenshot({ path: output + `${engine}-${width}-offline.png` });
          assert.deepEqual(errors, []);
          results.push({ engine, width, literalText: true, imageAndTable: true, cachedOfflineReopen: true });
          console.log(`PASS ${engine} ${width}: text fidelity, rich HTML and offline cache`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  await writeFile(output + 'verification.json', JSON.stringify(results, null, 2) + '\n');
} finally { await server.close(); }
