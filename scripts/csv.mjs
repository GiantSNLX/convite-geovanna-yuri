import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptsDir, '..');

/** Resolve the SQLite database path from env or default .data location. */
export function resolveDbPath(root = projectRoot) {
  return process.env.GUESTBOOK_DB_PATH || path.join(root, '.data', 'messages.sqlite');
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
