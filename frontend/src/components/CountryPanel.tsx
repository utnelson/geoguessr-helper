import { useMemo, useState } from 'react';
import type { Category, CountryInfo, Meta, RegionInfo } from '../types';
import { flagUrl } from '../geo';

interface Props {
  country: CountryInfo;
  metas: Meta[];
  loading: boolean;
  categories: Category[];
  /** admin1-Regionen des Landes (null = noch nicht geladen) */
  regions: Map<string, RegionInfo> | null;
  regionCounts: Record<string, number>;
  selectedRegions: string[];
  onSelectRegions: (refs: string[]) => void;
  onClose: () => void;
  onAdd: () => void;
  onEdit: (m: Meta) => void;
  onDelete: (m: Meta) => void;
  onOpenImage: (url: string) => void;
}

function groupByCategory(list: Meta[]): [string, Meta[]][] {
  const groups = new Map<string, Meta[]>();
  for (const m of list) {
    const g = groups.get(m.category_name) ?? [];
    g.push(m);
    groups.set(m.category_name, g);
  }
  return [...groups.entries()];
}

export function CountryPanel({
  country, metas, loading, categories, regions, regionCounts, selectedRegions, onSelectRegions,
  onClose, onAdd, onEdit, onDelete, onOpenImage,
}: Props) {
  const [filter, setFilter] = useState<number | 'all'>('all');
  const flag = flagUrl(country.iso);
  const hasSelection = selectedRegions.length > 0;
  const regionName = (ref: string) => regions?.get(ref)?.name ?? ref;
  const metaRegionName = (r: Meta['regions'][number]) => (r.ref && regions?.get(r.ref)?.name) || r.name;

  // Sichtbare Metas: die der ausgewählten Region(en) – oder alle Metas des Landes
  const scoped = useMemo(
    () => (hasSelection ? metas.filter((m) => m.regions.some((r) => r.ref && selectedRegions.includes(r.ref))) : metas),
    [metas, selectedRegions, hasSelection],
  );
  const visible = filter === 'all' ? scoped : scoped.filter((m) => m.category_id === filter);
  const general = visible.filter((m) => m.regions.length === 0);
  const regional = visible.filter((m) => m.regions.length > 0);

  // Länderansicht: Regionen-Metas nach Regions-Kombination gruppieren („Bayern, Sachsen“)
  const regionalGroups = useMemo(() => {
    const groups = new Map<string, { refs: string[]; names: string[]; metas: Meta[] }>();
    for (const m of regional) {
      const names = m.regions.map(metaRegionName).sort((a, b) => a.localeCompare(b, 'de'));
      const key = names.join('|');
      const g = groups.get(key) ?? { refs: m.regions.flatMap((r) => (r.ref ? [r.ref] : [])), names, metas: [] };
      g.metas.push(m);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => a.names.length - b.names.length || a.names[0].localeCompare(b.names[0], 'de'));
  }, [regional, regions]);

  const usedCategories = categories.filter((c) => scoped.some((m) => m.category_id === c.id));
  const generalCount = metas.filter((m) => m.regions.length === 0).length;
  const regionalCount = metas.length - generalCount;

  const regionList = useMemo(
    () => (regions ? [...regions.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')) : []),
    [regions],
  );

  const renderCards = (list: Meta[], showRegions: boolean) => (
    <div className="cards">
      {list.map((m) => (
        <article key={m.id} className="card">
          {m.images.length > 0 && (
            <div className="card-images">
              {m.images.map((img) => (
                <img key={img.id} src={img.url} alt={img.caption || m.title} loading="lazy" onClick={() => onOpenImage(img.url)} />
              ))}
            </div>
          )}
          <div className="card-body">
            <h4>{m.title}</h4>
            {showRegions && m.regions.length > 0 && (
              <div className="card-regions">📍 {m.regions.map(metaRegionName).join(', ')}</div>
            )}
            {m.text && <p>{m.text}</p>}
          </div>
          <div className="card-actions">
            <button className="btn ghost small" onClick={() => onEdit(m)}>Bearbeiten</button>
            <button className="btn ghost small danger" onClick={() => onDelete(m)}>Löschen</button>
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <section className="panel">
      <header className="panel-head">
        <button className="btn ghost" onClick={onClose} title="Zurück zur Weltkarte">← Welt</button>
        {flag && <img className="flag" src={flag} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
        <div className="panel-title">
          <h2>{country.name}</h2>
          <small>
            {country.iso} · {country.continent} · {generalCount} Metas
            {regionalCount > 0 && ` · ${regionalCount} Regionen-Metas`}
          </small>
        </div>
        {regionList.length > 0 && (
          <select
            className="region-select"
            value={selectedRegions.length > 1 ? '__multi' : selectedRegions[0] ?? ''}
            onChange={(e) => onSelectRegions(e.target.value ? [e.target.value] : [])}
            title="Region auswählen – mehrere mit Strg+Klick auf der Karte"
          >
            <option value="">Ganzes Land</option>
            {selectedRegions.length > 1 && (
              <option value="__multi" disabled>{selectedRegions.length} Regionen ausgewählt</option>
            )}
            {regionList.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{regionCounts[r.id] ? ` (${regionCounts[r.id]})` : ''}
              </option>
            ))}
          </select>
        )}
        <div className="chips">
          <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Alle</button>
          {usedCategories.map((c) => (
            <button key={c.id} className={`chip ${filter === c.id ? 'active' : ''}`} onClick={() => setFilter(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={onAdd}>
          {selectedRegions.length > 1 ? `+ Meta für ${selectedRegions.length} Regionen` : hasSelection ? '+ Regionen-Meta' : '+ Meta'}
        </button>
      </header>

      {hasSelection && (
        <div className="region-bar">
          <span className="region-pin">📍</span>
          {selectedRegions.length === 1 ? (
            (() => {
              const region = regions?.get(selectedRegions[0]);
              return (
                <>
                  <strong>{region?.name ?? '…'}</strong>
                  {region && (
                    <span className="muted">
                      {[region.nameEn !== region.name ? region.nameEn : '', region.type, region.code].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </>
              );
            })()
          ) : (
            <span className="region-chips">
              {selectedRegions.map((ref) => (
                <span key={ref} className="region-chip">
                  {regionName(ref)}
                  <button title="Abwählen" onClick={() => onSelectRegions(selectedRegions.filter((r) => r !== ref))}>×</button>
                </span>
              ))}
            </span>
          )}
          <span className="muted">{scoped.length} Metas{selectedRegions.length === 1 && ' · Strg+Klick auf der Karte: weitere Regionen'}</span>
          <button className="btn ghost small" onClick={() => onSelectRegions([])}>× Ganzes Land</button>
        </div>
      )}

      <div className="panel-body">
        {loading && <p className="muted">Lade…</p>}
        {!loading && scoped.length === 0 && (
          <div className="empty">
            {hasSelection
              ? `Noch keine Metas für ${selectedRegions.length === 1 ? regionName(selectedRegions[0]) : 'diese Regionen'}.`
              : `Noch keine Metas für ${country.name}.`}
            <button className="btn primary" onClick={onAdd}>Erstes Meta anlegen</button>
          </div>
        )}

        {groupByCategory(general).map(([cat, list]) => (
          <div key={cat} className="group">
            <h3>{cat}</h3>
            {renderCards(list, false)}
          </div>
        ))}

        {hasSelection
          ? groupByCategory(regional).map(([cat, list]) => (
              <div key={cat} className="group">
                <h3>{cat}</h3>
                {renderCards(list, true)}
              </div>
            ))
          : regionalGroups.length > 0 && (
              <>
                <h3 className="section-title">Regionen-Metas</h3>
                {regionalGroups.map((g) => (
                  <div key={g.names.join('|')} className="group">
                    <h3>
                      {g.refs.length > 0 ? (
                        <button className="link" onClick={() => onSelectRegions(g.refs)} title="Region(en) auf der Karte zeigen">
                          📍 {g.names.join(', ')}
                        </button>
                      ) : (
                        <>📍 {g.names.join(', ')}</>
                      )}
                    </h3>
                    {renderCards(g.metas, false)}
                  </div>
                ))}
              </>
            )}
      </div>
    </section>
  );
}
