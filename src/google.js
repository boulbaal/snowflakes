// Controle van een Google ID-token (Google Identity Services), zonder client-secret.
// Google ondertekent het token met RS256; de publieke sleutels staan op CERTS_URL.
// We controleren handtekening, uitgever, doelgroep (ons client-ID), vervaltijd,
// nonce en of het e-mailadres bevestigd is.

export const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const UITGEVERS = ['accounts.google.com', 'https://accounts.google.com'];
const SPELING_S = 60;   // klokverschil dat we toelaten

let sleutelCache = { tot: 0, keys: null };

function b64urlNaarBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const uit = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) uit[i] = bin.charCodeAt(i);
  return uit;
}
function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlNaarBytes(s)));
}

// haalt de sleutels op en bewaart ze zolang Google zegt (max-age), max. 6 uur
async function sleutels(haal, nu) {
  if (sleutelCache.keys && sleutelCache.tot > nu) return sleutelCache.keys;
  const r = await haal(CERTS_URL);
  if (!r.ok) throw new Error('certs_' + r.status);
  const json = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  const s = Math.min(m ? Number(m[1]) : 3600, 6 * 3600);
  sleutelCache = { tot: nu + s * 1000, keys: Array.isArray(json.keys) ? json.keys : [] };
  return sleutelCache.keys;
}

export function wisSleutelCache() { sleutelCache = { tot: 0, keys: null }; }

/**
 * @param {string} token   het ID-token (JWT) uit de browser
 * @param {object} o       { clientId, nonce, nu (ms), haal (fetch) }
 * @returns {Promise<{sub:string,email:string}>}  of een Error met .code
 */
export async function controleerGoogleToken(token, o) {
  const fout = (code) => Object.assign(new Error(code), { code });
  if (typeof token !== 'string' || token.length > 8192) throw fout('token_vorm');
  const delen = token.split('.');
  if (delen.length !== 3) throw fout('token_vorm');
  let kop, inhoud;
  try { kop = b64urlJson(delen[0]); inhoud = b64urlJson(delen[1]); } catch { throw fout('token_vorm'); }
  if (kop.alg !== 'RS256' || typeof kop.kid !== 'string') throw fout('token_alg');

  const nu = o.nu ?? Date.now();
  let keys = await sleutels(o.haal || fetch, nu);
  let jwk = keys.find((k) => k.kid === kop.kid);
  if (!jwk) {
    // Google wisselt sleutels: één keer opnieuw ophalen
    wisSleutelCache();
    keys = await sleutels(o.haal || fetch, nu);
    jwk = keys.find((k) => k.kid === kop.kid);
  }
  if (!jwk) throw fout('token_sleutel');

  const sleutel = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', sleutel, b64urlNaarBytes(delen[2]),
    new TextEncoder().encode(delen[0] + '.' + delen[1]),
  );
  if (!ok) throw fout('token_handtekening');

  const s = Math.floor(nu / 1000);
  if (!UITGEVERS.includes(inhoud.iss)) throw fout('token_uitgever');
  if (!o.clientId || inhoud.aud !== o.clientId) throw fout('token_doelgroep');
  if (typeof inhoud.exp !== 'number' || inhoud.exp + SPELING_S < s) throw fout('token_verlopen');
  if (typeof inhoud.iat === 'number' && inhoud.iat - SPELING_S > s) throw fout('token_toekomst');
  if (!o.nonce || inhoud.nonce !== o.nonce) throw fout('token_nonce');
  if (typeof inhoud.sub !== 'string' || !inhoud.sub) throw fout('token_sub');
  const bevestigd = inhoud.email_verified === true || inhoud.email_verified === 'true';
  return { sub: inhoud.sub, email: bevestigd && typeof inhoud.email === 'string' ? inhoud.email.toLowerCase() : '' };
}
