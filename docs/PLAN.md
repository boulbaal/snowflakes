# Snowflakes: plan (afgesproken met Ali, 4 oktober 2026)

Een gratis web-app (PWA) waar fans foto's van sneeuwvlokken delen en erdoor swipen.
Zelfde huisstijl van werken als Whenly, Evenly en Notitieboekje: geen reclame,
doneren via PayPal (ABoulbahaiem), 23 talen, contact alleen via GitHub issues.

## Wat het doet

- **Swipen op foto's** (geen mensen, geen chat). Een kaart met één sneeuwvlok:
  - rechts = mooi: bewaard in je favorieten, telt als stem, de fotograaf krijgt een hartje
  - links = verder
  - ook met knoppen (hart / kruis) en pijltjestoetsen, niet alleen vegen
- **Iedereen kijkt en swipet zonder account.** Inloggen is pas nodig om foto's te
  uploaden, favorieten te bewaren en te stemmen. Swipen zonder account telt niet als
  stem (anders kan iemand de top-lijst vervalsen); bij de eerste keer rechts zonder
  account: een vriendelijk briefje "log in om te bewaren".
- **Top-lijst**: vandaag, deze week, ooit (aantal keer rechts van ingelogde mensen).
- **Mijn foto's**: je eigen uploads, met status (wacht op goedkeuring, online,
  geweigerd) en het aantal hartjes.
- **Favorieten**: wat jij naar rechts swipete.
- **Melden**: knop op elke foto. Na 3 meldingen gaat de foto offline tot Ali kijkt.

## Inloggen

- Alleen **Google-login** (Google Identity Services, ID-token, geen client-secret).
- Bij de eerste keer kies je een **bijnaam**. Echte naam, e-mail en Google-profielfoto
  worden **nooit getoond en niet bewaard**; we bewaren alleen Google's vaste
  gebruikersnummer (`sub`) en je bijnaam.
- Account verwijderen kan zelf, met al je foto's, stemmen en favorieten (AVG).

## Alleen sneeuwvlokken: Ali keurt alles goed

- Elke upload komt eerst in een **wachtrij**. Pas na Ali's akkoord is de foto zichtbaar.
- Beheerpagina `/admin`: alleen voor Ali's Google-account. Het adres staat als geheime
  instelling bij Cloudflare (`ADMIN_EMAIL`), **niet in de code of op GitHub**.
- Goedkeuren, weigeren (met korte reden voor de uploader), gemelde foto's bekijken.

## Foto's

- In de browser verkleind naar max. 1600 px (en een kleine versie van 480 px), opnieuw
  opgeslagen als JPEG/WebP. Daardoor verdwijnt ook de **EXIF-info (GPS-locatie!)**.
- Opslag in de **D1-database** om te beginnen (gratis tot 500 MB, ongeveer 1.600 foto's).
  De code bewaart foto's via één klein opslag-onderdeel, zodat we later naar R2 kunnen
  zonder dat gebruikers iets merken.
- Max. 10 uploads per dag per gebruiker. De server controleert type en grootte.
- Bij uploaden bevestig je dat het je eigen foto is; je geeft de app toestemming om hem
  te tonen. Verwijderen kan altijd.

## Techniek

- Cloudflare Worker + D1 (zoals Evenly), statische app in `public/`, PWA met service worker.
- Sessie: willekeurige sleutel in een HttpOnly-cookie, gehasht in D1, 30 dagen.
- Beveiliging: CSP, Origin-controle op alles wat schrijft, rate limits, geen
  externe scripts behalve Google's inlogscript.
- Tests met Playwright. Inloggen in de tests via een test-login die **alleen lokaal**
  bestaat; het deploy-script weigert te deployen als die aan staat.
- Adres: `snowflakes.vanali.workers.dev`. Repo: `boulbaal/snowflakes`.

## Wat Ali zelf moet doen (Claude maakt geen accounts aan)

1. **Google-inlog voor de nieuwe site**: in Google Cloud een OAuth-client (type
   "Webapplicatie") met als JavaScript-origin `https://snowflakes.vanali.workers.dev`,
   en het toestemmingsscherm op **"In productie"** zetten (anders kunnen alleen
   testgebruikers inloggen). Het client-ID is niet geheim; dat geef je aan Claude.
2. Bij het eerste deploy: `ADMIN_EMAIL` instellen als geheim (`wrangler secret put`),
   zodat je e-mailadres nergens in de code staat.

## Later (niet in de eerste versie)

- Opslag naar R2 als de 500 MB vol raakt.
- Fotografen volgen.
- Swipen op mensen / matchen (bewust niet nu: profielen, chat, melden, 18+).
