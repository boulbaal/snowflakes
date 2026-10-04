// Snowflakes E2E: de hele weg van uploaden tot swipen, tegen wrangler dev.
const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const FIX = (n) => path.join(__dirname, '..', 'fixtures', n);
const H = { 'X-SF': '1' };

// Google's inlogscript niet echt laden in de tests: een klein nepje dat een knop tekent.
async function nepGoogle(page) {
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.google={accounts:{id:{initialize(o){window.__gsiInit=o},renderButton(el){const b=document.createElement('button');b.textContent='Google';b.id='nepGoogle';el.appendChild(b)}}}}`,
  }));
}

// Een gebruiker via de API (eigen cookies), voor het klaarzetten van data.
async function gebruiker(baseURL, sub, nick, email = '') {
  const ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: H });
  await ctx.post('/api/dev-login', { data: { sub, email } });
  if (nick) expect((await ctx.post('/api/me/nickname', { data: { nickname: nick } })).ok()).toBe(true);
  return ctx;
}
const MULTI = () => ({
  full: { name: 'f.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(FIX('vlok.jpg')) },
  thumb: { name: 't.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(FIX('vlok-klein.jpg')) },
  consent: '1',
});
async function uploadApi(ctx) {
  // zoals de app: zonder EXIF (de fixtures vlok.jpg en vlok-klein.jpg hebben er geen)
  const r = await ctx.post('/api/photos', { multipart: MULTI() });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id;
}
async function loginInPage(page, sub, email = '') {
  await page.evaluate(([s, e]) => window.__sfDevLogin(s, e), [sub, email]);
}

test.beforeEach(async ({ baseURL, page }) => {
  const r = await pwRequest.newContext({ baseURL, extraHTTPHeaders: H });
  expect((await r.post('/api/dev-reset')).ok()).toBe(true);
  await r.dispose();
  await nepGoogle(page);
  page.on('dialog', (d) => d.accept());
  page.__fouten = [];
  page.on('pageerror', (e) => page.__fouten.push(String(e)));
});
test.afterEach(async ({ page }) => {
  expect(page.__fouten).toEqual([]);
});

test('zonder foto\'s: een vriendelijke lege stapel', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#leegstapel')).toBeVisible();
  await expect(page.locator('#ja')).toBeDisabled();
});

test('de hele weg: uploaden (EXIF weg), goedkeuren, swipen, favoriet, top en hartjes', async ({ page, baseURL }) => {
  const ali = await gebruiker(baseURL, 'ali', 'Ali', 'admin@example.test');
  await page.goto('/');
  // Bob uploadt via de app een foto MET GPS-gegevens
  await loginInPage(page, 'bob');
  await expect(page.locator('#velNaam')).toBeVisible();
  await page.locator('#naamInvoer').fill('Bob');
  await page.locator('#naamOk').click();
  await expect(page.locator('#wie')).toHaveText('Bob');
  await page.locator('.balk a[data-naar="upload"]').click();
  await page.setInputFiles('#upBestand', FIX('vlok-met-gps.jpg'));
  await expect(page.locator('#upVoorbeeld')).toBeVisible();
  await expect(page.locator('#upVerstuur')).toBeDisabled();       // eerst het vinkje
  await page.locator('#upToestemming').check();
  await page.locator('#upVerstuur').click();
  await expect(page.locator('#upMelding')).toHaveClass(/goed/);
  await page.goto('/#/mine');
  await expect(page.locator('#mijnLijst .status')).toHaveText([/Wacht op goedkeuring|Waiting for approval/]);
  // wat bij de server aankwam bevat geen EXIF/GPS meer
  const q = await (await ali.get('/api/admin/queue')).json();
  expect(q.photos).toHaveLength(1);
  const id = q.photos[0].id;
  const beeld = Buffer.from(await (await ali.get('/img/' + id + '/f')).body());
  expect(beeld.includes(Buffer.from('Exif'))).toBe(false);
  expect(beeld.includes(Buffer.from('TestCamera'))).toBe(false);
  // nog niet zichtbaar voor anderen
  expect((await page.request.get('/img/' + id + '/t')).status()).toBe(200);   // de eigenaar ziet hem wel
  const anoniem = await pwRequest.newContext({ baseURL });
  expect((await anoniem.get('/img/' + id + '/t')).status()).toBe(404);
  expect((await (await anoniem.post('/api/feed', { data: {}, headers: H })).json()).photos).toHaveLength(0);

  // Ali keurt goed via de beheerpagina
  await loginInPage(page, 'ali', 'admin@example.test');
  await page.goto('/#/admin');
  await expect(page.locator('#admLijst li')).toHaveCount(1);
  await page.locator('#admLijst li .knop:not(.gevaar)').click();
  await expect(page.locator('#admLijst li')).toHaveCount(0);
  expect((await anoniem.get('/img/' + id + '/t')).status()).toBe(200);

  // Cara swipet naar rechts
  await loginInPage(page, 'cara');
  await page.locator('#naamInvoer').fill('Cara');
  await page.locator('#naamOk').click();
  await page.goto('/#/');
  await expect(page.locator('.kaart:not(.onder) .door')).toHaveText('© Bob');
  await page.locator('#ja').click();
  await expect(page.locator('#leegstapel')).toBeVisible();
  await page.goto('/#/favorites');
  await expect(page.locator('#favLijst li')).toHaveCount(1);
  await page.goto('/#/top');
  await page.locator('#topTabs button[data-periode="day"]').click();
  await expect(page.locator('#topLijst .label')).toContainText(['♥ 1']);
  // Bob ziet zijn hartje
  await loginInPage(page, 'bob');
  await page.goto('/#/mine');
  await expect(page.locator('#mijnHartjes')).toContainText('1');
  await expect(page.locator('#mijnLijst .status')).toHaveText(['Online']);   // zelfde in nl en en
});

test('zonder account: swipen kan, rechts vraagt één keer om in te loggen en telt niet als stem', async ({ page, baseURL }) => {
  const bob = await gebruiker(baseURL, 'bob', 'Bob');
  const ali = await gebruiker(baseURL, 'ali', 'Ali', 'admin@example.test');
  for (let i = 0; i < 3; i++) {
    const id = await uploadApi(bob);
    await ali.post('/api/admin/photos/' + id, { data: { action: 'approve' } });
  }
  await page.goto('/');
  await expect(page.locator('.kaart:not(.onder)')).toBeVisible();
  await page.locator('#ja').click();
  await expect(page.locator('#velLogin')).toBeVisible();
  await expect(page.locator('#loginUitleg')).toHaveText(/Log in om hem te bewaren|Log in to save it/);
  await expect(page.locator('#nepGoogle')).toBeVisible();                     // Google-knop getekend
  expect(await page.evaluate(() => window.__gsiInit && window.__gsiInit.nonce.length)).toBeGreaterThan(10);
  await page.locator('#loginDicht').click();
  await page.locator('#ja').click();
  await expect(page.locator('#velLogin')).toBeHidden();                      // maar één keer
  // met de pijltjes
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#leegstapel')).toBeVisible();
  const top = await (await ali.get('/api/top/all')).json();
  expect(top.photos).toHaveLength(0);                                        // geen stemmen zonder account
});

test('slepen naar rechts en links', async ({ page, baseURL }) => {
  const bob = await gebruiker(baseURL, 'bob', 'Bob');
  const ali = await gebruiker(baseURL, 'ali', 'Ali', 'admin@example.test');
  for (let i = 0; i < 2; i++) {
    const id = await uploadApi(bob);
    await ali.post('/api/admin/photos/' + id, { data: { action: 'approve' } });
  }
  await page.goto('/');
  await loginInPage(page, 'cara');
  await page.locator('#naamInvoer').fill('Cara');
  await page.locator('#naamOk').click();
  const sleep = async (dx) => {
    await expect(page.locator('.kaart:not(.onder):not(.weg)')).toBeVisible();
    const k = await page.locator('.kaart:not(.onder):not(.weg)').boundingBox();
    await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2);
    await page.mouse.down();
    await page.mouse.move(k.x + k.width / 2 + dx, k.y + k.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  const boven = page.locator('.kaart:not(.onder):not(.weg)');
  const eerste = await boven.getAttribute('data-id');
  await sleep(20);                                                           // te kort: terug op zijn plaats
  await expect(boven).toHaveAttribute('data-id', eerste);
  await sleep(200);
  await expect(boven).not.toHaveAttribute('data-id', eerste);
  await sleep(-200);
  await expect(page.locator('#leegstapel')).toBeVisible();
  const fav = await (await (await gebruiker(baseURL, 'cara', null)).get('/api/favorites')).json();
  expect(fav.photos.map((f) => f.id)).toEqual([eerste]);
});

test('melden: na 3 meldingen offline, Ali ziet hem in de wachtrij', async ({ page, baseURL }) => {
  const bob = await gebruiker(baseURL, 'bob', 'Bob');
  const ali = await gebruiker(baseURL, 'ali', 'Ali', 'admin@example.test');
  const id = await uploadApi(bob);
  await ali.post('/api/admin/photos/' + id, { data: { action: 'approve' } });
  for (const n of ['u1', 'u2']) await (await gebruiker(baseURL, n, 'Gebruiker' + n)).post('/api/photos/' + id + '/report');
  await page.goto('/');
  await loginInPage(page, 'u3');
  await page.locator('#naamInvoer').fill('Derde');
  await page.locator('#naamOk').click();
  await page.locator('.kaart:not(.onder) .vlag').click();
  await page.locator('#meldJa').click();
  await expect(page.locator('#toast')).toHaveClass(/zichtbaar/);
  const anoniem = await pwRequest.newContext({ baseURL });
  expect((await anoniem.get('/img/' + id + '/t')).status()).toBe(404);
  const q = await (await ali.get('/api/admin/queue')).json();
  expect(q.photos.map((p) => [p.id, p.status, p.reports])).toEqual([[id, 'hidden', 3]]);
  // de eigenaar ziet "wacht op controle", geen meldingen
  const mijn = await (await bob.get('/api/mine')).json();
  expect(mijn.photos[0].status).toBe('pending');
});

test('weigeren met een reden: de uploader ziet de reden in zijn taal', async ({ page, baseURL }) => {
  const bob = await gebruiker(baseURL, 'bob', 'Bob');
  const id = await uploadApi(bob);
  await page.goto('/');
  await loginInPage(page, 'ali', 'admin@example.test');
  await page.locator('#naamInvoer').fill('Ali');
  await page.locator('#naamOk').click();
  await page.goto('/#/admin');
  await page.locator('#admLijst select').selectOption('not_snowflake');
  await page.locator('#admLijst .knop.gevaar').click();
  await expect(page.locator('#admLeeg')).toBeVisible();
  const mijn = await (await bob.get('/api/mine')).json();
  expect(mijn.photos[0]).toMatchObject({ id, status: 'rejected', reason: 'not_snowflake' });
  await loginInPage(page, 'bob');
  await page.goto('/#/mine');
  await expect(page.locator('#mijnLijst .reden')).toHaveText(/Geen sneeuwvlok|Not a snowflake/);
});

test('beheer is alleen voor de beheerder', async ({ page, baseURL }) => {
  const bob = await gebruiker(baseURL, 'bob', 'Bob', 'bob@example.test');
  expect((await bob.get('/api/admin/queue')).status()).toBe(404);
  await page.goto('/');
  await loginInPage(page, 'bob', 'bob@example.test');
  await page.goto('/#/admin');
  await expect(page).toHaveURL(/#\/$/);
  await page.goto('/#/account');
  await expect(page.locator('#accBeheer')).toBeHidden();
});

test('zonder account: uploaden, favorieten en mijn foto\'s vragen om in te loggen', async ({ page }) => {
  for (const s of ['upload', 'favorites', 'mine']) {
    await page.goto('/#/' + s);
    await expect(page.locator('#s-' + s + ' .slot')).toBeVisible();
    await expect(page.locator('#s-' + s + ' .slot .knop')).toBeVisible();
  }
  await page.locator('#s-mine .slot .knop').click();
  await expect(page.locator('#velLogin')).toBeVisible();
});

test('bijnaam: bezet en ongeldig geven een duidelijke melding', async ({ page, baseURL }) => {
  await gebruiker(baseURL, 'bob', 'Bob');
  await page.goto('/');
  await loginInPage(page, 'cara');
  await page.locator('#naamInvoer').fill('bob');
  await page.locator('#naamOk').click();
  await expect(page.locator('#naamMelding')).toHaveText(/bezet|taken/);
  await page.locator('#naamInvoer').fill('<b>');
  await page.locator('#naamOk').click();
  await expect(page.locator('#naamMelding')).toHaveText(/letters/);
});

test('te kleine foto wordt in de browser al geweigerd', async ({ page }) => {
  await page.goto('/');
  await loginInPage(page, 'bob');
  await page.locator('#naamInvoer').fill('Bob');
  await page.locator('#naamOk').click();
  await page.goto('/#/upload');
  await page.setInputFiles('#upBestand', FIX('te-klein.jpg'));
  await expect(page.locator('#upMelding')).toHaveText(/200/);
  await expect(page.locator('#upVoorbeeld')).toBeHidden();
});

test('account verwijderen haalt alles weg', async ({ page, baseURL }) => {
  const ali = await gebruiker(baseURL, 'ali', 'Ali', 'admin@example.test');
  await page.goto('/');
  await loginInPage(page, 'bob');
  await page.locator('#naamInvoer').fill('Bob');
  await page.locator('#naamOk').click();
  const bobCtx = page.request;
  const r = await bobCtx.post('/api/photos', { headers: H, multipart: MULTI() });
  expect(r.status()).toBe(201);
  const id = (await r.json()).id;
  await ali.post('/api/admin/photos/' + id, { data: { action: 'approve' } });
  await page.goto('/#/account');
  await page.locator('.gevaarzone summary').click();
  await page.locator('#accVerwijder').click();
  await expect(page.locator('#wie')).toHaveText(/Inloggen|Log in/);
  const anoniem = await pwRequest.newContext({ baseURL });
  expect((await anoniem.get('/img/' + id + '/f')).status()).toBe(404);
  // de bijnaam is weer vrij
  await gebruiker(baseURL, 'nieuw', 'Bob');
});

test('beveiliging: schrijven zonder eigen header wordt geweigerd, test-login bestaat alleen lokaal', async ({ baseURL }) => {
  const ctx = await pwRequest.newContext({ baseURL });
  expect((await ctx.post('/api/dev-login', { data: { sub: 'x' } })).status()).toBe(403);
  const vals = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { ...H, Origin: 'https://evil.example' } });
  expect((await vals.post('/api/dev-login', { data: { sub: 'x' } })).status()).toBe(403);
  const r = await ctx.get('/');
  expect(r.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  // ongeldig Google-token
  const g = await pwRequest.newContext({ baseURL, extraHTTPHeaders: H });
  expect((await g.post('/api/login', { data: { credential: 'a.b.c' } })).status()).toBe(401);
});

test('Arabisch: van rechts naar links, alle teksten vertaald', async ({ page }) => {
  await page.goto('/');
  await page.locator('#taal').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#navSwipe')).not.toHaveText('Swipe');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
