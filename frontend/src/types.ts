export interface Category {
  id: number;
  name: string;
  sort: number;
  /** Anzahl Metas (nur bei GET /api/categories) */
  meta_count?: number;
}

export interface Settings {
  /** ausgeschaltete Länder (z.B. ohne GeoGuessr-Coverage) – nicht auswählbar */
  disabled_countries: string[];
}

export interface MetaImage {
  id: number;
  filename: string;
  caption: string;
  url: string;
}

export interface Meta {
  id: number;
  country_iso: string;
  /** Regionen, für die das Meta gilt (leer = ganzes Land) */
  regions: MetaRegion[];
  category_id: number;
  category_name: string;
  title: string;
  text: string;
  images: MetaImage[];
  created_at: string;
  updated_at: string;
}

export interface MetaInput {
  country_iso: string;
  category_id: number;
  title: string;
  text: string;
  /** vorhandene Regionen (z.B. selbst gezeichnete) */
  region_ids?: number[];
  /** admin1-Regionen – werden bei Bedarf angelegt */
  admin1?: { ref: string; name: string }[];
}

export type RegionSource = 'admin1' | 'group' | 'custom';

export interface MetaRegion {
  id: number;
  name: string;
  ref: string | null;
  source: RegionSource;
  color: string | null;
}

export type BBox = [number, number, number, number]; // [west, south, east, north]

export interface CountryInfo {
  iso: string;
  name: string;
  nameEn: string;
  continent: string;
  bbox: BBox;
  /** Beschriftungspunkt [lng, lat] */
  label: [number, number];
  /** Fläche des größten Teils (Grad², nur zum Sortieren) */
  area: number;
}

/** Region aus der Datenbank (wird beim ersten Regionen-Meta angelegt) */
export interface Region {
  id: number;
  country_iso: string;
  name: string;
  source: RegionSource;
  ref: string | null;
  color: string | null;
  geometry: string | null;
  /** admin1-Mitglieder (nur bei Gruppen) */
  members: string[];
}

/** Regionsgruppe, z.B. „Kansai“ = mehrere Präfekturen */
export type RegionGroup = Region & { source: 'group'; meta_count: number };

/** admin1-Region aus public/geo/admin1/<ISO>.geojson */
export interface RegionInfo {
  id: string; // Natural-Earth adm1_code, z.B. "DEU-1591"
  name: string;
  nameEn: string;
  type: string;
  code: string; // ISO 3166-2, z.B. "DE-BY" (kann leer sein)
  /** übergeordnete Region laut Natural Earth (Vorschlag für Gruppen), kann leer sein */
  group: string;
  bbox: BBox;
}

/** Ein Kasten der Infografik-Ansicht (ein Meta, verbunden mit seinen Regionen) */
export interface InfoItem {
  key: string;
  color: string;
  /** admin1-Regionen, die eingefärbt werden (leer = landesweit, ohne Linie) */
  refs: string[];
  label: string;
  title: string;
  text: string;
  image: string | null;
  /** Welt-Infografik: Land, das eingefärbt wird und per Klick geöffnet werden kann */
  iso?: string;
  /** fester Ankerpunkt [lng, lat] (sonst aus den Regionen berechnet) */
  anchor?: [number, number];
}
