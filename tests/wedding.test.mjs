import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable, Writable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGuestbookStore } from '../guestbook.mjs';
import { createPreviewServer } from '../server.mjs';
import { buildCsv, escapeCsvCell } from '../scripts/csv.mjs';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const experience = require(path.join(projectRoot, 'experience.js'));

function loadWeddingUtils() {
  const sandbox = { window: {}, URLSearchParams, Intl, Date, Math, Number, String, Error };
  sandbox.window = sandbox;
  vm.runInNewContext(readFileSync(path.join(projectRoot, 'app.js'), 'utf8'), sandbox);
  return sandbox.WeddingUtils;
}

const WeddingUtils = loadWeddingUtils();

const sampleConfig = {
  couple: { firstNames: 'Geovanna & Yuri' },
  event: {
    date: '2027-01-13',
    dateConfirmed: true,
    startTime: '19:00',
    endTime: '',
    timeZone: 'America/Manaus',
    venue: 'Casa Colonial Festas & Eventos',
    address: 'R. Ovídio Gomes Monteiro, 2020 — Manaus'
  },
  rsvp: { allowCompanions: false },
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

test('WeddingUtils converts America/Manaus time to UTC and builds calendar URL and ICS', () => {
  const utc = WeddingUtils.zonedDateTimeToUTC('2027-01-13', '19:00', 'America/Manaus');
  assert.equal(utc.toISOString(), '2027-01-13T23:00:00.000Z');

  const gcal = new URL(WeddingUtils.buildGoogleCalendarUrl(sampleConfig));
  assert.equal(gcal.searchParams.get('dates'), '20270113T230000Z/20270113T230000Z');
  assert.equal(gcal.searchParams.get('ctz'), 'America/Manaus');

  const ics = WeddingUtils.buildICS(sampleConfig, new Date('2026-11-19T12:00:00Z'));
  assert.match(ics, /DTSTART:20270113T230000Z/);
  assert.match(ics, /SUMMARY:Casamento de Geovanna & Yuri/);
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

test('GuestbookStore handles messages, Unicode surrogates, idempotency and RSVPs', () => {
  const store = createGuestbookStore(':memory:');
  try {
    const reqId = '11111111-1111-4111-8111-111111111111';
    const first = store.add({ name: 'Ana', message: 'Felicidades x\ud800y!', requestId: reqId });
    assert.equal(first.created, true);

    const retry = store.add({ name: 'Ana', message: 'Felicidades x\ud800y!', requestId: reqId });
    assert.equal(retry.created, false);
    assert.equal(retry.message.id, first.message.id);

    assert.throws(
      () => store.add({ name: 'Ana', message: 'Outro texto', requestId: reqId }),
      (err) => err.status === 409
    );

    const rsvpId = '22222222-2222-4222-8222-222222222222';
    const rsvp = store.addRsvp({ name: 'Carlos', response: 'yes', companions: 1, requestId: rsvpId });
    assert.equal(rsvp.created, true);
    assert.equal(store.exportRsvps().length, 1);

    assert.throws(
      () => store.addRsvp({ name: 'Bia', response: 'no', companions: 1, requestId: '33333333-3333-4333-8333-333333333333' }),
      /zero acompanhantes/
    );

    assert.equal(store.remove(first.message.id), 1);
    assert.equal(store.export().length, 0);
  } finally {
    store.close();
  }
});

test('CSV export helper neutralizes formula prefixes', () => {
  assert.equal(escapeCsvCell('=CMD()'), "'=CMD()");
  assert.equal(escapeCsvCell('+1+1'), "'+1+1");
  const csv = buildCsv([{ key: 'name', label: 'Nome' }], [{ name: '@evil' }]);
  assert.match(csv, /'@evil/);
});

test('Preview server serves allowlisted assets, blocks private paths and handles API routes', async () => {
  const server = createPreviewServer(projectRoot, { databasePath: ':memory:' });

  try {
    const home = await dispatchRequest(server, { url: '/' });
    assert.equal(home.status, 200);
    assert.match(home.text(), /Yuri & Geovanna/);

    const blockedDocs = await dispatchRequest(server, { url: '/docs/geracao-imagens.json' });
    assert.equal(blockedDocs.status, 404);

    const blockedHidden = await dispatchRequest(server, { url: '/.gitignore' });
    assert.equal(blockedHidden.status, 404);

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

    const listMsg = await dispatchRequest(server, { url: '/api/messages' });
    assert.equal(listMsg.status, 200);
    const data = listMsg.json();
    assert.equal(data.messages.length, 1);
    assert.equal(data.messages[0].name, 'Convidado');

    const rsvpPayload = JSON.stringify({
      name: 'Convidado',
      response: 'yes',
      companions: 0,
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
  } finally {
    server.close();
  }
});
