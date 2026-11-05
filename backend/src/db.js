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

    -- Regionen: admin1 (aus Natural Earth, ref = adm1_code, Geometrie liegt im Frontend)
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

  const count = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)');
    DEFAULT_CATEGORIES.forEach((name, i) => insert.run(name, i));
  }

  return db;
}
