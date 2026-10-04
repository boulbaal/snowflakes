#!/usr/bin/env node
// Deploy naar Cloudflare met het korte git-commitnummer als versie.
// 1. weigert als de werkboom niet schoon is (de versie moet kloppen met de code)
// 2. weigert als de test-login (DEV_LOGIN) in wrangler.toml staat: die hoort alleen in .dev.vars
// 3. kopieert src/, public/ en wrangler.toml naar dist/ en vervangt __VERSION__
// 4. wrangler deploy --config dist/wrangler.toml
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim();
if (dirty && !process.argv.includes('--allow-dirty')) {
  console.error('Werkboom is niet schoon. Commit eerst, zodat de versie (' + sha + ') klopt met de code.');
  process.exit(1);
}
const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
if (/DEV_LOGIN/.test(toml)) {
  console.error('DEV_LOGIN staat in wrangler.toml. De test-login mag nooit online: zet hem alleen in .dev.vars.');
  process.exit(1);
}
if (/VUL-IN/.test(toml)) {
  console.error('database_id in wrangler.toml is nog niet ingevuld (npx wrangler d1 create snowflakes).');
  process.exit(1);
}
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
fs.cpSync(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });
fs.copyFileSync(path.join(root, 'wrangler.toml'), path.join(dist, 'wrangler.toml'));
let vervangen = 0;
for (const f of ['src/worker.js', 'public/app.js', 'public/sw.js']) {
  const p = path.join(dist, f);
  const voor = fs.readFileSync(p, 'utf8');
  const na = voor.replaceAll('__VERSION__', sha);
  if (na !== voor) vervangen++;
  fs.writeFileSync(p, na);
}
if (vervangen !== 3) { console.error('Verwachtte __VERSION__ in 3 bestanden, gevonden in ' + vervangen); process.exit(1); }
console.log('versie ' + sha + ' gestempeld, deployen...');
execSync('npx wrangler deploy --config dist/wrangler.toml', { cwd: root, stdio: 'inherit' });
console.log('klaar: versie ' + sha + ' op https://snowflakes.vanali.workers.dev');
