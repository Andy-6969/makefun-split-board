// Hands the entry in (Node 22, standard library only, no network). The frontend itself is app/: static files a
// browser opens at app/index.html, reading make.fun's public API. This program copies app/ and screenshots/ into
// the output directory and writes dossier.json there with the vendored make.fun library, which must stay byte
// for byte as shipped: the scorer rebuilds the dossier with its own copy and compares.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts      (the grader's container uses /output)
//
// Everything written depends only on the files in this repository, so two runs write identical bytes.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

/** The scorer's caps. Only text_max_bytes changes what is written; the rest refuse what the scorer would refuse. */
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 3, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 16777216,
};

const repo = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyInto(name: string): void {
  const from = join(repo, name);
  mkdirSync(join(outputDir, name), { recursive: true });
  if (existsSync(from)) cpSync(from, join(outputDir, name), { recursive: true });
}

mkdirSync(outputDir, { recursive: true });
copyInto('app');
copyInto('screenshots');
writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, DOSSIER_CAPS));
