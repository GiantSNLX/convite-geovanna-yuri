import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildCsv } from './scripts/csv.mjs';

function normalizeSingleLine(value) {
  return String(value || '')
    .toWellFormed()
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMultiLine(value) {
  return String(value || '')
    .toWellFormed()
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
}

function validateOptionalAge(value, label = 'a idade') {
  if (value === undefined || value === null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 120) {
    throw new Error(`Informe ${label} entre 0 e 120 anos.`);
  }
  return num;
}

export function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (digits.length >= 4) return `final ${digits.slice(-4)}`;
  return digits ? `final ${digits}` : 'não informado';
}

const SHORT_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateShortKey(length = 6) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SHORT_KEY_ALPHABET[bytes[i] % SHORT_KEY_ALPHABET.length];
  }
  return out;
}

export function validateMessage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Informe seu nome e sua mensagem.');
  if (input.website) throw new Error('Não foi possível enviar este recado.');
  if (typeof input.name !== 'string' || typeof input.message !== 'string') throw new Error('Informe seu nome e sua mensagem.');
  const name = normalizeSingleLine(input.name);
  const message = normalizeMultiLine(input.message);
  if (name.length < 1 || name.length > 80) throw new Error('Escreva um nome de até 80 caracteres.');
  if (message.length < 3 || message.length > 600) throw new Error('Escreva um recado de 3 a 600 caracteres.');
  if (typeof input.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)) {
    throw new Error('Recarregue o convite e tente enviar novamente.');
  }
  return { name, message, requestId: input.requestId.toLowerCase() };
}

export function validateRsvp(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Informe seus dados para confirmar.');
  if (input.website) throw new Error('Não foi possível enviar esta confirmação.');
  if (typeof input.name !== 'string') throw new Error('Informe o nome do responsável pela resposta.');
  const name = normalizeSingleLine(input.name);
  if (name.length < 1 || name.length > 120) throw new Error('Escreva um nome de até 120 caracteres.');
  const age = validateOptionalAge(input.age, 'sua idade');
  if (!['yes', 'no'].includes(input.response)) throw new Error('Escolha se poderá estar com a gente.');

  const rawGuests = input.guests === undefined ? [] : input.guests;
  if (!Array.isArray(rawGuests) || rawGuests.length > 20) throw new Error('Informe até 20 pessoas da família.');
  const guests = rawGuests.map((guest, index) => {
    if (typeof guest === 'string') {
      const guestName = normalizeSingleLine(guest);
      if (guestName.length < 1 || guestName.length > 120) {
        throw new Error(`Escreva o nome completo da pessoa ${index + 1} (até 120 caracteres).`);
      }
      return { name: guestName, age: null };
    }
    if (!guest || typeof guest !== 'object' || Array.isArray(guest) || typeof guest.name !== 'string') {
      throw new Error(`Informe o nome da pessoa ${index + 1}.`);
    }
    const guestName = normalizeSingleLine(guest.name);
    if (guestName.length < 1 || guestName.length > 120) {
      throw new Error(`Escreva o nome completo da pessoa ${index + 1} (até 120 caracteres).`);
    }
    const guestAge = validateOptionalAge(guest.age, `a idade de ${guestName}`);
    return guestAge === null ? { name: guestName } : { name: guestName, age: guestAge };
  });

  if (input.response === 'no' && guests.length > 0) {
    throw new Error('Quem não comparecer não deve adicionar outras pessoas.');
  }

  const rawPhone = typeof input.phone === 'string' ? normalizeSingleLine(input.phone) : '';
  const digits = (rawPhone.match(/\d/g) || []).length;
  if (input.response === 'yes' || rawPhone.length > 0) {
    if (rawPhone.length < 8 || rawPhone.length > 30 || digits < 8) {
      throw new Error('Informe um WhatsApp ou telefone válido com DDD.');
    }
  }

  if (input.email !== undefined && typeof input.email !== 'string') throw new Error('Informe um e-mail válido.');
  const email = input.email ? normalizeSingleLine(input.email).toLowerCase() : '';
  if (email && (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('Informe um e-mail válido ou deixe o campo em branco.');
  }

  const absenceNote = typeof input.absenceNote === 'string' ? normalizeMultiLine(input.absenceNote).slice(0, 600) : '';
  const inviteToken = typeof input.inviteToken === 'string' ? normalizeSingleLine(input.inviteToken) : '';

  if (typeof input.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)) {
    throw new Error('Recarregue o convite e tente enviar novamente.');
  }

  return {
    name,
    age,
    response: input.response,
    companions: guests.length,
    guests,
    guestsJson: JSON.stringify(guests),
    phone: rawPhone,
    email,
    absenceNote,
    inviteToken,
    requestId: input.requestId.toLowerCase()
  };
}

function hydrateRsvp(row) {
  if (!row) return null;
  let guests = [];
  try {
    guests = JSON.parse(row.guestsJson || '[]');
    if (!Array.isArray(guests)) guests = [];
  } catch {
    guests = [];
  }
  return {
    id: row.id,
    name: row.name,
    age: row.age,
    response: row.response,
    companions: row.companions,
    guests,
    phone: row.phone || '',
    phoneMask: maskPhone(row.phone || ''),
    email: row.email || '',
    createdAt: row.createdAt
  };
}

function hydrateInvite(row, { includePrivate = false } = {}) {
  if (!row) return null;
  let confirmedGuests = [];
  try {
    confirmedGuests = JSON.parse(row.confirmedGuestsJson || '[]');
    if (!Array.isArray(confirmedGuests)) confirmedGuests = [];
  } catch {
    confirmedGuests = [];
  }
  const base = {
    id: row.id,
    token: row.token,
    familyName: row.familyName,
    maxGuests: row.maxGuests,
    active: Boolean(row.active),
    status: row.status,
    respondentName: row.respondentName || '',
    phoneMask: maskPhone(row.phone || ''),
    confirmedGuests,
    confirmedCount: row.confirmedCount || 0,
    absenceNote: row.absenceNote || '',
    updatedAt: row.updatedAt || null,
    createdAt: row.createdAt
  };
  if (includePrivate) {
    base.phone = row.phone || '';
  }
  return base;
}

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

  const fields = 'id, name, message, status, featured, created_at AS createdAt';
  const byRequest = database.prepare(`SELECT ${fields} FROM messages WHERE request_id = ?`);
  const byIdStmt = database.prepare(`SELECT ${fields} FROM messages WHERE id = ?`);
  const insert = database.prepare('INSERT INTO messages (request_id,name,message,status,featured,created_at) VALUES (?,?,?,?,0,?)');
  const latestApproved = database.prepare(`SELECT ${fields} FROM messages WHERE status = 'approved' ORDER BY featured DESC, id DESC LIMIT 13`);
  const olderApproved = database.prepare(`SELECT ${fields} FROM messages WHERE status = 'approved' AND (featured < ? OR (featured = ? AND id < ?)) ORDER BY featured DESC, id DESC LIMIT 13`);

  const rsvpFields = 'id, name, age, response, companions, guests_json AS guestsJson, phone, email, invite_token AS inviteToken, absence_note AS absenceNote, created_at AS createdAt';
  const rsvpByRequest = database.prepare(`SELECT ${rsvpFields} FROM rsvps WHERE request_id = ?`);
  const insertRsvp = database.prepare('INSERT INTO rsvps (request_id,name,age,response,companions,guests_json,phone,email,invite_token,absence_note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');

  const inviteFields = 'id, token, family_name AS familyName, max_guests AS maxGuests, active, status, respondent_name AS respondentName, phone, confirmed_guests_json AS confirmedGuestsJson, confirmed_count AS confirmedCount, absence_note AS absenceNote, last_request_id AS lastRequestId, updated_at AS updatedAt, created_at AS createdAt';
  const inviteByTokenStmt = database.prepare(`SELECT ${inviteFields} FROM invites WHERE lower(token) = lower(?)`);
  const inviteByIdStmt = database.prepare(`SELECT ${inviteFields} FROM invites WHERE id = ?`);
  const insertInviteStmt = database.prepare('INSERT INTO invites (token,family_name,max_guests,active,status,created_at) VALUES (?,?,?,1,\'pending\',?)');
  const insertHistoryStmt = database.prepare('INSERT INTO invite_history (invite_id,status,respondent_name,phone,confirmed_guests_json,confirmed_count,absence_note,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)');

  return {
    createInvite({ familyName, maxGuests = 2, customToken = '' } = {}) {
      const cleanName = normalizeSingleLine(familyName);
      if (cleanName.length < 2 || cleanName.length > 120) {
        throw new Error('Informe a identificação da família ou grupo (2 a 120 caracteres).');
      }
      const max = Number(maxGuests);
      if (!Number.isInteger(max) || max < 1 || max > 30) {
        throw new Error('O limite de pessoas deve ser um número entre 1 e 30.');
      }
      let token = customToken ? normalizeSingleLine(customToken).toLowerCase().replace(/[^a-z0-9-_]/g, '') : generateShortKey();
      if (token.length < 3) token = generateShortKey();
      while (inviteByTokenStmt.get(token)) {
        token = generateShortKey();
      }
      const now = new Date().toISOString();
      const info = insertInviteStmt.run(token, cleanName, max, now);
      return hydrateInvite(inviteByIdStmt.get(Number(info.lastInsertRowid)), { includePrivate: true });
    },

    getInviteByToken(token, { includePrivate = false } = {}) {
      if (!token || typeof token !== 'string') return null;
      const row = inviteByTokenStmt.get(normalizeSingleLine(token));
      if (!row) return null;
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
        .map((row) => ({
          id: row.id,
          inviteId: row.inviteId,
          status: row.status,
          respondentName: row.respondentName,
          phone: row.phone,
          confirmedGuests: (() => { try { return JSON.parse(row.confirmedGuestsJson || '[]'); } catch { return []; } })(),
          confirmedCount: row.confirmedCount,
          absenceNote: row.absenceNote,
          source: row.source,
          createdAt: row.createdAt
        }));
    },

    updateInviteByAdmin(id, patch = {}) {
      const row = inviteByIdStmt.get(Number(id));
      if (!row) {
        const err = new Error('Convite não encontrado.');
        err.status = 404;
        throw err;
      }
      const familyName = patch.familyName !== undefined ? normalizeSingleLine(patch.familyName) : row.familyName;
      if (familyName.length < 2 || familyName.length > 120) {
        throw new Error('Informe um nome válido para a família ou grupo.');
      }
      const maxGuests = patch.maxGuests !== undefined ? Number(patch.maxGuests) : row.maxGuests;
      if (!Number.isInteger(maxGuests) || maxGuests < 1 || maxGuests > 30) {
        throw new Error('O limite deve ficar entre 1 e 30 pessoas.');
      }
      const active = patch.active !== undefined ? (patch.active ? 1 : 0) : row.active;
      const status = patch.status !== undefined ? patch.status : row.status;
      if (!['pending', 'yes', 'no'].includes(status)) {
        throw new Error('Situação inválida.');
      }
      const respondentName = patch.respondentName !== undefined ? normalizeSingleLine(patch.respondentName) : row.respondentName;
      const phone = patch.phone !== undefined ? normalizeSingleLine(patch.phone) : row.phone;
      const absenceNote = patch.absenceNote !== undefined ? normalizeMultiLine(patch.absenceNote).slice(0, 600) : row.absenceNote;

      let confirmedGuests = (() => { try { return JSON.parse(row.confirmedGuestsJson || '[]'); } catch { return []; } })();
      if (Array.isArray(patch.confirmedGuests)) {
        confirmedGuests = patch.confirmedGuests
          .map((g) => (typeof g === 'string' ? { name: normalizeSingleLine(g) } : { name: normalizeSingleLine(g && g.name) }))
          .filter((g) => g.name.length > 0);
      }
      if (status !== 'yes') {
        confirmedGuests = [];
      }
      if (confirmedGuests.length > maxGuests) {
        throw new Error(`A lista de confirmados (${confirmedGuests.length}) excede o limite deste convite (${maxGuests}).`);
      }
      const confirmedCount = status === 'yes' ? confirmedGuests.length : 0;
      const confirmedGuestsJson = JSON.stringify(confirmedGuests);
      const now = new Date().toISOString();

      database
        .prepare('UPDATE invites SET family_name = ?, max_guests = ?, active = ?, status = ?, respondent_name = ?, phone = ?, confirmed_guests_json = ?, confirmed_count = ?, absence_note = ?, updated_at = ? WHERE id = ?')
        .run(familyName, maxGuests, active, status, respondentName, phone, confirmedGuestsJson, confirmedCount, absenceNote, now, row.id);

      if (patch.status !== undefined || patch.confirmedGuests !== undefined) {
        insertHistoryStmt.run(row.id, status, respondentName || familyName, phone, confirmedGuestsJson, confirmedCount, absenceNote, 'admin', now);
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
        if (!inviteRow || !inviteRow.active) {
          const err = new Error('Este link de convite não está ativo ou não foi encontrado.');
          err.status = 404;
          throw err;
        }
        const attendingList = data.response === 'yes'
          ? (data.guests.length > 0 ? data.guests : [{ name: data.name }])
          : [];
        if (data.response === 'yes' && attendingList.length < 1) {
          throw new Error('Informe ao menos uma pessoa que estará presente.');
        }
        if (attendingList.length > inviteRow.maxGuests) {
          throw new Error(`Este convite permite até ${inviteRow.maxGuests} pessoa(s). Para solicitar um lugar adicional, entre em contato com os noivos.`);
        }
        const now = new Date().toISOString();
        const confirmedJson = JSON.stringify(attendingList);
        const confirmedCount = data.response === 'yes' ? attendingList.length : 0;
        database
          .prepare('UPDATE invites SET status = ?, respondent_name = ?, phone = ?, confirmed_guests_json = ?, confirmed_count = ?, absence_note = ?, last_request_id = ?, updated_at = ? WHERE id = ?')
          .run(data.response, data.name, data.phone, confirmedJson, confirmedCount, data.absenceNote, data.requestId, now, inviteRow.id);
        insertHistoryStmt.run(inviteRow.id, data.response, data.name, data.phone, confirmedJson, confirmedCount, data.absenceNote, 'guest', now);
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
      const invites = this.listInvites();
      return invites.map((inv) => ({
        familyName: inv.familyName,
        token: inv.token,
        statusLabel: !inv.active
          ? 'Link desativado'
          : inv.status === 'yes'
            ? 'Presença confirmada'
            : inv.status === 'no'
              ? 'Ausência informada'
              : 'Sem resposta',
        respondentName: inv.respondentName || '',
        confirmedNames: inv.confirmedGuests.map((g) => g.name).join(', '),
        phone: inv.phone || '',
        confirmedCount: inv.confirmedCount,
        maxGuests: inv.maxGuests,
        absenceNote: inv.absenceNote || '',
        updatedAt: inv.updatedAt || inv.createdAt
      }));
    },

    getOverview() {
      const invites = this.listInvites();
      const activeInvites = invites.filter((i) => i.active);
      const totalInvites = activeInvites.length;
      const totalInvitedPeople = activeInvites.reduce((acc, i) => acc + i.maxGuests, 0);
      const confirmedPeople = activeInvites
        .filter((i) => i.status === 'yes')
        .reduce((acc, i) => acc + i.confirmedCount, 0);
      const pendingInvites = activeInvites.filter((i) => i.status === 'pending').length;
      const confirmedInvites = activeInvites.filter((i) => i.status === 'yes').length;
      const declinedInvites = activeInvites.filter((i) => i.status === 'no').length;
      const absentPeople = activeInvites.reduce((acc, i) => {
        if (i.status === 'no') return acc + i.maxGuests;
        if (i.status === 'yes') return acc + Math.max(0, i.maxGuests - i.confirmedCount);
        return acc;
      }, 0);

      const counts = database
        .prepare("SELECT status, COUNT(*) AS total FROM messages GROUP BY status")
        .all();
      const msgMap = { pending: 0, approved: 0, archived: 0 };
      for (const row of counts) msgMap[row.status] = Number(row.total);

      return {
        totalInvites,
        totalInvitedPeople,
        confirmedPeople,
        pendingInvites,
        confirmedInvites,
        declinedInvites,
        absentPeople,
        pendingMessages: msgMap.pending,
        approvedMessages: msgMap.approved,
        archivedMessages: msgMap.archived
      };
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
      let rows;
      if (before === null || before === undefined || before === '') {
        rows = latestApproved.all();
      } else {
        const raw = String(before);
        let feat = 0;
        let lastId = Number(raw);
        if (/^[01]:\d+$/.test(raw)) {
          const parts = raw.split(':');
          feat = Number(parts[0]);
          lastId = Number(parts[1]);
        } else if (!/^\d+$/.test(raw)) {
          lastId = NaN;
        }
        if (!Number.isSafeInteger(lastId) || lastId <= 0) {
          const error = new Error('Página inválida.');
          error.status = 400;
          throw error;
        }
        rows = olderApproved.all(feat, feat, lastId);
      }
      const hasMore = rows.length > 12;
      const messages = rows.slice(0, 12);
      const last = messages.at(-1);
      return {
        messages,
        nextCursor: hasMore && last ? `${last.featured ? 1 : 0}:${last.id}` : null
      };
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

function parseCookies(cookieHeader = '') {
  const out = {};
  for (const pair of String(cookieHeader || '').split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
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
  const allowedOrigin = options.allowedOrigin || '';
  const adminPassword = String(options.adminPassword || process.env.ADMIN_PASSWORD || 'yuri-geovanna-2027');
  const sessionSecret = randomBytes(32);
  const attempts = new Map();

  function signAdminToken() {
    const exp = Date.now() + 1000 * 60 * 60 * 12; // 12h
    const payload = `admin.${exp}`;
    const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  function verifyAdminToken(token) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'admin') return false;
    const exp = Number(parts[1]);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const expected = createHmac('sha256', sessionSecret).update(`admin.${parts[1]}`).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  function isAdminAuthenticated(request) {
    const cookies = parseCookies(request.headers.cookie);
    if (verifyAdminToken(cookies.wedding_admin_session)) return true;
    const auth = String(request.headers.authorization || '');
    if (auth.startsWith('Bearer ')) {
      return verifyAdminToken(auth.slice(7).trim());
    }
    return false;
  }

  function checkPassword(candidate) {
    const a = Buffer.from(String(candidate || ''));
    const b = Buffer.from(adminPassword);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  return async function handleGuestbook(request, response, url) {
    const pathname = url.pathname;
    const isPublicApi = pathname === '/api/rsvps' || pathname === '/api/messages' || pathname === '/api/invite';
    const isAdminApi = pathname.startsWith('/api/admin/');
    if (!isPublicApi && !isAdminApi) return false;

    const json = (status, value, extraHeaders = {}) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders
      });
      response.end(JSON.stringify(value));
    };

    const origin = request.headers.origin;
    const ownOrigin = url.origin;
    let sameHostOrigin = false;
    try {
      const parsed = new URL(origin);
      sameHostOrigin = ['http:', 'https:'].includes(parsed.protocol) && parsed.host === url.host;
    } catch {
      /* Origin ausente ou inválida. */
    }
    if (origin && origin !== ownOrigin && !sameHostOrigin && origin !== allowedOrigin) {
      json(403, { error: 'Origem não autorizada.' });
      return true;
    }
    if (origin && origin === allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.writeHead(204);
      response.end();
      return true;
    }

    // ---------------------------------------------------------------- Public: GET /api/invite?token=...
    if (pathname === '/api/invite') {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET, OPTIONS');
        json(405, { error: 'Método não permitido.' });
        return true;
      }
      const token = url.searchParams.get('token') || '';
      const invite = store.getInviteByToken(token, { includePrivate: false });
      if (!invite || !invite.active) {
        json(404, { error: 'Este link de convite não está ativo ou não foi encontrado. Confira o endereço enviado pelos noivos.' });
        return true;
      }
      json(200, { invite });
      return true;
    }

    // ---------------------------------------------------------------- Admin endpoints: /api/admin/*
    if (isAdminApi) {
      if (pathname === '/api/admin/login' && request.method === 'POST') {
        try {
          const body = await readJsonBody(request, 4096);
          if (!checkPassword(body.password)) {
            json(401, { error: 'Senha incorreta. Confira a credencial configurada pelos noivos.' });
            return true;
          }
          const token = signAdminToken();
          json(
            200,
            { authenticated: true, token },
            { 'Set-Cookie': `wedding_admin_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200` }
          );
        } catch (error) {
          json(error.status || 400, { error: error.message });
        }
        return true;
      }

      if (pathname === '/api/admin/logout' && request.method === 'POST') {
        json(
          200,
          { authenticated: false },
          { 'Set-Cookie': 'wedding_admin_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0' }
        );
        return true;
      }

      if (!isAdminAuthenticated(request)) {
        json(401, { error: 'Acesso restrito aos noivos. Faça login para continuar.' });
        return true;
      }

      if (pathname === '/api/admin/overview' && request.method === 'GET') {
        json(200, {
          overview: store.getOverview(),
          invites: store.listInvites(),
          messages: store.listAllMessages()
        });
        return true;
      }

      if (pathname === '/api/admin/invites' && request.method === 'POST') {
        try {
          const body = await readJsonBody(request, 8192);
          const invite = store.createInvite(body);
          json(201, { invite, overview: store.getOverview() });
        } catch (error) {
          json(error.status || 400, { error: error.message });
        }
        return true;
      }

      const inviteMatch = pathname.match(/^\/api\/admin\/invites\/(\d+)(?:\/(history))?$/);
      if (inviteMatch) {
        const inviteId = Number(inviteMatch[1]);
        const sub = inviteMatch[2];
        if (sub === 'history' && request.method === 'GET') {
          json(200, { history: store.getInviteHistory(inviteId) });
          return true;
        }
        if (!sub && request.method === 'PATCH') {
          try {
            const body = await readJsonBody(request, 16384);
            const invite = store.updateInviteByAdmin(inviteId, body);
            json(200, { invite, overview: store.getOverview() });
          } catch (error) {
            json(error.status || 400, { error: error.message });
          }
          return true;
        }
      }

      const msgMatch = pathname.match(/^\/api\/admin\/messages\/(\d+)(?:\/(approve|archive|feature))?$/);
      if (msgMatch) {
        const msgId = Number(msgMatch[1]);
        const action = msgMatch[2];
        if (action === 'approve' && request.method === 'POST') {
          const updated = store.setMessageStatus(msgId, 'approved');
          if (!updated) {
            json(404, { error: 'Recado não encontrado.' });
            return true;
          }
          json(200, { message: updated, overview: store.getOverview() });
          return true;
        }
        if (action === 'archive' && request.method === 'POST') {
          const updated = store.setMessageStatus(msgId, 'archived');
          if (!updated) {
            json(404, { error: 'Recado não encontrado.' });
            return true;
          }
          json(200, { message: updated, overview: store.getOverview() });
          return true;
        }
        if (action === 'feature' && request.method === 'POST') {
          try {
            const body = await readJsonBody(request, 2048);
            const updated = store.setMessageFeatured(msgId, Boolean(body.featured));
            if (!updated) {
              json(404, { error: 'Recado não encontrado.' });
              return true;
            }
            json(200, { message: updated, overview: store.getOverview() });
          } catch (error) {
            json(error.status || 400, { error: error.message });
          }
          return true;
        }
        if (!action && request.method === 'DELETE') {
          const removed = store.remove(msgId);
          if (!removed) {
            json(404, { error: 'Recado não encontrado.' });
            return true;
          }
          json(200, { removed: true, overview: store.getOverview() });
          return true;
        }
      }

      if (pathname === '/api/admin/export.csv' && request.method === 'GET') {
        const rows = store.exportInvitesForSheet();
        const csv = buildCsv(
          [
            { key: 'familyName', label: 'Família ou grupo' },
            { key: 'statusLabel', label: 'Situação da resposta' },
            { key: 'confirmedCount', label: 'Quantidade de presentes' },
            { key: 'maxGuests', label: 'Limite do convite' },
            { key: 'confirmedNames', label: 'Nome das pessoas confirmadas' },
            { key: 'respondentName', label: 'Responsável pela resposta' },
            { key: 'phone', label: 'Telefone do responsável' },
            { key: 'absenceNote', label: 'Observação / Recado de ausência' },
            { key: 'token', label: 'Código do link' },
            { key: 'updatedAt', label: 'Última atualização' }
          ],
          rows
        );
        response.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="convites-yuri-geovanna.csv"',
          'Cache-Control': 'no-store'
        });
        response.end(csv);
        return true;
      }

      json(404, { error: 'Rota administrativa não encontrada.' });
      return true;
    }

    // ---------------------------------------------------------------- Public: /api/messages & /api/rsvps
    const isRsvp = pathname === '/api/rsvps';
    const allowedMethods = isRsvp ? 'POST, OPTIONS' : 'GET, POST, OPTIONS';

    if (request.method === 'GET' && !isRsvp) {
      try {
        json(200, store.list(url.searchParams.has('before') ? url.searchParams.get('before') : null));
      } catch (error) {
        json(error.status || 500, { error: error.status ? error.message : 'Não foi possível carregar os recados.' });
      }
      return true;
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', allowedMethods);
      json(405, { error: 'Método não permitido.' });
      return true;
    }
    if (!(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      json(415, { error: 'Envie os dados no formato JSON.' });
      return true;
    }
    const now = Date.now();
    for (const [key, value] of attempts) if (value.expires < now) attempts.delete(key);
    const address = request.socket.remoteAddress || 'local';
    const limit = attempts.get(address) || { count: 0, expires: now + 60000 };
    if (limit.count >= 12) {
      response.setHeader('Retry-After', String(Math.ceil((limit.expires - now) / 1000)));
      json(429, { error: 'Aguarde um minuto antes de enviar novamente.' });
      return true;
    }
    if (attempts.size >= 10000 && !attempts.has(address)) {
      json(503, { error: 'O servidor está ocupado. Tente novamente em instantes.' });
      return true;
    }
    limit.count++;
    attempts.set(address, limit);

    const maxBytes = isRsvp ? 16384 : 4096;
    try {
      const data = await readJsonBody(request, maxBytes);
      try {
        (isRsvp ? validateRsvp : validateMessage)(data);
      } catch (error) {
        json(400, { error: error.message });
        return true;
      }
      const result = isRsvp ? store.addRsvp(data) : store.add(data);
      json(result.created ? 201 : 200, result);
    } catch (error) {
      json(error.status || 500, { error: error.status ? error.message : 'Não foi possível enviar agora. Confira sua conexão e tente novamente.' });
    }
    return true;
  };
}
