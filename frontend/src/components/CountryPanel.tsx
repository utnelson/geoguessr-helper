import { useMemo } from 'react';
import type { Category, CountryInfo, Meta, RegionGroup, RegionInfo } from '../types';

interface Props {
  country: CountryInfo;
  metas: Meta[];
  loading: boolean;
  categories: Category[];
  /** admin1-Regionen des Landes (null = noch nicht geladen) */
  regions: Map<string, RegionInfo> | null;
  selectedRegions: string[];
  onSelectRegions: (refs: string[]) => void;
  /** admin1-Regionen eines Metas (Gruppen aufgelöst) */
  metaRefs: (m: Meta) => string[];
  /** Gruppe, die genau der aktuellen Auswahl entspricht */
  activeGroup: RegionGroup | null;
  /** aktive Kategorie aus der Kategorie-Leiste über der Karte (null = alle) – filtert die Liste */
  activeCategory: number | null;
  onClearCategory: () => void;
  /** Anzeigename einer admin1-Region */
  refName: (ref: string) => string;
  /** ausgewähltes Meta (Klick auf die Karte in der Liste) – sein eingezeichneter Bereich wird gezeigt */
  selectedMetaId: number | null;
  onSelectMeta: (id: number | null) => void;
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
  country, metas, loading, categories, regions, selectedRegions, onSelectRegions, metaRefs,
  activeGroup, activeCategory, onClearCategory, refName, selectedMetaId, onSelectMeta, onAdd, onEdit, onDelete, onOpenImage,
}: Props) {
  const hasSelection = selectedRegions.length > 0;
  const regionName = refName;
  const metaRegionName = (r: Meta['regions'][number]) => (r.ref && regions?.get(r.ref)?.name) || r.name;

  // Sichtbare Metas: die der ausgewählten Region(en) – oder alle Metas des Landes
  const scoped = useMemo(
    () => (hasSelection ? metas.filter((m) => metaRefs(m).some((r) => selectedRegions.includes(r))) : metas),
    [metas, selectedRegions, hasSelection, metaRefs],
  );
  const visible = activeCategory == null ? scoped : scoped.filter((m) => m.category_id === activeCategory);
  const general = visible.filter((m) => m.regions.length === 0);
  const regional = visible.filter((m) => m.regions.length > 0);

  // Länderansicht: Regionen-Metas nach Regions-Kombination gruppieren („Kansai“, „Bayern, Sachsen“)
  const regionalGroups = useMemo(() => {
    const out = new Map<string, { refs: string[]; names: string[]; color: string | null; metas: Meta[] }>();
    for (const m of regional) {
      const names = m.regions.map(metaRegionName).sort((a, b) => a.localeCompare(b, 'de'));
      const key = names.join('|');
      const color = m.regions.length === 1 ? m.regions[0].color : null;
      const g = out.get(key) ?? { refs: metaRefs(m), names, color, metas: [] };
      g.metas.push(m);
      out.set(key, g);
    }
    return [...out.values()].sort((a, b) => a.names.length - b.names.length || a.names[0].localeCompare(b.names[0], 'de'));
  }, [regional, regions, metaRefs]);

  const activeCat = categories.find((c) => c.id === activeCategory) ?? null;

  const renderCards = (list: Meta[], showRegions: boolean) => (
    <div className="cards">
      {list.map((m) => (
        <article
          key={m.id}
          className={`card selectable ${selectedMetaId === m.id ? 'selected' : ''}`}
          onClick={() => onSelectMeta(selectedMetaId === m.id ? null : m.id)}
          title={m.area ? 'Klicken: eingezeichneten Bereich auf der Karte zeigen' : 'Klicken: auswählen'}
        >
          {m.images.length > 0 && (
            <div className="card-images">
              {m.images.map((img) => (
                <img key={img.id} src={img.url} alt={img.caption || m.title} loading="lazy"
                  onClick={(e) => { e.stopPropagation(); onOpenImage(img.url); }} />
              ))}
            </div>
          )}
          <div className="card-body">
            {m.title && <h4>{m.title}</h4>}
            {m.area && (
              <div className="card-area">
                🖌 {selectedMetaId === m.id ? 'Bereich auf der Karte' : 'mit eingezeichnetem Bereich – anklicken'}
              </div>
            )}
            {showRegions && m.regions.length > 0 && (
              <div className="card-regions">📍 {m.regions.map(metaRegionName).join(', ')}</div>
            )}
            {m.text && <p>{m.text}</p>}
          </div>
          <div className="card-actions">
            <button className="btn ghost small" onClick={(e) => { e.stopPropagation(); onEdit(m); }}>Bearbeiten</button>
            <button className="btn ghost small danger" onClick={(e) => { e.stopPropagation(); onDelete(m); }}>Löschen</button>
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <section className="panel">
      <header className="panel-head">
        {activeCat ? (
          <span className="filter-pill" title="Kategorie aus der Leiste über der Karte">
            {activeCat.name}
            <button onClick={onClearCategory} title="Filter aufheben – alle Kategorien zeigen">×</button>
          </span>
        ) : (
          <span className="muted">Alle Kategorien</span>
        )}
        <span className="muted">{visible.length} Metas</span>
        <button className="btn primary panel-add" onClick={onAdd}>
          {activeGroup
            ? `+ Meta für ${activeGroup.name}`
            : selectedRegions.length > 1 ? `+ Meta für ${selectedRegions.length} Regionen` : hasSelection ? '+ Regionen-Meta' : '+ Meta'}
        </button>
      </header>

      {hasSelection && (
        <div className="region-bar">
          <span className="region-pin">📍</span>
          {activeGroup ? (
            <>
              <strong>{activeGroup.name}</strong>
              <span className="muted">{selectedRegions.map(regionName).join(', ')}</span>
            </>
          ) : selectedRegions.length === 1 ? (
            (() => {
              const region = regions?.get(selectedRegions[0]);
              return (
                <>
                  <strong>{region?.name ?? regionName(selectedRegions[0])}</strong>
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
          <button className="btn ghost small" onClick={() => onSelectRegions([])}>× Ganzes Land</button>
        </div>
      )}

      <div className="panel-body">
        {loading && <p className="muted">Lade…</p>}
        {!loading && visible.length === 0 && (
          <div className="empty">
            {`Noch keine ${activeCat ? `„${activeCat.name}“-` : ''}Metas für ${
              hasSelection
                ? activeGroup?.name ?? (selectedRegions.length === 1 ? regionName(selectedRegions[0]) : 'diese Regionen')
                : country.name
            }.`}
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
                      {g.color && <i className="group-dot" style={{ background: g.color }} />}
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
