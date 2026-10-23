/** Shelf regression against the production bundle and local API fixture. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { createReviewServer } from './server.mjs';

const output = resolve(process.env.UI_REVIEW_DIR || '../artifacts/ui-review/shelf-layout');
const server = createReviewServer({ port: 0 });
await server.listen();
const origin = 'http://127.0.0.1:' + server.server.address().port;
const titles = ['转生成为异世界领主之后的悠闲生活', '被逐出勇者队伍后开始经营魔法书店', '关于我在图书馆遇见神秘少女这件事', '从零开始的异世界生活第一部完整版', '不时轻声地以俄语遮羞的邻座艾莉同学', '在地下城寻求邂逅是否搞错了什么', '败犬女主太多了第一卷青春物语', '欢迎来到实力至上主义的教室', '魔女之旅与世界尽头的约定', '这个勇者明明超强却过分慎重'];
const colors = ['#667a82', '#a76049', '#6f7958', '#8d6d8d', '#a17c47'];
const longGroup = '异世界冒险与图书馆的漫长故事系列';
const makeBooks = () => titles.map((title, i) => ({ id: 'shelf-fixture-' + i, title, author: ['远方的旅人', '佐藤与铃木的联合笔名', '山间一叶'][i % 3], publisher: '', language: 'zh', isbn: '', description: '', series: i < 5 ? longGroup : '', seriesIndex: i + 1, tags: ['轻小说'], pubdate: '', format: i % 3 === 0 ? (i === 3 ? 'CHAPTERS' : 'chapters') : 'epub', coverUrl: '/api/v1/books/shelf-fixture-' + i + '/cover', fileSize: 1024, pageCount: 100, source: '', manualFields: [], addedAt: i, updatedAt: i, shelfState: 'on', readingState: ['reading', 'want', 'finished', null][i % 4] }));
const report = { passed: false, origin, syntheticCovers: true, scenarios: [], screenshots: [], errors: [] };
await mkdir(output, { recursive: true });
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch({ headless: true, ...(engine === 'chromium' && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const covers = (await page.evaluate(({ titles, colors }) => titles.map((title, i) => {
        const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 360;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(0, 0, 240, 360);
        ctx.strokeStyle = '#fff8ed80'; ctx.strokeRect(12, 12, 216, 336); ctx.fillStyle = '#fff8ed'; ctx.font = '23px serif';
        title.match(/.{1,5}/g).forEach((line, index) => ctx.fillText(line, 28, 78 + index * 35));
        ctx.fillStyle = '#fff8ed2b'; ctx.beginPath(); ctx.arc(178, 285, 35, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff8ed'; ctx.font = '14px serif'; ctx.fillText('本地评审 · ' + (i + 1), 28, 326);
        return canvas.toDataURL('image/png').split(',')[1];
      }), { titles, colors })).map(base64 => Buffer.from(base64, 'base64'));
      page.on('pageerror', error => report.errors.push({ engine, message: error.message }));
      let books = makeBooks(), mode = 'normal', delay = 0, coverRequests = 0;
      const requests = [];
      await page.route('https://wuxf.top/**', route => route.abort());
      await page.route('**/api/v1/**', async route => {
        const url = new URL(route.request().url());
        assert.equal(url.origin, origin, 'fixture API must remain local');
        if (url.pathname === '/api/v1/books') {
          requests.push(url.search);
          if (delay) await new Promise(done => setTimeout(done, delay));
          if (mode === 'error') return route.fulfill({ status: 500, json: { error: { code: 'REVIEW_ERROR', message: '夹具加载失败' } } });
          const q = url.searchParams.get('search') || '';
          let items = mode === 'empty' ? [] : books.filter(book => (book.title + book.author).includes(q) && (!url.searchParams.get('status') || book.readingState === url.searchParams.get('status')) && (!url.searchParams.get('series') || book.series === url.searchParams.get('series')) && (!url.searchParams.get('tag') || book.tags.includes(url.searchParams.get('tag'))));
          if (url.searchParams.get('sort') === 'title') items.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
          if (url.searchParams.get('sort') === 'author') items.sort((a, b) => a.author.localeCompare(b.author, 'zh'));
          return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 60 } });
        }
        if (url.pathname === '/api/v1/library/facets') return route.fulfill({ json: { authors: [], series: [longGroup], tags: ['轻小说'], formats: ['epub', 'CHAPTERS'] } });
        if (url.pathname === '/api/v1/library/continue') return route.fulfill({ json: { items: [] } });
        const cover = url.pathname.match(/^\/api\/v1\/books\/shelf-fixture-(\d+)\/cover$/);
        if (cover) {
          coverRequests++;
          const i = Number(cover[1]);
          return route.fulfill({ contentType: 'image/png', body: covers[i] });
        }
        if (url.pathname.endsWith('/reading-status')) {
          const id = url.pathname.split('/')[4];
          books.find(book => book.id === id).readingState = route.request().postDataJSON().status;
          return route.fulfill({ json: { ok: true } });
        }
        return route.continue();
      });
      const button = name => page.getByRole('button', { name, exact: true });
      const grid = page.locator('.shelf-screen .book-grid');
      async function ready(count = 10) {
        await page.waitForFunction(count => document.querySelectorAll('.shelf-screen .book-card').length === count, count);
        await page.waitForFunction(() => document.querySelector('.shelf-screen .book-grid')?.getAttribute('aria-busy') !== 'true');
        await page.waitForFunction(() => [...document.querySelectorAll('.shelf-screen .cover')].filter(el => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }).every(el => { const img = el.querySelector('img'); return img?.complete && img.naturalWidth > 0; }));
      }
      async function shot(name) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' page overflow');
        assert.equal(await page.locator('.shelf-screen').evaluate(el => el.scrollWidth > el.clientWidth), false, name + ' shelf overflow');
        const file = `${engine}-${name}.png`;
        await page.screenshot({ path: join(output, file), animations: 'disabled' });
        report.screenshots.push(file);
        if (name === 'shelf-390-cozy' || name === 'dark-390') {
          const contrast = await page.evaluate(() => {
            const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
            canvas.width = canvas.height = 1;
            const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
            const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] / 255 + bg[i] * (1 - fg[3] / 255));
            const paper = rgba(getComputedStyle(document.documentElement).getPropertyValue('--reader-paper'));
            const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            return ['.shelf-count', '.shelf-screen .author', '.shelf-screen .book-state', '.shelf-state-filter .chip[aria-pressed=true]'].map(selector => {
              const style = getComputedStyle(document.querySelector(selector)), bg = blend(rgba(style.backgroundColor), paper), fg = blend(rgba(style.color), bg);
              const light = Math.max(luminance(fg), luminance(bg)), dark = Math.min(luminance(fg), luminance(bg));
              return { selector, ratio: (light + .05) / (dark + .05) };
            });
          });
          assert.ok(contrast.every(item => item.ratio >= 4.5), 'text contrast: ' + JSON.stringify(contrast));
          report.scenarios.push({ engine, theme: name, contrast });
        }
      }
      async function density(label) {
        await page.locator('.shelf-head button[aria-label^="书架设置"]').click();
        await page.getByRole('group', { name: '封面大小', exact: true }).getByRole('button', { name: label, exact: true }).click();
        await page.locator('.shelf-settings button[aria-label="关闭"]').click();
      }
      await page.goto(origin + '/#/shelf');
      await page.getByText('更换服务地址', { exact: true }).click();
      await page.locator('input[type=url]').fill(origin);
      await page.locator('input[autocomplete=username]').fill('review');
      await page.locator('input[type=password]').fill('password12');
      await page.locator('button[type=submit]').click();
      await ready();
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        for (const [value, label] of [['cozy', '适中'], ['compact', '紧凑'], ['comfortable', '宽松']]) {
          await density(label);
          const layout = await grid.evaluate(el => {
            const cards = [...el.querySelectorAll('.book-card')], first = cards[0].getBoundingClientRect();
            const controls = [...document.querySelectorAll('.shelf-filters button, .shelf-head a, .shelf-head button, select.shelf-sort, .shelf-screen .book-more')].map(el => ({ label: el.getAttribute('aria-label') || el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
            return { filtersOnOneRow: Math.abs(document.querySelector('.shelf-state-filter').getBoundingClientRect().top - document.querySelector('.shelf-group').getBoundingClientRect().top) < 1, columns: cards.filter(card => Math.abs(card.getBoundingClientRect().top - first.top) < 1).length, coverWidth: first.width, controls, titleClamp: getComputedStyle(cards[0].querySelector('.title')).webkitLineClamp, gapAfterSearch: document.querySelector('.shelf-filters').getBoundingClientRect().top - document.querySelector('.shelf-search').getBoundingClientRect().bottom };
          });
          if (width === 390) assert.ok(layout.filtersOnOneRow, '390px status and group controls share a compact row');
          if (width === 390) assert.ok(layout.columns <= 3, '390px must never squeeze four columns');
          if (width === 390 && value === 'cozy') assert.equal(layout.columns, 3);
          if (width === 320) {
            assert.equal(layout.columns, 2);
            assert.ok(await page.locator('.shelf-title').evaluate(el => el.getBoundingClientRect().height < 35), '320px header title stays on one line');
          }
          if (width === 1280) assert.ok(await page.locator('.shelf-search input').evaluate(el => el.getBoundingClientRect().width / document.querySelector('.shelf-section').getBoundingClientRect().width > .85), 'desktop search spans the content column');
          assert.equal(layout.titleClamp, '2');
          assert.ok(layout.gapAfterSearch >= 0 && layout.gapAfterSearch < 28, 'filters follow search without a blank band');
          assert.ok(layout.controls.every(control => control.width >= 43.5 && control.height >= 43.5), '44px touch targets: ' + JSON.stringify(layout.controls));
          report.scenarios.push({ engine, width, density: value, ...layout });
          await shot(`shelf-${width}-${value}`);
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await density('适中');
      await page.getByRole('searchbox').fill('异世界');
      await page.getByRole('searchbox').press('Enter');
      await ready(2);
      const sort = page.getByRole('combobox', { name: '排序方式', exact: true });
      assert.deepEqual(await sort.locator('option').evaluateAll(options => options.map(option => option.value)), ['recent', 'added', 'title', 'author']);
      await page.setViewportSize({ width: 320, height: 844 });
      const longSearch = '关于一本讲述漫长阅读旅程与异世界书店之间关系的超长中文搜索词';
      await page.getByRole('searchbox').fill(longSearch);
      await page.getByRole('searchbox').press('Enter');
      await page.getByText('没有匹配的书', { exact: true }).waitFor();
      const longSearchLayout = await page.evaluate(() => {
        const shelf = document.querySelector('.shelf-screen');
        const sort = document.querySelector('.shelf-sort');
        const shelfRect = shelf.getBoundingClientRect(), sortRect = sort.getBoundingClientRect();
        return {
          pageFits: document.documentElement.scrollWidth <= innerWidth,
          shelfFits: shelf.scrollWidth <= shelf.clientWidth,
          sortVisible: sort.getClientRects().length > 0 && sortRect.width > 0,
          sortFits: sortRect.left >= shelfRect.left && sortRect.right <= shelfRect.right,
        };
      });
      assert.ok(longSearchLayout.pageFits && longSearchLayout.shelfFits, 'long Chinese search does not overflow the page or shelf');
      assert.ok(longSearchLayout.sortVisible && longSearchLayout.sortFits, 'native sort remains visible within the shelf');
      await page.getByRole('searchbox').fill('异世界');
      await page.getByRole('searchbox').press('Enter');
      await ready(2);
      await page.setViewportSize({ width: 390, height: 844 });
      for (const value of ['added', 'title', 'author', 'recent']) { await sort.selectOption(value); await page.waitForURL(url => new URLSearchParams(url.hash.split('?')[1]).get('sort') === value); await ready(2); }
      await button('在读').click(); await ready(1);
      await button('分组').click();
      await page.getByRole('menuitem', { name: '系列 · ' + longGroup, exact: true }).click(); await ready(1);
      assert.match(page.url(), /status=reading/);
      assert.equal(new URLSearchParams(page.url().split('?')[1]).get('q'), '异世界');
      await sort.focus(); await sort.selectOption('author'); await ready(1);
      assert.equal(await sort.evaluate(el => document.activeElement === el), true, 'sorting preserves keyboard focus');
      assert.match(page.url(), /status=reading/); assert.match(page.url(), /series=/);
      await shot('filtered-long-group');
      await page.setViewportSize({ width: 320, height: 844 }); await shot('filtered-long-group-320');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.shelf-group-active').click();
      await button('全部').click(); await ready(2);
      const image = page.locator('.shelf-screen .book-open[href$="/book/shelf-fixture-0"] .cover img');
      const src = await image.getAttribute('src'), coversBefore = coverRequests;
      await sort.selectOption('title'); await ready(2);
      assert.equal(await image.getAttribute('src'), src, 'sorting preserves mounted covers');
      assert.equal(coverRequests, coversBefore, 'sorting does not refetch covers');
      await button('清除搜索').click(); await ready();
      await page.locator('.book-card').filter({ has: page.locator('.book-open[href$="/book/shelf-fixture-0"]') }).locator('.book-more').click();
      await page.getByRole('menuitem', { name: '标记为已读', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.book-open[href$="/book/shelf-fixture-0"]')?.closest('.book-card').querySelector('.book-state')?.textContent === '已读');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
      assert.equal(await page.locator('html').getAttribute('data-mode'), 'dark', 'app shell follows the dark system color scheme');
      await shot('dark-390');
      await page.setViewportSize({ width: 1280, height: 844 }); await shot('dark-1280');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 390, height: 844 });
      const coverBox = await page.locator('.shelf-screen .cover').first().boundingBox();
      await page.mouse.move(coverBox.x + 20, coverBox.y + 20); await page.mouse.down();
      assert.equal(await page.locator('.shelf-screen .cover').first().evaluate(el => getComputedStyle(el).transform), 'none', 'reduced motion removes cover press movement');
      await page.mouse.move(1, 1); await page.mouse.up();
      await shot('reduced-motion');
      await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px'));
      await page.locator('.shelf-screen').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const bottom = await page.locator('.shelf-screen .book-card').last().boundingBox();
      const nav = await page.locator('.app-nav').boundingBox();
      if (nav) assert.ok(bottom.y + bottom.height <= nav.y + 1, 'last card stays above bottom navigation');
      await shot('safe-bottom');
      await page.locator('.shelf-screen').evaluate(el => { el.scrollTop = 0; });
      mode = 'empty'; await page.getByRole('searchbox').fill('不存在'); await page.getByRole('searchbox').press('Enter');
      await page.getByText('没有匹配的书', { exact: true }).waitFor(); await shot('empty-search');
      mode = 'normal'; delay = 700;
      await page.getByRole('searchbox').fill('勇者'); await page.getByRole('searchbox').press('Enter');
      await page.waitForFunction(() => document.querySelector('.shelf-screen .book-grid[aria-busy="true"]') || document.body.textContent.includes('正在加载书架…') || document.body.textContent.includes('正在更新'));
      assert.equal(await page.getByText('没有匹配的书', { exact: true }).count(), 0, 'pending query does not report the previous empty result');
      await shot('loading');
      await ready(2); delay = 0;
      mode = 'error'; await page.getByRole('searchbox').fill('错误夹具'); await page.getByRole('searchbox').press('Enter');
      await page.getByText('书架加载失败', { exact: true }).waitFor({ timeout: 20000 }); await shot('error');
      assert.ok(requests.length > 10);
      report.scenarios.push({ engine, functional: ['search', 'four sorts', 'state and group URL', 'book menu', 'cover identity', 'dark', 'reduced motion', 'safe bottom', 'empty', 'loading', 'error'], coverRequests });
    } finally { await browser.close(); }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(`PASS shelf layout: ${report.scenarios.length} scenario records, ${report.screenshots.length} screenshots, Chromium + WebKit`);
} finally {
  await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2));
  await server.close();
}
