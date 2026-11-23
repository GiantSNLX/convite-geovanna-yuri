import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGuestbookStore, createGuestbookApi } from './guestbook.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ics': 'text/calendar; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.md': 'text/plain; charset=utf-8'
};
const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};

export function createPreviewServer(root = projectRoot, options = {}) {
  let store;
  let guestbookApi;
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const finish = (code, message) => {
      response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    try {
      const url = new URL(request.url, 'http://' + (request.headers.host || '127.0.0.1'));
      if (url.pathname.startsWith('/api/')) {
        if (!store) {
          store = createGuestbookStore(options.databasePath || process.env.GUESTBOOK_DB_PATH || path.join(root, '.data', 'messages.sqlite'));
          guestbookApi = createGuestbookApi(store, {
            allowedOrigin: options.allowedOrigin || process.env.GUESTBOOK_ALLOWED_ORIGIN || '',
            adminPassword: options.adminPassword || process.env.ADMIN_PASSWORD || ''
          });
        }
        if (await guestbookApi(request, response, url)) return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        finish(405, 'Método não permitido.');
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      } catch {
        finish(400, 'Endereço inválido.');
        return;
      }
      if (pathname.includes('\0') || pathname.includes('\\')) {
        finish(400, 'Endereço inválido.');
        return;
      }
      if (pathname === '/admin' || pathname === '/admin/') {
        pathname = '/admin.html';
      }
      // Arquivos de trabalho, banco, testes e credenciais nunca são públicos.
      const target = path.resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
      if (!isInside(path.resolve(root), target)) {
        finish(403, 'Acesso negado.');
        return;
      }
      const allowed =
        pathname === '/' ||
        /^\/(?:index\.html|admin\.html|admin\.js|styles\.css|app\.js|experience\.js|config\.js|gallery\.js|casamento-yuri-geovanna\.ics)$/.test(pathname) ||
        /^\/assets\//.test(pathname);
      if (!allowed || pathname.split('/').some((segment) => segment.startsWith('.'))) {
        finish(404, 'Arquivo não encontrado.');
        return;
      }
      const [resolvedRoot, resolvedTarget] = await Promise.all([realpath(root), realpath(target)]);
      if (!isInside(resolvedRoot, resolvedTarget)) {
        finish(403, 'Acesso negado.');
        return;
      }
      const info = await stat(resolvedTarget);
      if (!info.isFile()) {
        finish(404, 'Arquivo não encontrado.');
        return;
      }
      const ext = path.extname(resolvedTarget).toLowerCase();
      const headers = { 'Content-Type': types[ext] || 'application/octet-stream', 'Content-Length': info.size };
      if (ext === '.ics') headers['Content-Disposition'] = 'inline; filename="casamento-yuri-geovanna.ics"';
      response.writeHead(200, headers);
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(resolvedTarget);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      finish(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, 'Arquivo não encontrado.');
    }
  });
  server.requestTimeout = 15000;
  server.on('close', () => {
    if (store) store.close();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const position = process.argv.indexOf('--port');
  const port = Number(position >= 0 ? process.argv[position + 1] : process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('Informe uma porta válida.');
    process.exitCode = 1;
  } else {
    const editorial = process.argv.includes('--editorial');
    const root = editorial ? path.join(projectRoot, '.versions', 'editorial') : projectRoot;
    const server = createPreviewServer(root, { databasePath: process.env.GUESTBOOK_DB_PATH || path.join(projectRoot, '.data', 'messages.sqlite') });
    server.on('error', (error) => {
      console.error('Não foi possível iniciar a prévia:', error.message);
      process.exitCode = 1;
    });
    const host = process.env.HOST || '127.0.0.1';
    server.listen(port, host, () => console.log(`Convite "Nossa história, nossa jornada" disponível em http://${host}:${server.address().port} (Painel: http://${host}:${server.address().port}/admin)`));
    const stop = () => server.close();
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
}
