import { createWeddingApiCore } from '../api-core.mjs';
import { createD1Store } from './d1-store.mjs';

async function readWorkerJsonBody(request, maxBytes = 16384) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    const err = new Error('Dados muito grandes.');
    err.status = 413;
    throw err;
  }
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    const err = new Error('Dados muito grandes.');
    err.status = 413;
    throw err;
  }
  try {
    const text = new TextDecoder().decode(buffer);
    return JSON.parse(text || '{}');
  } catch {
    const err = new Error('Não foi possível ler os dados enviados.');
    err.status = 400;
    throw err;
  }
}

export function createWorkerHandler() {
  let cachedDb = null;
  let cachedHandler = null;

  function getApiHandler(env) {
    if (!cachedHandler || cachedDb !== env.DB) {
      cachedDb = env.DB;
      cachedHandler = createWeddingApiCore(createD1Store(env.DB));
    }
    return cachedHandler;
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url);

      if (url.pathname === '/healthz' && (request.method === 'GET' || request.method === 'HEAD')) {
        const body = JSON.stringify({ ok: true, runtime: 'cloudflare-workers-d1' });
        return new Response(request.method === 'HEAD' ? null : body, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        });
      }

      if (url.pathname.startsWith('/api/')) {
        const apiHandler = getApiHandler(env);
        const isHttps =
          url.protocol === 'https:' ||
          String(request.headers.get('x-forwarded-proto') || '').toLowerCase() === 'https';
        const clientIp =
          request.headers.get('cf-connecting-ip') ||
          String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
          'edge';

        const result = await apiHandler({
          method: request.method,
          url,
          getHeader: (name) => request.headers.get(name) || '',
          readBodyJson: (maxBytes) => readWorkerJsonBody(request, maxBytes),
          clientIp,
          isHttps,
          runtimeOptions: {
            adminPassword: env.ADMIN_PASSWORD || 'yuri-geovanna-2027',
            sessionSecret: env.SESSION_SECRET || '',
            allowedOrigin: env.GUESTBOOK_ALLOWED_ORIGIN || ''
          }
        });

        if (result) {
          return new Response(result.body, { status: result.status, headers: result.headers });
        }
      }

      if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
        return new Response('Assets binding indisponível.', { status: 404 });
      }

      if (url.pathname === '/admin' || url.pathname === '/admin/') {
        const rewritten = new URL(url.toString());
        rewritten.pathname = '/admin.html';
        return env.ASSETS.fetch(new Request(rewritten.toString(), request));
      }

      if (url.pathname === '/casamento-yuri-geovanna.ics') {
        const res = await env.ASSETS.fetch(request);
        const headers = new Headers(res.headers);
        headers.set('Content-Type', 'text/calendar; charset=utf-8');
        headers.set('Content-Disposition', 'inline; filename="casamento-yuri-geovanna.ics"');
        return new Response(res.body, { status: res.status, headers });
      }

      return env.ASSETS.fetch(request);
    }
  };
}

export default createWorkerHandler();
