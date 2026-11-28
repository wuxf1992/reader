import type { FastifyRequest } from 'fastify';

export function requestLogPath(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path.replace(/^(\/api\/v1\/sources\/playback)\/[^/]+\/[^/]+$/, '$1/:ticket/:asset');
}

export function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: requestLogPath(request.url),
    hostname: request.hostname,
    remoteAddress: request.ip,
  };
}
