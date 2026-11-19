import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createGuestbookStore } from '../guestbook.mjs';
import { buildCsv, projectRoot, resolveDbPath } from './csv.mjs';

const [, , action = 'export', targetArg] = process.argv;
const store = createGuestbookStore(resolveDbPath());

try {
  if (action === 'export') {
    const rows = store.export();
    const outPath = path.join(projectRoot, '.data', 'recados.csv');
    mkdirSync(path.dirname(outPath), { recursive: true });
    const csv = buildCsv(
      [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Nome' },
        { key: 'message', label: 'Recado' },
        { key: 'createdAt', label: 'Criado em' }
      ],
      rows
    );
    writeFileSync(outPath, csv, 'utf8');
    console.log(`${rows.length} recado(s) exportado(s) para ${outPath}`);
  } else if (action === 'remove') {
    const id = Number(targetArg);
    if (!Number.isSafeInteger(id) || id <= 0) {
      console.error('Uso: npm run messages:remove -- <id>');
      process.exitCode = 1;
    } else {
      const removed = store.remove(id);
      console.log(removed > 0 ? `Recado #${id} removido.` : `Nenhum recado encontrado com ID ${id}.`);
      if (removed === 0) process.exitCode = 1;
    }
  } else {
    console.error(`Ação inválida: ${action}. Use "export" ou "remove <id>".`);
    process.exitCode = 1;
  }
} finally {
  store.close();
}
