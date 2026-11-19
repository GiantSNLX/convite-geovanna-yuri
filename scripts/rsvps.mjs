import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createGuestbookStore } from '../guestbook.mjs';
import { buildCsv, projectRoot, resolveDbPath } from './csv.mjs';

const store = createGuestbookStore(resolveDbPath());

try {
  const rows = store.exportRsvps().map((item) => ({
    id: item.id,
    name: item.name,
    response: item.response === 'yes' ? 'Sim' : 'Não',
    companions: item.companions,
    createdAt: item.createdAt
  }));
  const outPath = path.join(projectRoot, '.data', 'presencas.csv');
  mkdirSync(path.dirname(outPath), { recursive: true });
  const csv = buildCsv(
    [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Nome' },
      { key: 'response', label: 'Presença' },
      { key: 'companions', label: 'Acompanhantes' },
      { key: 'createdAt', label: 'Criado em' }
    ],
    rows
  );
  writeFileSync(outPath, csv, 'utf8');
  console.log(`${rows.length} confirmação(ões) exportada(s) para ${outPath}`);
} finally {
  store.close();
}
