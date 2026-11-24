import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '_site');

const PUBLIC_FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'config.js',
  'experience.js',
  'qr.js',
  'casamento-yuri-geovanna.ics',
  'admin.html',
  'admin.js'
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const file of PUBLIC_FILES) {
  cpSync(path.join(root, file), path.join(outDir, file));
}
cpSync(path.join(root, 'assets'), path.join(outDir, 'assets'), { recursive: true });
writeFileSync(path.join(outDir, '.nojekyll'), '');

console.log(`Artefato estático gerado em ${outDir}`);
