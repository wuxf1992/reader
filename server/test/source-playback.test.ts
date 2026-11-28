import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { SourcePlayback } from '../src/sources/source-playback.ts';

const owner = { userId: 'admin', sourceId: 'videos', authVersion: 1 };
const signal = new AbortController().signal;

function response(body: string, type: string, statusCode = 200, headers = {}): IncomingMessage {
  return Object.assign(Readable.from([body]), {
    statusCode,
    headers: { 'content-type': type, ...headers },
  }) as IncomingMessage;
}

function parts(path: string): [string, string] {
  const [ticket, asset] = path.split('/').slice(-2);
  assert.ok(ticket && asset);
  return [ticket, asset];
}

test('HLS master, variants, keys and segments use opaque playback URLs and recheck permission', async () => {
  const playback = new SourcePlayback(async (url, range) => {
    if (url.pathname.endsWith('master.m3u8'))
      return {
        url: new URL('https://cdn.example.test/current/master.m3u8'),
        response: response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nindex\n', 'application/vnd.apple.mpegurl'),
      };
    if (url.pathname === '/current/index')
      return {
        url,
        response: response(
          '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="keys/key"\n#EXTINF:4,\n../chunk.ts\n#EXT-X-ENDLIST\n',
          'application/octet-stream',
        ),
      };
    assert.equal(url.href, 'https://cdn.example.test/chunk.ts');
    assert.equal(range, 'bytes=1-2');
    return { url, response: response('xy', 'video/mp2t', 206, { 'content-range': 'bytes 1-2/10' }) };
  });
  const initial = playback.create(owner, { title: '样片', url: 'https://video.example.test/master.m3u8' });
  assert.equal(initial.kind, 'hls');
  assert.ok(!JSON.stringify(initial).includes('example.test'));
  const [ticket, root] = parts(initial.path);
  let active = true;
  const mayPlay = (value: typeof owner) => active && value === owner;
  const master = await playback.read(ticket, root, mayPlay, undefined, signal);
  const variant = String(master.body).split('\n')[2]!;
  assert.match(variant, /^[\w-]{24}$/);
  const playlist = await playback.read(ticket, variant, mayPlay, undefined, signal);
  const text = String(playlist.body);
  assert.match(text, /URI="[\w-]{24}"/);
  assert.ok(!text.includes('chunk.ts'));
  const segment = text.split('\n')[3]!;
  const result = await playback.read(ticket, segment, mayPlay, 'bytes=1-2', signal);
  assert.equal(result.status, 206);
  assert.equal(result.headers['content-range'], 'bytes 1-2/10');
  assert.ok(result.body instanceof Readable);
  active = false;
  await assert.rejects(playback.read(ticket, segment, mayPlay, undefined, signal), { code: 'SOURCE_PLAYBACK_EXPIRED' });
  await assert.rejects(
    playback.read(ticket, 'unissued', () => true, undefined, signal),
    { code: 'SOURCE_PLAYBACK_EXPIRED' },
  );
});

test('MP4 streams bytes with Range and rejects invalid URLs and non-media pages', async () => {
  const playback = new SourcePlayback(async (url, range) => {
    if (url.pathname === '/video.mp4') {
      assert.equal(range, 'bytes=0-3');
      return { url, response: response('test', 'video/mp4', 206, { 'content-range': 'bytes 0-3/10' }) };
    }
    return { url, response: response('<html>not a video</html>', 'text/html') };
  });
  const video = playback.create(owner, { title: '样片', url: 'https://video.example.test/video.mp4?t=key' });
  const [ticket, asset] = parts(video.path);
  const result = await playback.read(ticket, asset, () => true, 'bytes=0-3', signal);
  assert.equal(result.headers['content-type'], 'video/mp4');
  assert.equal(result.status, 206);
  await assert.rejects(
    playback.read(ticket, asset, () => true, 'bytes=0-2,4-5', signal),
    { code: 'SOURCE_PLAYBACK_RANGE' },
  );
  assert.throws(() => playback.create(owner, { title: 'invalid', url: 'http://127.0.0.1/hidden.mp4' }), {
    code: 'SOURCE_PLAYBACK_URL',
  });
  assert.throws(() => playback.create(owner, { title: 'invalid', url: 'https://video.example.test/watch.html' }), {
    code: 'SOURCE_PLAYBACK_URL',
  });
  const html = playback.create(owner, { title: '样片', url: 'https://video.example.test/html.mp4' });
  await assert.rejects(
    playback.read(...parts(html.path), () => true, undefined, signal),
    { code: 'SOURCE_PLAYBACK_UPSTREAM' },
  );
});
