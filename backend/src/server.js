import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from './db.js';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? path.resolve('data');
const DB_FILE = process.env.DB_FILE ?? path.join(DATA_DIR, 'geo.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(DATA_DIR, 'uploads');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = openDb(DB_FILE);

const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};
const EXT_TO_TYPE = Object.fromEntries(Object.entries(IMAGE_TYPES).map(([t, e]) => [e, t]));

// ---------- Hilfsfunktionen ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Datei zu groß'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 1024 * 1024);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Ungültiges JSON');
  }
}

function normIso(iso) {
  const v = String(iso ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,8}$/.test(v)) throw new HttpError(400, 'Ungültiger Ländercode');
  return v;
}

function requireText(v, field) {
  const s = String(v ?? '').trim();
  if (!s) throw new HttpError(400, `Feld "${field}" fehlt`);
  return s;
}

function removeUploadFile(filename) {
  const file = path.join(UPLOAD_DIR, path.basename(filename));
  fs.rm(file, { force: true }, () => {});
}

// ---------- Datenzugriff ----------

function getMeta(id) {
  const meta = db
    .prepare(
      `SELECT m.*, c.name AS category_name
       FROM metas m
       JOIN categories c ON c.id = m.category_id
       WHERE m.id = ?`,
    )
    .get(id);
  if (!meta) return null;
  meta.images = db
    .prepare('SELECT id, filename, caption FROM meta_images WHERE meta_id = ? ORDER BY id')
    .all(id)
    .map(withUrl);
  meta.regions = db
    .prepare(
      `SELECT r.id, r.name, r.ref, r.source, r.color FROM meta_regions mr
       JOIN regions r ON r.id = mr.region_id WHERE mr.meta_id = ? ORDER BY r.name`,
    )
    .all(id);
  return meta;
}

function withUrl(img) {
  return { ...img, url: `/uploads/${img.filename}` };
}

function listCountryMetas(iso) {
  const metas = db
    .prepare(
      `SELECT m.*, c.name AS category_name
       FROM metas m
       JOIN categories c ON c.id = m.category_id
       WHERE m.country_iso = ?
       ORDER BY c.sort, c.name, m.id`,
    )
    .all(iso);
  if (metas.length === 0) return [];
  const images = db
    .prepare(
      `SELECT i.id, i.meta_id, i.filename, i.caption
       FROM meta_images i JOIN metas m ON m.id = i.meta_id
       WHERE m.country_iso = ? ORDER BY i.id`,
    )
    .all(iso);
  const regions = db
    .prepare(
      `SELECT mr.meta_id, r.id, r.name, r.ref, r.source, r.color
       FROM meta_regions mr JOIN regions r ON r.id = mr.region_id
       JOIN metas m ON m.id = mr.meta_id
       WHERE m.country_iso = ? ORDER BY r.name`,
    )
    .all(iso);
  const byMeta = new Map(metas.map((m) => [m.id, { ...m, images: [], regions: [] }]));
  for (const img of images) byMeta.get(img.meta_id)?.images.push(withUrl(img));
  for (const { meta_id, ...r } of regions) byMeta.get(meta_id)?.regions.push(r);
  return [...byMeta.values()];
}

function validateMetaInput(body, partial = false, currentCountry = null) {
  const out = {};
  if (!partial || body.country_iso !== undefined) out.country_iso = normIso(body.country_iso);
  if (!partial || body.category_id !== undefined) {
    const cid = Number(body.category_id);
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(cid)) {
      throw new HttpError(400, 'Unbekannte Kategorie');
    }
    out.category_id = cid;
  }
  // Titel ist optional – ein Meta kann auch nur aus Bild und/oder Beschreibung bestehen
  if (!partial || body.title !== undefined) out.title = String(body.title ?? '').trim();
  if (!partial || body.text !== undefined) out.text = String(body.text ?? '');

  // Regionen: region_ids (vorhandene Regionen) und/oder admin1 ([{ ref, name }], werden bei Bedarf angelegt).
  // region_id (einzeln) wird aus Kompatibilität weiter akzeptiert.
  const ids = body.region_ids ?? (body.region_id !== undefined ? (body.region_id === null ? [] : [body.region_id]) : undefined);
  if (ids !== undefined || body.admin1 !== undefined) {
    if (ids !== undefined && !Array.isArray(ids)) throw new HttpError(400, '"region_ids" muss eine Liste sein');
    if (body.admin1 !== undefined && !Array.isArray(body.admin1)) throw new HttpError(400, '"admin1" muss eine Liste sein');
    const country = out.country_iso ?? currentCountry;
    const regionIds = new Set();
    for (const raw of ids ?? []) {
      const rid = Number(raw);
      const region = db.prepare('SELECT country_iso FROM regions WHERE id = ?').get(rid);
      if (!region) throw new HttpError(400, 'Unbekannte Region');
      if (region.country_iso !== country) throw new HttpError(400, 'Region gehört zu einem anderen Land');
      regionIds.add(rid);
    }
    out.regions = { ids: regionIds, admin1: (body.admin1 ?? []).map((a) => ({
      ref: requireText(a?.ref, 'admin1.ref'),
      name: requireText(a?.name, 'admin1.name'),
    })) };
  }
  return out;
}

/** admin1-Region anlegen bzw. vorhandene (gleiche ref) wiederverwenden → id */
function upsertAdmin1Region(country_iso, ref, name) {
  const found = db.prepare("SELECT id, country_iso FROM regions WHERE source = 'admin1' AND ref = ?").get(ref);
  if (found) {
    if (found.country_iso !== country_iso) throw new HttpError(409, 'Region gehört zu einem anderen Land');
    db.prepare('UPDATE regions SET name = ? WHERE id = ?').run(name, found.id);
    return found.id;
  }
  const r = db
    .prepare("INSERT INTO regions (country_iso, name, source, ref) VALUES (?, ?, 'admin1', ?)")
    .run(country_iso, name, ref);
  return Number(r.lastInsertRowid);
}

function setMetaRegions(metaId, country_iso, spec) {
  const ids = new Set(spec.ids);
  for (const a of spec.admin1) ids.add(upsertAdmin1Region(country_iso, a.ref, a.name));
  db.prepare('DELETE FROM meta_regions WHERE meta_id = ?').run(metaId);
  const insert = db.prepare('INSERT INTO meta_regions (meta_id, region_id) VALUES (?, ?)');
  for (const id of ids) insert.run(metaId, id);
  db.prepare('UPDATE metas SET region_id = ? WHERE id = ?').run([...ids][0] ?? null, metaId);
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const REGION_SOURCES = new Set(['admin1', 'group', 'custom']);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function regionMembers(id) {
  return db.prepare('SELECT ref FROM region_members WHERE region_id = ? ORDER BY ref').all(id).map((r) => r.ref);
}

function getRegion(id) {
  const region = db
    .prepare('SELECT id, country_iso, name, source, ref, color, geometry FROM regions WHERE id = ?')
    .get(id);
  if (region) region.members = region.source === 'group' ? regionMembers(id) : [];
  return region;
}

function parseColor(v) {
  if (v == null || v === '') return null;
  if (!COLOR_RE.test(String(v))) throw new HttpError(400, 'Farbe muss im Format #rrggbb sein');
  return String(v).toLowerCase();
}

function parseMembers(v) {
  if (!Array.isArray(v)) throw new HttpError(400, '"members" muss eine Liste sein');
  const refs = [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (refs.length === 0) throw new HttpError(400, 'Eine Gruppe braucht mindestens eine Region');
  return refs;
}

function setMembers(regionId, refs) {
  db.prepare('DELETE FROM region_members WHERE region_id = ?').run(regionId);
  const insert = db.prepare('INSERT INTO region_members (region_id, ref) VALUES (?, ?)');
  for (const ref of refs) insert.run(regionId, ref);
}

// ---------- Routen ----------

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$',
  );
  routes.push({ method, re, keys, handler });
}

route('GET', '/api/health', () => ({ ok: true }));

route('GET', '/api/categories', () =>
  db
    .prepare(
      `SELECT c.id, c.name, c.sort, COUNT(m.id) AS meta_count
       FROM categories c LEFT JOIN metas m ON m.category_id = c.id
       GROUP BY c.id ORDER BY c.sort, c.name`,
    )
    .all(),
);

route('POST', '/api/categories', async ({ req }) => {
  const body = await readJson(req);
  const name = requireText(body.name, 'name');
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM categories').get().s;
  try {
    const r = db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)').run(name, sort);
    return [201, { id: Number(r.lastInsertRowid), name, sort }];
  } catch {
    throw new HttpError(409, 'Kategorie existiert bereits');
  }
});

// Reihenfolge setzen: { ids: [3, 1, 2, …] }
route('PUT', '/api/categories/order', async ({ req }) => {
  const { ids } = await readJson(req);
  if (!Array.isArray(ids)) throw new HttpError(400, '"ids" muss eine Liste sein');
  transaction(() => {
    const upd = db.prepare('UPDATE categories SET sort = ? WHERE id = ?');
    ids.forEach((id, i) => upd.run(i, Number(id)));
  });
  return [204, null];
});

route('PUT', '/api/categories/:id', async ({ req, params }) => {
  const id = Number(params.id);
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id)) throw new HttpError(404, 'Kategorie nicht gefunden');
  const name = requireText((await readJson(req)).name, 'name');
  try {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
  } catch {
    throw new HttpError(409, 'Kategorie existiert bereits');
  }
  return db.prepare('SELECT id, name, sort FROM categories WHERE id = ?').get(id);
});

// Löschen; genutzte Kategorien nur mit { move_to: <id> } – deren Metas wandern dorthin
route('DELETE', '/api/categories/:id', async ({ req, params }) => {
  const id = Number(params.id);
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id)) throw new HttpError(404, 'Kategorie nicht gefunden');
  const body = await readJson(req);
  const used = db.prepare('SELECT COUNT(*) AS n FROM metas WHERE category_id = ?').get(id).n;
  transaction(() => {
    if (used > 0) {
      const target = Number(body.move_to);
      if (!target || target === id || !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(target)) {
        throw new HttpError(409, `Kategorie wird von ${used} Metas genutzt – Zielkategorie angeben`);
      }
      db.prepare('UPDATE metas SET category_id = ? WHERE category_id = ?').run(target, id);
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  });
  return [204, null];
});

// ---------- Einstellungen ----------
const SETTINGS_DEFAULTS = { disabled_countries: [] };

function readSettings() {
  const out = { ...SETTINGS_DEFAULTS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (key in SETTINGS_DEFAULTS) {
      try {
        out[key] = JSON.parse(value);
      } catch {
        /* kaputter Wert → Standard */
      }
    }
  }
  return out;
}

route('GET', '/api/settings', () => readSettings());

route('PUT', '/api/settings', async ({ req }) => {
  const body = await readJson(req);
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  if (body.disabled_countries !== undefined) {
    if (!Array.isArray(body.disabled_countries)) throw new HttpError(400, '"disabled_countries" muss eine Liste sein');
    const isos = [...new Set(body.disabled_countries.map(normIso))].sort();
    upsert.run('disabled_countries', JSON.stringify(isos));
  }
  return readSettings();
});

// Anzahl Metas pro Land – für die Einfärbung der Weltkarte
route('GET', '/api/stats', () =>
  db.prepare('SELECT country_iso AS iso, COUNT(*) AS count FROM metas GROUP BY country_iso').all(),
);

route('GET', '/api/countries/:iso/metas', ({ params }) => listCountryMetas(normIso(params.iso)));

// Allgemeine (landesweite) Metas einer Kategorie in allen Ländern – für die Welt-Infografik
route('GET', '/api/categories/:id/metas', ({ params }) => {
  const id = Number(params.id);
  const metas = db
    .prepare(
      `SELECT m.*, c.name AS category_name
       FROM metas m JOIN categories c ON c.id = m.category_id
       WHERE m.category_id = ? AND NOT EXISTS (SELECT 1 FROM meta_regions mr WHERE mr.meta_id = m.id)
       ORDER BY m.country_iso, m.id`,
    )
    .all(id);
  if (metas.length === 0) return [];
  const images = db
    .prepare(
      `SELECT i.id, i.meta_id, i.filename, i.caption FROM meta_images i
       JOIN metas m ON m.id = i.meta_id WHERE m.category_id = ? ORDER BY i.id`,
    )
    .all(id);
  const byMeta = new Map(metas.map((m) => [m.id, { ...m, images: [], regions: [] }]));
  for (const img of images) byMeta.get(img.meta_id)?.images.push(withUrl(img));
  return [...byMeta.values()];
});

// Regionen eines Landes inkl. Anzahl Metas und – bei Gruppen – den Mitgliedern
route('GET', '/api/countries/:iso/regions', ({ params }) => {
  const iso = normIso(params.iso);
  const regions = db
    .prepare(
      `SELECT r.id, r.country_iso, r.name, r.source, r.ref, r.color, r.geometry, COUNT(m.meta_id) AS meta_count
       FROM regions r LEFT JOIN meta_regions m ON m.region_id = r.id
       WHERE r.country_iso = ?
       GROUP BY r.id ORDER BY r.name`,
    )
    .all(iso);
  const members = db
    .prepare(
      `SELECT rm.region_id, rm.ref FROM region_members rm
       JOIN regions r ON r.id = rm.region_id WHERE r.country_iso = ? ORDER BY rm.ref`,
    )
    .all(iso);
  const byId = new Map(regions.map((r) => [r.id, { ...r, members: [] }]));
  for (const m of members) byId.get(m.region_id)?.members.push(m.ref);
  return [...byId.values()];
});

// Region anlegen – admin1-Regionen werden über (source, ref) wiederverwendet
route('POST', '/api/regions', async ({ req }) => {
  const body = await readJson(req);
  const country_iso = normIso(body.country_iso);
  const name = requireText(body.name, 'name');
  const source = String(body.source ?? 'custom');
  if (!REGION_SOURCES.has(source)) throw new HttpError(400, 'Unbekannte Quelle');
  const ref = body.ref == null || body.ref === '' ? null : String(body.ref);
  if (source === 'admin1' && !ref) throw new HttpError(400, 'Feld "ref" fehlt');
  const geometry = body.geometry == null ? null : JSON.stringify(body.geometry);

  if (source === 'admin1') return getRegion(upsertAdmin1Region(country_iso, ref, name));
  const color = parseColor(body.color);
  const members = source === 'group' ? parseMembers(body.members) : [];
  const id = transaction(() => {
    const r = db
      .prepare('INSERT INTO regions (country_iso, name, source, ref, color, geometry) VALUES (?, ?, ?, ?, ?, ?)')
      .run(country_iso, name, source, ref, color, geometry);
    const id = Number(r.lastInsertRowid);
    if (source === 'group') setMembers(id, members);
    return id;
  });
  return [201, getRegion(id)];
});

// Gruppe (oder eigene Region) bearbeiten: Name, Farbe, Mitglieder
route('PUT', '/api/regions/:id', async ({ req, params }) => {
  const id = Number(params.id);
  const region = getRegion(id);
  if (!region) throw new HttpError(404, 'Region nicht gefunden');
  if (region.source === 'admin1') throw new HttpError(400, 'admin1-Regionen können nicht bearbeitet werden');
  const body = await readJson(req);
  transaction(() => {
    if (body.name !== undefined) db.prepare('UPDATE regions SET name = ? WHERE id = ?').run(requireText(body.name, 'name'), id);
    if (body.color !== undefined) db.prepare('UPDATE regions SET color = ? WHERE id = ?').run(parseColor(body.color), id);
    if (body.members !== undefined && region.source === 'group') setMembers(id, parseMembers(body.members));
  });
  return getRegion(id);
});

// Gruppe löschen. Metas, die die Gruppe nutzen, werden auf deren Mitglieder umgestellt,
// wenn der Body die Namen liefert: { members: [{ ref, name }] } – sonst verlieren sie nur die Gruppe.
route('DELETE', '/api/regions/:id', async ({ req, params }) => {
  const id = Number(params.id);
  const region = getRegion(id);
  if (!region) throw new HttpError(404, 'Region nicht gefunden');
  if (region.source === 'admin1') throw new HttpError(400, 'admin1-Regionen können nicht gelöscht werden');
  const body = await readJson(req);
  const names = new Map((Array.isArray(body.members) ? body.members : []).map((m) => [String(m?.ref), String(m?.name ?? '')]));
  transaction(() => {
    const metaIds = db.prepare('SELECT meta_id FROM meta_regions WHERE region_id = ?').all(id).map((r) => r.meta_id);
    if (region.source === 'group' && names.size) {
      const link = db.prepare('INSERT OR IGNORE INTO meta_regions (meta_id, region_id) VALUES (?, ?)');
      for (const ref of region.members) {
        const name = names.get(ref);
        if (!name) continue;
        const rid = upsertAdmin1Region(region.country_iso, ref, name);
        for (const metaId of metaIds) link.run(metaId, rid);
      }
    }
    db.prepare('DELETE FROM regions WHERE id = ?').run(id);
    // metas.region_id (Kompatibilität) neu setzen
    const first = db.prepare('SELECT region_id FROM meta_regions WHERE meta_id = ? LIMIT 1');
    const upd = db.prepare('UPDATE metas SET region_id = ? WHERE id = ?');
    for (const metaId of metaIds) upd.run(first.get(metaId)?.region_id ?? null, metaId);
  });
  return [204, null];
});

route('POST', '/api/metas', async ({ req }) => {
  const m = validateMetaInput(await readJson(req));
  const id = transaction(() => {
    const r = db
      .prepare('INSERT INTO metas (country_iso, category_id, title, text) VALUES (?, ?, ?, ?)')
      .run(m.country_iso, m.category_id, m.title, m.text);
    const id = Number(r.lastInsertRowid);
    if (m.regions) setMetaRegions(id, m.country_iso, m.regions);
    return id;
  });
  return [201, getMeta(id)];
});

route('GET', '/api/metas/:id', ({ params }) => {
  const meta = getMeta(Number(params.id));
  if (!meta) throw new HttpError(404, 'Meta nicht gefunden');
  return meta;
});

route('PUT', '/api/metas/:id', async ({ req, params }) => {
  const id = Number(params.id);
  const existing = getMeta(id);
  if (!existing) throw new HttpError(404, 'Meta nicht gefunden');
  const { regions, ...m } = validateMetaInput(await readJson(req), true, existing.country_iso);
  if (m.country_iso && m.country_iso !== existing.country_iso && !regions) {
    throw new HttpError(400, 'Beim Länderwechsel müssen die Regionen neu gesetzt werden');
  }
  transaction(() => {
    const fields = Object.keys(m);
    const set = fields.map((f) => `${f} = ?, `).join('');
    db.prepare(`UPDATE metas SET ${set}updated_at = datetime('now') WHERE id = ?`).run(
      ...fields.map((f) => m[f]),
      id,
    );
    if (regions) setMetaRegions(id, m.country_iso ?? existing.country_iso, regions);
  });
  return getMeta(id);
});

route('DELETE', '/api/metas/:id', ({ params }) => {
  const id = Number(params.id);
  const files = db.prepare('SELECT filename FROM meta_images WHERE meta_id = ?').all(id);
  const r = db.prepare('DELETE FROM metas WHERE id = ?').run(id);
  if (r.changes === 0) throw new HttpError(404, 'Meta nicht gefunden');
  files.forEach((f) => removeUploadFile(f.filename));
  return [204, null];
});

// Bild-Upload: Body = rohe Bilddatei, Content-Type = image/*
route('POST', '/api/metas/:id/images', async ({ req, params, url }) => {
  const id = Number(params.id);
  if (!db.prepare('SELECT 1 FROM metas WHERE id = ?').get(id)) {
    throw new HttpError(404, 'Meta nicht gefunden');
  }
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new HttpError(415, 'Nur Bilder (jpg, png, webp, gif, avif) erlaubt');
  const data = await readBody(req, MAX_UPLOAD_BYTES);
  if (data.length === 0) throw new HttpError(400, 'Leere Datei');
  const filename = crypto.randomUUID() + ext;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), data);
  const caption = url.searchParams.get('caption') ?? '';
  const r = db
    .prepare('INSERT INTO meta_images (meta_id, filename, caption) VALUES (?, ?, ?)')
    .run(id, filename, caption);
  return [201, withUrl({ id: Number(r.lastInsertRowid), filename, caption })];
});

route('DELETE', '/api/images/:id', ({ params }) => {
  const id = Number(params.id);
  const img = db.prepare('SELECT filename FROM meta_images WHERE id = ?').get(id);
  if (!img) throw new HttpError(404, 'Bild nicht gefunden');
  db.prepare('DELETE FROM meta_images WHERE id = ?').run(id);
  removeUploadFile(img.filename);
  return [204, null];
});

// ---------- Server ----------

function serveUpload(res, name) {
  const filename = path.basename(decodeURIComponent(name));
  const type = EXT_TO_TYPE[path.extname(filename).toLowerCase()];
  const file = path.join(UPLOAD_DIR, filename);
  if (!type || !fs.existsSync(file)) {
    sendJson(res, 404, { error: 'Nicht gefunden' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
      serveUpload(res, url.pathname.slice('/uploads/'.length));
      return;
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = r.re.exec(url.pathname);
      if (!match) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, match[i + 1]]));
      const result = await r.handler({ req, res, params, url });
      const [status, data] = Array.isArray(result) && typeof result[0] === 'number' && result.length === 2
        ? result
        : [200, result];
      if (status === 204) {
        res.writeHead(204);
        res.end();
      } else {
        sendJson(res, status, data);
      }
      return;
    }
    sendJson(res, 404, { error: 'Route nicht gefunden' });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message ?? 'Fehler' });
  }
});

server.listen(PORT, () => {
  console.log(`GeoGuessr Helper API läuft auf Port ${PORT} (DB: ${DB_FILE})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
