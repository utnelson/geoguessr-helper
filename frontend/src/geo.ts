import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import type { BBox, CountryInfo, RegionInfo } from './types';

export type CountryFeature = Feature<
  Polygon | MultiPolygon,
  { iso: string; name: string; name_en: string; continent: string; label?: [number, number] | null }
>;
export type RegionFeature = Feature<Polygon | MultiPolygon, { id: string; name: string; name_en: string; type: string; code: string; group?: string }>;
export type RegionCollection = FeatureCollection<Polygon | MultiPolygon, RegionFeature['properties']>;
export type CountryCollection = FeatureCollection<Polygon | MultiPolygon, CountryFeature['properties']>;

function ringBBox(ring: Position[]): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

function ringArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

/**
 * Zoom-Rahmen für ein Land. Kleine Außengebiete (Inseln, Überseegebiete)
 * (< 20 % der Fläche des größten Teils) werden ignoriert, damit z.B. Frankreich nicht wegen Französisch-Guayana
 * auf halb Atlantik zoomt. Über die Datumsgrenze hinweg wird auf das größte
 * Teilgebiet zurückgefallen (z.B. Russland, Fidschi).
 */
export function countryBBox(f: CountryFeature | RegionFeature): BBox {
  const outers: Position[][] =
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]);
  const parts = outers.map((r) => ({ bbox: ringBBox(r), area: ringArea(r) })).sort((a, b) => b.area - a.area);
  const largest = parts[0];
  const relevant = parts.filter((p) => p.area >= largest.area * 0.2);
  const union = relevant.reduce<BBox>(
    (acc, p) => [
      Math.min(acc[0], p.bbox[0]),
      Math.min(acc[1], p.bbox[1]),
      Math.max(acc[2], p.bbox[2]),
      Math.max(acc[3], p.bbox[3]),
    ],
    [...largest.bbox] as BBox,
  );
  return union[2] - union[0] > 180 ? largest.bbox : union;
}

export async function loadCountries(): Promise<{ geojson: CountryCollection; countries: Map<string, CountryInfo> }> {
  const res = await fetch('/geo/countries.geojson');
  if (!res.ok) throw new Error('Kartendaten fehlen – "npm run fetch-geo" ausführen');
  const geojson = (await res.json()) as CountryCollection;
  const countries = new Map<string, CountryInfo>();
  for (const f of geojson.features) {
    const p = f.properties;
    const c = featureCentroid(f);
    countries.set(p.iso, {
      iso: p.iso, name: p.name, nameEn: p.name_en, continent: p.continent, bbox: countryBBox(f),
      // Natural-Earth-Beschriftungspunkt, sonst Schwerpunkt des größten Teils (ältere countries.geojson)
      label: p.label ?? [c.x, c.y],
      area: c.area,
    });
  }
  return { geojson, countries };
}

export interface RegionData {
  iso: string;
  geojson: RegionCollection;
  features: Map<string, RegionFeature>;
  regions: Map<string, RegionInfo>;
}

const regionCache = new Map<string, Promise<RegionData>>();

/** admin1-Regionen eines Landes (leer, wenn es keine gibt) */
export function loadRegions(iso: string): Promise<RegionData> {
  let p = regionCache.get(iso);
  if (!p) {
    p = (async () => {
      const res = await fetch(`/geo/admin1/${encodeURIComponent(iso)}.geojson`);
      const empty: RegionCollection = { type: 'FeatureCollection', features: [] };
      // Fehlende Datei: nginx → 404, Vite-Dev-Server → index.html
      const isHtml = res.headers.get('content-type')?.includes('html') ?? false;
      const geojson: RegionCollection = res.ok && !isHtml ? await res.json().catch(() => empty) : empty;
      const regions = new Map<string, RegionInfo>();
      const features = new Map<string, RegionFeature>();
      for (const f of geojson.features) {
        const p = f.properties;
        regions.set(p.id, {
          id: p.id, name: p.name, nameEn: p.name_en, type: p.type, code: p.code, group: p.group ?? '', bbox: countryBBox(f),
        });
        features.set(p.id, f);
      }
      return { iso, geojson, regions, features };
    })();
    p.catch(() => regionCache.delete(iso));
    regionCache.set(iso, p);
  }
  return p;
}

/** Flaggenbild (flagcdn.com) – nur für echte ISO-3166-Alpha-2-Codes */
export function flagUrl(iso: string): string | null {
  return /^[A-Z]{2}$/.test(iso) ? `https://flagcdn.com/w80/${iso.toLowerCase()}.png` : null;
}

/** Schwerpunkt + Fläche des größten Teilpolygons (Grad, grob genähert) */
function featureCentroid(f: Feature<Polygon | MultiPolygon>): { x: number; y: number; area: number } {
  const rings: Position[][] =
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]);
  let best = { x: 0, y: 0, area: -1 };
  for (const ring of rings) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
    if (Math.abs(a) > best.area && a !== 0) best = { x: cx / (3 * a), y: cy / (3 * a), area: Math.abs(a / 2) };
  }
  return best;
}

/**
 * Ankerpunkt für eine Menge von Regionen (Infografik-Linie): flächengewichteter Mittelpunkt,
 * auf den Schwerpunkt der nächstgelegenen Mitgliedsregion gezogen – liegt so sicher in der Gruppe.
 */
export function regionsAnchor(data: RegionData, refs: string[]): [number, number] | null {
  const cs = refs.flatMap((r) => {
    const f = data.features.get(r);
    return f ? [featureCentroid(f)] : [];
  });
  if (cs.length === 0) return null;
  const total = cs.reduce((a, c) => a + c.area, 0) || 1;
  const mx = cs.reduce((a, c) => a + c.x * c.area, 0) / total;
  const my = cs.reduce((a, c) => a + c.y * c.area, 0) / total;
  const nearest = cs.reduce((a, c) => ((c.x - mx) ** 2 + (c.y - my) ** 2 < (a.x - mx) ** 2 + (a.y - my) ** 2 ? c : a));
  return [nearest.x, nearest.y];
}

/** Farbpalette für Gruppen / Infografik */
export const GROUP_COLORS = [
  '#7b8cff', '#f2a0a0', '#ffe066', '#8ce08c', '#ff9f5a', '#e37ae3',
  '#7ee8e8', '#b39ddb', '#ffd8a8', '#63e6be', '#ffa8d5', '#a9e34b',
];

/** Kontinente (Natural-Earth-Namen) mit Kartenausschnitt [west, south, east, north] */
export const CONTINENTS: { id: string; name: string; bbox: BBox }[] = [
  { id: 'Europe', name: 'Europa', bbox: [-25, 34, 45, 71.5] },
  { id: 'Asia', name: 'Asien', bbox: [25, -11, 150, 56] },
  { id: 'Africa', name: 'Afrika', bbox: [-19, -36, 52, 38] },
  { id: 'North America', name: 'Nordamerika', bbox: [-170, 7, -52, 72] },
  { id: 'South America', name: 'Südamerika', bbox: [-82, -56, -34, 13] },
  { id: 'Oceania', name: 'Ozeanien', bbox: [110, -48, 180, 0] },
];
