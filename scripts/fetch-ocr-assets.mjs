// Vendor the Tesseract runtime so receipt OCR never calls a CDN: the worker + wasm core come
// from node_modules, the language data is downloaded once. Output lands in web/public/tesseract,
// which Vite copies verbatim into the build — so everything is served same-origin under a
// self-only CSP. Re-run after bumping tesseract.js. Assets are gitignored, not committed.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'web', 'public', 'tesseract');
const langDir = join(out, 'lang');
// Models come from the official tesseract-ocr org at a pinned tag, verified by SHA-256 — not
// from tesseract.js's default CDN, which publishes no checksums. `_fast` keeps the image small
// and is plenty for printed receipts; swap to tessdata_best if accuracy ever falls short.
const TESSDATA = 'https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0';
const LANGS = {
  // receipts here are Portuguese; English also catches Latin-script noise
  eng: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  por: 'c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb',
};

mkdirSync(langDir, { recursive: true });

// 1. worker script + wasm core, straight from the installed packages.
const copies = [
  [join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js')],
];
for (const [from, to] of copies) {
  if (!existsSync(from)) throw new Error(`missing ${from} — run npm install first`);
  cpSync(from, to);
}
const coreSrc = join(root, 'node_modules', 'tesseract.js-core');
for (const f of readdirSync(coreSrc)) {
  if (/\.(js|wasm)$/.test(f)) cpSync(join(coreSrc, f), join(out, f));
}

// 2. language data (the only piece npm doesn't ship). Verified by SHA-256, written to a temp
// file and renamed — an interrupted run must not leave a truncated file that later looks cached.
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

for (const [lang, expected] of Object.entries(LANGS)) {
  const dest = join(langDir, `${lang}.traineddata`);
  if (existsSync(dest) && sha256(readFileSync(dest)) === expected) {
    console.log(`✓ ${lang}.traineddata (cached, checksum ok)`);
    continue;
  }
  const url = `${TESSDATA}/${lang}.traineddata`;
  process.stdout.write(`↓ ${url} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== expected) throw new Error(`${url} checksum mismatch\n  expected ${expected}\n  got      ${got}`);
  const tmp = `${dest}.part`;
  writeFileSync(tmp, buf);
  renameSync(tmp, dest); // atomic within the same directory
  console.log(`${(buf.length / 1e6).toFixed(1)} MB, checksum ok`);
}

console.log(`OCR assets ready in ${out}`);
