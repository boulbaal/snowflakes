/* Snowflakes: foto's van sneeuwvlokken delen en erdoor swipen.
 * Vanilla JS, geen build. Tekst van gebruikers gaat altijd via textContent.
 */
'use strict';

(function () {
  const { TALEN, TEKSTEN } = self.SF_I18N;
  const VERSION = '__VERSION__';
  const VERSIE = VERSION.startsWith('__') ? 'dev' : VERSION;
  const PAYPAL = 'ABoulbahaiem';
  const GSI = 'https://accounts.google.com/gsi/client';

  const $ = (id) => document.getElementById(id);
  const beweging = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================= opslag (per toestel, alleen gemak) ================= */
  const K_TAAL = 'sf.lang';
  const K_GEZIEN = 'sf.seen';      // zonder account: welke vlokken je al zag
  const K_TIP = 'sf.tip';          // het briefje "log in om te bewaren" al getoond
  const lees = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  /* ================= talen ================= */
  function bepaalTaal() {
    const b = lees(K_TAAL);
    if (b && TALEN[b]) return b;
    const l = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (const tag of l) {
      const c = String(tag).toLowerCase().split('-')[0];
      if (TALEN[c]) return c;
      if (c === 'tzm' || c === 'ber' || c === 'kab' || c === 'shi' || c === 'rif') return 'zgh';
      if (c === 'kmr') return 'ku';
    }
    return 'en';
  }
  let taal = bepaalTaal();
  function t(k, vars) {
    let s = (TEKSTEN[taal] && TEKSTEN[taal][k]) || TEKSTEN.en[k] || k;
    if (s && typeof s === 'object') {
      const n = vars && typeof vars.n === 'number' ? vars.n : 0;
      let soort = 'other';
      try { soort = new Intl.PluralRules(taal).select(n); } catch {}
      s = s[soort] || s.other;
    }
    if (vars) for (const v of Object.keys(vars)) s = s.split('{' + v + '}').join(String(vars[v]));
    return s;
  }
  const getal = (n) => { try { return new Intl.NumberFormat(taal).format(n); } catch { return String(n); } };

  /* ================= de server ================= */
  async function vraag(pad, opties = {}) {
    const o = { method: opties.method || 'GET', credentials: 'same-origin', headers: {} };
    if (o.method !== 'GET') o.headers['X-SF'] = '1';
    if (opties.json !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opties.json); }
    if (opties.form) o.body = opties.form;
    let r;
    try { r = await fetch(pad, o); } catch { const e = new Error('offline'); e.code = 'offline'; throw e; }
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) { const e = new Error((data && data.error) || 'server'); e.code = (data && data.error) || 'server'; e.status = r.status; throw e; }
    return data;
  }
  const foutTekst = (e) => {
    const k = 'err.' + ((e && e.code) || 'server');
    const s = t(k);
    return s === k ? t('err.server') : s;
  };

  /* ================= wie ben ik ================= */
  let ik = null;          // { nickname, admin } of null
  let clientId = '';
  async function laadIk() {
    try {
      const r = await vraag('/api/me');
      ik = r.user; clientId = r.clientId || '';
    } catch { ik = null; }
    toonWie();
  }
  const wie = $('wie');
  function toonWie() {
    if (ik && ik.nickname) { wie.textContent = ik.nickname; wie.setAttribute('aria-label', t('account.title') + ': ' + ik.nickname); }
    else if (ik) { wie.textContent = t('nick.title'); wie.removeAttribute('aria-label'); }
    else { wie.textContent = t('login.button'); wie.removeAttribute('aria-label'); }
  }
  wie.addEventListener('click', () => {
    if (!ik) vraagLogin('');
    else if (!ik.nickname) vraagBijnaam();
    else location.hash = '#/account';
  });

  /* ================= kleine meldingen ================= */
  const toast = $('toast');
  let toastTimer = 0;
  function toonToast(tekst) {
    toast.textContent = tekst;
    toast.classList.add('zichtbaar');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('zichtbaar'), 2600);
  }

  /* ================= vellen (dialogen) ================= */
  let openVel = null;
  let terugFocus = null;
  function toonVel(vel, focus) {
    if (openVel && openVel !== vel) openVel.hidden = true;
    terugFocus = terugFocus || document.activeElement;
    openVel = vel;
    vel.hidden = false;
    (focus || vel.querySelector('button, input, a'))?.focus({ preventScroll: true });
  }
  function sluitVel() {
    if (!openVel) return;
    openVel.hidden = true;
    openVel = null;
    const f = terugFocus; terugFocus = null;
    if (f && f.focus && document.contains(f)) f.focus({ preventScroll: true });
  }
  for (const v of document.querySelectorAll('.vel')) {
    v.addEventListener('click', (e) => { if (e.target === v) sluitVel(); });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!grootBeeld.hidden) { sluitGroot(); return; }
    if (openVel) sluitVel();
  });

  /* ================= inloggen met Google ================= */
  let naInloggen = null;      // wat we daarna willen doen
  let gsiGeladen = null;
  function laadGsi() {
    if (gsiGeladen) return gsiGeladen;
    gsiGeladen = new Promise((klaar, mis) => {
      const s = document.createElement('script');
      s.src = GSI; s.async = true;
      s.onload = () => klaar();
      s.onerror = () => { gsiGeladen = null; mis(new Error('gsi')); };
      document.head.appendChild(s);
    });
    return gsiGeladen;
  }
  async function vraagLogin(redenSleutel, daarna) {
    naInloggen = daarna || null;
    $('loginTitel').textContent = t('login.title');
    $('loginUitleg').textContent = t(redenSleutel || 'login.why');
    $('loginPrivacy').textContent = t('login.privacy');
    $('loginDicht').textContent = t('close');
    const melding = $('loginMelding');
    melding.textContent = '';
    const plek = $('googleKnop');
    plek.textContent = '';
    toonVel($('velLogin'), $('loginDicht'));
    if (!clientId) { melding.textContent = t('login.notset'); return; }
    try {
      const [{ nonce }] = await Promise.all([vraag('/api/nonce'), laadGsi()]);
      google.accounts.id.initialize({
        client_id: clientId,
        nonce,
        callback: naGoogle,
        ux_mode: 'popup',
        use_fedcm_for_button: true,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      google.accounts.id.renderButton(plek, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: taal });
    } catch {
      melding.textContent = t('err.offline');
    }
  }
  async function naGoogle(antwoord) {
    const melding = $('loginMelding');
    try {
      await vraag('/api/login', { method: 'POST', json: { credential: antwoord.credential } });
      await ingelogd();
    } catch (e) {
      melding.textContent = foutTekst(e);
    }
  }
  async function ingelogd() {
    sluitVel();
    await laadIk();
    if (ik && !ik.nickname) { vraagBijnaam(); return; }
    klaarMetInloggen();
  }
  function klaarMetInloggen() {
    const f = naInloggen; naInloggen = null;
    toonToast(t('login.done', { name: ik ? ik.nickname : '' }));
    if (f) f(); else toonScherm();
  }
  $('loginDicht').addEventListener('click', () => { naInloggen = null; sluitVel(); });

  // Alleen lokaal (tests): window.__sfDevLogin('sub', 'email')
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__sfDevLogin = async (sub, email) => {
      await vraag('/api/dev-login', { method: 'POST', json: { sub, email } });
      await ingelogd();
    };
  }

  /* ================= bijnaam ================= */
  function vraagBijnaam() {
    $('naamTitel').textContent = t('nick.title');
    $('naamUitleg').textContent = t('nick.why');
    $('naamOk').textContent = t('nick.save');
    $('naamMelding').textContent = '';
    $('naamInvoer').value = '';
    toonVel($('velNaam'), $('naamInvoer'));
  }
  async function bewaarBijnaam(invoer, melding) {
    melding.textContent = '';
    melding.classList.remove('fout', 'goed');
    try {
      const r = await vraag('/api/me/nickname', { method: 'POST', json: { nickname: invoer.value } });
      ik.nickname = r.nickname;
      toonWie();
      return true;
    } catch (e) {
      melding.textContent = foutTekst(e);
      melding.classList.add('fout');
      return false;
    }
  }
  $('naamForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await bewaarBijnaam($('naamInvoer'), $('naamMelding'))) { sluitVel(); klaarMetInloggen(); }
  });

  /* ================= schermen (hash-router) ================= */
  const SCHERMEN = ['swipe', 'top', 'favorites', 'mine', 'upload', 'account', 'admin'];
  let huidigScherm = null;
  function schermUitHash() {
    const h = location.hash.replace(/^#\/?/, '').split('/')[0];
    return SCHERMEN.includes(h) ? h : 'swipe';
  }
  function toonScherm() {
    const naam = schermUitHash();
    // wat een account vraagt: eerst inloggen
    if ((naam === 'favorites' || naam === 'mine' || naam === 'upload' || naam === 'account' || naam === 'admin') && !ik) {
      tekenScherm(naam, true);
      return;
    }
    if (naam === 'admin' && !(ik && ik.admin)) { location.hash = '#/'; return; }
    tekenScherm(naam, false);
  }
  function tekenScherm(naam, slot) {
    const nieuw = naam !== huidigScherm;
    huidigScherm = naam;
    for (const s of document.querySelectorAll('.scherm')) s.hidden = s.dataset.scherm !== naam;
    for (const a of document.querySelectorAll('.balk a')) {
      if (a.dataset.naar === naam) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    if (nieuw) window.scrollTo(0, 0);
    if (slot) { toonSlot(naam); return; }
    herstelSectie($('s-' + naam));
    if (naam === 'swipe') startSwipe();
    else if (naam === 'top') laadTop();
    else if (naam === 'favorites') laadFavorieten();
    else if (naam === 'mine') laadMijn();
    else if (naam === 'upload') toonUpload();
    else if (naam === 'account') toonAccount();
    else if (naam === 'admin') laadWachtrij();
  }
  // scherm dat een account vraagt, zonder account: uitleg + inlogknop
  function toonSlot(naam) {
    const sectie = $('s-' + naam);
    let slot = sectie.querySelector('.slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'leeg slot';
      sectie.appendChild(slot);
    }
    sectie.classList.add('op-slot');
    slot.textContent = '';
    const p = document.createElement('p');
    p.textContent = t('login.needed.' + naam);
    const knop = document.createElement('button');
    knop.type = 'button'; knop.className = 'knop';
    knop.textContent = t('login.button');
    knop.addEventListener('click', () => vraagLogin('login.needed.' + naam, () => toonScherm()));
    slot.append(p, knop);
  }
  function herstelSectie(sectie) {
    const slot = sectie.querySelector('.slot');
    if (slot) slot.remove();
    sectie.classList.remove('op-slot');
  }
  window.addEventListener('hashchange', toonScherm);

  /* ================= swipen ================= */
  const stapel = $('stapel');
  const leegStapel = $('leegstapel');
  const jaKnop = $('ja');
  const neeKnop = $('nee');
  let rij = [];             // vlokken die nog komen
  let bezigLaden = false;
  let opIs = false;         // server zei: niets meer
  const beslist = new Set(); // deze sessie al geswipet (de server weet het misschien nog niet)
  const gezienZonderAccount = () => { try { return JSON.parse(lees(K_GEZIEN) || '[]'); } catch { return []; } };
  function markeerGezien(id) {
    if (ik) return;
    const l = gezienZonderAccount().filter((x) => x !== id);
    l.push(id);
    schrijf(K_GEZIEN, JSON.stringify(l.slice(-280)));
  }

  async function vulRij() {
    if (bezigLaden || opIs) return;
    bezigLaden = true;
    try {
      const skip = [...new Set(rij.map((f) => f.id).concat([...beslist].slice(-150), ik ? [] : gezienZonderAccount()))].slice(-300);
      const r = await vraag('/api/feed', { method: 'POST', json: { skip } });
      const bekend = new Set(rij.map((f) => f.id).concat([...beslist]));
      const nieuw = r.photos.filter((f) => !bekend.has(f.id));
      // niets nieuws: "je hebt alles gezien" (zonder account onthouden we de laatste 280,
      // dus oudere vlokken komen na een tijd vanzelf terug)
      if (!nieuw.length) opIs = true;
      rij.push(...nieuw);
    } catch (e) {
      if (!rij.length) toonToast(foutTekst(e));
    } finally {
      bezigLaden = false;
    }
    tekenStapel();
  }
  function startSwipe() {
    opIs = false;
    if (!rij.length) { stapel.textContent = ''; vulRij(); } else tekenStapel();
  }

  function maakKaart(f, bovenop) {
    const k = document.createElement('div');
    k.className = 'kaart' + (bovenop ? '' : ' onder');
    k.dataset.id = f.id;
    const img = document.createElement('img');
    img.src = '/img/' + f.id + '/f';
    img.alt = t('card.alt', { name: f.by });
    img.decoding = 'async';
    img.draggable = false;
    const door = document.createElement('div');
    door.className = 'door';
    door.textContent = '© ' + f.by;
    const mooi = document.createElement('span'); mooi.className = 'stempel mooi'; mooi.textContent = t('stamp.like');
    const verder = document.createElement('span'); verder.className = 'stempel verder'; verder.textContent = t('stamp.skip');
    const waas = document.createElement('img');
    waas.className = 'waas'; waas.src = img.src; waas.alt = ''; waas.setAttribute('aria-hidden', 'true'); waas.draggable = false;
    k.append(waas, img, door, mooi, verder);
    if (bovenop) {
      const vlag = document.createElement('button');
      vlag.type = 'button'; vlag.className = 'vlag';
      vlag.setAttribute('aria-label', t('report.button')); vlag.title = t('report.button');
      vlag.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 21V4M6 4h10l-2 4 2 4H6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      vlag.addEventListener('click', (e) => { e.stopPropagation(); vraagMelden(f); });
      vlag.addEventListener('pointerdown', (e) => e.stopPropagation());
      k.appendChild(vlag);
      sleepbaar(k, f);
    }
    return k;
  }
  // De stapel bijwerken. De bovenste kaart blijft staan als ze dezelfde is (anders zou
  // binnenkomende data een kaart onder je vinger vervangen). opnieuw = alles opnieuw (taal).
  function tekenStapel(opnieuw) {
    if (huidigScherm !== 'swipe') return;
    const leeg = !rij.length;
    leegStapel.hidden = !leeg || bezigLaden;
    stapel.hidden = leeg;
    jaKnop.disabled = neeKnop.disabled = leeg;
    let boven = stapel.querySelector('.kaart:not(.onder):not(.weg)');
    let onder = stapel.querySelector('.kaart.onder');
    if (leeg || opnieuw || (boven && boven.dataset.id !== rij[0].id)) { if (boven) boven.remove(); boven = null; }
    if (leeg || opnieuw || (onder && (!rij[1] || onder.dataset.id !== rij[1].id))) { if (onder) onder.remove(); onder = null; }
    if (leeg) { if (!bezigLaden && !opIs) vulRij(); return; }
    const vliegend = stapel.querySelector('.kaart.weg');
    if (!boven) { boven = maakKaart(rij[0], true); stapel.insertBefore(boven, vliegend); }
    if (!onder && rij[1]) { onder = maakKaart(rij[1], false); stapel.insertBefore(onder, boven); }
    // de volgende alvast inladen
    for (const f of rij.slice(2, 4)) { const i = new Image(); i.src = '/img/' + f.id + '/f'; }
    if (rij.length < 5) vulRij();
  }

  function sleepbaar(kaart, f) {
    let x0 = 0, y0 = 0, dx = 0, dy = 0, id = null, t0 = 0, bewogen = false;
    const mooi = kaart.querySelector('.stempel.mooi');
    const verder = kaart.querySelector('.stempel.verder');
    const teken = () => {
      const rot = dx / 18;
      kaart.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${rot}deg)`;
      const d = dx;   // in elke taal: rechts = mooi (zoals overal bij swipen)
      mooi.style.opacity = String(Math.max(0, Math.min(1, d / 90)));
      verder.style.opacity = String(Math.max(0, Math.min(1, -d / 90)));
    };
    kaart.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || id !== null) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; t0 = performance.now(); bewogen = false;
      kaart.setPointerCapture(id);
      kaart.classList.add('sleept');
    });
    kaart.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      dx = e.clientX - x0; dy = e.clientY - y0;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) bewogen = true;
      teken();
    });
    const los = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      kaart.classList.remove('sleept');
      const snel = Math.abs(dx) / Math.max(1, performance.now() - t0) > 0.6;
      if (Math.abs(dx) > 110 || (snel && Math.abs(dx) > 40)) {
        beslis(dx > 0 ? 1 : -1, dx);
      } else {
        kaart.style.transform = '';
        mooi.style.opacity = verder.style.opacity = '0';
        if (!bewogen && e.type === 'pointerup') openGroot(f, 'swipe');
      }
    };
    kaart.addEventListener('pointerup', los);
    kaart.addEventListener('pointercancel', los);
  }

  function beslis(richting, dxStart) {
    if (!rij.length) return;
    const f = rij[0];
    // zonder account: rechts = vriendelijk vragen om in te loggen (één keer), maar wel doorgaan
    if (richting === 1 && !ik && !lees(K_TIP)) {
      schrijf(K_TIP, '1');
      vraagLogin('login.why.like');
    }
    // de kaart vliegt weg op zichzelf; de volgende staat meteen klaar (snel tikken mag)
    const kaart = stapel.querySelector('.kaart:not(.onder):not(.weg)');
    if (kaart) {
      if (beweging()) {
        const naar = (dxStart !== undefined ? Math.sign(dxStart) : richting) * (window.innerWidth + 200);
        kaart.classList.add('weg');
        kaart.style.pointerEvents = 'none';
        kaart.style.transition = 'transform .32s ease-in';
        const stempel = kaart.querySelector(richting === 1 ? '.stempel.mooi' : '.stempel.verder');
        if (stempel) stempel.style.opacity = '1';
        requestAnimationFrame(() => { kaart.style.transform = `translate(${naar}px, -30px) rotate(${naar / 30}deg)`; });
        setTimeout(() => kaart.remove(), 360);
      } else {
        kaart.remove();
      }
    }
    rij.shift();
    beslist.add(f.id);
    markeerGezien(f.id);
    tekenStapel();
    if (ik) {
      vraag('/api/swipe', { method: 'POST', json: { id: f.id, dir: richting } })
        .catch((e) => toonToast(foutTekst(e)));
    }
  }
  jaKnop.addEventListener('click', () => beslis(1));
  neeKnop.addEventListener('click', () => beslis(-1));
  document.addEventListener('keydown', (e) => {
    if (huidigScherm !== 'swipe' || openVel || !grootBeeld.hidden) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); beslis(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); beslis(-1); }
  });

  /* ================= melden ================= */
  let teMelden = null;
  function vraagMelden(f) {
    if (!ik || !ik.nickname) { vraagLogin('login.why.report', () => vraagMelden(f)); return; }
    teMelden = f;
    $('meldTitel').textContent = t('report.title');
    $('meldUitleg').textContent = t('report.why');
    $('meldNee').textContent = t('cancel');
    $('meldJa').textContent = t('report.confirm');
    toonVel($('velMeld'), $('meldNee'));
  }
  $('meldNee').addEventListener('click', sluitVel);
  $('meldJa').addEventListener('click', async () => {
    const f = teMelden; teMelden = null;
    sluitVel();
    if (!f) return;
    try {
      await vraag('/api/photos/' + f.id + '/report', { method: 'POST' });
      toonToast(t('report.done'));
      // uit je eigen rij halen
      rij = rij.filter((x) => x.id !== f.id);
      markeerGezien(f.id);
      if (ik) vraag('/api/swipe', { method: 'POST', json: { id: f.id, dir: -1 } }).catch(() => {});
      tekenStapel();
    } catch (e) {
      toonToast(foutTekst(e));
    }
  });

  /* ================= groot beeld ================= */
  const grootBeeld = $('grootBeeld');
  let grootTerug = null;
  function openGroot(f, waar) {
    grootTerug = document.activeElement;
    const img = $('grootImg');
    img.src = '/img/' + f.id + '/f';
    img.alt = t('card.alt', { name: f.by });
    $('grootDoor').textContent = f.by ? '© ' + f.by : '';
    const acties = $('grootActies');
    acties.textContent = '';
    if (waar === 'favorites') {
      const weg = document.createElement('button');
      weg.type = 'button'; weg.className = 'knop licht';
      weg.textContent = t('fav.remove');
      weg.addEventListener('click', async () => {
        try {
          await vraag('/api/swipe', { method: 'POST', json: { id: f.id, dir: -1 } });
          sluitGroot();
          laadFavorieten();
        } catch (e) { toonToast(foutTekst(e)); }
      });
      acties.appendChild(weg);
    }
    if (waar === 'mine') {
      const weg = document.createElement('button');
      weg.type = 'button'; weg.className = 'knop gevaar';
      weg.textContent = t('mine.delete');
      weg.addEventListener('click', async () => {
        if (!confirm(t('mine.delete.confirm'))) return;
        try {
          await vraag('/api/photos/' + f.id, { method: 'DELETE' });
          sluitGroot();
          laadMijn();
        } catch (e) { toonToast(foutTekst(e)); }
      });
      acties.appendChild(weg);
    }
    $('grootDicht').setAttribute('aria-label', t('close'));
    grootBeeld.setAttribute('aria-label', img.alt);
    grootBeeld.hidden = false;
    $('grootDicht').focus({ preventScroll: true });
  }
  function sluitGroot() {
    grootBeeld.hidden = true;
    $('grootImg').removeAttribute('src');
    if (grootTerug && document.contains(grootTerug)) grootTerug.focus({ preventScroll: true });
    grootTerug = null;
  }
  $('grootDicht').addEventListener('click', sluitGroot);
  grootBeeld.addEventListener('click', (e) => { if (e.target === grootBeeld) sluitGroot(); });

  /* ================= rasters ================= */
  function tegel(f, opties = {}) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tegel';
    const img = document.createElement('img');
    img.src = '/img/' + f.id + '/t';
    img.alt = t('card.alt', { name: f.by });
    img.loading = 'lazy'; img.decoding = 'async';
    b.appendChild(img);
    if (opties.nr) { const nr = document.createElement('span'); nr.className = 'nr'; nr.textContent = String(opties.nr); b.appendChild(nr); }
    if (opties.status) {
      const s = document.createElement('span'); s.className = 'status ' + opties.status;
      s.textContent = t('status.' + opties.status);
      b.appendChild(s);
    }
    const label = document.createElement('span');
    label.className = 'label';
    const naam = document.createElement('span'); naam.textContent = opties.zonderNaam ? '' : f.by;
    label.appendChild(naam);
    if (typeof f.likes === 'number' && (!opties.status || opties.status === 'approved')) {
      const h = document.createElement('span');
      h.textContent = '♥ ' + getal(f.likes);
      h.setAttribute('aria-label', t('likes', { n: f.likes }));
      label.appendChild(h);
    }
    b.appendChild(label);
    b.addEventListener('click', () => openGroot(f, opties.waar));
    li.appendChild(b);
    if (opties.reden) {
      const p = document.createElement('p'); p.className = 'reden';
      p.textContent = t('reason.' + opties.reden);
      li.appendChild(p);
    }
    return li;
  }

  let topPeriode = 'week';
  async function laadTop() {
    for (const b of $('topTabs').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.periode === topPeriode));
    const lijst = $('topLijst');
    try {
      const r = await vraag('/api/top/' + topPeriode);
      lijst.textContent = '';
      r.photos.forEach((f, i) => lijst.appendChild(tegel(f, { nr: i + 1, waar: 'top' })));
      $('topLeeg').hidden = r.photos.length > 0;
      $('topLeeg').textContent = t('top.empty');
    } catch (e) { toonToast(foutTekst(e)); }
  }
  $('topTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-periode]');
    if (!b) return;
    topPeriode = b.dataset.periode;
    laadTop();
  });

  async function laadFavorieten() {
    const lijst = $('favLijst');
    try {
      const r = await vraag('/api/favorites');
      lijst.textContent = '';
      r.photos.forEach((f) => lijst.appendChild(tegel(f, { waar: 'favorites' })));
      $('favLeeg').hidden = r.photos.length > 0;
      $('favLeeg').textContent = t('fav.empty');
    } catch (e) { toonToast(foutTekst(e)); }
  }

  async function laadMijn() {
    const lijst = $('mijnLijst');
    try {
      const r = await vraag('/api/mine');
      lijst.textContent = '';
      for (const f of r.photos) {
        lijst.appendChild(tegel(f, { waar: 'mine', status: f.status, reden: f.status === 'rejected' ? (f.reason || 'other') : '', zonderNaam: true }));
      }
      $('mijnLeeg').hidden = r.photos.length > 0;
      $('mijnLeeg').textContent = t('mine.empty');
      const h = $('mijnHartjes');
      h.textContent = '';
      if (r.photos.length) {
        const s = document.createElement('strong'); s.textContent = '♥ ' + getal(r.hearts);
        h.append(s, document.createTextNode(' ' + t('mine.hearts', { n: r.hearts })));
      }
    } catch (e) { toonToast(foutTekst(e)); }
  }

  /* ================= uploaden ================= */
  const MAX_PX = 1600, DUIM_PX = 480, MIN_PX = 200, MAX_BYTES = 1_450_000;
  let upKlaar = null;     // { full: Blob, thumb: Blob, url }
  function toonUpload() {
    $('upKies').textContent = t('upload.choose');
    resetUpload(false);
  }
  function resetUpload(melding = true) {
    if (upKlaar && upKlaar.url) URL.revokeObjectURL(upKlaar.url);
    upKlaar = null;
    $('upBestand').value = '';
    $('upKiezer').hidden = false;
    $('upVoorbeeld').hidden = true;
    $('upToestemmingRij').hidden = true;
    $('upVerstuur').hidden = true;
    $('upToestemming').checked = false;
    if (melding) zetUpMelding('');
  }
  function zetUpMelding(tekst, soort) {
    const m = $('upMelding');
    m.textContent = tekst;
    m.classList.toggle('fout', soort === 'fout');
    m.classList.toggle('goed', soort === 'goed');
  }
  async function laadBeeld(bestand) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(bestand, { imageOrientation: 'from-image' }); } catch {}
    }
    const url = URL.createObjectURL(bestand);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  // Opnieuw tekenen op een canvas en als JPEG bewaren: verkleint én haalt alle
  // EXIF-gegevens weg (ook de GPS-locatie).
  async function naarJpeg(bron, maxPx, maxBytes) {
    const w0 = bron.width, h0 = bron.height;
    const schaal = Math.min(1, maxPx / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * schaal)), h = Math.max(1, Math.round(h0 * schaal));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bron, 0, 0, w, h);
    for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
      const b = await new Promise((k) => c.toBlob(k, 'image/jpeg', q));
      if (b && b.size <= maxBytes) return b;
    }
    throw Object.assign(new Error('upload_big'), { code: 'upload_big' });
  }
  $('upBestand').addEventListener('change', async () => {
    const bestand = $('upBestand').files && $('upBestand').files[0];
    if (!bestand) return;
    zetUpMelding(t('upload.preparing'));
    try {
      const beeld = await laadBeeld(bestand);
      if (Math.min(beeld.width, beeld.height) < MIN_PX) throw Object.assign(new Error(), { code: 'upload_small' });
      const full = await naarJpeg(beeld, MAX_PX, MAX_BYTES);
      const thumb = await naarJpeg(beeld, DUIM_PX, 190_000);
      if (beeld.close) beeld.close();
      upKlaar = { full, thumb, url: URL.createObjectURL(full) };
      $('upBeeld').src = upKlaar.url;
      $('upBeeld').alt = t('upload.preview');
      $('upKiezer').hidden = true;
      $('upVoorbeeld').hidden = false;
      $('upToestemmingRij').hidden = false;
      $('upVerstuur').hidden = false;
      $('upVerstuur').disabled = !$('upToestemming').checked;
      zetUpMelding('');
    } catch (e) {
      resetUpload(false);
      zetUpMelding(e && e.code ? foutTekst(e) : t('err.upload_open'), 'fout');
    }
  });
  $('upToestemming').addEventListener('change', () => { $('upVerstuur').disabled = !$('upToestemming').checked; });
  $('upAnder').addEventListener('click', () => { resetUpload(); $('upBestand').click(); });
  $('upVerstuur').addEventListener('click', async () => {
    if (!upKlaar || !$('upToestemming').checked) return;
    const knop = $('upVerstuur');
    knop.disabled = true;
    zetUpMelding(t('upload.sending'));
    const form = new FormData();
    form.append('full', upKlaar.full, 'full.jpg');
    form.append('thumb', upKlaar.thumb, 'thumb.jpg');
    form.append('consent', '1');
    try {
      await vraag('/api/photos', { method: 'POST', form });
      resetUpload(false);
      zetUpMelding(t('upload.done'), 'goed');
    } catch (e) {
      knop.disabled = false;
      zetUpMelding(foutTekst(e), 'fout');
    }
  });

  /* ================= account ================= */
  function toonAccount() {
    $('accNaam').value = ik && ik.nickname ? ik.nickname : '';
    $('accNaamMelding').textContent = '';
    $('accBeheer').hidden = !(ik && ik.admin);
  }
  $('accNaamForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('accNaamMelding');
    if (await bewaarBijnaam($('accNaam'), m)) { m.textContent = t('nick.saved'); m.classList.add('goed'); }
  });
  $('accUitloggen').addEventListener('click', async () => {
    try { await vraag('/api/logout', { method: 'POST' }); } catch {}
    ik = null;
    rij = []; opIs = false; beslist.clear();
    toonWie();
    location.hash = '#/';
    toonScherm();
  });
  $('accVerwijder').addEventListener('click', async () => {
    if (!confirm(t('account.delete.confirm'))) return;
    try {
      await vraag('/api/me', { method: 'DELETE' });
      ik = null; rij = []; opIs = false; beslist.clear();
      toonWie();
      toonToast(t('account.deleted'));
      location.hash = '#/';
      toonScherm();
    } catch (e) { toonToast(foutTekst(e)); }
  });

  /* ================= beheer ================= */
  const REDENEN = ['not_snowflake', 'not_own', 'inappropriate', 'quality', 'other'];
  function datum(ms) {
    try { return new Intl.DateTimeFormat(taal, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)); } catch { return new Date(ms).toLocaleString(); }
  }
  async function laadWachtrij() {
    const lijst = $('admLijst');
    try {
      const r = await vraag('/api/admin/queue');
      lijst.textContent = '';
      for (const f of r.photos) {
        const li = document.createElement('li');
        li.dataset.id = f.id;
        const img = document.createElement('img');
        img.src = '/img/' + f.id + '/f'; img.alt = t('card.alt', { name: f.by }); img.loading = 'lazy';
        const info = document.createElement('p'); info.className = 'info';
        info.textContent = '© ' + f.by + ' · ' + datum(f.at) + ' · ' + f.w + '×' + f.h + ' ';
        if (f.status === 'hidden') {
          const s = document.createElement('strong'); s.textContent = t('admin.reported', { n: f.reports });
          info.appendChild(s);
        }
        const acties = document.createElement('div'); acties.className = 'acties';
        const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'knop'; ok.textContent = t('admin.approve');
        const keuze = document.createElement('select');
        keuze.setAttribute('aria-label', t('admin.reason'));
        for (const rd of REDENEN) { const o = document.createElement('option'); o.value = rd; o.textContent = t('reason.' + rd); keuze.appendChild(o); }
        const nee = document.createElement('button'); nee.type = 'button'; nee.className = 'knop gevaar'; nee.textContent = t('admin.reject');
        const doe = async (actie) => {
          ok.disabled = nee.disabled = true;
          try {
            await vraag('/api/admin/photos/' + f.id, { method: 'POST', json: { action: actie, reason: keuze.value } });
            li.remove();
            $('admLeeg').hidden = lijst.children.length > 0;
            toonToast(t(actie === 'approve' ? 'admin.approved' : 'admin.rejected'));
          } catch (e) { ok.disabled = nee.disabled = false; toonToast(foutTekst(e)); }
        };
        ok.addEventListener('click', () => doe('approve'));
        nee.addEventListener('click', () => doe('reject'));
        acties.append(ok, keuze, nee);
        li.append(img, info, acties);
        lijst.appendChild(li);
      }
      $('admLeeg').hidden = r.photos.length > 0;
      $('admLeeg').textContent = t('admin.empty');
    } catch (e) { toonToast(foutTekst(e)); }
  }

  /* ================= voet: doneren, taal, versie, verversen ================= */
  const doneerKnop = $('doneerKnop');
  const doneerPaneel = $('doneerPaneel');
  const taalKeuze = $('taal');
  const ververs = $('ververs');
  function paypalLink(bedrag) {
    return bedrag ? 'https://www.paypal.com/paypalme/' + PAYPAL + '/' + bedrag + 'EUR' : 'https://www.paypal.com/paypalme/' + PAYPAL;
  }
  function vulDoneer() {
    doneerPaneel.textContent = '';
    const p = (cls, k) => { const e = document.createElement('p'); e.className = cls; e.textContent = t(k); return e; };
    const knop = (b) => {
      const a = document.createElement('a');
      a.className = 'doneer-bedrag'; a.href = paypalLink(b); a.target = '_blank'; a.rel = 'noopener';
      try { a.textContent = new Intl.NumberFormat(taal, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(b); } catch { a.textContent = '€' + b; }
      return a;
    };
    const rijtje = (l) => { const d = document.createElement('div'); d.className = 'doneer-rij'; l.forEach((b) => d.appendChild(knop(b))); return d; };
    const vrij = document.createElement('a');
    vrij.className = 'doneer-vrij'; vrij.href = paypalLink(null); vrij.target = '_blank'; vrij.rel = 'noopener';
    vrij.textContent = t('donate.free');
    doneerPaneel.append(p('doneer-intro', 'donate.intro'), rijtje([1, 2, 5]), p('doneer-joke', 'donate.joke'), rijtje([20, 50]), vrij);
  }
  function sluitDoneer() { doneerPaneel.hidden = true; doneerKnop.setAttribute('aria-expanded', 'false'); }
  doneerKnop.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = doneerPaneel.hidden;
    doneerPaneel.hidden = !open;
    doneerKnop.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!doneerPaneel.hidden && !doneerPaneel.contains(e.target) && e.target !== doneerKnop) sluitDoneer();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !doneerPaneel.hidden) { sluitDoneer(); doneerKnop.focus(); } });

  function bouwTaalKeuze() {
    for (const [code, info] of Object.entries(TALEN)) {
      const o = document.createElement('option');
      o.value = code; o.textContent = info.naam;
      o.lang = code;
      taalKeuze.appendChild(o);
    }
    taalKeuze.value = taal;
  }
  taalKeuze.addEventListener('change', () => {
    if (!TALEN[taalKeuze.value]) return;
    taal = taalKeuze.value;
    schrijf(K_TAAL, taal);
    pasTaalToe();
    toonScherm();
  });

  $('versie').textContent = 'v' + VERSIE;
  ververs.addEventListener('click', async () => {
    if (ververs.classList.contains('bezig')) return;
    ververs.classList.add('bezig');
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    } catch {}
    location.reload();
  });

  /* ================= alle vaste teksten ================= */
  function pasTaalToe() {
    const html = document.documentElement;
    html.lang = taal;
    html.dir = TALEN[taal].rtl ? 'rtl' : 'ltr';
    const zet = (id, k) => { const e = $(id); if (e) e.textContent = t(k); };
    zet('swipeTitel', 'swipe.title');
    zet('leegTekst', 'swipe.empty');
    zet('leegTop', 'swipe.empty.top');
    zet('leegUpload', 'swipe.empty.upload');
    jaKnop.setAttribute('aria-label', t('like')); jaKnop.title = t('like');
    neeKnop.setAttribute('aria-label', t('skip')); neeKnop.title = t('skip');
    zet('topTitel', 'top.title');
    const tabs = $('topTabs').querySelectorAll('button');
    tabs[0].textContent = t('top.day'); tabs[1].textContent = t('top.week'); tabs[2].textContent = t('top.all');
    zet('favTitel', 'fav.title');
    zet('mijnTitel', 'mine.title');
    zet('upTitel', 'upload.title');
    zet('upUitleg', 'upload.why');
    zet('upKies', 'upload.choose');
    zet('upAnder', 'upload.other');
    zet('upToestemmingTekst', 'upload.consent');
    zet('upVerstuur', 'upload.send');
    zet('accTitel', 'account.title');
    zet('accNaamLabel', 'nick.label');
    zet('accNaamOpslaan', 'nick.save');
    zet('accBeheer', 'admin.title');
    zet('accUitloggen', 'logout');
    zet('accVerwijderKop', 'account.delete');
    zet('accVerwijderUitleg', 'account.delete.why');
    zet('accVerwijder', 'account.delete.button');
    zet('privTitel', 'privacy.title');
    const priv = $('privTekst');
    priv.textContent = '';
    for (const k of ['privacy.1', 'privacy.2', 'privacy.3', 'privacy.4']) { const p = document.createElement('p'); p.textContent = t(k); priv.appendChild(p); }
    zet('contactLink', 'contact');
    zet('admTitel', 'admin.title');
    zet('navSwipe', 'nav.swipe');
    zet('navTop', 'nav.top');
    zet('navUpload', 'nav.upload');
    zet('navFav', 'nav.fav');
    zet('navMine', 'nav.mine');
    doneerKnop.textContent = t('donate.button');
    taalKeuze.setAttribute('aria-label', t('lang.pick'));
    taalKeuze.title = t('lang.pick');
    if (taalKeuze.value !== taal) taalKeuze.value = taal;
    ververs.setAttribute('aria-label', t('refresh')); ververs.title = t('refresh');
    $('balk').setAttribute('aria-label', t('nav.label'));
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('tagline'));
    vulDoneer();
    toonWie();
    // de kaarten opnieuw (stempels, alt-teksten)
    if (huidigScherm === 'swipe') tekenStapel(true);
  }

  /* ================= start ================= */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  bouwTaalKeuze();
  pasTaalToe();
  laadIk().then(() => {
    if (ik && !ik.nickname) vraagBijnaam();
    toonScherm();
  });
})();
