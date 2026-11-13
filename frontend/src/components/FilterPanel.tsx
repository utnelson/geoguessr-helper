import { useMemo, useState } from 'react';
import { filterKey, valueCountryCounts, type FilterResult } from '../filters';
import type { Attribute, AttributeValueRow, Category, CountryInfo, Filter } from '../types';

interface PanelProps {
  categories: Category[];
  attributes: Attribute[];
  rows: AttributeValueRow[];
  filters: Filter[];
  onChange: (f: Filter[]) => void;
  result: FilterResult | null;
  countries: Map<string, CountryInfo>;
  /** Kandidaten auf diesen Kontinent beschränken (Weltansicht) */
  continentId: string | null;
  onOpenCountry: (iso: string) => void;
  onClose: () => void;
  onManage: () => void;
}

/**
 * Rückwärtssuche (Klappmenü über der Karte): Werte anklicken, die man im Spiel sieht.
 * Die Karte graut sofort alle Länder aus, die nicht passen. Eingeklappt bleiben die Filter aktiv.
 */
export function FilterPanel({
  categories, attributes, rows, filters, onChange, result, countries, continentId, onOpenCountry, onClose, onManage,
}: PanelProps) {
  const [query, setQuery] = useState('');
  const counts = useMemo(() => valueCountryCounts(rows), [rows]);
  const active = new Set(filters.map(filterKey));
  const toggle = (f: Filter) =>
    onChange(active.has(filterKey(f)) ? filters.filter((x) => filterKey(x) !== filterKey(f)) : [...filters, f]);

  const q = query.trim().toLowerCase();
  const groups = categories
    .map((c) => ({
      category: c,
      attrs: attributes.filter(
        (a) =>
          a.category_id === c.id &&
          a.values.length > 0 &&
          (!q || c.name.toLowerCase().includes(q) || a.key.toLowerCase().includes(q) || a.values.some((v) => v.toLowerCase().includes(q))),
      ),
    }))
    .filter((g) => g.attrs.length > 0);

  const candidates = (result?.match ?? [])
    .map((iso) => countries.get(iso))
    .filter((c): c is CountryInfo => !!c && (!continentId || c.continent === continentId))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  return (
    <aside className="filter-panel">
      <div className="filter-head">
        <strong>🔎 Rückwärtssuche</strong>
        <button className="btn ghost small" onClick={onClose} title="Einklappen – die Filter bleiben aktiv">Einklappen ›</button>
      </div>

      {result && (
        <div className="filter-result">
          <div>
            <strong className="match-count">{candidates.length}</strong> {candidates.length === 1 ? 'Land passt' : 'Länder passen'}
            {continentId && <span className="muted"> (im gewählten Kontinent)</span>}
          </div>
          <div className="muted small-hint">
            {result.unknown} ohne Angabe · {result.excluded} ausgeschlossen
          </div>
          {candidates.length > 0 && (
            <div className="candidate-list">
              {candidates.slice(0, 40).map((c) => (
                <button key={c.iso} className="chip candidate" onClick={() => onOpenCountry(c.iso)} title="Land öffnen">
                  {c.name}
                </button>
              ))}
              {candidates.length > 40 && <span className="muted small-hint">+{candidates.length - 40} weitere</span>}
            </div>
          )}
          <button className="btn ghost small" onClick={() => onChange([])}>× Alle Filter löschen</button>
        </div>
      )}

      {attributes.length > 0 && (
        <input className="filter-search" placeholder="Merkmal suchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}

      <div className="filter-groups">
        {groups.length === 0 && (
          <div className="muted small-hint filter-empty">
            {attributes.length === 0 ? (
              <>
                Noch keine Merkmale angelegt. Lege sie unter <strong>⚙ Optionen → Merkmale</strong> an (z.B. Masten → Muster:
                Waffel, Löcher) und vergib sie im Meta-Formular.
                <button className="btn ghost small" onClick={onManage}>Merkmale anlegen</button>
              </>
            ) : (
              'Nichts gefunden.'
            )}
          </div>
        )}
        {groups.map(({ category, attrs }) => (
          <div key={category.id} className="filter-group">
            <h4>{category.name}</h4>
            {attrs.map((a) => (
              <div key={a.id} className="filter-attr">
                <span className="tag-key">{a.key}</span>
                <span className="value-chips">
                  {a.values.map((v) => {
                    const k = `${a.id}:${v}`;
                    const n = counts.get(k) ?? 0;
                    return (
                      <button
                        key={k}
                        className={`chip ${active.has(k) ? 'active' : ''} ${n === 0 ? 'empty' : ''}`}
                        onClick={() => toggle({ attribute_id: a.id, value: v })}
                        title={n ? `${n} Länder haben „${v}“` : 'Noch keinem Meta zugeordnet'}
                      >
                        {v} <span className="chip-count">{n}</span>
                      </button>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="muted small-hint filter-rules">
        Mehrere Werte eines Merkmals = <em>oder</em>, verschiedene Merkmale = <em>und</em>.
        „Ohne Angabe“: Land hat zu diesem Merkmal noch kein Meta – es könnte also trotzdem passen.
      </p>
    </aside>
  );
}

interface BarProps {
  attributes: Attribute[];
  categories: Category[];
  filters: Filter[];
  onChange: (f: Filter[]) => void;
  matchCount: number;
  onOpen: () => void;
}

/** Leiste mit den aktiven Filtern (sichtbar, auch wenn das Menü eingeklappt ist) */
export function ActiveFilterBar({ attributes, categories, filters, onChange, matchCount, onOpen }: BarProps) {
  if (filters.length === 0) return null;
  const label = (f: Filter) => {
    const a = attributes.find((x) => x.id === f.attribute_id);
    const c = categories.find((x) => x.id === a?.category_id);
    return `${c ? `${c.name} › ` : ''}${a?.key ?? '?'}: ${f.value}`;
  };
  return (
    <div className="active-filter-bar">
      <button className="btn ghost small" onClick={onOpen} title="Filter-Menü öffnen">🔎 Filter</button>
      {filters.map((f) => (
        <span key={filterKey(f)} className="region-chip filter-chip">
          {label(f)}
          <button title="Filter entfernen" onClick={() => onChange(filters.filter((x) => filterKey(x) !== filterKey(f)))}>×</button>
        </span>
      ))}
      <span className="muted">→ <strong>{matchCount}</strong> {matchCount === 1 ? 'Land passt' : 'Länder passen'}</span>
      <button className="btn ghost small" onClick={() => onChange([])}>Alle löschen</button>
    </div>
  );
}
