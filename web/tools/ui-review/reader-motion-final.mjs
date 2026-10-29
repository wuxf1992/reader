import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';
const output = new URL('../../../artifacts/ui-review/reader-motion-final/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createReviewServer({ port: 0 }), origin = await server.listen();
const report = { origin, cases: [], errors: [] };
const books = Array.from({ length: 8 }, (_, i) => ({ id: 'motion-' + i, title: String.fromCharCode(72 - i) + ' 漫长的阅读旅程', author: '作者' + i, format: 'epub', coverUrl: '/api/v1/books/motion-' + i + '/cover', tags: [], series: '', readingState: i % 2 ? 'want' : 'reading', shelfState: 'on', addedAt: i, updatedAt: i }));
const longChapter = '第一百二十三章 在遥远山海之间继续前行的漫长旅途';
async function login(page) {
  await page.goto(origin + '/#/shelf');
  await page.getByText('更换服务地址', { exact: true }).click();
  await page.locator('input[type=url]').fill(origin);
  await page.locator('input[autocomplete=username]').fill('review');
  await page.locator('input[type=password]').fill('password12');
  await page.locator('button[type=submit]').click();
  await page.locator('.app-shell').waitFor();
}
async function settle(page) { await page.waitForFunction(() => !document.querySelector('.book-grid[aria-busy=true]')); }
async function select(page, value) {
  await page.locator('.shelf-sort').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}
async function closeSheet(page, mode) {
  const sheet = page.locator('dialog[open]').last();
  await sheet.evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))); });
  const before = await page.evaluate(() => window.motionRecords.length);
  if (mode === 'escape') await page.keyboard.press('Escape');
  else if (mode === 'outside') await page.mouse.click(3, 3);
  else await sheet.locator('.sheet-close').click();
  await sheet.waitFor({ state: 'detached' });
  const middle = await page.evaluate(before => window.motionRecords.slice(before).find(r => r.target.includes('sheet')), before);
  assert.ok(middle && middle.options.duration === 150 && middle.samples.some(s => s.state === 'running'), JSON.stringify(middle));
  return middle;
}
try {
  for (const [engine, type] of Object.entries({ chromium, webkit }).filter(([name]) => !process.env.UI_REVIEW_ENGINE || name === process.env.UI_REVIEW_ENGINE)) {
    const browser = await type.launch({ headless: true });
    try {
      for (const width of [390, 1280].filter(width => !process.env.UI_REVIEW_WIDTH || width === Number(process.env.UI_REVIEW_WIDTH))) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, serviceWorkers: 'block', colorScheme: 'dark' });
        let delay = 0, failure = false, coverRequests = 0;
        page.on('pageerror', error => report.errors.push({ engine, width, error: error.message }));
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.addInitScript(() => {
          window.motionRecords = [];
          const animate = Element.prototype.animate;
          Element.prototype.animate = function (frames, options) {
            const animation = animate.call(this, frames, options);
            const record = { target: this.className, id: this.dataset?.shelfBookId, frames, options, started: performance.now() };
            window.motionRecords.push(record);
            record.samples = [];
            const target = this;
            const sample = () => {
              record.samples.push({ time: animation.currentTime, state: animation.playState, transform: getComputedStyle(target).transform, opacity: getComputedStyle(target).opacity });
              if (animation.playState === 'running') requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
            const cancel = animation.cancel.bind(animation);
            animation.cancel = () => { record.cancelled = performance.now(); cancel(); };
            animation.addEventListener('finish', () => { record.finished = performance.now(); });
            return animation;
          };
        });
        await page.route('**/api/v1/books?**', async route => {
          assert.equal(new URL(route.request().url()).origin, origin);
          if (delay) await new Promise(done => setTimeout(done, delay));
          if (failure) return route.fulfill({ status: 500, json: { error: { code: 'FIXTURE', message: '本地夹具失败' } } });
          const params = new URL(route.request().url()).searchParams;
          let items = books.filter(b => !params.get('status') || b.readingState === params.get('status'));
          if (params.get('sort') === 'title') items = [...items].reverse();
          return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 60 } });
        });
        await page.route('**/api/v1/books/motion-*/cover', route => {
          coverRequests++;
          return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#82685b"/><text x="12" y="40" fill="white">本地阅读</text></svg>' });
        });
        await login(page); await page.locator('.book-grid .cover img').first().waitFor(); await settle(page);
        await page.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
        const images = await page.locator('.book-grid img').evaluateAll(els => els.map(e => e.src));
        const coverStart = coverRequests;
        // Automatic refetch keeps aria-busy but never fades or moves the shelf.
        delay = 120;
        await page.evaluate(() => { window.readerApp.queryClient.invalidateQueries({ queryKey: ['shelf'] }); });
        await page.waitForFunction(() => !!document.querySelector('.book-grid[aria-busy=true]'));
        const refetch = await page.locator('.book-grid').evaluate(el => ({ opacity: getComputedStyle(el).opacity, animations: window.motionRecords.length }));
        assert.equal(refetch.opacity, '1'); assert.equal(refetch.animations, 0); await settle(page);
        delay = 35;
        await select(page, 'title');
        await page.waitForFunction(() => window.motionRecords.some(r => r.id));
        await page.waitForFunction(() => window.motionRecords.some(r => r.id && r.samples?.some(s => s.state === 'running' && s.transform !== 'none')), undefined, { timeout: 3000 }).catch(async error => {
          await writeFile(output + `${engine}-${width}-diagnostic.json`, JSON.stringify(await page.evaluate(() => ({ records: window.motionRecords, now: performance.now(), sort: document.querySelector('.shelf-sort').value, cards: [...document.querySelectorAll('.book-grid .book-card')].map(e => ({ id: e.dataset.shelfBookId, rect: e.getBoundingClientRect().toJSON(), style: getComputedStyle(e).transform })) })), null, 2));
          throw error;
        });
        const middle = await page.evaluate(() => window.motionRecords.filter(r => r.id).map(r => ({ id: r.id, samples: r.samples })));
        assert.ok(middle.some(e => e.samples.some(s => s.transform !== 'none' && s.state === 'running')));
        await page.screenshot({ path: output + `${engine}-${width}-shelf-middle.png` });
        await page.waitForTimeout(240);
        assert.deepEqual(await page.locator('.book-grid .book-card').evaluateAll(els => els.map(e => e.dataset.shelfBookId)), books.map(b => b.id).reverse());
        assert.equal(coverRequests, coverStart);
        assert.deepEqual((await page.locator('.book-grid img').evaluateAll(els => els.map(e => e.src))).sort(), [...images].sort());
        // Cached recent navigation launches immediately; its 35ms refetch must not cancel 220ms motion.
        await page.evaluate(() => { window.motionRecords = []; });
        await select(page, 'recent'); await settle(page); await page.waitForTimeout(250);
        const cached = await page.evaluate(() => window.motionRecords.filter(r => r.id));
        assert.ok(cached.length > 0);
        assert.ok(cached.every(r => (r.finished ?? r.cancelled) - r.started >= 190), JSON.stringify(cached));
        await page.evaluate(() => { window.motionRecords = []; });
        // Interrupt twice, then verify the final order and cleaned transforms.
        await select(page, 'title'); await page.waitForTimeout(55); await select(page, 'recent');
        await page.waitForTimeout(55); await select(page, 'title'); await settle(page); await page.waitForTimeout(250);
        assert.deepEqual(await page.locator('.book-grid .book-card').evaluateAll(els => els.map(e => e.dataset.shelfBookId)), books.map(b => b.id).reverse());
        await page.waitForFunction(() => [...document.querySelectorAll('.book-grid .book-card')].every(e => !e.getAnimations().length && !e.style.transform && !e.style.opacity), undefined, { timeout: 3000 });
        const cleanup = await page.locator('.book-grid .book-card').evaluateAll(els => els.map(e => ({ id: e.dataset.shelfBookId, transform: getComputedStyle(e).transform, inline: e.style.transform, opacity: e.style.opacity, identity: getComputedStyle(e).transform === 'none' || new DOMMatrix(getComputedStyle(e).transform).isIdentity, animations: e.getAnimations().map(a => ({ state: a.playState, time: a.currentTime })) })));
        assert.ok(cleanup.every(e => e.identity), JSON.stringify(cleanup));
        const interruptions = await page.evaluate(() => window.motionRecords.filter(r => r.id));
        await page.getByRole('button', { name: '在读', exact: true }).click(); await settle(page); await page.waitForTimeout(250);
        assert.equal(await page.locator('.book-grid .book-card').count(), 4);
        await page.getByRole('button', { name: '全部', exact: true }).click(); await settle(page); await page.waitForTimeout(250);
        // A failed navigation clears intent; a later refresh must not animate.
        failure = true; await select(page, 'added'); await page.getByText('书架加载失败', { exact: true }).waitFor();
        failure = false; await page.evaluate(() => { window.motionRecords = []; window.readerApp.queryClient.invalidateQueries({ queryKey: ['shelf'] }); });
        await settle(page); await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => window.motionRecords.filter(r => r.id).length), 0);
        const sheetCases = [];
        for (const mode of ['close', 'escape', 'outside']) {
          const opener = page.locator('.shelf-head button[aria-label^="书架设置"]');
          await opener.focus(); await opener.click();
          const enter = await page.locator('dialog').evaluate(el => el.getAnimations().map(a => ({ duration: a.effect.getTiming().duration, name: a.animationName })));
          assert.ok(enter.some(a => a.duration === 220));
          sheetCases.push({ mode, enter, middle: await closeSheet(page, mode) });
          assert.ok(await opener.evaluate(el => document.activeElement === el));
        }
        // Action selection keeps the sheet in the top layer through its exit.
        await page.getByRole('button', { name: '分组', exact: true }).click();
        const menu = page.locator('dialog'); await menu.getByRole('menuitem').first().click();
        await menu.waitFor({ state: 'detached' });
        report.cases.push({ engine, width, kind: 'motion', refetch, middle, cached, interruptions, cleanup, sheetCases, coverRequests, passed: true });
        // Reduced motion preserves a short fade but contains no card translation.
        await page.emulateMedia({ reducedMotion: 'reduce' }); await page.evaluate(() => { window.motionRecords = []; });
        await select(page, 'title'); await settle(page); await page.waitForTimeout(120);
        const reduced = await page.evaluate(() => window.motionRecords.filter(r => r.id));
        assert.ok(reduced.every(r => r.frames.every(f => f.transform === 'none')));
        report.cases.at(-1).reduced = reduced;
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.addStyleTag({ content: ':root { --safe-top:47px; --safe-bottom:34px; }' });
        // Exercise real reading themes, contrasting app/device modes, paper, brightness and both chrome states.
        const themes = [
          { name: 'v3-light', mode: 'light', paper: 'theme', brightness: 1 },
          { name: 'local-night', mode: 'light', paper: 'local-wechat-night', brightness: 1 },
          { name: 'paper-dim', mode: 'dark', paper: 'warm', paperFollowsDark: false, brightness: .5 },
        ];
        for (const theme of themes) {
          await page.evaluate(async theme => {
            const scope = window.readerApp.mediaApi.preferenceScope();
            localStorage.setItem('reader.appearance.v1:' + scope, JSON.stringify({ theme: 'warm', mode: theme.mode, system: { light: 'warm', dark: 'warm' } }));
            dispatchEvent(new CustomEvent('reader-theme-change', { detail: { scope } }));
            await window.readerApp.updateSettings({ ...theme, readoutTopLeft: 'chapter', readoutTopRight: 'time', readoutBottomLeft: 'progress', readoutBottomRight: 'time' });
          }, theme);
          await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
          await page.locator('book-content .book-flow p').first().waitFor();
          if (width === 390 && theme.name === 'v3-light') {
            await page.getByRole('button', { name: '工具', exact: true }).click();
            const parent = page.getByRole('dialog', { name: '阅读工具', exact: true });
            await parent.getByRole('button', { name: '离线缓存', exact: true }).click();
            await parent.getByText('存储管理与配额', { exact: true }).click();
            const trigger = parent.getByRole('button', { name: '清理缓存', exact: true }).first();
            await trigger.click();
            assert.equal(await page.locator('dialog[open]').count(), 2);
            await page.keyboard.press('Escape');
            const nested = page.getByRole('alertdialog', { name: '清理缓存', exact: true });
            await nested.waitFor({ state: 'detached' });
            assert.equal(await page.locator('dialog[open]').count(), 1);
            assert.ok(await trigger.evaluate(el => document.activeElement === el));
            await trigger.click();
            await page.getByRole('button', { name: '保留缓存', exact: true }).click();
            assert.equal(await page.locator('dialog[open]').count(), 2);
            await nested.waitFor({ state: 'detached' });
            assert.equal(await page.locator('dialog[open]').count(), 1);
            await closeSheet(page, 'close');
            report.cases.push({ engine, width, kind: 'nested-sheet', escapeTopOnly: true, cancelAnimated: true, focusRestored: true, passed: true });
          }
          // Long source chapter titles exercise the actual readout layout without changing the publication fixture.
          await page.locator('.indicator-left[data-mode=chapter]').evaluate((el, title) => { el.textContent = title; el.title = title; }, longChapter);
          const stageBefore = await page.locator('.book-host').evaluate(el => el.getBoundingClientRect().toJSON());
          for (const state of ['visible', 'hidden']) {
            if (state === 'hidden') await page.mouse.click(width / 2, 422);
            await page.waitForFunction(state => document.documentElement.dataset.readerChrome === state, state);
            const result = await page.evaluate(() => {
              const root = document.documentElement, screen = document.querySelector('.reader-screen');
              const style = getComputedStyle(root), s = getComputedStyle(screen);
              const source = s.getPropertyValue(root.dataset.readerChrome === 'visible' ? '--reader-surface' : '--reader-paper').trim();
              const brightness = Number(root.dataset.readerBrightness);
              const channels = source.slice(1).match(/../g).map(v => Math.round(parseInt(v, 16) * brightness));
              const expected = '#' + channels.map(v => v.toString(16).padStart(2, '0')).join('');
              const rgb = `rgb(${channels.join(', ')})`;
              const bars = ['.topbar', '.footer'].map(selector => { const el = screen.querySelector(selector), r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, visible: getComputedStyle(el).visibility === 'visible' }; });
              return { expected, actual: style.getPropertyValue('--reader-browser-paper').trim(), root: style.backgroundColor, body: getComputedStyle(document.body).backgroundColor, rgb, scheme: style.colorScheme,
                meta: document.querySelector('meta[name=theme-color]').content,
                readouts: [...screen.querySelectorAll('.reading-indicator span')].map(el => { const r = el.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(el); const text = range.getBoundingClientRect(); return { mode: el.dataset.mode, text: el.textContent, width: r.width, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, inViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 47 && r.bottom <= innerHeight - 34, glyphFits: text.top >= r.top - 1 && text.bottom <= r.bottom + 1, outsideBars: bars.every(b => !b.visible || r.bottom <= b.top || r.top >= b.bottom) }; }) };
            });
            assert.equal(result.actual, result.expected, theme.name); assert.equal(result.meta, result.expected);
            assert.equal(result.root, result.rgb); assert.equal(result.body, result.rgb);
            if (theme.name === 'local-night') assert.equal(result.scheme, 'dark');
            assert.equal(result.readouts.length, 4);
            assert.ok(result.readouts.every(r => r.inViewport && r.glyphFits && r.outsideBars), JSON.stringify(result));
            assert.ok(result.readouts.filter(r => ['time', 'progress'].includes(r.mode)).every(r => r.scrollWidth <= r.clientWidth + 1));
            await page.screenshot({ path: output + `${engine}-${width}-${theme.name}-${state}.png` });
            report.cases.push({ engine, width, theme: theme.name, state, ...result, passed: true });
          }
          assert.deepEqual(await page.locator('.book-host').evaluate(el => el.getBoundingClientRect().toJSON()), stageBefore, 'toolbar toggling preserves page geometry');
          if (width === 390 && theme.name === 'v3-light') {
            await page.setViewportSize({ width: 320, height: 844 });
            const fit = await page.locator('.reading-indicator span').evaluateAll(els => els.every(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && (!['time','progress'].includes(el.dataset.mode) || el.scrollWidth <= el.clientWidth + 1); }));
            assert.ok(fit); await page.screenshot({ path: output + `${engine}-320-corners.png` });
            await page.setViewportSize({ width, height: 844 });
          }
          await page.evaluate(() => { location.hash = '#/shelf'; }); await page.locator('.app-shell').waitFor();
          await page.waitForFunction(() => document.documentElement.dataset.readerChrome === undefined);
          const exit = await page.evaluate(() => ({ chrome: document.documentElement.dataset.readerChrome, tint: document.documentElement.style.getPropertyValue('--reader-browser-paper'), scheme: document.documentElement.style.colorScheme, root: getComputedStyle(document.documentElement).backgroundColor, app: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(), stored: localStorage.getItem('reader.browser-color'), meta: document.querySelector('meta[name=theme-color]').content }));
          assert.equal(exit.chrome, undefined); assert.equal(exit.tint, ''); assert.equal(exit.scheme, ''); assert.equal(exit.meta.toLowerCase(), exit.app.toLowerCase()); assert.equal(exit.stored.toLowerCase(), exit.app.toLowerCase());
          assert.equal(exit.root, 'rgb(' + exit.app.slice(1).match(/../g).map(v => parseInt(v, 16)).join(', ') + ')');
          report.cases.push({ engine, width, theme: theme.name, kind: 'exit', ...exit, passed: true });
        }
        await page.close();
        console.log(engine, width, 'motion, sheets, reader bars and corners passed');
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile(output + (process.env.UI_REVIEW_ENGINE ? 'results-' + process.env.UI_REVIEW_ENGINE + (process.env.UI_REVIEW_WIDTH ? '-' + process.env.UI_REVIEW_WIDTH : '') + '.json' : 'results.json'), JSON.stringify(report, null, 2));
  server.server.closeAllConnections(); await server.close();
}
