import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function validateMessage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Informe seu nome e sua mensagem.');
  if (input.website) throw new Error('Não foi possível publicar este recado.');
  if (typeof input.name !== 'string' || typeof input.message !== 'string') throw new Error('Informe seu nome e sua mensagem.');
  const name = input.name.toWellFormed().normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  const message = input.message.toWellFormed().normalize('NFC').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
  if (name.length < 1 || name.length > 80) throw new Error('Escreva um nome de até 80 caracteres.');
  if (message.length < 3 || message.length > 600) throw new Error('Escreva um recado de 3 a 600 caracteres.');
  if (typeof input.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)) throw new Error('Recarregue o convite e tente enviar novamente.');
  return {name,message,requestId:input.requestId.toLowerCase()};
}

export function validateRsvp(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Informe seu nome e sua resposta.');
  if (input.website) throw new Error('Não foi possível enviar esta confirmação.');
  if (typeof input.name !== 'string') throw new Error('Informe seu nome.');
  const name = input.name.toWellFormed().normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if (name.length < 1 || name.length > 120) throw new Error('Escreva um nome de até 120 caracteres.');
  if (!['yes','no'].includes(input.response)) throw new Error('Escolha se poderá comparecer.');
  if (!Number.isInteger(input.companions) || input.companions < 0 || input.companions > 20) throw new Error('Informe de 0 a 20 acompanhantes.');
  if (input.response === 'no' && input.companions !== 0) throw new Error('Quem não comparecer deve informar zero acompanhantes.');
  if (typeof input.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)) throw new Error('Recarregue o convite e tente enviar novamente.');
  return {name,response:input.response,companions:input.companions,requestId:input.requestId.toLowerCase()};
}

export function createGuestbookStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), {recursive:true});
  const database = new DatabaseSync(filename);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      message TEXT NOT NULL CHECK(length(message) BETWEEN 3 AND 600),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rsvps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      response TEXT NOT NULL CHECK(response IN ('yes','no')),
      companions INTEGER NOT NULL CHECK(typeof(companions) = 'integer' AND companions BETWEEN 0 AND 20),
      created_at TEXT NOT NULL
    );`);
  const fields = 'id, name, message, created_at AS createdAt';
  const byRequest = database.prepare(`SELECT ${fields} FROM messages WHERE request_id = ?`);
  const insert = database.prepare('INSERT INTO messages (request_id,name,message,created_at) VALUES (?,?,?,?)');
  const latest = database.prepare(`SELECT ${fields} FROM messages ORDER BY id DESC LIMIT 13`);
  const older = database.prepare(`SELECT ${fields} FROM messages WHERE id < ? ORDER BY id DESC LIMIT 13`);
  const rsvpFields = 'id, name, response, companions, created_at AS createdAt';
  const rsvpByRequest = database.prepare(`SELECT ${rsvpFields} FROM rsvps WHERE request_id = ?`);
  const insertRsvp = database.prepare('INSERT INTO rsvps (request_id,name,response,companions,created_at) VALUES (?,?,?,?,?)');
  return {
    addRsvp(input) {
      const data = validateRsvp(input);
      const existing = rsvpByRequest.get(data.requestId);
      if (existing) {
        if (existing.name !== data.name || existing.response !== data.response || existing.companions !== data.companions) { const error = new Error('Este envio já foi usado para outra confirmação. Edite sua resposta e tente novamente.'); error.status = 409; throw error; }
        return {confirmation:existing,created:false};
      }
      insertRsvp.run(data.requestId,data.name,data.response,data.companions,new Date().toISOString());
      return {confirmation:rsvpByRequest.get(data.requestId),created:true};
    },
    exportRsvps() { return database.prepare(`SELECT ${rsvpFields} FROM rsvps ORDER BY id`).all(); },
    add(input) {
      const data = validateMessage(input);
      const existing = byRequest.get(data.requestId);
      if (existing) {
        if (existing.name !== data.name || existing.message !== data.message) { const error = new Error('Este envio já foi usado para outro recado. Edite o texto e tente novamente.'); error.status = 409; throw error; }
        return {message:existing,created:false};
      }
      insert.run(data.requestId,data.name,data.message,new Date().toISOString());
      return {message:byRequest.get(data.requestId),created:true};
    },
    list(before) {
      if (before !== null && before !== undefined && (!/^\d+$/.test(String(before)) || !Number.isSafeInteger(Number(before)) || Number(before) <= 0)) { const error = new Error('Página inválida.'); error.status = 400; throw error; }
      const rows = before ? older.all(Number(before)) : latest.all();
      const hasMore = rows.length > 12;
      const messages = rows.slice(0,12);
      return {messages,nextCursor:hasMore ? String(messages.at(-1).id) : null};
    },
    export() { return database.prepare(`SELECT ${fields} FROM messages ORDER BY id`).all(); },
    remove(id) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Informe um ID numérico válido.');
      return Number(database.prepare('DELETE FROM messages WHERE id = ?').run(id).changes);
    },
    close() { database.close(); }
  };
}

export function createGuestbookApi(store, options = {}) {
  const allowedOrigin = options.allowedOrigin || '';
  const attempts = new Map();
  return async function handleGuestbook(request,response,url) {
    const isRsvp = url.pathname === '/api/rsvps';
    if (!isRsvp && url.pathname !== '/api/messages') return false;
    const allowedMethods = isRsvp ? 'POST, OPTIONS' : 'GET, POST, OPTIONS';
    const json = (status,value) => {
      response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      response.end(JSON.stringify(value));
    };
    const origin = request.headers.origin;
    const ownOrigin = url.origin;
    let sameHostOrigin = false;
    try { const parsed = new URL(origin); sameHostOrigin = ['http:','https:'].includes(parsed.protocol) && parsed.host === url.host; } catch { /* Origin ausente ou inválida. */ }
    if (origin && origin !== ownOrigin && !sameHostOrigin && origin !== allowedOrigin) { json(403,{error:'Origem não autorizada.'}); return true; }
    if (origin && origin === allowedOrigin) { response.setHeader('Access-Control-Allow-Origin',origin); response.setHeader('Vary','Origin'); }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods',allowedMethods);
      response.setHeader('Access-Control-Allow-Headers','Content-Type');
      response.writeHead(204);response.end();return true;
    }
    if (request.method === 'GET' && !isRsvp) {
      try { json(200,store.list(url.searchParams.has('before') ? url.searchParams.get('before') : null)); }
      catch(error) { json(error.status || 500,{error:error.status ? error.message : 'Não foi possível carregar os recados.'}); }
      return true;
    }
    if (request.method !== 'POST') { response.setHeader('Allow',allowedMethods); json(405,{error:'Método não permitido.'}); return true; }
    if (!(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { json(415,{error:'Envie os dados no formato JSON.'}); return true; }
    const now = Date.now();
    for (const [key,value] of attempts) if (value.expires < now) attempts.delete(key);
    const address = request.socket.remoteAddress || 'local';
    const limit = attempts.get(address) || {count:0,expires:now+60000};
    if (limit.count >= 8) { response.setHeader('Retry-After',String(Math.ceil((limit.expires-now)/1000)));json(429,{error:'Aguarde um minuto antes de enviar mais recados.'}); return true; }
    if (attempts.size >= 10000 && !attempts.has(address)) { json(503,{error:'O mural está ocupado. Tente novamente em instantes.'}); return true; }
    limit.count++; attempts.set(address,limit);
    try {
      if (Number(request.headers['content-length'] || 0) > 4096) { json(413,{error:'Mensagem muito grande.'});return true; }
      let size=0; const chunks=[];
      for await (const chunk of request) { size+=chunk.length; if (size <= 4096) chunks.push(chunk); }
      if (size > 4096) {json(413,{error:'Mensagem muito grande.'});return true;}
      let data;
      try { data=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {json(400,{error:'Não foi possível ler o recado.'});return true;}
      let result;
      try { (isRsvp ? validateRsvp : validateMessage)(data); } catch(error) {json(400,{error:error.message});return true;}
      result=isRsvp ? store.addRsvp(data) : store.add(data);
      json(result.created ? 201 : 200,result);
    } catch(error) {json(error.status || 500,{error:error.status ? error.message : 'Não foi possível salvar o recado. Tente novamente.'});}
    return true;
  };
}
