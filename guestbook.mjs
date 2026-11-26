import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPagedMessageResult,
  computeOverviewMetrics,
  createWeddingApiCore,
  formatInvitesForSheet,
  generateShortKey,
  hydrateHistoryRow,
  hydrateInvite,
  hydrateRsvp,
  maskPhone,
  normalizeSingleLine,
  parsePagedCursor,
  prepareAdminInvitePatch,
  prepareInviteRsvpUpdate,
  prepareNewInvite,
  validateMessage,
  validateRsvp
} from './api-core.mjs';

export { maskPhone, validateMessage, validateRsvp };

export function createGuestbookStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      message TEXT NOT NULL CHECK(length(message) BETWEEN 3 AND 600),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','archived')),
      featured INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rsvps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      age INTEGER CHECK(age IS NULL OR (typeof(age) = 'integer' AND age BETWEEN 0 AND 120)),
      response TEXT NOT NULL CHECK(response IN ('yes','no')),
      companions INTEGER NOT NULL CHECK(typeof(companions) = 'integer' AND companions BETWEEN 0 AND 20),
      guests_json TEXT NOT NULL DEFAULT '[]',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      invite_token TEXT NOT NULL DEFAULT '',
      absence_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      family_name TEXT NOT NULL CHECK(length(family_name) BETWEEN 1 AND 120),
      max_guests INTEGER NOT NULL CHECK(typeof(max_guests) = 'integer' AND max_guests BETWEEN 1 AND 30),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','yes','no')),
      respondent_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      expected_guests_json TEXT NOT NULL DEFAULT '[]',
      confirmed_guests_json TEXT NOT NULL DEFAULT '[]',
      confirmed_count INTEGER NOT NULL DEFAULT 0,
      absence_note TEXT NOT NULL DEFAULT '',
      last_request_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invite_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      respondent_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      confirmed_guests_json TEXT NOT NULL,
      confirmed_count INTEGER NOT NULL,
      absence_note TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'guest',
      created_at TEXT NOT NULL
    );`);

  const msgColumns = new Set(database.prepare('PRAGMA table_info(messages)').all().map((col) => col.name));
  if (!msgColumns.has('status')) {
    database.exec("ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';");
  }
  if (!msgColumns.has('featured')) {
    database.exec('ALTER TABLE messages ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;');
  }

  const rsvpColumns = new Set(database.prepare('PRAGMA table_info(rsvps)').all().map((col) => col.name));
  const rsvpMigrations = [
    ['age', 'INTEGER'],
    ['guests_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['phone', "TEXT NOT NULL DEFAULT ''"],
    ['email', "TEXT NOT NULL DEFAULT ''"],
    ['invite_token', "TEXT NOT NULL DEFAULT ''"],
    ['absence_note', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [column, definition] of rsvpMigrations) {
    if (!rsvpColumns.has(column)) {
      database.exec(`ALTER TABLE rsvps ADD COLUMN ${column} ${definition};`);
    }
  }

  const inviteColumns = new Set(database.prepare('PRAGMA table_info(invites)').all().map((col) => col.name));
  if (!inviteColumns.has('expected_guests_json')) {
    database.exec("ALTER TABLE invites ADD COLUMN expected_guests_json TEXT NOT NULL DEFAULT '[]';");
  }

  const fields = 'id, name, message, status, featured, created_at AS createdAt';
  const byRequest = database.prepare(`SELECT ${fields} FROM messages WHERE request_id = ?`);
  const byIdStmt = database.prepare(`SELECT ${fields} FROM messages WHERE id = ?`);
  const insert = database.prepare('INSERT INTO messages (request_id,name,message,status,featured,created_at) VALUES (?,?,?,?,0,?)');
  const latestApproved = database.prepare(`SELECT ${fields} FROM messages WHERE status = 'approved' ORDER BY featured DESC, id DESC LIMIT 13`);
  const olderApproved = database.prepare(`SELECT ${fields} FROM messages WHERE status = 'approved' AND (featured < ? OR (featured = ? AND id < ?)) ORDER BY featured DESC, id DESC LIMIT 13`);

  const rsvpFields = 'id, name, age, response, companions, guests_json AS guestsJson, phone, email, invite_token AS inviteToken, absence_note AS absenceNote, created_at AS createdAt';
  const rsvpByRequest = database.prepare(`SELECT ${rsvpFields} FROM rsvps WHERE request_id = ?`);
  const insertRsvp = database.prepare('INSERT INTO rsvps (request_id,name,age,response,companions,guests_json,phone,email,invite_token,absence_note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');

  const inviteFields = 'id, token, family_name AS familyName, max_guests AS maxGuests, active, status, respondent_name AS respondentName, phone, expected_guests_json AS expectedGuestsJson, confirmed_guests_json AS confirmedGuestsJson, confirmed_count AS confirmedCount, absence_note AS absenceNote, last_request_id AS lastRequestId, updated_at AS updatedAt, created_at AS createdAt';
  const inviteByTokenStmt = database.prepare(`SELECT ${inviteFields} FROM invites WHERE lower(token) = lower(?)`);
  const inviteByIdStmt = database.prepare(`SELECT ${inviteFields} FROM invites WHERE id = ?`);
  const insertInviteStmt = database.prepare('INSERT INTO invites (token,family_name,max_guests,expected_guests_json,active,status,created_at) VALUES (?,?,?,?,1,\'pending\',?)');
  const insertHistoryStmt = database.prepare('INSERT INTO invite_history (invite_id,status,respondent_name,phone,confirmed_guests_json,confirmed_count,absence_note,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)');

  return {
    createInvite(input = {}) {
      const { cleanName, max, initialToken, expectedGuestsJson } = prepareNewInvite(input);
      let token = initialToken;
      while (inviteByTokenStmt.get(token)) {
        token = generateShortKey();
      }
      const now = new Date().toISOString();
      const info = insertInviteStmt.run(token, cleanName, max, expectedGuestsJson, now);
      return hydrateInvite(inviteByIdStmt.get(Number(info.lastInsertRowid)), { includePrivate: true });
    },

    getInviteByToken(token, { includePrivate = false } = {}) {
      if (!token || typeof token !== 'string') return null;
      const row = inviteByTokenStmt.get(normalizeSingleLine(token));
      return hydrateInvite(row, { includePrivate });
    },

    getInviteById(id, { includePrivate = true } = {}) {
      const num = Number(id);
      if (!Number.isSafeInteger(num) || num <= 0) return null;
      return hydrateInvite(inviteByIdStmt.get(num), { includePrivate });
    },

    listInvites() {
      return database
        .prepare(`SELECT ${inviteFields} FROM invites ORDER BY id DESC`)
        .all()
        .map((row) => hydrateInvite(row, { includePrivate: true }));
    },

    getInviteHistory(inviteId) {
      const num = Number(inviteId);
      if (!Number.isSafeInteger(num) || num <= 0) return [];
      return database
        .prepare('SELECT id, invite_id AS inviteId, status, respondent_name AS respondentName, phone, confirmed_guests_json AS confirmedGuestsJson, confirmed_count AS confirmedCount, absence_note AS absenceNote, source, created_at AS createdAt FROM invite_history WHERE invite_id = ? ORDER BY id DESC')
        .all(num)
        .map(hydrateHistoryRow);
    },

    updateInviteByAdmin(id, patch = {}) {
      const row = inviteByIdStmt.get(Number(id));
      if (!row) {
        const err = new Error('Convite não encontrado.');
        err.status = 404;
        throw err;
      }
      const prepared = prepareAdminInvitePatch(row, patch);
      database
        .prepare('UPDATE invites SET family_name = ?, max_guests = ?, active = ?, status = ?, respondent_name = ?, phone = ?, expected_guests_json = ?, confirmed_guests_json = ?, confirmed_count = ?, absence_note = ?, updated_at = ? WHERE id = ?')
        .run(
          prepared.familyName,
          prepared.maxGuests,
          prepared.active,
          prepared.status,
          prepared.respondentName,
          prepared.phone,
          prepared.expectedGuestsJson,
          prepared.confirmedGuestsJson,
          prepared.confirmedCount,
          prepared.absenceNote,
          prepared.now,
          row.id
        );
      if (prepared.recordHistory) {
        insertHistoryStmt.run(
          row.id,
          prepared.status,
          prepared.respondentName || prepared.familyName,
          prepared.phone,
          prepared.confirmedGuestsJson,
          prepared.confirmedCount,
          prepared.absenceNote,
          'admin',
          prepared.now
        );
      }
      return hydrateInvite(inviteByIdStmt.get(row.id), { includePrivate: true });
    },

    addRsvp(input) {
      const data = validateRsvp(input);
      const existing = rsvpByRequest.get(data.requestId);
      if (existing) {
        const same =
          existing.name === data.name &&
          existing.age === data.age &&
          existing.response === data.response &&
          existing.companions === data.companions &&
          (existing.guestsJson || '[]') === data.guestsJson &&
          (existing.phone || '') === data.phone &&
          (existing.email || '') === data.email;
        if (!same) {
          const error = new Error('Este envio já foi usado para outra confirmação. Edite sua resposta e tente novamente.');
          error.status = 409;
          throw error;
        }
        const hydrated = hydrateRsvp(existing);
        const invite = data.inviteToken ? this.getInviteByToken(data.inviteToken) : null;
        return { confirmation: hydrated, invite, created: false };
      }

      let updatedInvite = null;
      if (data.inviteToken) {
        const inviteRow = inviteByTokenStmt.get(data.inviteToken);
        const upd = prepareInviteRsvpUpdate(inviteRow, data);
        database
          .prepare('UPDATE invites SET status = ?, respondent_name = ?, phone = ?, confirmed_guests_json = ?, confirmed_count = ?, absence_note = ?, last_request_id = ?, updated_at = ? WHERE id = ?')
          .run(data.response, data.name, data.phone, upd.confirmedJson, upd.confirmedCount, data.absenceNote, data.requestId, upd.now, inviteRow.id);
        insertHistoryStmt.run(inviteRow.id, data.response, data.name, data.phone, upd.confirmedJson, upd.confirmedCount, data.absenceNote, 'guest', upd.now);
        updatedInvite = hydrateInvite(inviteByIdStmt.get(inviteRow.id), { includePrivate: false });
      }

      insertRsvp.run(
        data.requestId,
        data.name,
        data.age,
        data.response,
        data.companions,
        data.guestsJson,
        data.phone,
        data.email,
        data.inviteToken,
        data.absenceNote,
        new Date().toISOString()
      );
      return {
        confirmation: hydrateRsvp(rsvpByRequest.get(data.requestId)),
        invite: updatedInvite,
        created: true
      };
    },

    exportRsvps() {
      return database.prepare(`SELECT ${rsvpFields} FROM rsvps ORDER BY id`).all().map(hydrateRsvp);
    },

    exportInvitesForSheet() {
      return formatInvitesForSheet(this.listInvites());
    },

    getOverview() {
      const invites = this.listInvites();
      const counts = database.prepare('SELECT status, COUNT(*) AS total FROM messages GROUP BY status').all();
      return computeOverviewMetrics(invites, counts);
    },

    add(input, { autoApprove = false } = {}) {
      const data = validateMessage(input);
      const existing = byRequest.get(data.requestId);
      if (existing) {
        if (existing.name !== data.name || existing.message !== data.message) {
          const error = new Error('Este envio já foi usado para outro recado. Edite o texto e tente novamente.');
          error.status = 409;
          throw error;
        }
        return { message: existing, created: false };
      }
      const status = autoApprove ? 'approved' : 'pending';
      insert.run(data.requestId, data.name, data.message, status, new Date().toISOString());
      return { message: byRequest.get(data.requestId), created: true };
    },

    list(before) {
      const cursor = parsePagedCursor(before);
      const rows = cursor.mode === 'latest'
        ? latestApproved.all()
        : olderApproved.all(cursor.feat, cursor.feat, cursor.lastId);
      return buildPagedMessageResult(rows);
    },

    listAllMessages(statusFilter = '') {
      if (statusFilter && ['pending', 'approved', 'archived'].includes(statusFilter)) {
        return database.prepare(`SELECT ${fields} FROM messages WHERE status = ? ORDER BY featured DESC, id DESC`).all(statusFilter);
      }
      return database.prepare(`SELECT ${fields} FROM messages ORDER BY featured DESC, id DESC`).all();
    },

    setMessageStatus(id, status) {
      const num = Number(id);
      if (!Number.isSafeInteger(num) || num <= 0) throw new Error('Informe um ID numérico válido.');
      if (!['pending', 'approved', 'archived'].includes(status)) throw new Error('Status inválido.');
      const changes = Number(database.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, num).changes);
      return changes ? byIdStmt.get(num) : null;
    },

    setMessageFeatured(id, featured) {
      const num = Number(id);
      if (!Number.isSafeInteger(num) || num <= 0) throw new Error('Informe um ID numérico válido.');
      const flag = featured ? 1 : 0;
      const changes = Number(database.prepare('UPDATE messages SET featured = ? WHERE id = ?').run(flag, num).changes);
      return changes ? byIdStmt.get(num) : null;
    },

    export() {
      return database.prepare(`SELECT ${fields} FROM messages ORDER BY id`).all();
    },

    remove(id) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Informe um ID numérico válido.');
      return Number(database.prepare('DELETE FROM messages WHERE id = ?').run(id).changes);
    },

    close() {
      database.close();
    }
  };
}

async function readJsonBody(request, maxBytes = 16384) {
  if (Number(request.headers['content-length'] || 0) > maxBytes) {
    const err = new Error('Dados muito grandes.');
    err.status = 413;
    throw err;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= maxBytes) chunks.push(chunk);
  }
  if (size > maxBytes) {
    const err = new Error('Dados muito grandes.');
    err.status = 413;
    throw err;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const err = new Error('Não foi possível ler os dados enviados.');
    err.status = 400;
    throw err;
  }
}

export function createGuestbookApi(store, options = {}) {
  const core = createWeddingApiCore(store, {
    allowedOrigin: options.allowedOrigin || '',
    adminPassword: String(options.adminPassword || process.env.ADMIN_PASSWORD || 'yuri-geovanna-2027'),
    sessionSecret: options.sessionSecret || process.env.SESSION_SECRET || ''
  });

  return async function handleGuestbook(request, response, url) {
    const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const isHttps = Boolean(request.socket.encrypted || forwardedProto === 'https');
    const forwardedIp = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const clientIp = forwardedIp || request.socket.remoteAddress || 'local';

    const result = await core({
      method: request.method,
      url,
      getHeader: (name) => request.headers[name.toLowerCase()] || '',
      readBodyJson: (maxBytes) => readJsonBody(request, maxBytes),
      clientIp,
      isHttps
    });
    if (!result) return false;
    response.writeHead(result.status, result.headers);
    response.end(result.body);
    return true;
  };
}
