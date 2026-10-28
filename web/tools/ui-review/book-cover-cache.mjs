import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
  setTimeout(() => {
    if (res.destroyed) return;
    coverState.responded.push(unchanged ? 304 : 200);
    res.writeHead(unchanged ? 304 : 200, { etag, 'content-type': 'image/png', 'cache-control': 'private, no-cache' });
    res.end(unchanged ? undefined : image);
  }, coverState.delay);
});
const origin = await server.listen();
const output = new URL('../../../artifacts/ui-review/book-cover-cache/', import.meta.url).pathname;
await mkdir(output, {recursive:true});
const metrics = [];
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      let page = await context.newPage();
      await page.goto(origin);
      const images = await page.evaluate(() => ['red', 'blue'].map(color => {
        const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 2, 2);
        return canvas.toDataURL('image/png').split(',')[1];
      }));
      let image = Buffer.from(images[0], 'base64');
      const requests = [];
      coverState = { image, offline: false, requests, responded: [], delay: 0 };
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
        const rgb = expected.equals(Buffer.from(images[0], 'base64')) ? [255, 0, 0] : [0, 0, 255];
        await page.waitForFunction(rgb => {
          const img = document.querySelector('.book-card img');
          if (!img?.complete || !img.naturalWidth) return false;
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d'); context.drawImage(img, 0, 0, 1, 1);
          const pixel = context.getImageData(0, 0, 1, 1).data;
          return rgb.every((value, index) => pixel[index] === value);
        }, rgb);
        const bytes = await page.locator('.book-card img').first().evaluate(async img => Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())));
        assert.deepEqual(Buffer.from(bytes), expected);
      }
      await checkImage(image);
      assert.deepEqual(requests, [200]);
      coverState.delay = 1500;
      await page.close(); page = await context.newPage();
      const validation = page.waitForResponse(response => response.url().includes(`/books/${BOOK_ID}/cover`) && response.status() === 304);
      await page.goto(origin + '/#/shelf');
      await page.locator('.book-card').first().waitFor();
      const start = Date.now();
      await checkImage(image);
      const elapsed = Date.now() - start;
      assert.equal(coverState.responded.length, 1, 'persistent cover must display before delayed network validation finishes');
      assert.ok(elapsed < 1000, `cache took ${elapsed}ms despite a 1500ms network delay`);
      await page.screenshot({path: output + name + '-cached-before-validation.png'});
      await validation;
      assert.deepEqual(requests, [200, 304]);
      const unchanged = await page.locator('.book-card img').first().getAttribute('src');
      await page.waitForTimeout(50);
      assert.equal(await page.locator('.book-card img').first().getAttribute('src'), unchanged, '304 must not replace the image URL');
      await page.evaluate(() => {location.hash = '#/library';});
      await page.locator('.library-screen .book-card').first().waitFor();
      await checkImage(image);
      await page.evaluate(() => {location.hash = '#/shelf';});
      await page.locator('.shelf-screen .book-card').first().waitFor();
      const firstFrame = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(!!document.querySelector('.book-card img')))));
      assert.equal(firstFrame, true, 'warm memory cache must render in the first frame');
      await checkImage(image);
      assert.deepEqual(requests, [200, 304], 'warm navigation must share cached bytes without another validation');
      image = Buffer.from(images[1], 'base64'); coverState.image = image;
      await page.reload();
      await checkImage(Buffer.from(images[0], 'base64'));
      await page.evaluate(() => {
        window.coverPlaceholderFrames = []; window.watchCover = true;
        const sample = () => { window.coverPlaceholderFrames.push(!document.querySelector('.book-card img')); if (window.watchCover) requestAnimationFrame(sample); };
        sample();
      });
      await checkImage(image);
      const frames = await page.evaluate(() => {window.watchCover = false;return window.coverPlaceholderFrames;});
      assert.ok(frames.every(frame => frame === false), 'background replacement must not reset the cover to a placeholder');
      assert.deepEqual(requests, [200, 304, 200]);
      coverState.delay = 0;
      metrics.push({engine:name,networkValidationDelayMs:1500,coverVisibleAfterCardMs:elapsed,warmFirstFrame:firstFrame,placeholderFramesDuringUpdate:frames.filter(Boolean).length});
      coverState.offline = true;
      await page.reload(); await checkImage(image);
      assert.ok(requests.length >= 4 && requests.slice(3).every(value => value === 'offline'), 'cached image remains visible offline');
      coverState.offline = false; coverState.image = Buffer.from(images[0], 'base64');
      await page.evaluate(() => {window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
      await checkImage(coverState.image);
      assert.equal(requests.at(-1), 200, 'reconnect refreshes even freshly cached data');
      console.log(name, 'passed: cache before delayed validation → warm first frame → changed cover without placeholder → offline cache → reconnect update');
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  }
} finally { server.server.closeAllConnections(); await server.close(); await writeFile(output+'metrics.json',JSON.stringify(metrics,null,2)); console.log(JSON.stringify(metrics)); }
