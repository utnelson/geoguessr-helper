import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CATEGORIES = [
  'Domain',
  'Flagge',
  'Kennzeichen',
  'Sprache',
  'Google-Car',
  'Poller',
  'Masten',
  'Straßenmarkierungen',
  'Schilder',
  'Landschaft',
  'Sonstiges',
];

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      sort       INTEGER NOT NULL DEFAULT 0
    );

    -- Regionen: admin1 (aus Natural Earth, ref = adm1_code, Geometrie liegt im Frontend),
    -- Gruppen aus admin1-Regionen (source = 'group', Mitglieder in region_members, mit Farbe)
    -- oder selbst gezeichnet (source = 'custom', Geometrie als GeoJSON)
    CREATE TABLE IF NOT EXISTS regions (
      id          INTEGER PRIMARY KEY,
      country_iso TEXT NOT NULL,
      name        TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'custom',
      geometry    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_regions_country ON regions(country_iso);

    -- Regionen eines Metas stehen in meta_regions (keine = allgemeines Länder-Meta);
    -- region_id ist nur noch die erste Region (Kompatibilität)
    CREATE TABLE IF NOT EXISTS metas (
      id          INTEGER PRIMARY KEY,
      country_iso TEXT NOT NULL,
      region_id   INTEGER REFERENCES regions(id) ON DELETE SET NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      title       TEXT NOT NULL,
      text        TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_metas_country ON metas(country_iso);

    CREATE TABLE IF NOT EXISTS meta_images (
      id         INTEGER PRIMARY KEY,
      meta_id    INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
      filename   TEXT NOT NULL,
      caption    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_images_meta ON meta_images(meta_id);

    -- Strukturierte Merkmale für die Rückwärtssuche (Etappe 4)
    -- z.B. Kategorie "Masten": key "Muster", values ["Waffel","Löcher","glatt"]
    CREATE TABLE IF NOT EXISTS attributes (
      id          INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      key         TEXT NOT NULL,
      values_json TEXT NOT NULL DEFAULT '[]',
      UNIQUE (category_id, key)
    );

    CREATE TABLE IF NOT EXISTS meta_attributes (
      meta_id      INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
      attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
      value        TEXT NOT NULL,
      PRIMARY KEY (meta_id, attribute_id, value)
    );
  `);

  // Migration Etappe 2: admin1-Regionen über ihren Natural-Earth-Code (adm1_code) referenzieren
  const regionCols = db.prepare('PRAGMA table_info(regions)').all().map((c) => c.name);
  if (!regionCols.includes('ref')) db.exec('ALTER TABLE regions ADD COLUMN ref TEXT');
  // Migration: Regionsgruppen (source = 'group') mit Farbe und admin1-Mitgliedern
  if (!regionCols.includes('color')) db.exec('ALTER TABLE regions ADD COLUMN color TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS region_members (
      region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
      ref       TEXT NOT NULL,
      PRIMARY KEY (region_id, ref)
    );
  `);
  // Migration: ein Meta kann für mehrere Regionen gelten (metas.region_id → meta_regions)
  const hasMetaRegions = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta_regions'")
    .get();
  if (!hasMetaRegions) {
    db.exec(`
      CREATE TABLE meta_regions (
        meta_id   INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
        region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
        PRIMARY KEY (meta_id, region_id)
      );
      CREATE INDEX idx_meta_regions_region ON meta_regions(region_id);
      INSERT INTO meta_regions (meta_id, region_id)
        SELECT id, region_id FROM metas WHERE region_id IS NOT NULL;
    `);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_regions_ref ON regions(source, ref) WHERE ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_metas_region ON metas(region_id);
  `);

  // Migration: eingezeichneter Bereich (Pinsel) direkt am Meta – GeoJSON MultiPolygon
  const metaCols = db.prepare('PRAGMA table_info(metas)').all().map((c) => c.name);
  if (!metaCols.includes('area')) {
    db.exec('ALTER TABLE metas ADD COLUMN area TEXT');
    // Früher gezeichnete eigene Gebiete (regions.source = 'custom') in die zugeordneten Metas übernehmen
    const customs = db.prepare("SELECT id, geometry FROM regions WHERE source = 'custom' AND geometry IS NOT NULL").all();
    const linked = db.prepare('SELECT meta_id FROM meta_regions WHERE region_id = ?');
    const getArea = db.prepare('SELECT area FROM metas WHERE id = ?');
    const setArea = db.prepare('UPDATE metas SET area = ? WHERE id = ?');
    for (const c of customs) {
      const geom = JSON.parse(c.geometry);
      for (const { meta_id } of linked.all(c.id)) {
        const prev = getArea.get(meta_id).area;
        const coords = [...(prev ? JSON.parse(prev).coordinates : []), ...geom.coordinates];
        setArea.run(JSON.stringify({ type: 'MultiPolygon', coordinates: coords }), meta_id);
      }
    }
    db.exec(`
      DELETE FROM regions WHERE source = 'custom';
      UPDATE metas SET region_id = (SELECT region_id FROM meta_regions mr WHERE mr.meta_id = metas.id LIMIT 1);
    `);
  }

  // Migration: Reihenfolge der Bilder eines Metas (erstes Bild = Titelbild der Infografik)
  const imageCols = db.prepare('PRAGMA table_info(meta_images)').all().map((c) => c.name);
  if (!imageCols.includes('sort')) {
    db.exec('ALTER TABLE meta_images ADD COLUMN sort INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE meta_images SET sort = id'); // bisherige Reihenfolge (Upload-Zeitpunkt) beibehalten
  }

  // Volltextsuche über Metas (wird beim Start und bei Änderungen neu befüllt, siehe server.js)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS meta_fts USING fts5(
      title, text, category, places, attrs,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);

  // App-Einstellungen (JSON-Werte), z.B. ausgeschaltete Länder
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const count = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)');
    DEFAULT_CATEGORIES.forEach((name, i) => insert.run(name, i));
  }

  return db;
}
