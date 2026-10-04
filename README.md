# Snowflakes

Share photos of snowflakes and swipe through the most beautiful ones. Free, no ads.

- Swipe right on a snowflake you love: it goes to your favourites, counts as a vote and gives the photographer a heart.
- Watching and swiping works without an account. Log in with Google to share photos, save favourites and vote.
- Every photo is checked by hand before it goes online. Location data is removed in your browser before upload.
- We only keep Google's account number and the nickname you choose. Never your name, email or profile photo.
- 23 languages.

Questions or ideas? [Open an issue](https://github.com/boulbaal/snowflakes/issues).

## Development

Cloudflare Worker + D1, plain HTML/CSS/JS (no build step).

```sh
npm install
npm run db:local      # local database
npm run dev           # http://localhost:8788 (test login via .dev.vars)
npm test              # unit tests + Playwright end-to-end tests
```

Deploy: `npm run deploy` (stamps the git commit as the version).
