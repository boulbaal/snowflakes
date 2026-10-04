// Snowflakes: foto's van sneeuwvlokken delen en erdoor swipen.
// De volledige API in één Worker; de app zelf staat in public/ (statisch).
// Antwoorden zijn JSON met Cache-Control: no-store, behalve de beelden.
// Fouten: { "error": "<code>" }; de app vertaalt de codes.

import { controleerGoogleToken } from './google.js';

const VERSION = '__VERSION__';

const JSON_KOP = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export const GRENZEN = {
  uploadsPerDag: 10,
  meldingenVerbergen: 3,           // na zoveel meldingen offline tot Ali kijkt
  volMaxBytes: 1_500_000,          // grote versie (D1: max 2 MB per rij)
  kleinMaxBytes: 200_000,
  volMaxPx: 1600,
  kleinMaxPx: 480,
  minPx: 200,
  feed: 20,
  top: 30,
  sessieDagen: 30,
};

const DAG = 24 * 3600 * 1000;
export const REDENEN = ['not_snowflake', 'not_own', 'inappropriate', 'quality', 'other'];

/* ---------------- kleine hulpjes ---------------- */

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_KOP, ...extra } });
const fout = (code, status = 400) => json({ error: code }, status);

function willekeurig(n) {
  const tekens = 'abcdefghijkmnpqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const x of b) s += tekens[x % tekens.length];
  return s;
}
function token() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}
function koekjes(request) {
  const uit = {};
  for (const deel of (request.headers.get('Cookie') || '').split(';')) {
    const i = deel.indexOf('=');
    if (i > 0) uit[deel.slice(0, i).trim()] = deel.slice(i + 1).trim();
  }
  return uit;
}
function koekje(naam, waarde, maxAge, pad = '/') {
  return `${naam}=${waarde}; Path=${pad}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
function isLokaal(url) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

// Alles wat iets verandert moet van onze eigen pagina komen: eigen header en,
// als de browser hem meestuurt, dezelfde Origin.
function vanOnsZelf(request, url) {
  if (request.headers.get('X-SF') !== '1') return false;
  const o = request.headers.get('Origin');
  return !o || o === url.origin;
}

/* ---------------- bijnamen ---------------- */

const GERESERVEERD = new Set(['admin', 'administrator', 'snowflakes', 'moderator', 'support']);
export function bijnaamFout(ruw) {
  if (typeof ruw !== 'string') return 'nick_invalid';
  const n = ruw.normalize('NFC').trim().replace(/\s+/g, ' ');
  const lengte = Array.from(n).length;
  if (lengte < 3) return 'nick_short';
  if (lengte > 24) return 'nick_long';
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}\p{M} ._-]*[\p{L}\p{N}\p{M}])?$/u.test(n)) return 'nick_chars';
  if (GERESERVEERD.has(n.toLowerCase())) return 'nick_taken';
  return null;
}
export const bijnaamSleutel = (n) => n.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/* ---------------- JPEG controleren ---------------- */

// Geeft { w, h } van een baseline/progressive JPEG, of null.
export function jpegMaat(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const m = bytes[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    // SOF0..SOF15 behalve DHT (C4), JPG (C8) en DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = (bytes[i + 5] << 8) | bytes[i + 6];
      const w = (bytes[i + 7] << 8) | bytes[i + 8];
      return w > 0 && h > 0 ? { w, h } : null;
    }
    i += 2 + len;
  }
  return null;
}

// Zit er nog EXIF/GPS in? (APP1 'Exif'). De app haalt het weg; de server weigert het toch.
export function heeftExif(bytes) {
  let i = 2;
  while (i + 4 < bytes.length && bytes[i] === 0xff) {
    const m = bytes[i + 1];
    if (m === 0xda) break;   // begin van de beelddata
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (m === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) return true;
    i += 2 + len;
  }
  return false;
}

/* ---------------- sessies ---------------- */

async function huidigeGebruiker(env, request) {
  const t = koekjes(request).sf_s;
  if (!t || t.length > 100) return null;
  const rij = await env.DB.prepare(
    `SELECT u.id, u.nickname, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(t), Date.now()).first();
  return rij ? { id: rij.id, nickname: rij.nickname, admin: rij.is_admin === 1 } : null;
}

async function startSessie(env, userId) {
  const t = token();
  const nu = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(t), userId, nu, nu + GRENZEN.sessieDagen * DAG).run();
  return koekje('sf_s', t, GRENZEN.sessieDagen * 24 * 3600);
}

// Inloggen met een bevestigde identiteit (Google, of de test-login lokaal).
async function logIn(env, sub, email) {
  const admin = !!(email && env.ADMIN_EMAIL && email === String(env.ADMIN_EMAIL).trim().toLowerCase());
  let u = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(sub).first();
  if (!u) {
    u = { id: willekeurig(16) };
    await env.DB.prepare('INSERT INTO users (id, google_sub, is_admin, created_at) VALUES (?, ?, ?, ?)')
      .bind(u.id, sub, admin ? 1 : 0, Date.now()).run();
  } else {
    await env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(admin ? 1 : 0, u.id).run();
  }
  return startSessie(env, u.id);
}

/* ---------------- foto's ---------------- */

const fotoVelden = `p.id, p.width, p.height, p.created_at, p.credit, p.source, u.nickname AS by`;
function fotoUit(r, extra = {}) {
  const uit = { id: r.id, w: r.width, h: r.height, by: r.by || '', at: r.created_at, ...extra };
  if (r.credit) { uit.credit = r.credit; uit.source = r.source || ''; }
  return uit;
}

async function leesBlob(env, id, variant) {
  const r = await env.DB.prepare('SELECT data FROM photo_blobs WHERE photo_id = ? AND variant = ?').bind(id, variant).first();
  if (!r) return null;
  const d = r.data;
  return d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d);
}

async function beeld(env, request, id, variant) {
  const p = await env.DB.prepare('SELECT user_id, status FROM photos WHERE id = ?').bind(id).first();
  if (!p) return new Response('Not found', { status: 404 });
  let publiek = p.status === 'approved';
  if (!publiek) {
    const me = await huidigeGebruiker(env, request);
    if (!me || (me.id !== p.user_id && !me.admin)) return new Response('Not found', { status: 404 });
  }
  const data = await leesBlob(env, id, variant);
  if (!data) return new Response('Not found', { status: 404 });
  return new Response(data, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': publiek ? 'public, max-age=86400' : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

async function upload(env, request, me) {
  if (!me.nickname) return fout('nick_needed', 403);
  const sinds = Date.now() - DAG;
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM photos WHERE user_id = ? AND created_at > ?').bind(me.id, sinds).first();
  if (n.n >= GRENZEN.uploadsPerDag) return fout('upload_limit', 429);

  let form;
  try { form = await request.formData(); } catch { return fout('upload_invalid'); }
  if (form.get('consent') !== '1') return fout('upload_consent');
  const vol = form.get('full');
  const klein = form.get('thumb');
  if (!(vol instanceof File || vol instanceof Blob) || !(klein instanceof File || klein instanceof Blob)) return fout('upload_invalid');
  if (vol.size > GRENZEN.volMaxBytes || klein.size > GRENZEN.kleinMaxBytes) return fout('upload_big', 413);
  const vb = new Uint8Array(await vol.arrayBuffer());
  const kb = new Uint8Array(await klein.arrayBuffer());
  const vm = jpegMaat(vb);
  const km = jpegMaat(kb);
  if (!vm || !km) return fout('upload_type');
  if (heeftExif(vb) || heeftExif(kb)) return fout('upload_exif');
  if (Math.max(vm.w, vm.h) > GRENZEN.volMaxPx || Math.max(km.w, km.h) > GRENZEN.kleinMaxPx) return fout('upload_dims');
  if (Math.min(vm.w, vm.h) < GRENZEN.minPx) return fout('upload_small');

  const id = willekeurig(12);
  const nu = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO photos (id, user_id, status, width, height, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, me.id, 'pending', vm.w, vm.h, vb.length, nu),
    env.DB.prepare('INSERT INTO photo_blobs (photo_id, variant, data) VALUES (?, ?, ?)').bind(id, 'full', vb.buffer),
    env.DB.prepare('INSERT INTO photo_blobs (photo_id, variant, data) VALUES (?, ?, ?)').bind(id, 'thumb', kb.buffer),
  ]);
  return json({ id, status: 'pending' }, 201);
}

async function feed(env, me, skip) {
  const lijst = (Array.isArray(skip) ? skip : []).filter((s) => typeof s === 'string' && /^[a-z0-9]{12}$/.test(s)).slice(0, 300);
  const plaats = lijst.map(() => '?').join(',');
  const zonder = lijst.length ? ` AND p.id NOT IN (${plaats})` : '';
  let q, args;
  if (me) {
    q = `SELECT ${fotoVelden} FROM photos p JOIN users u ON u.id = p.user_id
         WHERE p.status = 'approved' AND p.user_id != ?
           AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.user_id = ? AND s.photo_id = p.id)${zonder}
         ORDER BY random() LIMIT ${GRENZEN.feed}`;
    args = [me.id, me.id, ...lijst];
  } else {
    q = `SELECT ${fotoVelden} FROM photos p JOIN users u ON u.id = p.user_id
         WHERE p.status = 'approved'${zonder} ORDER BY random() LIMIT ${GRENZEN.feed}`;
    args = lijst;
  }
  const r = await env.DB.prepare(q).bind(...args).all();
  return json({ photos: r.results.map((x) => fotoUit(x)) });
}

async function swipe(env, me, body) {
  const id = body && body.id;
  const dir = body && body.dir;
  if (typeof id !== 'string' || (dir !== 1 && dir !== -1)) return fout('swipe_invalid');
  const p = await env.DB.prepare("SELECT user_id FROM photos WHERE id = ? AND status = 'approved'").bind(id).first();
  if (!p) return fout('not_found', 404);
  if (p.user_id === me.id) return fout('swipe_own');
  await env.DB.prepare(
    `INSERT INTO swipes (user_id, photo_id, dir, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, photo_id) DO UPDATE SET dir = excluded.dir, created_at = excluded.created_at`,
  ).bind(me.id, id, dir, Date.now()).run();
  return json({ ok: true });
}

async function top(env, periode) {
  const sinds = periode === 'day' ? Date.now() - DAG : periode === 'week' ? Date.now() - 7 * DAG : 0;
  const r = await env.DB.prepare(
    `SELECT ${fotoVelden}, COUNT(*) AS n FROM swipes s
       JOIN photos p ON p.id = s.photo_id JOIN users u ON u.id = p.user_id
     WHERE s.dir = 1 AND s.created_at >= ? AND p.status = 'approved'
     GROUP BY p.id ORDER BY n DESC, p.created_at DESC LIMIT ${GRENZEN.top}`,
  ).bind(sinds).all();
  return json({ photos: r.results.map((x) => fotoUit(x, { likes: x.n })) });
}

async function favorieten(env, me) {
  const r = await env.DB.prepare(
    `SELECT ${fotoVelden} FROM swipes s JOIN photos p ON p.id = s.photo_id JOIN users u ON u.id = p.user_id
     WHERE s.user_id = ? AND s.dir = 1 AND p.status = 'approved' ORDER BY s.created_at DESC LIMIT 500`,
  ).bind(me.id).all();
  return json({ photos: r.results.map((x) => fotoUit(x)) });
}

async function mijnFotos(env, me) {
  const r = await env.DB.prepare(
    `SELECT p.id, p.width, p.height, p.created_at, p.status, p.reason,
            (SELECT COUNT(*) FROM swipes s WHERE s.photo_id = p.id AND s.dir = 1) AS likes
     FROM photos p WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 500`,
  ).bind(me.id).all();
  const fotos = r.results.map((x) => ({
    id: x.id, w: x.width, h: x.height, at: x.created_at, by: me.nickname || '',
    // een verborgen foto (gemeld) toont de uploader als "wacht op controle"
    status: x.status === 'hidden' ? 'pending' : x.status, reason: x.status === 'rejected' ? x.reason || '' : '', likes: x.likes,
  }));
  return json({ photos: fotos, hearts: fotos.reduce((s, f) => s + f.likes, 0) });
}

async function verwijderFoto(env, me, id) {
  const p = await env.DB.prepare('SELECT user_id FROM photos WHERE id = ?').bind(id).first();
  if (!p || (p.user_id !== me.id && !me.admin)) return fout('not_found', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM photo_blobs WHERE photo_id = ?').bind(id),
    env.DB.prepare('DELETE FROM swipes WHERE photo_id = ?').bind(id),
    env.DB.prepare('DELETE FROM reports WHERE photo_id = ?').bind(id),
    env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function meld(env, me, id) {
  const p = await env.DB.prepare("SELECT user_id FROM photos WHERE id = ? AND status = 'approved'").bind(id).first();
  if (!p) return fout('not_found', 404);
  if (p.user_id === me.id) return fout('report_own');
  await env.DB.prepare('INSERT OR IGNORE INTO reports (user_id, photo_id, created_at) VALUES (?, ?, ?)').bind(me.id, id, Date.now()).run();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE photo_id = ?').bind(id).first();
  if (n.n >= GRENZEN.meldingenVerbergen) {
    await env.DB.prepare("UPDATE photos SET status = 'hidden' WHERE id = ? AND status = 'approved'").bind(id).run();
  }
  return json({ ok: true });
}

/* ---------------- archieffoto's (eenmalig inladen) ---------------- */

async function zaai(env, request) {
  const geheim = env.SEED_TOKEN;
  if (!geheim || String(geheim).length < 32) return fout('not_found', 404);
  const kop = request.headers.get('Authorization') || '';
  const gegeven = kop.startsWith('Bearer ') ? kop.slice(7) : '';
  if ((await sha256(gegeven)) !== (await sha256(String(geheim)))) return fout('not_found', 404);
  let form;
  try { form = await request.formData(); } catch { return fout('upload_invalid'); }
  const credit = String(form.get('credit') || '').trim();
  const bron = String(form.get('source') || '').trim();
  if (!credit || credit.length > 80) return fout('seed_credit');
  if (!/^https:\/\/[^\s]{8,300}$/.test(bron)) return fout('seed_source');
  const al = await env.DB.prepare('SELECT id FROM photos WHERE source = ?').bind(bron).first();
  if (al) return json({ id: al.id, existing: true });
  const vol = form.get('full');
  const klein = form.get('thumb');
  if (!vol || !klein || typeof vol === 'string' || typeof klein === 'string') return fout('upload_invalid');
  if (vol.size > GRENZEN.volMaxBytes || klein.size > GRENZEN.kleinMaxBytes) return fout('upload_big', 413);
  const vb = new Uint8Array(await vol.arrayBuffer());
  const kb = new Uint8Array(await klein.arrayBuffer());
  const vm = jpegMaat(vb);
  const km = jpegMaat(kb);
  if (!vm || !km) return fout('upload_type');
  if (heeftExif(vb) || heeftExif(kb)) return fout('upload_exif');
  if (Math.max(vm.w, vm.h) > GRENZEN.volMaxPx || Math.max(km.w, km.h) > GRENZEN.kleinMaxPx) return fout('upload_dims');
  // de archieffoto's horen bij één vaste systeemgebruiker zonder bijnaam
  let u = await env.DB.prepare("SELECT id FROM users WHERE google_sub = 'seed:archive'").first();
  if (!u) {
    u = { id: willekeurig(16) };
    await env.DB.prepare("INSERT INTO users (id, google_sub, is_admin, created_at) VALUES (?, 'seed:archive', 0, ?)").bind(u.id, Date.now()).run();
  }
  const id = willekeurig(12);
  const nu = Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO photos (id, user_id, status, width, height, bytes, credit, source, created_at, reviewed_at)
                    VALUES (?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)`).bind(id, u.id, vm.w, vm.h, vb.length, credit, bron, nu, nu),
    env.DB.prepare('INSERT INTO photo_blobs (photo_id, variant, data) VALUES (?, ?, ?)').bind(id, 'full', vb.buffer),
    env.DB.prepare('INSERT INTO photo_blobs (photo_id, variant, data) VALUES (?, ?, ?)').bind(id, 'thumb', kb.buffer),
  ]);
  return json({ id }, 201);
}

/* ---------------- beheer (alleen Ali) ---------------- */

async function wachtrij(env) {
  const r = await env.DB.prepare(
    `SELECT ${fotoVelden}, p.status, (SELECT COUNT(*) FROM reports r WHERE r.photo_id = p.id) AS reports
     FROM photos p JOIN users u ON u.id = p.user_id
     WHERE p.status IN ('pending', 'hidden') ORDER BY p.status = 'hidden' DESC, p.created_at ASC LIMIT 100`,
  ).all();
  return json({ photos: r.results.map((x) => fotoUit(x, { status: x.status, reports: x.reports })) });
}

async function beoordeel(env, id, body) {
  const actie = body && body.action;
  const p = await env.DB.prepare('SELECT status FROM photos WHERE id = ?').bind(id).first();
  if (!p) return fout('not_found', 404);
  const nu = Date.now();
  if (actie === 'approve') {
    await env.DB.batch([
      env.DB.prepare("UPDATE photos SET status = 'approved', reason = NULL, reviewed_at = ? WHERE id = ?").bind(nu, id),
      env.DB.prepare('DELETE FROM reports WHERE photo_id = ?').bind(id),   // goedgekeurd na meldingen: opnieuw beginnen
    ]);
  } else if (actie === 'reject') {
    // een vaste code, zodat de uploader de reden in zijn eigen taal ziet
    const reden = REDENEN.includes(body.reason) ? body.reason : 'other';
    // het beeld zelf hoeven we niet te bewaren: plaats vrijmaken
    await env.DB.batch([
      env.DB.prepare("UPDATE photos SET status = 'rejected', reason = ?, reviewed_at = ? WHERE id = ?").bind(reden, nu, id),
      env.DB.prepare('DELETE FROM photo_blobs WHERE photo_id = ?').bind(id),
      env.DB.prepare('DELETE FROM swipes WHERE photo_id = ?').bind(id),
      env.DB.prepare('DELETE FROM reports WHERE photo_id = ?').bind(id),
    ]);
  } else {
    return fout('action_invalid');
  }
  return json({ ok: true });
}

/* ---------------- account ---------------- */

async function zetBijnaam(env, me, body) {
  const ruw = body && body.nickname;
  const f = bijnaamFout(ruw);
  if (f) return fout(f);
  const naam = ruw.normalize('NFC').trim().replace(/\s+/g, ' ');
  try {
    await env.DB.prepare('UPDATE users SET nickname = ?, nickname_key = ? WHERE id = ?').bind(naam, bijnaamSleutel(naam), me.id).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return fout('nick_taken', 409);
    throw e;
  }
  return json({ nickname: naam });
}

async function verwijderAccount(env, me) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM photo_blobs WHERE photo_id IN (SELECT id FROM photos WHERE user_id = ?)').bind(me.id),
    env.DB.prepare('DELETE FROM swipes WHERE photo_id IN (SELECT id FROM photos WHERE user_id = ?)').bind(me.id),
    env.DB.prepare('DELETE FROM reports WHERE photo_id IN (SELECT id FROM photos WHERE user_id = ?)').bind(me.id),
    env.DB.prepare('DELETE FROM photos WHERE user_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM swipes WHERE user_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM reports WHERE user_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(me.id),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': koekje('sf_s', '', 0) });
}

/* ---------------- de router ---------------- */

async function leesJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function api(request, env, url) {
  const pad = url.pathname;
  const m = request.method;

  if (pad === '/api/version') return json({ version: VERSION });

  if (pad === '/api/me' && m === 'GET') {
    const me = await huidigeGebruiker(env, request);
    return json({
      user: me ? { nickname: me.nickname, admin: me.admin } : null,
      clientId: env.GOOGLE_CLIENT_ID || '',
    });
  }

  if (pad === '/api/nonce' && m === 'GET') {
    const n = willekeurig(24);
    return json({ nonce: n }, 200, { 'Set-Cookie': koekje('sf_n', n, 600, '/api') });
  }

  // Archieffoto's inladen (eenmalig, vanaf Ali's pc): alleen met de geheime SEED_TOKEN.
  // Zonder die instelling bestaat deze route niet.
  if (pad === '/api/seed' && m === 'POST') return zaai(env, request);

  // vanaf hier: alleen van onze eigen pagina (behalve GET's die niets veranderen)
  const schrijft = m !== 'GET' && m !== 'HEAD';
  if (schrijft && !vanOnsZelf(request, url)) return fout('forbidden', 403);
  // (lokaal met de test-login niet: de tests doen veel schrijfacties na elkaar)
  if (schrijft && env.RL_WRITE && !(env.DEV_LOGIN === '1' && isLokaal(url))) {
    const ip = request.headers.get('CF-Connecting-IP') || 'lokaal';
    const { success } = await env.RL_WRITE.limit({ key: ip });
    if (!success) return fout('slow_down', 429);
  }

  if (pad === '/api/login' && m === 'POST') {
    const body = await leesJson(request);
    const nonce = koekjes(request).sf_n;
    let wie;
    try {
      wie = await controleerGoogleToken(body && body.credential, { clientId: env.GOOGLE_CLIENT_ID, nonce });
    } catch (e) {
      return fout('login_failed', 401);
    }
    const sessie = await logIn(env, wie.sub, wie.email);
    const h = new Headers(JSON_KOP);
    h.append('Set-Cookie', sessie);
    h.append('Set-Cookie', koekje('sf_n', '', 0, '/api'));
    return new Response(JSON.stringify({ ok: true }), { headers: h });
  }

  // Test-login: bestaat alleen lokaal (wrangler dev met DEV_LOGIN=1 in .dev.vars).
  // Het deploy-script weigert te deployen als DEV_LOGIN in wrangler.toml staat.
  if (pad === '/api/dev-login' && m === 'POST') {
    if (env.DEV_LOGIN !== '1' || !isLokaal(url)) return fout('not_found', 404);
    const body = await leesJson(request);
    if (!body || typeof body.sub !== 'string') return fout('login_failed', 400);
    const sessie = await logIn(env, 'dev:' + body.sub, typeof body.email === 'string' ? body.email.toLowerCase() : '');
    return json({ ok: true }, 200, { 'Set-Cookie': sessie });
  }

  // Tests: alles leegmaken. Zelfde slot als de test-login: alleen lokaal met DEV_LOGIN=1.
  if (pad === '/api/dev-reset' && m === 'POST') {
    if (env.DEV_LOGIN !== '1' || !isLokaal(url)) return fout('not_found', 404);
    await env.DB.batch(['reports', 'swipes', 'photo_blobs', 'photos', 'sessions', 'users'].map((tbl) => env.DB.prepare('DELETE FROM ' + tbl)));
    return json({ ok: true });
  }

  if (pad === '/api/feed' && m === 'POST') {
    const me = await huidigeGebruiker(env, request);
    const body = await leesJson(request);
    return feed(env, me, body && body.skip);
  }

  const tm = /^\/api\/top\/(day|week|all)$/.exec(pad);
  if (tm && m === 'GET') return top(env, tm[1]);

  // vanaf hier: ingelogd
  const me = await huidigeGebruiker(env, request);
  if (!me) return fout('login_needed', 401);

  if (pad === '/api/logout' && m === 'POST') {
    const t = koekjes(request).sf_s;
    if (t) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(t)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': koekje('sf_s', '', 0) });
  }
  if (pad === '/api/me/nickname' && m === 'POST') return zetBijnaam(env, me, await leesJson(request));
  if (pad === '/api/me' && m === 'DELETE') return verwijderAccount(env, me);
  if (pad === '/api/swipe' && m === 'POST') return swipe(env, me, await leesJson(request));
  if (pad === '/api/favorites' && m === 'GET') return favorieten(env, me);
  if (pad === '/api/mine' && m === 'GET') return mijnFotos(env, me);
  if (pad === '/api/photos' && m === 'POST') return upload(env, request, me);

  const fm = /^\/api\/photos\/([a-z0-9]{12})(\/report)?$/.exec(pad);
  if (fm && m === 'DELETE' && !fm[2]) return verwijderFoto(env, me, fm[1]);
  if (fm && m === 'POST' && fm[2]) return meld(env, me, fm[1]);

  if (pad.startsWith('/api/admin/')) {
    if (!me.admin) return fout('not_found', 404);
    if (pad === '/api/admin/queue' && m === 'GET') return wachtrij(env);
    const am = /^\/api\/admin\/photos\/([a-z0-9]{12})$/.exec(pad);
    if (am && m === 'POST') return beoordeel(env, am[1], await leesJson(request));
  }

  return fout('not_found', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      const im = /^\/img\/([a-z0-9]{12})\/(f|t)$/.exec(url.pathname);
      if (im && request.method === 'GET') return await beeld(env, request, im[1], im[2] === 'f' ? 'full' : 'thumb');
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e && e.stack || e);
      return fout('server', 500);
    }
  },
};
