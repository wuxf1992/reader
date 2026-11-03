import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID } from './server.mjs';
const server = createReviewServer({ port: 0 }), origin = await server.listen();
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch();
    try {
      for (const mobile of [true, false]) {
        const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: 844 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
        try {
          await context.route('https://wuxf.top/**', route => route.abort());
          const page = await context.newPage(); page.setDefaultTimeout(8000);
          await page.goto(origin + '/#/shelf');
          await page.getByText('更换服务地址', { exact: true }).click();
          await page.locator('input[type=url]').fill(origin);
          await page.locator('input[autocomplete=username]').fill('review');
          await page.locator('input[type=password]').fill('password12');
          await page.locator('button[type=submit]').click();
          const card = page.locator(`[data-shelf-book-id="${BOOK_ID}"]`).first();
          await card.waitFor();
          for (const selector of ['.cover', '.title']) {
            const opens = await card.locator(selector).evaluate(element => {
              const b = element.getBoundingClientRect();
              return !!document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.book-open');
            });
            assert(opens, `${name} ${mobile ? 'phone' : 'desktop'}: ${selector} must open the book, not its action menu`);
          }
          await card.locator('.cover').click();
          await page.waitForURL('**/#/book/' + BOOK_ID);
          await page.evaluate(() => { location.hash = '#/shelf'; });
          await card.locator('.book-more').click();
          await page.getByText('标记为想读', { exact: true }).waitFor();
          console.log(`PASS ${name} ${mobile ? 'phone' : 'desktop'}: cover/title hit targets, direct open and action menu`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
