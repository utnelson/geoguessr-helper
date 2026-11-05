export interface Category {
  id: number;
  name: string;
  sort: number;
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

export interface MetaRegion {
  id: number;
  name: string;
  ref: string | null;
  source: 'admin1' | 'custom';
}

export type BBox = [number, number, number, number]; // [west, south, east, north]

export interface CountryInfo {
  iso: string;
  name: string;
  nameEn: string;
  continent: string;
  bbox: BBox;
}

/** Region aus der Datenbank (wird beim ersten Regionen-Meta angelegt) */
export interface Region {
  id: number;
  country_iso: string;
  name: string;
  source: 'admin1' | 'custom';
  ref: string | null;
  geometry: string | null;
}

/** admin1-Region aus public/geo/admin1/<ISO>.geojson */
export interface RegionInfo {
  id: string; // Natural-Earth adm1_code, z.B. "DEU-1591"
  name: string;
  nameEn: string;
  type: string;
  code: string; // ISO 3166-2, z.B. "DE-BY" (kann leer sein)
  bbox: BBox;
}
