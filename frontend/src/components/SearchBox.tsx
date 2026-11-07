import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CountryInfo, SearchHit } from '../types';

interface Props {
  /** auswählbare Länder (ohne ausgeschaltete) */
  countries: CountryInfo[];
  countryNames: Map<string, CountryInfo>;
  onOpenCountry: (iso: string) => void;
  onOpenMeta: (hit: SearchHit) => void;
  /** Länder mit Meta-Treffern → auf der Karte markieren (null = keine Suche aktiv) */
  onHitsChange: (isos: Set<string> | null) => void;
}

/** Ausschnitt mit markierten Treffern (\u0002 … \u0003 aus der Volltextsuche) */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0002') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

/** Suchfeld oben: Länder nach Name + Volltextsuche über alle Metas */
export function SearchBox({ countries, countryNames, onOpenCountry, onOpenMeta, onHitsChange }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const term = q.trim().toLowerCase();
  // Treffer in ausgeschalteten Ländern weglassen (die lassen sich nicht öffnen)
  const allowedKey = countries.map((c) => c.iso).join(',');

  const countryHits = term
    ? countries
        .filter((c) => c.name.toLowerCase().includes(term) || c.nameEn.toLowerCase().includes(term) || c.iso.toLowerCase() === term)
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term)))
        .slice(0, 6)
    : [];

  // Volltextsuche (verzögert, damit nicht bei jedem Tastendruck gesucht wird)
  useEffect(() => {
    if (term.length < 2) {
      setHits([]);
      onHitsChange(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.search(term).then((all) => {
        if (cancelled) return;
        const allowed = new Set(allowedKey.split(','));
        const h = all.filter((x) => allowed.has(x.country_iso));
        setHits(h);
        onHitsChange(new Set(h.map((x) => x.country_iso)));
      }).catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, onHitsChange, allowedKey]);

  // Klick außerhalb schließt die Liste (Suche und Kartenmarkierung bleiben)
  useEffect(() => {
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const items: ({ kind: 'country'; c: CountryInfo } | { kind: 'meta'; h: SearchHit })[] = [
    ...countryHits.map((c) => ({ kind: 'country' as const, c })),
    ...hits.map((h) => ({ kind: 'meta' as const, h })),
  ];
  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    if (it.kind === 'country') {
      onOpenCountry(it.c.iso);
      setQ('');
    } else onOpenMeta(it.h);
    setOpen(false);
  };
  const clear = () => {
    setQ('');
    setOpen(false);
  };

  const metaCountries = new Set(hits.map((h) => h.country_iso)).size;

  return (
    <div className="searchbox" ref={wrap}>
      <input
        className="search"
        placeholder="Land oder Meta suchen… (z.B. Waffel, gelbe Kennzeichen)"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setCursor((c) => Math.min(c + 1, items.length - 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setCursor((c) => Math.max(c - 1, 0)));
          else if (e.key === 'Enter') choose(cursor);
          else if (e.key === 'Escape') clear();
        }}
      />
      {q && <button className="search-clear" onClick={clear} title="Suche löschen (Esc)">×</button>}
      {open && term && (
        <div className="search-results">
          {countryHits.length > 0 && <div className="search-section">Länder</div>}
          {countryHits.map((c, i) => (
            <button key={c.iso} className={`search-item ${cursor === i ? 'active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => choose(i)}>
              🌍 {c.name} <span className="muted">{c.iso}</span>
            </button>
          ))}
          {term.length >= 2 && (
            <div className="search-section">
              Metas {hits.length > 0 && <span className="muted">· {hits.length} Treffer in {metaCountries} Ländern (auf der Karte markiert)</span>}
            </div>
          )}
          {hits.map((h, k) => {
            const i = countryHits.length + k;
            return (
              <button key={h.id} className={`search-item meta ${cursor === i ? 'active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => choose(i)}>
                <span className="search-meta-head">
                  <strong>{countryNames.get(h.country_iso)?.name ?? h.country_iso}</strong>
                  <span className="muted"> · {h.category_name}{h.title ? ` · ${h.title}` : ''}</span>
                </span>
                <span className="search-snippet"><Snippet text={h.snippet} /></span>
              </button>
            );
          })}
          {term.length >= 2 && hits.length === 0 && <div className="muted small-hint search-empty">Keine Metas gefunden.</div>}
        </div>
      )}
    </div>
  );
}
