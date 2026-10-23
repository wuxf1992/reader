import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createReviewServer, BOOK_ID, ILLUSTRATED_ID } from './server.mjs';

const output = '/tmp/reader-chinese-review';
const server = createReviewServer({ port: 0 });
const origin = await server.listen();
const reports = [];
const simplified = '头发发展，干净干活，皇后后来。';
const traditional = '頭髮發展，乾淨幹活，皇后後來。';
const raw = `第一章 原文\n\n${simplified}\n\n${traditional}\n\n${Array.from({ length: 65 }, (_, i) => `第${i}段：${simplified}走过山河，看见远方。`).join('\n\n')}`;
await mkdir(output, { recursive: true });
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
        const errors = [], spoken = [], navigationAborts = [];
        let reloading = false;
        page.on('pageerror', error => {
          if (reloading && error.message === `/${new URL(origin).host}/api/v1/sync due to access control checks.`) navigationAborts.push(error.message);
          else errors.push(error.message);
        });
        await page.exposeFunction('reviewSpoken', text => spoken.push(text));
        await page.addInitScript(() => {
          Object.defineProperty(window, 'speechSynthesis', { value: {
            getVoices: () => [{ voiceURI: 'review', name: 'Review', lang: 'zh-CN', default: true }],
            addEventListener() {}, removeEventListener() {}, cancel() {}, pause() {}, resume() {},
            speak(utterance) { window.reviewSpoken(utterance.text); },
          } });
          window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        });
        await page.route('https://wuxf.top/**', route => route.abort());
        await page.route(`**/api/v1/books/${BOOK_ID}/assets?*`, route => route.fulfill({ contentType: 'text/plain; charset=utf-8', body: raw }));
        await page.goto(origin);
        await page.getByText('更换服务地址', { exact: true }).click();
        await page.locator('input[type=url]').fill(origin);
        await page.locator('input[autocomplete=username]').fill('review');
        await page.locator('input[type=password]').fill('password12');
        await page.locator('button[type=submit]').click();
        await page.locator('.app-shell').waitFor();
        await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
        const flow = page.locator('book-content .book-flow');
        await flow.waitFor();
        await page.waitForFunction(value => document.querySelector('book-content')?.shadowRoot.querySelector('.book-flow')?.textContent.includes(value), simplified);
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByRole('group', { name: '翻页方式', exact: true }).getByRole('button', { name: '翻页', exact: true }).click();
        await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
        await page.locator('.progress-scrubber').evaluate(slider => { slider.value = '3'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForFunction(() => document.querySelector('.progress-page')?.textContent.includes('第 3/'));
        const position = await page.locator('.progress-scrubber').inputValue();
        await page.getByRole('button', { name: '外观', exact: true }).click();
        const choices = page.getByRole('group', { name: '繁简转换（全局）', exact: true });
        await choices.getByRole('button', { name: '繁体', exact: true }).click();
        await page.waitForFunction(value => document.querySelector('book-content')?.shadowRoot.querySelector('.book-flow')?.textContent.includes(value), traditional);
        assert.equal(await choices.getByRole('button', { name: '繁体', exact: true }).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.progress-scrubber').inputValue(), position, 'conversion keeps the current page');
        const dimensions = await page.locator('.sheet').evaluate(panel => ({ width: panel.clientWidth, scroll: panel.scrollWidth }));
        assert.ok(dimensions.scroll <= dimensions.width + 1, 'settings fit the screen');
        await page.screenshot({ path: `${output}/${name}-${width}-settings.png` });
        await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
        await page.getByRole('button', { name: '朗读', exact: true }).click();
        await page.getByRole('button', { name: '从当前位置朗读', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.tts-bar') !== null);
        assert.ok(spoken.some(text => text.includes('頭髮')), 'TTS uses the displayed text');
        await page.getByRole('button', { name: '停止朗读', exact: true }).click();
        if (await page.locator('.sheet').count()) await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
        await page.screenshot({ path: `${output}/${name}-${width}-traditional.png` });
        reloading = true;
        await page.reload();
        await page.waitForFunction(value => document.querySelector('book-content')?.shadowRoot.querySelector('.book-flow')?.textContent.includes(value), traditional);
        reloading = false;
        assert.ok((await flow.textContent()).includes(traditional), 'reload restores the global preference');
        await page.evaluate(book => { location.hash = '#/book/' + book; }, ILLUSTRATED_ID);
        await page.locator('book-content .book-flow img').first().waitFor();
        await page.getByRole('button', { name: '外观', exact: true }).click();
        assert.equal(await choices.getByRole('button', { name: '繁体', exact: true }).getAttribute('aria-pressed'), 'true', 'another book shares the preference');
        await choices.getByRole('button', { name: '简体', exact: true }).click();
        await choices.getByRole('button', { name: '原文', exact: true }).click();
        await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
        await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
        await page.waitForFunction(value => document.querySelector('book-content')?.shadowRoot.querySelector('.book-flow')?.textContent.includes(value), simplified);
        await page.getByRole('button', { name: '外观', exact: true }).click();
        await choices.getByRole('button', { name: '简体', exact: true }).click();
        await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
        await page.waitForFunction(value => !document.querySelector('book-content')?.shadowRoot.querySelector('.book-flow')?.textContent.includes(value), traditional);
        await page.getByRole('button', { name: '外观', exact: true }).click();
        await choices.getByRole('button', { name: '原文', exact: true }).click();
        await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
        const original = await flow.textContent();
        assert.ok(original.includes(simplified) && original.includes(traditional), 'original recovers both source scripts');
        await page.evaluate(() => { location.hash = '#/shelf'; });
        await page.getByRole('button', { name: /^书架设置 · / }).click();
        const globalChoice = page.getByRole('dialog', { name: '书架设置', exact: true }).getByRole('group', { name: '繁简转换（全局）', exact: true });
        await globalChoice.waitFor();
        assert.equal(await globalChoice.getByRole('button', { name: '原文', exact: true }).getAttribute('aria-pressed'), 'true');
        await globalChoice.getByRole('button', { name: '繁体', exact: true }).click();
        await page.getByRole('dialog', { name: '书架设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
        await page.evaluate(book => { location.hash = '#/book/' + book; }, BOOK_ID);
        await page.waitForFunction(value => document.querySelector('book-content')?.shadowRoot.querySelector('.book-flow')?.textContent.includes(value), traditional);
        assert.deepEqual(errors, []);
        reports.push({ browser: name, width, passed: true, preservedPage: position, spoken: spoken.length, navigationAbortWarnings: navigationAborts.length });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify(reports));
} finally { server.server.closeAllConnections(); await server.close(); }
