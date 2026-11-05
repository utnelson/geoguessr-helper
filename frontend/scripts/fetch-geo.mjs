// Lädt Länder- und Regionsgrenzen von Natural Earth (Public Domain), entfernt
// unnötige Eigenschaften, vereinfacht/rundet Koordinaten und speichert:
//   public/geo/countries.geojson        – Ländergrenzen (50m)
//   public/geo/admin1/<ISO>.geojson     – admin1-Regionen je Land (10m)
// Läuft automatisch im Docker-Build. Mit --force wird alles neu geladen.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const SRC_COUNTRIES = `${BASE}/ne_50m_admin_0_countries.geojson`;
const SRC_ADMIN1 = `${BASE}/ne_10m_admin_1_states_provinces.geojson`;

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, '../public/geo');
const OUT_COUNTRIES = path.join(OUT_DIR, 'countries.geojson');
const OUT_ADMIN1 = path.join(OUT_DIR, 'admin1');
const OUT_ADMIN1_DONE = path.join(OUT_ADMIN1, 'index.json');
const force = process.argv.includes('--force');

const exists = (f) => fs.access(f).then(() => true, () => false);
const valid = (v) => v && v !== '-99' && v !== -99;

async function download(url) {
  console.log(`↓ Lade ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
  return res.json();
}

// ---------- Geometrie ----------

const r3 = (n) => Math.round(n * 1000) / 1000;

/** Douglas-Peucker (iterativ) – tol in Grad */
function simplifyRing(ring, tol) {
  if (ring.length <= 8 || tol <= 0) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      let d;
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d > maxD) (maxD = d), (idx = i);
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

function cleanRing(ring, tol) {
  const out = [];
  for (const [x, y] of simplifyRing(ring, tol)) {
    const p = [r3(x), r3(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}

function cleanGeometry(g, tol) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const cleaned = polys
    .map((rings) => rings.map((r) => cleanRing(r, tol)).filter(Boolean))
    .filter((rings) => rings.length > 0);
  if (cleaned.length === 0) return null;
  return cleaned.length === 1
    ? { type: 'Polygon', coordinates: cleaned[0] }
    : { type: 'MultiPolygon', coordinates: cleaned };
}

// ---------- Länder ----------

/** ISO-Code wie in countries.geojson (für die Zuordnung der Regionen) */
function countryIso(p, seen) {
  let iso = valid(p.ISO_A2_EH) ? p.ISO_A2_EH : valid(p.ISO_A2) ? p.ISO_A2 : p.ADM0_A3;
  if (seen.has(iso)) iso = p.ADM0_A3; // Eindeutigkeit für Feature-State
  seen.add(iso);
  return String(iso).toUpperCase();
}

const countriesRaw = await download(SRC_COUNTRIES);
const a3ToIso = new Map();
{
  const seen = new Set();
  const features = countriesRaw.features.map((f) => {
    const p = f.properties;
    const iso = countryIso(p, seen);
    a3ToIso.set(p.ADM0_A3, iso);
    return {
      type: 'Feature',
      properties: {
        iso,
        name: p.NAME_DE || p.NAME || p.ADMIN,
        name_en: p.NAME || p.ADMIN,
        continent: p.CONTINENT,
      },
      geometry: cleanGeometry(f.geometry, 0),
    };
  });
  if (force || !(await exists(OUT_COUNTRIES))) {
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(OUT_COUNTRIES, JSON.stringify({ type: 'FeatureCollection', features }));
    console.log(`✔ ${features.length} Länder → ${OUT_COUNTRIES}`);
  } else {
    console.log(`✔ ${OUT_COUNTRIES} existiert bereits`);
  }
}

// ---------- Regionen (admin1) ----------

if (!force && (await exists(OUT_ADMIN1_DONE))) {
  console.log(`✔ ${OUT_ADMIN1} existiert bereits (mit --force neu laden)`);
  process.exit(0);
}

const admin1Raw = await download(SRC_ADMIN1);
const byCountry = new Map();
let skipped = 0;
for (const f of admin1Raw.features) {
  const p = f.properties;
  const iso = a3ToIso.get(p.adm0_a3);
  const geometry = f.geometry && cleanGeometry(f.geometry, 0.003);
  if (!iso || !geometry || !p.adm1_code) {
    skipped++;
    continue;
  }
  const list = byCountry.get(iso) ?? [];
  list.push({
    type: 'Feature',
    properties: {
      id: p.adm1_code,
      name: p.name_de || p.name || p.name_en || p.adm1_code,
      name_en: p.name_en || p.name || '',
      type: p.type_en || p.type || '',
      code: valid(p.iso_3166_2) && !String(p.iso_3166_2).endsWith('~') ? p.iso_3166_2 : '',
    },
    geometry,
  });
  byCountry.set(iso, list);
}

await fs.rm(OUT_ADMIN1, { recursive: true, force: true });
await fs.mkdir(OUT_ADMIN1, { recursive: true });
const index = {};
for (const [iso, features] of byCountry) {
  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'de'));
  await fs.writeFile(path.join(OUT_ADMIN1, `${iso}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }));
  index[iso] = features.length;
}
await fs.writeFile(OUT_ADMIN1_DONE, JSON.stringify(index));
const total = Object.values(index).reduce((a, b) => a + b, 0);
console.log(`✔ ${total} Regionen in ${byCountry.size} Ländern → ${OUT_ADMIN1} (${skipped} übersprungen)`);
