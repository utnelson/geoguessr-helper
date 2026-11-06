import type { MouseEvent } from 'react';
import { CONTINENTS, flagUrl } from '../geo';
import type { CountryInfo, Meta, RegionGroup } from '../types';

const continentName = (id: string) => CONTINENTS.find((c) => c.id === id)?.name ?? id;

interface CountryBarProps {
  country: CountryInfo;
  metas: Meta[];
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onBack: () => void;
}

/** Leiste über der Karte, wenn ein Land geöffnet ist: zurück, Flagge, Name, Anzahl Metas, Seitenleiste */
export function CountryBar({ country, metas, sidebarCollapsed, onToggleSidebar, onBack }: CountryBarProps) {
  const flag = flagUrl(country.iso);
  const general = metas.filter((m) => m.regions.length === 0).length;
  const regional = metas.length - general;
  return (
    <div className="country-bar">
      <button className="btn ghost small" onClick={onBack} title="Zurück zur Weltkarte">← Welt</button>
      {flag && <img className="flag" src={flag} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
      <div className="country-bar-title">
        <strong>{country.name}</strong>
        <span className="muted">
          {country.iso} · {continentName(country.continent)} · {general} Metas
          {regional > 0 && ` · ${regional} Regionen-Metas`}
        </span>
      </div>
      <button
        className="btn ghost small sidebar-toggle"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? 'Seitenleiste mit den Metas einblenden' : 'Seitenleiste einklappen – mehr Platz für die Karte'}
      >
        {sidebarCollapsed ? '⟨ Seitenleiste' : 'Seitenleiste ⟩'}
      </button>
    </div>
  );
}

interface GroupBarProps {
  groups: RegionGroup[];
  activeGroup: RegionGroup | null;
  selectedRegions: string[];
  onSelectRegions: (refs: string[]) => void;
  onNewGroup: () => void;
  onEditGroup: (g: RegionGroup) => void;
  /** > 0: Natural Earth schlägt so viele Gruppen vor (nur wenn noch keine existieren) */
  suggestedGroupCount: number;
  onSuggestGroups: () => void;
}

/** Regionsgruppen des Landes – unter der Länderleiste */
export function GroupBar({
  groups, activeGroup, selectedRegions, onSelectRegions, onNewGroup, onEditGroup, suggestedGroupCount, onSuggestGroups,
}: GroupBarProps) {
  const hasSelection = selectedRegions.length > 0;
  const clickGroup = (g: RegionGroup, e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) onSelectRegions([...new Set([...selectedRegions, ...g.members])]);
    else onSelectRegions(activeGroup?.id === g.id ? [] : g.members); // erneuter Klick hebt die Auswahl auf
  };

  // Nur zeigen, wenn es Gruppen gibt oder gerade eine angelegt/vorgeschlagen werden kann
  if (groups.length === 0 && !(hasSelection && selectedRegions.length > 1) && suggestedGroupCount === 0) return null;

  return (
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
      {hasSelection && !activeGroup && (
        <button className="btn ghost small" onClick={onNewGroup}>+ Gruppe aus Auswahl ({selectedRegions.length})</button>
      )}
      {suggestedGroupCount > 0 && (
        <button className="btn ghost small" onClick={onSuggestGroups} title="Gruppen aus Natural Earth übernehmen (danach anpassbar)">
          ✨ {suggestedGroupCount} Gruppen vorschlagen
        </button>
      )}
      {!hasSelection && groups.length > 0 && (
        <span className="muted small-hint">Strg+Klick auf Regionen → „+ Gruppe aus Auswahl“</span>
      )}
    </div>
  );
}
