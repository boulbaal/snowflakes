// Controle van Google ID-tokens met een eigen testsleutel (geen netwerk).
import test from 'node:test';
import assert from 'node:assert/strict';
import { controleerGoogleToken, wisSleutelCache, CERTS_URL } from '../../src/google.js';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sleutelpaar = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const anderPaar = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', sleutelpaar.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

const NU = Date.UTC(2026, 9, 4, 12, 0, 0);
const S = Math.floor(NU / 1000);
const CLIENT = 'test-client.apps.googleusercontent.com';

async function maakToken(inhoud, { kid = 'k1', alg = 'RS256', sleutel = sleutelpaar.privateKey } = {}) {
  const kop = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(inhoud));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', sleutel, new TextEncoder().encode(kop + '.' + body));
  return kop + '.' + body + '.' + b64url(sig);
}
const goed = (extra = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234567890', email: 'Iemand@Gmail.com', email_verified: true, iat: S - 10, exp: S + 3600, nonce: 'n0nce', ...extra });
let opgehaald = 0;
const haal = async (url) => {
  assert.equal(url, CERTS_URL);
  opgehaald++;
  return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=1000' } });
};
const opties = (extra = {}) => ({ clientId: CLIENT, nonce: 'n0nce', nu: NU, haal, ...extra });

test('een geldig token geeft sub en het e-mailadres in kleine letters', async () => {
  wisSleutelCache();
  const r = await controleerGoogleToken(await maakToken(goed()), opties());
  assert.deepEqual(r, { sub: '1234567890', email: 'iemand@gmail.com' });
});

test('de sleutels worden bewaard (niet bij elke login opnieuw opgehaald)', async () => {
  wisSleutelCache(); opgehaald = 0;
  await controleerGoogleToken(await maakToken(goed()), opties());
  await controleerGoogleToken(await maakToken(goed()), opties());
  assert.equal(opgehaald, 1);
});

const weigert = async (token, code, o = {}) => {
  await assert.rejects(controleerGoogleToken(token, opties(o)), (e) => { assert.equal(e.code, code); return true; });
};

test('vervalste handtekening wordt geweigerd', async () => {
  await weigert(await maakToken(goed(), { sleutel: anderPaar.privateKey }), 'token_handtekening');
});
test('aangepaste inhoud met de oude handtekening wordt geweigerd', async () => {
  const t = (await maakToken(goed())).split('.');
  t[1] = b64url(JSON.stringify(goed({ sub: 'iemand-anders' })));
  await weigert(t.join('.'), 'token_handtekening');
});
test('verkeerde doelgroep (token voor een andere app)', async () => {
  await weigert(await maakToken(goed({ aud: 'andere-app' })), 'token_doelgroep');
});
test('verkeerde uitgever', async () => {
  await weigert(await maakToken(goed({ iss: 'https://evil.example' })), 'token_uitgever');
});
test('verlopen token', async () => {
  await weigert(await maakToken(goed({ exp: S - 120 })), 'token_verlopen');
});
test('nonce moet kloppen en mag niet ontbreken', async () => {
  await weigert(await maakToken(goed({ nonce: 'ander' })), 'token_nonce');
  await weigert(await maakToken(goed()), 'token_nonce', { nonce: undefined });
});
test('alg "none" of een andere alg wordt geweigerd', async () => {
  const kop = b64url(JSON.stringify({ alg: 'none', kid: 'k1' }));
  await weigert(kop + '.' + b64url(JSON.stringify(goed())) + '.', 'token_alg');
  await weigert(await maakToken(goed(), { alg: 'HS256' }), 'token_alg');
});
test('onbekende sleutel', async () => {
  wisSleutelCache();
  await weigert(await maakToken(goed(), { kid: 'onbekend' }), 'token_sleutel');
});
test('rommel wordt geweigerd', async () => {
  await weigert('geen.token', 'token_vorm');
  await weigert('a.b.c', 'token_vorm');
  await weigert(null, 'token_vorm');
});
test('zonder bevestigd e-mailadres: inloggen mag, maar zonder e-mail (dus nooit beheerder)', async () => {
  wisSleutelCache();
  const r = await controleerGoogleToken(await maakToken(goed({ email_verified: false })), opties());
  assert.deepEqual(r, { sub: '1234567890', email: '' });
});
