// Rückwärtssuche: Aus den vergebenen Merkmalen aller Metas berechnen, welche Länder zu den Filtern passen.
//
// Regeln:
// - Mehrere Werte desselben Merkmals = ODER   (Muster: Waffel ODER Löcher)
// - Verschiedene Merkmale              = UND   (Muster … UND Farbe …)
// - Ein Land passt bei einem Merkmal, wenn eines seiner Metas einen gewählten Wert hat.
//   Hat es Angaben zu dem Merkmal, aber keinen gewählten Wert → ausgeschlossen.
//   Hat es gar keine Angabe dazu → „ohne Angabe“ (könnte passen, ist nur nicht erfasst).
import type { AttributeValueRow, Filter, FilterStatus } from './types';

export interface FilterResult {
  status: Map<string, FilterStatus>;
  match: string[];
  unknown: number;
  excluded: number;
  /** Metas, die mindestens einen gewählten Wert haben (für Hervorhebung in der Seitenleiste) */
  matchingMetaIds: Set<number>;
}

export const filterKey = (f: Filter) => `${f.attribute_id}:${f.value}`;

export function computeFilter(rows: AttributeValueRow[], filters: Filter[], countries: Iterable<string>): FilterResult {
  const wanted = new Map<number, Set<string>>();
  for (const f of filters) {
    const set = wanted.get(f.attribute_id) ?? new Set<string>();
    set.add(f.value);
    wanted.set(f.attribute_id, set);
  }
  // Land → Merkmal → vorhandene Werte
  const byCountry = new Map<string, Map<number, Set<string>>>();
  const matchingMetaIds = new Set<number>();
  for (const r of rows) {
    if (!wanted.has(r.attribute_id)) continue;
    const attrs = byCountry.get(r.country_iso) ?? new Map<number, Set<string>>();
    const vals = attrs.get(r.attribute_id) ?? new Set<string>();
    vals.add(r.value);
    attrs.set(r.attribute_id, vals);
    byCountry.set(r.country_iso, attrs);
    if (wanted.get(r.attribute_id)!.has(r.value)) matchingMetaIds.add(r.meta_id);
  }
  const status = new Map<string, FilterStatus>();
  const match: string[] = [];
  let unknown = 0, excluded = 0;
  for (const iso of countries) {
    const attrs = byCountry.get(iso);
    let st: FilterStatus = 'match';
    for (const [attrId, vals] of wanted) {
      const have = attrs?.get(attrId);
      if (!have) st = st === 'match' ? 'unknown' : st;
      else if (![...have].some((v) => vals.has(v))) {
        st = 'excluded';
        break;
      }
    }
    status.set(iso, st);
    if (st === 'match') match.push(iso);
    else if (st === 'unknown') unknown++;
    else excluded++;
  }
  return { status, match, unknown, excluded, matchingMetaIds };
}

/** Anzahl Länder je Merkmalswert (für die Zahlen an den Filter-Buttons) */
export function valueCountryCounts(rows: AttributeValueRow[]): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = filterKey(r);
    const s = sets.get(k) ?? new Set<string>();
    s.add(r.country_iso);
    sets.set(k, s);
  }
  return new Map([...sets].map(([k, s]) => [k, s.size]));
}
