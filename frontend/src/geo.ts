import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import type { BBox, CountryInfo, RegionInfo } from './types';

export type CountryFeature = Feature<Polygon | MultiPolygon, { iso: string; name: string; name_en: string; continent: string }>;
export type RegionFeature = Feature<Polygon | MultiPolygon, { id: string; name: string; name_en: string; type: string; code: string }>;
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
    countries.set(p.iso, { iso: p.iso, name: p.name, nameEn: p.name_en, continent: p.continent, bbox: countryBBox(f) });
  }
  return { geojson, countries };
}

export interface RegionData {
  iso: string;
  geojson: RegionCollection;
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
      for (const f of geojson.features) {
        const p = f.properties;
        regions.set(p.id, { id: p.id, name: p.name, nameEn: p.name_en, type: p.type, code: p.code, bbox: countryBBox(f) });
      }
      return { iso, geojson, regions };
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
