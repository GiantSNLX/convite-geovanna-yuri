import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable, Writable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createGuestbookStore } from '../guestbook.mjs';
import { createPreviewServer } from '../server.mjs';
import { buildCsv, escapeCsvCell } from '../scripts/csv.mjs';
import { createWorkerHandler } from '../cloudflare/worker.mjs';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const experience = require(path.join(projectRoot, 'experience.js'));
const WeddingQR = require(path.join(projectRoot, 'qr.js'));

function loadWeddingUtils() {
  const sandbox = { window: {}, URLSearchParams, Intl, Date, Math, Number, String, Error };
  sandbox.window = sandbox;
  vm.runInNewContext(readFileSync(path.join(projectRoot, 'app.js'), 'utf8'), sandbox);
  return sandbox.WeddingUtils;
}

const WeddingUtils = loadWeddingUtils();

const sampleConfig = {
  couple: { firstNames: 'Yuri & Geovanna' },
  event: {
    date: '2027-01-13',
    dateConfirmed: true,
    startTime: '19:00',
    endTime: '',
    timeZone: 'America/Manaus',
    venue: 'Casa Colonial',
    fullVenue: 'Casa Colonial Festas & Eventos',
    address: 'R. Ovídio Gomes Monteiro, 2020 — Manaus'
  },
  rsvp: { allowCompanions: true },
  site: { url: 'https://exemplo.github.io/convite/' }
};

function dispatchRequest(server, { method = 'GET', url = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === null ? [] : [Buffer.from(body)]);
    req.method = method;
    req.url = url;
    req.headers = { host: '127.0.0.1:4173', ...headers };
    req.socket = { remoteAddress: '127.0.0.1' };

    const chunks = [];
    const headerMap = {};
    let statusCode = 200;

    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    res.setHeader = (name, value) => {
      headerMap[name.toLowerCase()] = value;
    };
    res.writeHead = (code, extraHeaders = {}) => {
      statusCode = code;
      for (const [key, value] of Object.entries(extraHeaders)) {
        headerMap[key.toLowerCase()] = value;
      }
    };
    res.on('finish', () => {
      resolve({
        status: statusCode,
        headers: headerMap,
        text: () => Buffer.concat(chunks).toString('utf8'),
        json: () => JSON.parse(Buffer.concat(chunks).toString('utf8'))
      });
    });
    res.on('error', reject);
    server.emit('request', req, res);
  });
}

test('WeddingUtils converts America/Manaus time to UTC, masks phone and builds Google, Outlook and Apple ICS', () => {
  const utc = WeddingUtils.zonedDateTimeToUTC('2027-01-13', '19:00', 'America/Manaus');
  assert.equal(utc.toISOString(), '2027-01-13T23:00:00.000Z');
  assert.equal(WeddingUtils.maskPhone('(92) 99123-4567'), 'final 4567');

  const gcal = new URL(WeddingUtils.buildGoogleCalendarUrl(sampleConfig));
  assert.equal(gcal.searchParams.get('dates'), '20270113T230000Z/20270114T030000Z');
  assert.equal(gcal.searchParams.get('ctz'), 'America/Manaus');

  const outlook = new URL(WeddingUtils.buildOutlookCalendarUrl(sampleConfig));
  assert.equal(outlook.origin + outlook.pathname, 'https://outlook.live.com/calendar/0/deeplink/compose');
  assert.equal(outlook.searchParams.get('startdt'), '2027-01-13T23:00:00.000Z');
  assert.equal(outlook.searchParams.get('enddt'), '2027-01-14T03:00:00.000Z');
  assert.equal(outlook.searchParams.get('subject'), 'Casamento de Yuri & Geovanna');

  const ics = WeddingUtils.buildICS(sampleConfig, new Date('2026-11-19T12:00:00Z'));
  assert.match(ics, /METHOD:PUBLISH/);
  assert.match(ics, /DTSTART:20270113T230000Z/);
  assert.match(ics, /DTEND:20270114T030000Z/);
  assert.match(ics, /SUMMARY:Casamento de Yuri & Geovanna/);
  assert.match(ics, /URL:https:\/\/exemplo\.github\.io\/convite\//);
});

test('WeddingExperience computes future, today and started countdown states in Manaus', () => {
  const future = experience.getCountdown('2027-01-13T23:00:00Z', '2027-01-12T22:00:00Z');
  assert.equal(future.state, 'future');
  assert.equal(future.days, 1);

  const today = experience.getCountdown('2027-01-13T23:00:00Z', '2027-01-13T12:00:00Z');
  assert.equal(today.state, 'today');
  assert.equal(today.hours, 11);

  const started = experience.getCountdown('2027-01-13T23:00:00Z', '2027-01-13T23:00:00Z');
  assert.equal(started.state, 'started');
  assert.equal(started.seconds, 0);
});

test('GuestbookStore handles message moderation, family invites, seat limits, updates and overview metrics', () => {
  const store = createGuestbookStore(':memory:');
  try {
    const reqId = '11111111-1111-4111-8111-111111111111';
    const first = store.add({ name: 'Ana', message: 'Felicidades x\ud800y!', requestId: reqId });
    assert.equal(first.created, true);
    assert.equal(first.message.status, 'pending');

    // Mensagem pendente não aparece no mural público até aprovação
    assert.equal(store.list().messages.length, 0);
    store.setMessageStatus(first.message.id, 'approved');
    assert.equal(store.list().messages.length, 1);

    const retry = store.add({ name: 'Ana', message: 'Felicidades x\ud800y!', requestId: reqId });
    assert.equal(retry.created, false);
    assert.equal(retry.message.id, first.message.id);

    // Criação de convite por família (até 3 pessoas)
    const invite = store.createInvite({ familyName: 'Família Silva', maxGuests: 3, customToken: 'familia-silva' });
    assert.equal(invite.token, 'familia-silva');
    assert.equal(invite.maxGuests, 3);
    assert.equal(invite.status, 'pending');

    // Confirmação parcial: 2 de 3 lugares informados (idade não obrigatória)
    const rsvp1 = store.addRsvp({
      name: 'João Silva',
      response: 'yes',
      guests: [{ name: 'João Silva' }, { name: 'Maria Silva' }],
      phone: '(92) 99123-1234',
      inviteToken: 'familia-silva',
      requestId: '22222222-2222-4222-8222-222222222222'
    });
    assert.equal(rsvp1.created, true);
    assert.equal(rsvp1.invite.status, 'yes');
    assert.equal(rsvp1.invite.confirmedCount, 2);
    assert.equal(rsvp1.invite.phoneMask, 'final 1234');

    // Exceder o limite do convite (4 pessoas em convite de 3) deve ser bloqueado
    assert.throws(
      () =>
        store.addRsvp({
          name: 'João Silva',
          response: 'yes',
          guests: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
          phone: '(92) 99123-1234',
          inviteToken: 'familia-silva',
          requestId: '22222222-2222-4222-8222-222222222223'
        }),
      /permite até 3 pessoa/
    );

    // Alteração posterior da confirmação substitui a resposta ativa e grava histórico
    const rsvpUpdate = store.addRsvp({
      name: 'João Silva',
      response: 'yes',
      guests: [
        { name: 'João Silva', ageGroup: 'adulto' },
        { name: 'Maria Silva', ageGroup: 'adulto' },
        { name: 'Pedro Silva', ageGroup: 'crianca' }
      ],
      phone: '(92) 99123-1234',
      inviteToken: 'familia-silva',
      requestId: '22222222-2222-4222-8222-222222222224'
    });
    assert.equal(rsvpUpdate.invite.confirmedCount, 3);
    assert.equal(rsvpUpdate.invite.confirmedGuests[2].ageGroup, 'crianca');
    assert.match(store.exportInvitesForSheet()[0].confirmedNames, /Pedro Silva \(Criança 6–12\)/);
    assert.equal(store.getInviteHistory(invite.id).length, 2);

    const overview = store.getOverview();
    assert.equal(overview.totalInvites, 1);
    assert.equal(overview.totalInvitedPeople, 3);
    assert.equal(overview.confirmedPeople, 3);
    assert.equal(overview.pendingInvites, 0);

    // Mensagem destacada aparece antes das mensagens mais recentes
    const second = store.add({
      name: 'Maria',
      message: 'Deus abençoe muito!',
      requestId: '11111111-1111-4111-8111-111111111112'
    }, { autoApprove: true });
    store.setMessageFeatured(first.message.id, true);
    const ordered = store.list().messages;
    assert.equal(ordered[0].id, first.message.id);
    assert.equal(ordered[1].id, second.message.id);

    assert.equal(store.remove(second.message.id), 1);
    assert.equal(store.remove(first.message.id), 1);
    assert.equal(store.export().length, 0);
  } finally {
    store.close();
  }
});

test('WeddingQR builds valid EMV Pix BR Code and renders crisp SVG matrix', () => {
  const payload = WeddingQR.buildPixBrCode({
    key: 'b322cbd5-a624-4fcc-b2a0-19cf3da563b4',
    merchantName: 'Yuri Menezes Tanaka',
    merchantCity: 'Manaus'
  });
  assert.match(payload, /^00020126580014br\.gov\.bcb\.pix0136b322cbd5-a624-4fcc-b2a0-19cf3da563b4.*5919Yuri Menezes Tanaka6006Manaus.*6304[0-9A-F]{4}$/);
  const svg = WeddingQR.toSvg(payload);
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"[^>]*>.*<path d="M/);
});

test('CSV export helper neutralizes formula prefixes', () => {
  assert.equal(escapeCsvCell('=CMD()'), "'=CMD()");
  assert.equal(escapeCsvCell('+1+1'), "'+1+1");
  const csv = buildCsv([{ key: 'name', label: 'Nome' }], [{ name: '@evil' }]);
  assert.match(csv, /'@evil/);
});

test('Preview server serves invitation, admin panel, .ics inline, moderates messages and protects admin routes', async () => {
  const server = createPreviewServer(projectRoot, {
    databasePath: ':memory:',
    adminPassword: 'test-secret-password'
  });

  try {
    const home = await dispatchRequest(server, { url: '/' });
    assert.equal(home.status, 200);
    assert.match(home.text(), /Geovanna &amp; Yuri|Geovanna & Yuri/);

    const health = await dispatchRequest(server, { url: '/healthz' });
    assert.equal(health.status, 200);
    assert.equal(health.json().ok, true);

    const adminPage = await dispatchRequest(server, { url: '/admin' });
    assert.equal(adminPage.status, 200);
    assert.match(adminPage.text(), /Painel dos Noivos/);

    const icsRes = await dispatchRequest(server, { url: '/casamento-yuri-geovanna.ics' });
    assert.equal(icsRes.status, 200);
    assert.equal(icsRes.headers['content-type'], 'text/calendar; charset=utf-8');
    assert.match(icsRes.headers['content-disposition'], /inline; filename="casamento-yuri-geovanna\.ics"/);

    const blockedDocs = await dispatchRequest(server, { url: '/docs/geracao-imagens.json' });
    assert.equal(blockedDocs.status, 404);
    const blockedDocker = await dispatchRequest(server, { url: '/Dockerfile' });
    assert.equal(blockedDocker.status, 404);

    // Rota admin sem login retorna 401
    const unauthOverview = await dispatchRequest(server, { url: '/api/admin/overview' });
    assert.equal(unauthOverview.status, 401);

    // Login no painel dos noivos (incluindo detecção HTTPS atrás de proxy)
    const loginBody = JSON.stringify({ password: 'test-secret-password' });
    const loginRes = await dispatchRequest(server, {
      method: 'POST',
      url: '/api/admin/login',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(loginBody)),
        'x-forwarded-proto': 'https'
      },
      body: loginBody
    });
    assert.equal(loginRes.status, 200);
    assert.match(String(loginRes.headers['set-cookie'] || ''), /;\s*Secure\b/);
    const { token } = loginRes.json();
    const authHeaders = { authorization: `Bearer ${token}` };

    // Criar convite de família pelo painel
    const createInvBody = JSON.stringify({ familyName: 'Família Souza', maxGuests: 2, customToken: 'souza-2027' });
    const createInvRes = await dispatchRequest(server, {
      method: 'POST',
      url: '/api/admin/invites',
      headers: {
        ...authHeaders,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(createInvBody))
      },
      body: createInvBody
    });
    assert.equal(createInvRes.status, 201);

    // Consultar convite pelo link público ?token=souza-2027
    const publicInvite = await dispatchRequest(server, { url: '/api/invite?token=souza-2027' });
    assert.equal(publicInvite.status, 200);
    assert.equal(publicInvite.json().invite.familyName, 'Família Souza');

    // Convidado envia recado -> fica pendente até aprovação
    const msgPayload = JSON.stringify({
      name: 'Convidado',
      message: 'Muito feliz por vocês!',
      requestId: '44444444-4444-4444-8444-444444444444'
    });
    const postMsg = await dispatchRequest(server, {
      method: 'POST',
      url: '/api/messages',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(msgPayload))
      },
      body: msgPayload
    });
    assert.equal(postMsg.status, 201);
    const createdMsgId = postMsg.json().message.id;

    const listBeforeApprove = await dispatchRequest(server, { url: '/api/messages' });
    assert.equal(listBeforeApprove.json().messages.length, 0);

    // Noivos aprovam recado no painel
    const approveRes = await dispatchRequest(server, {
      method: 'POST',
      url: `/api/admin/messages/${createdMsgId}/approve`,
      headers: authHeaders
    });
    assert.equal(approveRes.status, 200);

    const listAfterApprove = await dispatchRequest(server, { url: '/api/messages' });
    assert.equal(listAfterApprove.json().messages.length, 1);

    // Convidado confirma presença pelo convite da família
    const rsvpPayload = JSON.stringify({
      name: 'Carlos Souza',
      response: 'yes',
      guests: [{ name: 'Carlos Souza' }, { name: 'Marina Souza' }],
      phone: '92999998888',
      inviteToken: 'souza-2027',
      requestId: '55555555-5555-4555-8555-555555555555'
    });
    const postRsvp = await dispatchRequest(server, {
      method: 'POST',
      url: '/api/rsvps',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(rsvpPayload))
      },
      body: rsvpPayload
    });
    assert.equal(postRsvp.status, 201);
    assert.equal(postRsvp.json().invite.confirmedCount, 2);

    // Exportar CSV pelo painel
    const csvRes = await dispatchRequest(server, {
      url: '/api/admin/export.csv',
      headers: authHeaders
    });
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.text(), /Família Souza/);
  } finally {
    server.close();
  }
});

function createInMemoryD1() {
  const sqlite = new DatabaseSync(':memory:');
  const wrapStmt = (sql, params = []) => {
    const stmt = sqlite.prepare(sql);
    return {
      bind(...args) {
        return wrapStmt(sql, args);
      },
      async first() {
        const row = stmt.get(...params);
        return row === undefined ? null : row;
      },
      async all() {
        return { results: stmt.all(...params) };
      },
      async run() {
        const info = stmt.run(...params);
        return {
          success: true,
          meta: {
            last_row_id: Number(info.lastInsertRowid || 0),
            changes: Number(info.changes || 0)
          }
        };
      }
    };
  };
  return {
    prepare(sql) {
      return wrapStmt(sql);
    },
    async batch(stmts) {
      const results = [];
      sqlite.exec('BEGIN');
      try {
        for (const s of stmts) results.push(await s.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    close() {
      sqlite.close();
    }
  };
}

test('Cloudflare Worker + D1 adapter handles healthz, /admin, .ics, login, invites, RSVP, messages and CSV export', async () => {
  const db = createInMemoryD1();
  const worker = createWorkerHandler();
  const mockAssets = {
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === '/admin.html') return new Response('<h1>Painel dos Noivos</h1>', { status: 200 });
      if (u.pathname === '/casamento-yuri-geovanna.ics') return new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR', { status: 200 });
      return new Response('<html>Geovanna &amp; Yuri</html>', { status: 200 });
    }
  };
  const env = {
    DB: db,
    ASSETS: mockAssets,
    ADMIN_PASSWORD: 'cf-secret-password',
    SESSION_SECRET: 'cf-test-session-secret-0123456789'
  };

  try {
    const health = await worker.fetch(new Request('https://casamento.yuritanaka.com.br/healthz'), env);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).runtime, 'cloudflare-workers-d1');

    const adminPage = await worker.fetch(new Request('https://casamento.yuritanaka.com.br/admin'), env);
    assert.equal(adminPage.status, 200);
    assert.match(await adminPage.text(), /Painel dos Noivos/);

    const homePage = await worker.fetch(new Request('https://casamento.yuritanaka.com.br/'), env);
    assert.equal(homePage.status, 200);
    assert.match(await homePage.text(), /Geovanna/);

    const ics = await worker.fetch(new Request('https://casamento.yuritanaka.com.br/casamento-yuri-geovanna.ics'), env);
    assert.equal(ics.status, 200);
    assert.equal(ics.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.match(ics.headers.get('content-disposition') || '', /inline; filename="casamento-yuri-geovanna\.ics"/);

    const login = await worker.fetch(
      new Request('https://casamento.yuritanaka.com.br/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'cf-secret-password' })
      }),
      env
    );
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie') || '', /;\s*Secure\b/);
    const { token } = await login.json();
    const authHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const createInv = await worker.fetch(
      new Request('https://casamento.yuritanaka.com.br/api/admin/invites', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ familyName: 'Família D1', maxGuests: 3, customToken: 'd1-2027' })
      }),
      env
    );
    assert.equal(createInv.status, 201);

    const pubInv = await worker.fetch(new Request('https://casamento.yuritanaka.com.br/api/invite?token=d1-2027'), env);
    assert.equal(pubInv.status, 200);
    assert.equal((await pubInv.json()).invite.familyName, 'Família D1');

    const msgRes = await worker.fetch(
      new Request('https://casamento.yuritanaka.com.br/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Ana D1',
          message: 'Felicidades ao casal!',
          requestId: '66666666-6666-4666-8666-666666666666'
        })
      }),
      env
    );
    assert.equal(msgRes.status, 201);
    const createdMsg = (await msgRes.json()).message;

    const approve = await worker.fetch(
      new Request(`https://casamento.yuritanaka.com.br/api/admin/messages/${createdMsg.id}/approve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` }
      }),
      env
    );
    assert.equal(approve.status, 200);

    const mural = await worker.fetch(new Request('https://casamento.yuritanaka.com.br/api/messages'), env);
    assert.equal((await mural.json()).messages.length, 1);

    const rsvp = await worker.fetch(
      new Request('https://casamento.yuritanaka.com.br/api/rsvps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Roberto D1',
          response: 'yes',
          guests: [{ name: 'Roberto D1', ageGroup: 'adulto' }],
          phone: '92999887766',
          inviteToken: 'd1-2027',
          requestId: '77777777-7777-4777-8777-777777777777'
        })
      }),
      env
    );
    assert.equal(rsvp.status, 201);
    assert.equal((await rsvp.json()).invite.confirmedCount, 1);

    const csv = await worker.fetch(
      new Request('https://casamento.yuritanaka.com.br/api/admin/export.csv', {
        headers: { authorization: `Bearer ${token}` }
      }),
      env
    );
    assert.equal(csv.status, 200);
    assert.match(await csv.text(), /Família D1/);
  } finally {
    db.close();
  }
});
