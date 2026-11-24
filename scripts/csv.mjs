import path from 'node:path';
import { fileURLToPath } from 'node:url';
export { buildCsv, escapeCsvCell } from '../api-core.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptsDir, '..');

/** Resolve the SQLite database path from env or default .data location. */
export function resolveDbPath(root = projectRoot) {
  return process.env.GUESTBOOK_DB_PATH || path.join(root, '.data', 'messages.sqlite');
}
