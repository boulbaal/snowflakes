-- Archieffoto's (bv. Wilson Bentley, publiek domein): wie ze maakte en de bron.
ALTER TABLE photos ADD COLUMN credit TEXT;
ALTER TABLE photos ADD COLUMN source TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS photos_source ON photos(source);
