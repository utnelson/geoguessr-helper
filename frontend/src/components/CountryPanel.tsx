import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { Category, CountryInfo, Meta, RegionGroup, RegionInfo } from '../types';
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
  /** admin1-Regionen eines Metas (Gruppen aufgelöst) */
  metaRefs: (m: Meta) => string[];
  groups: RegionGroup[];
  /** Gruppe, die genau der aktuellen Auswahl entspricht */
  activeGroup: RegionGroup | null;
  /** > 0: Natural Earth schlägt so viele Gruppen vor (nur wenn noch keine existieren) */
  suggestedGroupCount: number;
  onSuggestGroups: () => void;
  onNewGroup: () => void;
  onEditGroup: (g: RegionGroup) => void;
  /** Kategorie der Infografik-Ansicht (null = aus) */
  infoCategory: number | null;
  onInfographic: (categoryId: number | null) => void;
  onClose: () => void;
  onCollapse: () => void;
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
  country, metas, loading, categories, regions, regionCounts, selectedRegions, onSelectRegions, metaRefs,
  groups, activeGroup, suggestedGroupCount, onSuggestGroups, onNewGroup, onEditGroup, infoCategory, onInfographic,
  onClose, onCollapse, onAdd, onEdit, onDelete, onOpenImage,
}: Props) {
  const [filter, setFilter] = useState<number | 'all'>(infoCategory ?? 'all');
  const flag = flagUrl(country.iso);
  const hasSelection = selectedRegions.length > 0;
  const regionName = (ref: string) => regions?.get(ref)?.name ?? ref;
  const metaRegionName = (r: Meta['regions'][number]) => (r.ref && regions?.get(r.ref)?.name) || r.name;

  // Infografik folgt dem Kategorie-Filter
  useEffect(() => {
    if (infoCategory != null && filter !== infoCategory) onInfographic(filter === 'all' ? null : filter);
  }, [filter, infoCategory, onInfographic]);

  // Sichtbare Metas: die der ausgewählten Region(en) – oder alle Metas des Landes
  const scoped = useMemo(
    () => (hasSelection ? metas.filter((m) => metaRefs(m).some((r) => selectedRegions.includes(r))) : metas),
    [metas, selectedRegions, hasSelection, metaRefs],
  );
  const visible = filter === 'all' ? scoped : scoped.filter((m) => m.category_id === filter);
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

  const usedCategories = categories.filter((c) => scoped.some((m) => m.category_id === c.id));
  const generalCount = metas.filter((m) => m.regions.length === 0).length;
  const regionalCount = metas.length - generalCount;

  const regionList = useMemo(
    () => (regions ? [...regions.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')) : []),
    [regions],
  );

  const clickGroup = (g: RegionGroup, e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) onSelectRegions([...new Set([...selectedRegions, ...g.members])]);
    else onSelectRegions(g.members);
  };

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
            {m.title && <h4>{m.title}</h4>}
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

  const infoCat = categories.find((c) => c.id === infoCategory);

  return (
    <section className="panel">
      <header className="panel-head">
        <button className="btn ghost" onClick={onClose} title="Zurück zur Weltkarte">← Welt</button>
        <button className="btn ghost collapse-btn" onClick={onCollapse} title="Seitenleiste einklappen – mehr Platz für die Karte">⟩</button>
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
              <option value="__multi" disabled>{activeGroup ? activeGroup.name : `${selectedRegions.length} Regionen ausgewählt`}</option>
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
          {filter !== 'all' && regionalCount > 0 && (
            <button
              className={`chip info-toggle ${infoCategory === filter ? 'active' : ''}`}
              onClick={() => onInfographic(infoCategory === filter ? null : filter)}
              title="Metas dieser Kategorie als Infografik auf der Karte zeigen"
            >
              🗺 Infografik
            </button>
          )}
        </div>
        <button className="btn primary" onClick={onAdd}>
          {activeGroup
            ? `+ Meta für ${activeGroup.name}`
            : selectedRegions.length > 1 ? `+ Meta für ${selectedRegions.length} Regionen` : hasSelection ? '+ Regionen-Meta' : '+ Meta'}
        </button>
      </header>

      {regionList.length > 0 && (
        <div className="group-bar">
          <span className="muted">Gruppen:</span>
          {groups.map((g) => (
            <span key={g.id} className={`group-chip ${activeGroup?.id === g.id ? 'active' : ''}`} style={{ ['--c' as string]: g.color ?? '#888' }}>
              <button className="group-chip-name" onClick={(e) => clickGroup(g, e)} title={`${g.members.length} Regionen – Strg+Klick: dazunehmen`}>
                <i />{g.name}
              </button>
              <button className="group-chip-edit" onClick={() => onEditGroup(g)} title="Gruppe bearbeiten">✎</button>
            </span>
          ))}
          {groups.length === 0 && <span className="muted">noch keine</span>}
          {hasSelection && !activeGroup && (
            <button className="btn ghost small" onClick={onNewGroup}>+ Gruppe aus Auswahl ({selectedRegions.length})</button>
          )}
          {!hasSelection && groups.length > 0 && (
            <span className="muted small-hint">Strg+Klick auf Regionen → „+ Gruppe aus Auswahl“</span>
          )}
          {suggestedGroupCount > 0 && (
            <button className="btn ghost small" onClick={onSuggestGroups} title="Gruppen aus Natural Earth übernehmen (danach anpassbar)">
              ✨ {suggestedGroupCount} Gruppen vorschlagen
            </button>
          )}
          {groups.length === 0 && !hasSelection && suggestedGroupCount === 0 && (
            <span className="muted small-hint">Regionen mit Strg+Klick markieren → „+ Gruppe aus Auswahl“</span>
          )}
        </div>
      )}

      {infoCat && (
        <div className="info-bar">
          <strong>🗺 Infografik: {infoCat.name}</strong>
          <span className="muted">Jedes Meta ist mit seinen Regionen verbunden · Bild anklicken zum Vergrößern · Karte verschieben/zoomen ordnet die Kästen neu</span>
          <button className="btn ghost small" onClick={() => onInfographic(null)}>× Beenden</button>
        </div>
      )}

      {hasSelection && !infoCat && (
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
          <span className="muted">{scoped.length} Metas</span>
          <button className="btn ghost small" onClick={() => onSelectRegions([])}>× Ganzes Land</button>
        </div>
      )}

      <div className="panel-body">
        {loading && <p className="muted">Lade…</p>}
        {!loading && scoped.length === 0 && (
          <div className="empty">
            {hasSelection
              ? `Noch keine Metas für ${activeGroup?.name ?? (selectedRegions.length === 1 ? regionName(selectedRegions[0]) : 'diese Regionen')}.`
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
