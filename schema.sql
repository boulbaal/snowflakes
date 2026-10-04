-- Snowflakes: foto's van sneeuwvlokken delen en erdoor swipen.
-- Tijden zijn milliseconden sinds 1970 (UTC), als INTEGER.

-- Een gebruiker. We bewaren alleen Google's vaste nummer (sub) en de zelfgekozen
-- bijnaam: geen e-mail, geen echte naam, geen profielfoto.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,               -- willekeurig, 16 tekens
  google_sub    TEXT NOT NULL UNIQUE,
  nickname      TEXT,                           -- NULL tot de gebruiker er een kiest
  nickname_key  TEXT UNIQUE,                    -- kleine letters, NFC: uniek zonder hoofdletterverschil
  is_admin      INTEGER NOT NULL DEFAULT 0,     -- bij elke login opnieuw bepaald (ADMIN_EMAIL)
  created_at    INTEGER NOT NULL
);

-- Ingelogde sessies. Alleen de SHA-256 van de cookie staat hier.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Een foto. Zichtbaar voor iedereen pas bij status 'approved'.
CREATE TABLE IF NOT EXISTS photos (
  id           TEXT PRIMARY KEY,                -- willekeurig, 12 tekens
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | hidden
  reason       TEXT,                            -- bij weigeren: korte reden voor de uploader
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  bytes        INTEGER NOT NULL,                -- grootte van de grote versie
  created_at   INTEGER NOT NULL,
  reviewed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS photos_status ON photos(status, created_at);
CREATE INDEX IF NOT EXISTS photos_user ON photos(user_id, created_at);

-- De beelden zelf (zolang ze in D1 staan; later kan dit naar R2).
CREATE TABLE IF NOT EXISTS photo_blobs (
  photo_id  TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  variant   TEXT NOT NULL,                      -- 'full' (max 1600 px) | 'thumb' (max 480 px)
  data      BLOB NOT NULL,
  PRIMARY KEY (photo_id, variant)
);

-- Elke swipe van een ingelogde gebruiker: 1 = rechts (mooi, favoriet, stem), -1 = links.
CREATE TABLE IF NOT EXISTS swipes (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_id    TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  dir         INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, photo_id)
);
CREATE INDEX IF NOT EXISTS swipes_photo ON swipes(photo_id, dir, created_at);
CREATE INDEX IF NOT EXISTS swipes_right ON swipes(dir, created_at);

-- Meldingen (alleen ingelogd, één per persoon per foto).
CREATE TABLE IF NOT EXISTS reports (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_id    TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, photo_id)
);
