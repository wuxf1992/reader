import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';

const server = createReviewServer({ port: 0 });
let coverState;
const [handle] = server.server.listeners('request');
server.server.removeListener('request', handle);
server.server.on('request', (req, res) => {
  if (req.url !== `/api/v1/books/${BOOK_ID}/cover`) { handle(req, res); return; }
  const { image, offline, requests } = coverState;
  if (offline) { requests.push('offline'); res.destroy(); return; }
  const etag = '"' + createHash('md5').update(image).digest('hex') + '"';
  const unchanged = req.headers['if-none-match'] === etag;
  requests.push(unchanged ? 304 : 200);
  res.writeHead(unchanged ? 304 : 200, { etag, 'content-type': 'image/png', 'cache-control': 'private, no-cache' });
  res.end(unchanged ? undefined : image);
});
const origin = await server.listen();
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      let page = await context.newPage();
      await page.goto(origin);
      const images = await page.evaluate(() => ['red', 'blue'].map(color => {
        const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 2, 2);
        return canvas.toDataURL('image/png').split(',')[1];
      }));
      let image = Buffer.from(images[0], 'base64');
      const requests = [];
      coverState = { image, offline: false, requests };
      await context.route('https://wuxf.top/**', route => route.abort());
      await context.route(/\/api\/v1\/books(?:\?.*)?$/, async route => {
        const response = await route.fetch(); const data = await response.json();
        data.items = data.items.map(book => ({ ...book, coverUrl: book.id === BOOK_ID ? `/api/v1/books/${BOOK_ID}/cover` : null }));
        await route.fulfill({ response, json: data });
      });
      await page.getByText('更换服务地址', { exact: true }).click();
      await page.locator('input[type=url]').fill(origin);
      await page.locator('input[autocomplete=username]').fill('review');
      await page.locator('input[type=password]').fill('password12');
      await page.locator('button[type=submit]').click();
      async function checkImage(expected) {
        await page.locator('.book-card img').first().waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('.book-card img')].some(img => img.complete && img.naturalWidth > 0));
        const bytes = await page.locator('.book-card img').first().evaluate(async img => Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())));
        assert.deepEqual(Buffer.from(bytes), expected);
      }
      await checkImage(image);
      assert.deepEqual(requests, [200]);
      await page.close(); page = await context.newPage(); await page.goto(origin);
      await checkImage(image);
      assert.deepEqual(requests, [200, 304], 'new page reads IndexedDB and receives no image body');
      image = Buffer.from(images[1], 'base64'); coverState.image = image;
      await page.reload(); await checkImage(image);
      assert.deepEqual(requests, [200, 304, 200], 'changed image replaces the cache');
      coverState.offline = true;
      await page.reload(); await checkImage(image);
      assert.ok(requests.length >= 4 && requests.slice(3).every(value => value === 'offline'), 'cached image remains visible offline');
      console.log(name, 'passed: first download → close/reopen 304 → changed cover 200 → offline local image');
      await context.close();
    } finally { await browser.close(); }
  }
} finally { server.server.closeAllConnections(); await server.close(); }
