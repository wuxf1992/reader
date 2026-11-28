import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as http, type IncomingMessage } from 'node:http';
import { request as https } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { AppError, badRequest, notFound } from '../lib/errors.ts';

export interface PlaybackRequest {
  title: string;
  url: string;
}

interface Asset {
  url: URL;
  kind: 'hls' | 'file' | 'audio' | 'part';
  mime?: string;
}
interface Session {
  owner: { userId: string; sourceId: string; authVersion: number };
  expires: number;
  assets: Map<string, Asset>;
  references: Map<string, string>;
  bytes: number;
}

const PLAYLIST_LIMIT = 1024 * 1024;
const SESSION_LIMIT = 64;
const ASSET_LIMIT = 8192;
const invalidMedia = () => badRequest('来源未提供可直接播放的音视频或 HLS 地址', 'SOURCE_PLAYBACK_URL');
const upstreamError = () => new AppError(502, 'SOURCE_PLAYBACK_UPSTREAM', '媒体来源暂时无法播放，请换一集或稍后重试');
const token = () => randomBytes(18).toString('base64url');

function publicUrl(value: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw invalidMedia();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
    !url.hostname.includes('.') ||
    url.href.length > 8192
  )
    throw invalidMedia();
  url.hash = '';
  return url;
}

const AUDIO_MIMES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

export function playbackKind(url: URL): 'hls' | 'file' | 'audio' {
  if (/\.m3u8$/i.test(url.pathname)) return 'hls';
  if (/\.mp4$/i.test(url.pathname)) return 'file';
  const ext = /\.[a-z0-9]+$/i.exec(url.pathname)?.[0]?.toLowerCase();
  if (ext && AUDIO_MIMES[ext]) return 'audio';
  throw invalidMedia();
}

function playbackMime(url: URL, kind: 'hls' | 'file' | 'audio'): string {
  if (kind === 'hls') return 'application/vnd.apple.mpegurl';
  if (kind === 'file') return 'video/mp4';
  const ext = /\.[a-z0-9]+$/i.exec(url.pathname)?.[0]?.toLowerCase();
  return (ext && AUDIO_MIMES[ext]) || 'audio/mpeg';
}

export class SourcePlayback {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly open = loadPublicMedia) {}

  create(owner: Session['owner'], request: PlaybackRequest) {
    const url = publicUrl(request.url);
    const kind = playbackKind(url);
    const id = token();
    const session: Session = {
      owner,
      expires: Date.now() + 4 * 3600_000,
      assets: new Map(),
      references: new Map(),
      bytes: 0,
    };
    const asset = this.add(session, { url, kind, mime: playbackMime(url, kind) });
    for (const [old, entry] of this.sessions) if (entry.expires <= Date.now()) this.sessions.delete(old);
    if (this.sessions.size >= SESSION_LIMIT) this.sessions.delete(this.sessions.keys().next().value!);
    this.sessions.set(id, session);
    return { title: request.title, kind, path: `/api/v1/sources/playback/${id}/${asset}` };
  }

  async read(
    id: string,
    asset: string,
    mayPlay: (owner: Session['owner']) => boolean,
    range: string | undefined,
    signal: AbortSignal,
  ) {
    const session = this.sessions.get(id);
    const target = session?.assets.get(asset);
    if (!session || !target || session.expires <= Date.now() || !mayPlay(session.owner))
      throw notFound('播放链接已失效，请重新选集', 'SOURCE_PLAYBACK_EXPIRED');
    if (range && !/^bytes=(?:\d{1,16}-\d{0,16}|-\d{1,16})$/.test(range))
      throw new AppError(416, 'SOURCE_PLAYBACK_RANGE', '视频不支持该分段范围');
    const { response, url } = await this.open(target.url, target.kind === 'hls' ? undefined : range, signal);
    const status = response.statusCode ?? 502;
    const headers = response.headers;
    if (status === 416) {
      response.destroy();
      return { status, headers: { 'content-range': header(headers['content-range']) }, body: '' };
    }
    if (status !== 200 && status !== 206) {
      response.destroy();
      throw upstreamError();
    }
    const type = header(headers['content-type']).split(';')[0]!.toLowerCase();
    if (
      target.kind === 'hls' ||
      ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl'].includes(type)
    ) {
      const playlist = await readPlaylist(response);
      return {
        status: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        body: rewritePlaylist(playlist, (value, isPlaylist) =>
          this.add(session, {
            url: publicUrl(value, url),
            kind: isPlaylist ? 'hls' : 'part',
          }),
        ),
      };
    }
    if (
      /(?:^text\/|html|xml|javascript|image\/|json)/i.test(type) ||
      (status === 206 && !/^bytes \d+-\d+\/(?:\d+|\*)$/.test(header(headers['content-range'])))
    ) {
      response.destroy();
      throw upstreamError();
    }
    return {
      status,
      headers: {
        'content-type': target.mime ?? (target.kind === 'file' ? 'video/mp4' : 'application/octet-stream'),
        'accept-ranges': header(headers['accept-ranges']),
        'content-length': header(headers['content-length']),
        'content-range': header(headers['content-range']),
      },
      body: response,
    };
  }

  private add(session: Session, asset: Asset): string {
    const key = asset.kind + ':' + asset.url.href;
    const previous = session.references.get(key);
    if (previous) return previous;
    const bytes = Buffer.byteLength(key);
    if (session.assets.size >= ASSET_LIMIT || session.bytes + bytes > 2 * PLAYLIST_LIMIT) throw upstreamError();
    const id = token();
    session.assets.set(id, asset);
    session.references.set(key, id);
    session.bytes += bytes;
    return id;
  }
}

function header(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

async function readPlaylist(response: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > PLAYLIST_LIMIT) throw upstreamError();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/^\uFEFF/, '');
}

export function rewritePlaylist(playlist: string, resolve: (uri: string, playlist: boolean) => string): string {
  if (!/^#EXTM3U(?:\r?\n|$)/.test(playlist) || /\{\$/.test(playlist)) throw upstreamError();
  let variant = false;
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith('#')) {
        if (line.startsWith('#EXT-X-STREAM-INF:')) variant = true;
        const includesPlaylist = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|IMAGE-STREAM-INF|RENDITION-REPORT):/.test(line);
        return line.replace(
          /([,:](?:[A-Z0-9-]+-)?URI=)"([^"]+)"/g,
          (_, attribute: string, url: string) => `${attribute}"${resolve(url, includesPlaylist)}"`,
        );
      }
      const path = resolve(line.trim(), variant || /\.m3u8(?:[?#]|$)/i.test(line));
      variant = false;
      return path;
    })
    .join('\n');
}

async function loadPublicMedia(url: URL, range: string | undefined, signal: AbortSignal) {
  try {
    for (let redirects = 0; redirects < 5; redirects++) {
      signal.throwIfAborted();
      const addresses = await lookup(url.hostname, { all: true });
      if (!addresses.length || addresses.some(({ address }) => ipaddr.process(address).range() !== 'unicast'))
        throw invalidMedia();
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        const headers = { 'accept-encoding': 'identity', ...(range ? { range } : {}) };
        const get = url.protocol === 'https:' ? https : http;
        const request = get(
          url,
          {
            signal,
            headers,
            agent: false,
            // Use the checked answer for this connection, including redirects and HLS children.
            lookup: (_host, options, callback) => {
              if (options.all) callback(null, addresses);
              else callback(null, addresses[0]!.address, addresses[0]!.family);
            },
          },
          resolve,
        );
        request.setTimeout(20_000, () => request.destroy(upstreamError()));
        request.once('error', reject);
        request.end();
      });
      if (![301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) return { response, url };
      const location = header(response.headers.location);
      response.destroy();
      if (!location) break;
      url = publicUrl(location, url);
    }
    throw upstreamError();
  } catch {
    throw upstreamError();
  }
}
