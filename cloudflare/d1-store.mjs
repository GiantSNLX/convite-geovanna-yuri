import {
  buildPagedMessageResult,
  computeOverviewMetrics,
  formatInvitesForSheet,
  generateShortKey,
  hydrateHistoryRow,
  hydrateInvite,
  hydrateRsvp,
  normalizeSingleLine,
  parsePagedCursor,
  prepareAdminInvitePatch,
  prepareInviteRsvpUpdate,
  prepareNewInvite,
  validateMessage,
  validateRsvp
} from '../api-core.mjs';

const MSG_FIELDS = 'id, name, message, status, featured, created_at AS createdAt';
const RSVP_FIELDS = 'id, name, age, response, companions, guests_json AS guestsJson, phone, email, invite_token AS inviteToken, absence_note AS absenceNote, created_at AS createdAt';
const INVITE_FIELDS = 'id, token, family_name AS familyName, max_guests AS maxGuests, active, status, respondent_name AS respondentName, phone, expected_guests_json AS expectedGuestsJson, confirmed_guests_json AS confirmedGuestsJson, confirmed_count AS confirmedCount, absence_note AS absenceNote, last_request_id AS lastRequestId, updated_at AS updatedAt, created_at AS createdAt';

const SCHEMA_STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), message TEXT NOT NULL CHECK(length(message) BETWEEN 3 AND 600), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','archived')), featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS rsvps (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120), age INTEGER CHECK(age IS NULL OR (typeof(age) = 'integer' AND age BETWEEN 0 AND 120)), response TEXT NOT NULL CHECK(response IN ('yes','no')), companions INTEGER NOT NULL CHECK(typeof(companions) = 'integer' AND companions BETWEEN 0 AND 20), guests_json TEXT NOT NULL DEFAULT '[]', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', invite_token TEXT NOT NULL DEFAULT '', absence_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS invites (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, family_name TEXT NOT NULL CHECK(length(family_name) BETWEEN 1 AND 120), max_guests INTEGER NOT NULL CHECK(typeof(max_guests) = 'integer' AND max_guests BETWEEN 1 AND 30), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','yes','no')), respondent_name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', expected_guests_json TEXT NOT NULL DEFAULT '[]', confirmed_guests_json TEXT NOT NULL DEFAULT '[]', confirmed_count INTEGER NOT NULL DEFAULT 0, absence_note TEXT NOT NULL DEFAULT '', last_request_id TEXT NOT NULL DEFAULT '', updated_at TEXT, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS invite_history (id INTEGER PRIMARY KEY AUTOINCREMENT, invite_id INTEGER NOT NULL, status TEXT NOT NULL, respondent_name TEXT NOT NULL, phone TEXT NOT NULL, confirmed_guests_json TEXT NOT NULL, confirmed_count INTEGER NOT NULL, absence_note TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'guest', created_at TEXT NOT NULL)"
];

const initializedDbs = new WeakMap();

async function ensureSchema(db) {
  if (!db) {
    const err = new Error('Banco Cloudflare D1 (binding DB) não configurado.');
    err.status = 500;
    throw err;
  }
  if (!initializedDbs.has(db)) {
    const promise = (async () => {
      await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
      try {
        await db.prepare('SELECT expected_guests_json FROM invites LIMIT 1').first();
      } catch {
        await db.prepare("ALTER TABLE invites ADD COLUMN expected_guests_json TEXT NOT NULL DEFAULT '[]'").run();
      }
    })().catch((err) => {
      initializedDbs.delete(db);
      throw err;
    });
    initializedDbs.set(db, promise);
  }
  await initializedDbs.get(db);
}

/** Create a Cloudflare D1-backed async store sharing domain logic with the Node server. */
export function createD1Store(db) {
  return {
    async createInvite(input = {}) {
      await ensureSchema(db);
      const { cleanName, max, initialToken, expectedGuestsJson } = prepareNewInvite(input);
      let token = initialToken;
      while (await db.prepare(`SELECT id FROM invites WHERE lower(token) = lower(?)`).bind(token).first()) {
        token = generateShortKey();
      }
      const now = new Date().toISOString();
      const res = await db
        .prepare("INSERT INTO invites (token,family_name,max_guests,expected_guests_json,active,status,created_at) VALUES (?,?,?,?,1,'pending',?)")
        .bind(token, cleanName, max, expectedGuestsJson, now)
        .run();
      const insertedId = res && res.meta ? res.meta.last_row_id : null;
      const row = insertedId
        ? await db.prepare(`SELECT ${INVITE_FIELDS} FROM invites WHERE id = ?`).bind(insertedId).first()
        : await db.prepare(`SELECT ${INVITE_FIELDS} FROM invites WHERE lower(token) = lower(?)`).bind(token).first();
      return hydrateInvite(row, { includePrivate: true });
    },

    async getInviteByToken(token, { includePrivate = false } = {}) {
      if (!token || typeof token !== 'string') return null;
      await ensureSchema(db);
      const row = await db
        .prepare(`SELECT ${INVITE_FIELDS} FROM invites WHERE lower(token) = lower(?)`)
        .bind(normalizeSingleLine(token))
        .first();
      return hydrateInvite(row, { includePrivate });
    },

    async getInviteById(id, { includePrivate = true } = {}) {
      const num = Number(id);
      if (!Number.isSafeInteger(num) || num <= 0) return null;
      await ensureSchema(db);
      const row = await db.prepare(`SELECT ${INVITE_FIELDS} FROM invites WHERE id = ?`).bind(num).first();
      return hydrateInvite(row, { includePrivate });
    },

    async listInvites() {
      await ensureSchema(db);
      const { results = [] } = await db.prepare(`SELECT ${INVITE_FIELDS} FROM invites ORDER BY id DESC`).all();
      return results.map((row) => hydrateInvite(row, { includePrivate: true }));
    },

    async getInviteHistory(inviteId) {
      const num = Number(inviteId);
      if (!Number.isSafeInteger(num) || num <= 0) return [];
      await ensureSchema(db);
      const { results = [] } = await db
        .prepare('SELECT id, invite_id AS inviteId, status, respondent_name AS respondentName, phone, confirmed_guests_json AS confirmedGuestsJson, confirmed_count AS confirmedCount, absence_note AS absenceNote, source, created_at AS createdAt FROM invite_history WHERE invite_id = ? ORDER BY id DESC')
        .bind(num)
        .all();
      return results.map(hydrateHistoryRow);
    },

    async updateInviteByAdmin(id, patch = {}) {
      await ensureSchema(db);
      const num = Number(id);
      const row = await db.prepare(`SELECT ${INVITE_FIELDS} FROM invites WHERE id = ?`).bind(num).first();
      if (!row) {
        const err = new Error('Convite não encontrado.');
        err.status = 404;
        throw err;
      }
      const prepared = prepareAdminInvitePatch(row, patch);
      const stmts = [
        db
          .prepare('UPDATE invites SET family_name = ?, max_guests = ?, active = ?, status = ?, respondent_name = ?, phone = ?, expected_guests_json = ?, confirmed_guests_json = ?, confirmed_count = ?, absence_note = ?, updated_at = ? WHERE id = ?')
          .bind(
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
          )
      ];
      if (prepared.recordHistory) {
        stmts.push(
          db
            .prepare('INSERT INTO invite_history (invite_id,status,respondent_name,phone,confirmed_guests_json,confirmed_count,absence_note,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
            .bind(
              row.id,
              prepared.status,
              prepared.respondentName || prepared.familyName,
              prepared.phone,
              prepared.confirmedGuestsJson,
              prepared.confirmedCount,
              prepared.absenceNote,
              'admin',
              prepared.now
            )
        );
      }
      await db.batch(stmts);
      const updated = await db.prepare(`SELECT ${INVITE_FIELDS} FROM invites WHERE id = ?`).bind(row.id).first();
      return hydrateInvite(updated, { includePrivate: true });
    },

    async addRsvp(input) {
      await ensureSchema(db);
      const data = validateRsvp(input);
      const existing = await db.prepare(`SELECT ${RSVP_FIELDS} FROM rsvps WHERE request_id = ?`).bind(data.requestId).first();
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
        const invite = data.inviteToken ? await this.getInviteByToken(data.inviteToken) : null;
        return { confirmation: hydrated, invite, created: false };
      }

      const stmts = [];
      let inviteRowId = null;
      if (data.inviteToken) {
        const inviteRow = await db
          .prepare(`SELECT ${INVITE_FIELDS} FROM invites WHERE lower(token) = lower(?)`)
          .bind(normalizeSingleLine(data.inviteToken))
          .first();
        const upd = prepareInviteRsvpUpdate(inviteRow, data);
        inviteRowId = inviteRow.id;
        stmts.push(
          db
            .prepare('UPDATE invites SET status = ?, respondent_name = ?, phone = ?, confirmed_guests_json = ?, confirmed_count = ?, absence_note = ?, last_request_id = ?, updated_at = ? WHERE id = ?')
            .bind(data.response, data.name, data.phone, upd.confirmedJson, upd.confirmedCount, data.absenceNote, data.requestId, upd.now, inviteRow.id),
          db
            .prepare('INSERT INTO invite_history (invite_id,status,respondent_name,phone,confirmed_guests_json,confirmed_count,absence_note,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
            .bind(inviteRow.id, data.response, data.name, data.phone, upd.confirmedJson, upd.confirmedCount, data.absenceNote, 'guest', upd.now)
        );
      }

      stmts.push(
        db
          .prepare('INSERT INTO rsvps (request_id,name,age,response,companions,guests_json,phone,email,invite_token,absence_note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .bind(
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
          )
      );
      await db.batch(stmts);

      const savedRsvp = await db.prepare(`SELECT ${RSVP_FIELDS} FROM rsvps WHERE request_id = ?`).bind(data.requestId).first();
      const updatedInvite = inviteRowId
        ? hydrateInvite(await db.prepare(`SELECT ${INVITE_FIELDS} FROM invites WHERE id = ?`).bind(inviteRowId).first(), { includePrivate: false })
        : null;

      return {
        confirmation: hydrateRsvp(savedRsvp),
        invite: updatedInvite,
        created: true
      };
    },

    async exportInvitesForSheet() {
      return formatInvitesForSheet(await this.listInvites());
    },

    async getOverview() {
      const [invites, countsRes] = await Promise.all([
        this.listInvites(),
        db.prepare('SELECT status, COUNT(*) AS total FROM messages GROUP BY status').all()
      ]);
      return computeOverviewMetrics(invites, countsRes.results || []);
    },

    async add(input, { autoApprove = false } = {}) {
      await ensureSchema(db);
      const data = validateMessage(input);
      const existing = await db.prepare(`SELECT ${MSG_FIELDS} FROM messages WHERE request_id = ?`).bind(data.requestId).first();
      if (existing) {
        if (existing.name !== data.name || existing.message !== data.message) {
          const error = new Error('Este envio já foi usado para outro recado. Edite o texto e tente novamente.');
          error.status = 409;
          throw error;
        }
        return { message: existing, created: false };
      }
      const status = autoApprove ? 'approved' : 'pending';
      await db
        .prepare('INSERT INTO messages (request_id,name,message,status,featured,created_at) VALUES (?,?,?,?,0,?)')
        .bind(data.requestId, data.name, data.message, status, new Date().toISOString())
        .run();
      return {
        message: await db.prepare(`SELECT ${MSG_FIELDS} FROM messages WHERE request_id = ?`).bind(data.requestId).first(),
        created: true
      };
    },

    async list(before) {
      await ensureSchema(db);
      const cursor = parsePagedCursor(before);
      const res = cursor.mode === 'latest'
        ? await db.prepare(`SELECT ${MSG_FIELDS} FROM messages WHERE status = 'approved' ORDER BY featured DESC, id DESC LIMIT 13`).all()
        : await db
            .prepare(`SELECT ${MSG_FIELDS} FROM messages WHERE status = 'approved' AND (featured < ? OR (featured = ? AND id < ?)) ORDER BY featured DESC, id DESC LIMIT 13`)
            .bind(cursor.feat, cursor.feat, cursor.lastId)
            .all();
      return buildPagedMessageResult(res.results || []);
    },

    async listAllMessages(statusFilter = '') {
      await ensureSchema(db);
      if (statusFilter && ['pending', 'approved', 'archived'].includes(statusFilter)) {
        const res = await db
          .prepare(`SELECT ${MSG_FIELDS} FROM messages WHERE status = ? ORDER BY featured DESC, id DESC`)
          .bind(statusFilter)
          .all();
        return res.results || [];
      }
      const res = await db.prepare(`SELECT ${MSG_FIELDS} FROM messages ORDER BY featured DESC, id DESC`).all();
      return res.results || [];
    },

    async setMessageStatus(id, status) {
      const num = Number(id);
      if (!Number.isSafeInteger(num) || num <= 0) throw new Error('Informe um ID numérico válido.');
      if (!['pending', 'approved', 'archived'].includes(status)) throw new Error('Status inválido.');
      await ensureSchema(db);
      const res = await db.prepare('UPDATE messages SET status = ? WHERE id = ?').bind(status, num).run();
      const changes = res && res.meta ? Number(res.meta.changes || 0) : 0;
      return changes ? db.prepare(`SELECT ${MSG_FIELDS} FROM messages WHERE id = ?`).bind(num).first() : null;
    },

    async setMessageFeatured(id, featured) {
      const num = Number(id);
      if (!Number.isSafeInteger(num) || num <= 0) throw new Error('Informe um ID numérico válido.');
      await ensureSchema(db);
      const flag = featured ? 1 : 0;
      const res = await db.prepare('UPDATE messages SET featured = ? WHERE id = ?').bind(flag, num).run();
      const changes = res && res.meta ? Number(res.meta.changes || 0) : 0;
      return changes ? db.prepare(`SELECT ${MSG_FIELDS} FROM messages WHERE id = ?`).bind(num).first() : null;
    },

    async remove(id) {
      const num = Number(id);
      if (!Number.isSafeInteger(num) || num <= 0) throw new Error('Informe um ID numérico válido.');
      await ensureSchema(db);
      const res = await db.prepare('DELETE FROM messages WHERE id = ?').bind(num).run();
      return res && res.meta ? Number(res.meta.changes || 0) : 0;
    }
  };
}
