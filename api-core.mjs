const encoder = new TextEncoder();

export function normalizeSingleLine(value) {
  return String(value || '')
    .toWellFormed()
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMultiLine(value) {
  return String(value || '')
    .toWellFormed()
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
}

export function validateOptionalAgeGroup(value) {
  if (value === undefined || value === null || value === '') return null;
  const clean = String(value).trim().toLowerCase();
  if (!['adulto', 'crianca', 'isento'].includes(clean)) {
    throw new Error('Selecione uma faixa de idade válida.');
  }
  return clean;
}

export function formatAgeGroupShort(ageGroup) {
  if (ageGroup === 'adulto') return 'Adulto 13+';
  if (ageGroup === 'crianca') return 'Criança 6–12';
  if (ageGroup === 'isento') return '0–5 anos';
  return '';
}

export function validateOptionalAge(value, label = 'a idade') {
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
export function generateShortKey(length = 6) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SHORT_KEY_ALPHABET[bytes[i] % SHORT_KEY_ALPHABET.length];
  }
  return out;
}

/** Escape a CSV field and neutralize spreadsheet formula prefixes. */
export function escapeCsvCell(value) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n');
  if (/^[=+\-@\t\r]/.test(text)) {
    text = "'" + text;
  }
  if (/[",\n;]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

/** Serialize rows into UTF-8 CSV with BOM for Excel compatibility. */
export function buildCsv(columns, rows) {
  const header = columns.map((col) => escapeCsvCell(col.label)).join(',');
  const lines = rows.map((row) => columns.map((col) => escapeCsvCell(row[col.key])).join(','));
  return '\uFEFF' + [header, ...lines].join('\r\n') + '\r\n';
}

export const INVITES_CSV_COLUMNS = [
  { key: 'familyName', label: 'Família ou grupo' },
  { key: 'statusLabel', label: 'Situação da resposta' },
  { key: 'confirmedCount', label: 'Quantidade de presentes' },
  { key: 'maxGuests', label: 'Limite do convite' },
  { key: 'confirmedNames', label: 'Nome das pessoas confirmadas' },
  { key: 'respondentName', label: 'Responsável pela resposta' },
  { key: 'phone', label: 'WhatsApp do responsável' },
  { key: 'absenceNote', label: 'Observação / Recado de ausência' },
  { key: 'token', label: 'Código do link' },
  { key: 'updatedAt', label: 'Última atualização' }
];

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
    const ageGroup = validateOptionalAgeGroup(guest.ageGroup);
    const entry = { name: guestName };
    if (guestAge !== null) entry.age = guestAge;
    if (ageGroup !== null) entry.ageGroup = ageGroup;
    return entry;
  });

  if (input.response === 'no' && guests.length > 0) {
    throw new Error('Quem não comparecer não deve adicionar outras pessoas.');
  }

  const rawPhone = typeof input.phone === 'string' ? normalizeSingleLine(input.phone) : '';
  const digits = (rawPhone.match(/\d/g) || []).length;
  if (input.response === 'yes' || rawPhone.length > 0) {
    if (rawPhone.length < 8 || rawPhone.length > 30 || digits < 8) {
      throw new Error('Informe um WhatsApp válido com DDD.');
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

export function hydrateRsvp(row) {
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

export function parseExpectedGuestsInput(value, maxGuests = 30) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === 'string') {
    list = value.split(/[\n,;]+/);
  }
  const max = Math.max(1, Math.min(30, Number(maxGuests) || 30));
  return list
    .map((item) => normalizeSingleLine(typeof item === 'string' ? item : item && item.name))
    .filter((name) => name.length > 0)
    .slice(0, max);
}

export function hydrateInvite(row, { includePrivate = false } = {}) {
  if (!row) return null;
  let confirmedGuests = [];
  try {
    confirmedGuests = JSON.parse(row.confirmedGuestsJson || '[]');
    if (!Array.isArray(confirmedGuests)) confirmedGuests = [];
  } catch {
    confirmedGuests = [];
  }
  let expectedGuests = [];
  try {
    expectedGuests = parseExpectedGuestsInput(JSON.parse(row.expectedGuestsJson || '[]'), row.maxGuests);
  } catch {
    expectedGuests = [];
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
    expectedGuests,
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

export function hydrateHistoryRow(row) {
  let confirmedGuests = [];
  try {
    confirmedGuests = JSON.parse(row.confirmedGuestsJson || '[]');
    if (!Array.isArray(confirmedGuests)) confirmedGuests = [];
  } catch {
    confirmedGuests = [];
  }
  return {
    id: row.id,
    inviteId: row.inviteId,
    status: row.status,
    respondentName: row.respondentName,
    phone: row.phone,
    confirmedGuests,
    confirmedCount: row.confirmedCount,
    absenceNote: row.absenceNote,
    source: row.source,
    createdAt: row.createdAt
  };
}

export function prepareNewInvite({ familyName, maxGuests = 2, customToken = '', expectedGuests = [] } = {}) {
  const cleanName = normalizeSingleLine(familyName);
  if (cleanName.length < 2 || cleanName.length > 120) {
    throw new Error('Informe a identificação da família ou grupo (2 a 120 caracteres).');
  }
  const max = Number(maxGuests);
  if (!Number.isInteger(max) || max < 1 || max > 30) {
    throw new Error('O limite de pessoas deve ser um número entre 1 e 30.');
  }
  const token = customToken ? normalizeSingleLine(customToken).toLowerCase().replace(/[^a-z0-9-_]/g, '') : generateShortKey();
  const expectedGuestsJson = JSON.stringify(parseExpectedGuestsInput(expectedGuests, max));
  return {
    cleanName,
    max,
    initialToken: token.length >= 3 ? token : generateShortKey(),
    expectedGuestsJson
  };
}

export function prepareAdminInvitePatch(row, patch = {}) {
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

  const expectedGuestsJson = patch.expectedGuests !== undefined
    ? JSON.stringify(parseExpectedGuestsInput(patch.expectedGuests, maxGuests))
    : JSON.stringify(parseExpectedGuestsInput((() => { try { return JSON.parse(row.expectedGuestsJson || '[]'); } catch { return []; } })(), maxGuests));

  let confirmedGuests = (() => { try { return JSON.parse(row.confirmedGuestsJson || '[]'); } catch { return []; } })();
  if (Array.isArray(patch.confirmedGuests)) {
    confirmedGuests = patch.confirmedGuests
      .map((g) => {
        if (typeof g === 'string') return { name: normalizeSingleLine(g) };
        const obj = { name: normalizeSingleLine(g && g.name) };
        const ag = validateOptionalAgeGroup(g && g.ageGroup);
        if (ag) obj.ageGroup = ag;
        return obj;
      })
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
  const recordHistory = patch.status !== undefined || patch.confirmedGuests !== undefined;

  return {
    familyName,
    maxGuests,
    active,
    status,
    respondentName,
    phone,
    confirmedGuestsJson,
    expectedGuestsJson,
    confirmedCount,
    absenceNote,
    now,
    recordHistory
  };
}

export function prepareInviteRsvpUpdate(inviteRow, data) {
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
  return {
    now: new Date().toISOString(),
    confirmedJson: JSON.stringify(attendingList),
    confirmedCount: data.response === 'yes' ? attendingList.length : 0
  };
}

export function formatInvitesForSheet(invites) {
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
    confirmedNames: inv.confirmedGuests.map((g) => {
      const ag = formatAgeGroupShort(g.ageGroup);
      return ag ? `${g.name} (${ag})` : g.name;
    }).join(', '),
    phone: inv.phone || '',
    confirmedCount: inv.confirmedCount,
    maxGuests: inv.maxGuests,
    absenceNote: inv.absenceNote || '',
    updatedAt: inv.updatedAt || inv.createdAt
  }));
}

export function computeOverviewMetrics(invites, msgCounts) {
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

  const msgMap = { pending: 0, approved: 0, archived: 0 };
  for (const row of msgCounts) msgMap[row.status] = Number(row.total);

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
}

export function parsePagedCursor(before) {
  if (before === null || before === undefined || before === '') {
    return { mode: 'latest', feat: 0, lastId: 0 };
  }
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
  return { mode: 'older', feat, lastId };
}

export function buildPagedMessageResult(rows) {
  const hasMore = rows.length > 12;
  const messages = rows.slice(0, 12);
  const last = messages.at(-1);
  return {
    messages,
    nextCursor: hasMore && last ? `${last.featured ? 1 : 0}:${last.id}` : null
  };
}

export function parseCookies(cookieHeader = '') {
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

function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/** Build a runtime-agnostic HTTP API handler using WebCrypto (compatible with Node 22+ and Cloudflare Workers). */
export function createWeddingApiCore(store, options = {}) {
  const fallbackSecret = new Uint8Array(32);
  globalThis.crypto.getRandomValues(fallbackSecret);
  const keyCache = new Map();
  const attempts = new Map();

  async function getHmacKey(secretInput) {
    const secretBytes = secretInput
      ? (typeof secretInput === 'string' ? encoder.encode(secretInput) : secretInput)
      : fallbackSecret;
    const cacheKey = bytesToHex(secretBytes);
    if (!keyCache.has(cacheKey)) {
      keyCache.set(
        cacheKey,
        globalThis.crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
      );
    }
    return keyCache.get(cacheKey);
  }

  async function signAdminToken(secretInput) {
    const exp = Date.now() + 1000 * 60 * 60 * 12;
    const payload = `admin.${exp}`;
    const key = await getHmacKey(secretInput);
    const sig = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
    return `${payload}.${bytesToHex(sig)}`;
  }

  async function verifyAdminToken(token, secretInput) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'admin') return false;
    const exp = Number(parts[1]);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const sigBytes = hexToBytes(parts[2]);
    if (!sigBytes) return false;
    const key = await getHmacKey(secretInput);
    return globalThis.crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(`admin.${parts[1]}`));
  }

  async function checkPassword(candidate, expectedPassword) {
    const [aHash, bHash] = await Promise.all([
      globalThis.crypto.subtle.digest('SHA-256', encoder.encode(String(candidate || ''))),
      globalThis.crypto.subtle.digest('SHA-256', encoder.encode(String(expectedPassword || '')))
    ]);
    return constantTimeEqual(new Uint8Array(aHash), new Uint8Array(bHash));
  }

  async function isAdminAuthenticated(getHeader, secretInput) {
    const cookies = parseCookies(getHeader('cookie'));
    if (await verifyAdminToken(cookies.wedding_admin_session, secretInput)) return true;
    const auth = String(getHeader('authorization') || '');
    if (auth.startsWith('Bearer ')) {
      return verifyAdminToken(auth.slice(7).trim(), secretInput);
    }
    return false;
  }

  return async function handleApi({ method, url, getHeader, readBodyJson, clientIp = 'local', isHttps = false, runtimeOptions = {} }) {
    const pathname = url.pathname;
    const isPublicApi = pathname === '/api/rsvps' || pathname === '/api/messages' || pathname === '/api/invite';
    const isAdminApi = pathname.startsWith('/api/admin/');
    if (!isPublicApi && !isAdminApi) return null;

    const allowedOrigin = runtimeOptions.allowedOrigin ?? options.allowedOrigin ?? '';
    const adminPassword = String(runtimeOptions.adminPassword ?? options.adminPassword ?? 'yuri-geovanna-2027');
    const sessionSecret = runtimeOptions.sessionSecret ?? options.sessionSecret ?? '';

    const corsHeaders = {};
    const origin = getHeader('origin');
    const ownOrigin = url.origin;
    const forwardedHost = String(getHeader('x-forwarded-host') || '').split(',')[0].trim();
    let sameHostOrigin = false;
    try {
      const parsed = new URL(origin);
      sameHostOrigin =
        ['http:', 'https:'].includes(parsed.protocol) &&
        (parsed.host === url.host || (forwardedHost && parsed.host === forwardedHost));
    } catch {
      /* Origin ausente ou inválida. */
    }
    if (origin && origin !== ownOrigin && !sameHostOrigin && origin !== allowedOrigin) {
      return {
        status: 403,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        },
        body: JSON.stringify({ error: 'Origem não autorizada.' })
      };
    }
    if (origin && origin === allowedOrigin) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
      corsHeaders.Vary = 'Origin';
    }

    const json = (status, value, extraHeaders = {}) => ({
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...corsHeaders,
        ...extraHeaders
      },
      body: JSON.stringify(value)
    });

    if (method === 'OPTIONS') {
      return {
        status: 204,
        headers: {
          ...corsHeaders,
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        },
        body: ''
      };
    }

    // ---------------------------------------------------------------- Public: GET /api/invite?token=...
    if (pathname === '/api/invite') {
      if (method !== 'GET') {
        return json(405, { error: 'Método não permitido.' }, { Allow: 'GET, OPTIONS' });
      }
      const token = url.searchParams.get('token') || '';
      const invite = await store.getInviteByToken(token, { includePrivate: false });
      if (!invite || !invite.active) {
        return json(404, { error: 'Este link de convite não está ativo ou não foi encontrado. Confira o endereço enviado pelos noivos.' });
      }
      return json(200, { invite });
    }

    // ---------------------------------------------------------------- Admin endpoints: /api/admin/*
    if (isAdminApi) {
      const secureFlag = isHttps ? '; Secure' : '';

      if (pathname === '/api/admin/login' && method === 'POST') {
        try {
          const body = await readBodyJson(4096);
          if (!(await checkPassword(body.password, adminPassword))) {
            return json(401, { error: 'Senha incorreta. Confira a credencial configurada pelos noivos.' });
          }
          const token = await signAdminToken(sessionSecret);
          return json(
            200,
            { authenticated: true, token },
            { 'Set-Cookie': `wedding_admin_session=${token}; HttpOnly; Path=/; SameSite=Strict${secureFlag}; Max-Age=43200` }
          );
        } catch (error) {
          return json(error.status || 400, { error: error.message });
        }
      }

      if (pathname === '/api/admin/logout' && method === 'POST') {
        return json(
          200,
          { authenticated: false },
          { 'Set-Cookie': `wedding_admin_session=; HttpOnly; Path=/; SameSite=Strict${secureFlag}; Max-Age=0` }
        );
      }

      if (!(await isAdminAuthenticated(getHeader, sessionSecret))) {
        return json(401, { error: 'Acesso restrito aos noivos. Faça login para continuar.' });
      }

      if (pathname === '/api/admin/overview' && method === 'GET') {
        const [overview, invites, messages] = await Promise.all([
          store.getOverview(),
          store.listInvites(),
          store.listAllMessages()
        ]);
        return json(200, { overview, invites, messages });
      }

      if (pathname === '/api/admin/invites' && method === 'POST') {
        try {
          const body = await readBodyJson(8192);
          const invite = await store.createInvite(body);
          const overview = await store.getOverview();
          return json(201, { invite, overview });
        } catch (error) {
          return json(error.status || 400, { error: error.message });
        }
      }

      const inviteMatch = pathname.match(/^\/api\/admin\/invites\/(\d+)(?:\/(history))?$/);
      if (inviteMatch) {
        const inviteId = Number(inviteMatch[1]);
        const sub = inviteMatch[2];
        if (sub === 'history' && method === 'GET') {
          const history = await store.getInviteHistory(inviteId);
          return json(200, { history });
        }
        if (!sub && method === 'PATCH') {
          try {
            const body = await readBodyJson(16384);
            const invite = await store.updateInviteByAdmin(inviteId, body);
            const overview = await store.getOverview();
            return json(200, { invite, overview });
          } catch (error) {
            return json(error.status || 400, { error: error.message });
          }
        }
      }

      const msgMatch = pathname.match(/^\/api\/admin\/messages\/(\d+)(?:\/(approve|archive|feature))?$/);
      if (msgMatch) {
        const msgId = Number(msgMatch[1]);
        const action = msgMatch[2];
        if (action === 'approve' && method === 'POST') {
          const updated = await store.setMessageStatus(msgId, 'approved');
          if (!updated) return json(404, { error: 'Recado não encontrado.' });
          return json(200, { message: updated, overview: await store.getOverview() });
        }
        if (action === 'archive' && method === 'POST') {
          const updated = await store.setMessageStatus(msgId, 'archived');
          if (!updated) return json(404, { error: 'Recado não encontrado.' });
          return json(200, { message: updated, overview: await store.getOverview() });
        }
        if (action === 'feature' && method === 'POST') {
          try {
            const body = await readBodyJson(2048);
            const updated = await store.setMessageFeatured(msgId, Boolean(body.featured));
            if (!updated) return json(404, { error: 'Recado não encontrado.' });
            return json(200, { message: updated, overview: await store.getOverview() });
          } catch (error) {
            return json(error.status || 400, { error: error.message });
          }
        }
        if (!action && method === 'DELETE') {
          const removed = await store.remove(msgId);
          if (!removed) return json(404, { error: 'Recado não encontrado.' });
          return json(200, { removed: true, overview: await store.getOverview() });
        }
      }

      if (pathname === '/api/admin/export.csv' && method === 'GET') {
        const rows = await store.exportInvitesForSheet();
        const csv = buildCsv(INVITES_CSV_COLUMNS, rows);
        return {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="convites-yuri-geovanna.csv"',
            'Cache-Control': 'no-store'
          },
          body: csv
        };
      }

      return json(404, { error: 'Rota administrativa não encontrada.' });
    }

    // ---------------------------------------------------------------- Public: /api/messages & /api/rsvps
    const isRsvp = pathname === '/api/rsvps';
    const allowedMethods = isRsvp ? 'POST, OPTIONS' : 'GET, POST, OPTIONS';

    if (method === 'GET' && !isRsvp) {
      try {
        const result = await store.list(url.searchParams.has('before') ? url.searchParams.get('before') : null);
        return json(200, result);
      } catch (error) {
        return json(error.status || 500, { error: error.status ? error.message : 'Não foi possível carregar os recados.' });
      }
    }

    if (method !== 'POST') {
      return json(405, { error: 'Método não permitido.' }, { Allow: allowedMethods });
    }
    if (!String(getHeader('content-type') || '').toLowerCase().startsWith('application/json')) {
      return json(415, { error: 'Envie os dados no formato JSON.' });
    }

    const now = Date.now();
    for (const [key, value] of attempts) if (value.expires < now) attempts.delete(key);
    const limit = attempts.get(clientIp) || { count: 0, expires: now + 60000 };
    if (limit.count >= 12) {
      return json(429, { error: 'Aguarde um minuto antes de enviar novamente.' }, {
        'Retry-After': String(Math.ceil((limit.expires - now) / 1000))
      });
    }
    if (attempts.size >= 10000 && !attempts.has(clientIp)) {
      return json(503, { error: 'O servidor está ocupado. Tente novamente em instantes.' });
    }
    limit.count++;
    attempts.set(clientIp, limit);

    const maxBytes = isRsvp ? 16384 : 4096;
    try {
      const data = await readBodyJson(maxBytes);
      try {
        (isRsvp ? validateRsvp : validateMessage)(data);
      } catch (error) {
        return json(400, { error: error.message });
      }
      const result = isRsvp ? await store.addRsvp(data) : await store.add(data);
      return json(result.created ? 201 : 200, result);
    } catch (error) {
      return json(error.status || 500, {
        error: error.status ? error.message : 'Não foi possível enviar agora. Confira sua conexão e tente novamente.'
      });
    }
  };
}
