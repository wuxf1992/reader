import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { LegacyProvider } from '/data/plugins/novel-web/legado.mjs';
import { ensureServices, closeServices } from '/data/plugins/novel-web/runtime.mjs';

await ensureServices();

for (const name of ['reader-browser']) {
  assert.equal((await lookup(name)).address, '127.0.0.1');
}
await import('/all-in-one/healthcheck.mjs');

const payload = {
  origin: 'http://1.1.1.1/', url: '/merge-check',
  html: '<div id="result"></div><script>document.querySelector("#result").textContent="browser-ready"</script>',
  js: 'document.querySelector("#result").textContent',
};
const rendered = await fetch('http://reader-browser:8081/render?' + new URLSearchParams({ payload: JSON.stringify(payload) }), { signal: AbortSignal.timeout(20000) });
assert.equal(await rendered.text(), 'browser-ready');
const blocked = await fetch('http://reader-browser:8081/render?' + new URLSearchParams({ payload: JSON.stringify({ ...payload, origin: 'http://127.0.0.1/', url: '/' }) }));
assert.equal(await blocked.text(), 'READER_BROWSER_ERROR:PRIVATE_DESTINATION');

const inline = html => 'data:text/html;base64,'+Buffer.from(html).toString('base64');
const text = 'JS 引擎测试正文。'.repeat(20);
const chapter = inline(`<div class="content">${text}</div>`);
const book = inline(`<h1>移植测试</h1><div class="author">测试作者</div><div id="chapters"><a href="${chapter}">第一章</a></div>`);
const source = {
  bookSourceUrl: 'https://example.com/', bookSourceName: '移植测试', bookSourceType: 0,
  searchUrl: inline(`<div class="book"><a href="${book}">移植测试</a><span class="author">测试作者</span></div>`),
  ruleSearch: { bookList: 'class.book', name: 'tag.a.0@text', bookUrl: 'tag.a.0@href', author: 'class.author.0@text' },
  ruleBookInfo: { name: 'tag.h1.0@text', author: 'class.author.0@text' },
  ruleToc: { chapterList: 'id.chapters.0@tag.a', chapterName: 'text', chapterUrl: 'href' },
  ruleContent: { content: 'class.content.0@text' },
};
const provider = new LegacyProvider();
const engine = (method, data) => provider.call(method, data, source);
const books = await engine('searchBook', { key: '移植测试', page: 1 });
assert.equal(books[0].name, '移植测试');
const chapters = await engine('getChapterList', { url: books[0].bookUrl, refresh: 1 });
assert.equal(chapters.length, 1);
assert.equal(chapters[0].title, '第一章');
assert.equal(await engine('getBookContent', { url: books[0].bookUrl, index: 0 }), text);
console.log('PASS: health, local aliases, Chromium JavaScript, private-address rejection, native JS search, TOC and content');
closeServices();
