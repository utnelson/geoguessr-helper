import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { CONTINENTS, GROUP_COLORS, loadCountries, loadRegions, type CountryCollection, type RegionData } from './geo';
import type { Category, CountryInfo, InfoItem, Meta, RegionGroup } from './types';
import { WorldMap } from './components/WorldMap';
import { CountryPanel } from './components/CountryPanel';
import { MetaForm } from './components/MetaForm';
import { GroupForm } from './components/GroupForm';
import { OptionsDrawer } from './components/OptionsDrawer';
import { Lightbox } from './components/Lightbox';

// Hash: #DE (Land) oder #DE/DEU-1591,DEU-1601 (Land + eine oder mehrere admin1-Regionen)
type Selection = { iso: string | null; regions: string[] };
function parseHash(): Selection {
  const [iso, regions] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { iso: iso?.toUpperCase() || null, regions: iso && regions ? regions.split(',').filter(Boolean) : [] };
}
const selectionHash = ({ iso, regions }: Selection) => (iso ? (regions.length ? `${iso}/${regions.join(',')}` : iso) : '');
const EMPTY_REGIONS: string[] = [];
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export default function App() {
  const [geo, setGeo] = useState<{ geojson: CountryCollection; countries: Map<string, CountryInfo> } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState(parseHash);
  const selectedIso = selection.iso;
  const selectedRegions = selection.iso ? selection.regions : EMPTY_REGIONS;
  const [regionData, setRegionData] = useState<RegionData | null>(null);
  const [groups, setGroups] = useState<RegionGroup[]>([]);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [loadingMetas, setLoadingMetas] = useState(false);
  const [editing, setEditing] = useState<{ meta: Meta | null; refs: string[]; groupIds: number[] } | null>(null);
  const [groupEditing, setGroupEditing] = useState<{ group: RegionGroup | null; members: string[] } | null>(null);
  const [infoCategory, setInfoCategory] = useState<number | null>(null);
  // Weltansicht: Kontinent-Filter, Welt-Infografik (landesweite Metas einer Kategorie), Ländernamen
  const [continentId, setContinentId] = useState<string | null>(() => localStorage.getItem('continent'));
  const [worldInfoCategory, setWorldInfoCategory] = useState<number | null>(null);
  const [worldMetas, setWorldMetas] = useState<Meta[]>([]);
  const [showLabels, setShowLabels] = useState(() => localStorage.getItem('labels') !== '0');
  const continent = CONTINENTS.find((c) => c.id === continentId) ?? null;
  // Ausgeschaltete Länder (Optionen) – nicht auswählbar, z.B. ohne GeoGuessr-Coverage
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar') === 'collapsed');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const refreshStats = useCallback(async () => {
    const s = await api.stats();
    setStats(Object.fromEntries(s.map((x) => [x.iso, x.count])));
  }, []);

  const loadCategories = useCallback(async () => {
    setCategories(await api.categories());
  }, []);

  useEffect(() => {
    loadCountries().then(setGeo).catch((e) => setError(e.message));
    loadCategories().catch((e) => setError(`API nicht erreichbar: ${e.message}`));
    api.settings().then((s) => setDisabled(new Set(s.disabled_countries))).catch(() => {});
    refreshStats().catch(() => {});
  }, [refreshStats, loadCategories]);

  useEffect(() => localStorage.setItem('sidebar', sidebarCollapsed ? 'collapsed' : 'open'), [sidebarCollapsed]);

  const saveDisabled = async (isos: string[]) => {
    try {
      const s = await api.saveSettings({ disabled_countries: isos });
      setDisabled(new Set(s.disabled_countries));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Auswahl ↔ URL-Hash (#DE), damit Links und Zurück-Button funktionieren
  useEffect(() => {
    const onHash = () => {
      const next = parseHash();
      setSelection((cur) => (selectionHash(cur) === selectionHash(next) ? cur : next));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const select = (iso: string | null, regions: string[] = []) => {
    const next = { iso, regions: iso ? regions : [] };
    const hash = selectionHash(next);
    if (decodeURIComponent(location.hash.slice(1)) !== hash) location.hash = hash;
    setSelection(next);
  };
  const selectRegions = (regions: string[]) => select(selectedIso, regions);

  const loadMetas = useCallback(async (iso: string) => {
    setLoadingMetas(true);
    try {
      setMetas(await api.countryMetas(iso));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMetas(false);
    }
  }, []);

  const loadGroups = useCallback(async (iso: string) => {
    try {
      const all = await api.countryRegions(iso);
      setGroups(all.filter((r): r is RegionGroup => r.source === 'group'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    setMetas([]);
    setGroups([]);
    setInfoCategory(null);
    if (selectedIso) {
      loadMetas(selectedIso);
      loadGroups(selectedIso);
    }
  }, [selectedIso, loadMetas, loadGroups]);

  useEffect(() => {
    if (continentId) localStorage.setItem('continent', continentId);
    else localStorage.removeItem('continent');
  }, [continentId]);
  useEffect(() => localStorage.setItem('labels', showLabels ? '1' : '0'), [showLabels]);

  // Welt-Infografik: landesweite Metas der Kategorie laden (auch nach Rückkehr aus einem Land)
  useEffect(() => {
    if (worldInfoCategory == null || selectedIso) return;
    let cancelled = false;
    api.categoryMetas(worldInfoCategory)
      .then((m) => !cancelled && setWorldMetas(m))
      .catch((e) => setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [worldInfoCategory, selectedIso]);

  // admin1-Grenzen des Landes nachladen (werden gecacht)
  useEffect(() => {
    if (!selectedIso) return;
    let cancelled = false;
    loadRegions(selectedIso)
      .then((d) => !cancelled && setRegionData(d))
      .catch(() => !cancelled && setRegionData({
        iso: selectedIso, geojson: { type: 'FeatureCollection', features: [] }, regions: new Map(), features: new Map(),
      }));
    return () => {
      cancelled = true;
    };
  }, [selectedIso]);

  const currentRegionData = regionData && regionData.iso === selectedIso ? regionData : null;
  const regions = currentRegionData?.regions ?? null;

  // admin1-Regionen eines Metas – Gruppen werden in ihre Mitglieder aufgelöst
  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const metaRefs = useCallback(
    (m: Meta) => [...new Set(m.regions.flatMap((r) => (r.ref ? [r.ref] : groupsById.get(r.id)?.members ?? [])))],
    [groupsById],
  );

  // Anzahl Metas pro admin1-Region (für die Einfärbung)
  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of metas) for (const ref of metaRefs(m)) counts[ref] = (counts[ref] ?? 0) + 1;
    return counts;
  }, [metas, metaRefs]);

  // Gruppe, deren Mitglieder genau der aktuellen Auswahl entsprechen
  const activeGroup = selectedRegions.length ? groups.find((g) => sameSet(g.members, selectedRegions)) ?? null : null;

  // Infografik: ein Kasten pro Meta der gewählten Kategorie
  const infographic = useMemo<InfoItem[] | null>(() => {
    if (infoCategory == null) return null;
    let next = 0;
    return metas
      .filter((m) => m.category_id === infoCategory)
      .map((m) => {
        const onlyGroup = m.regions.length === 1 && m.regions[0].source === 'group' ? m.regions[0] : null;
        const color = m.regions.length === 0
          ? '#ffffff'
          : onlyGroup?.color ?? GROUP_COLORS[next++ % GROUP_COLORS.length];
        return {
          key: String(m.id),
          color,
          refs: metaRefs(m),
          label: m.regions.length ? m.regions.map((r) => (r.ref && regions?.get(r.ref)?.name) || r.name).join(', ') : 'Landesweit',
          title: m.title,
          text: m.text,
          image: m.images[0]?.url ?? null,
        };
      });
  }, [infoCategory, metas, metaRefs, regions]);

  // Ausgeschaltete Länder lassen sich nicht öffnen (auch nicht per Link)
  const country = selectedIso && geo && !disabled.has(selectedIso) ? geo.countries.get(selectedIso) ?? null : null;

  // Welt-Infografik: ein Kasten pro Land (bzw. Meta), Linie zum Land, Land in Kastenfarbe
  const worldInfographic = useMemo<InfoItem[] | null>(() => {
    if (worldInfoCategory == null || !geo) return null;
    const colorOf = new Map<string, string>();
    const items: InfoItem[] = [];
    for (const m of worldMetas) {
      if (m.category_id !== worldInfoCategory) continue;
      const c = geo.countries.get(m.country_iso);
      if (!c || disabled.has(c.iso) || (continent && c.continent !== continent.id)) continue;
      if (!colorOf.has(c.iso)) colorOf.set(c.iso, GROUP_COLORS[colorOf.size % GROUP_COLORS.length]);
      items.push({
        key: String(m.id),
        iso: c.iso,
        anchor: c.label,
        color: colorOf.get(c.iso)!,
        refs: [],
        label: c.name,
        title: m.title,
        text: m.text,
        image: m.images[0]?.url ?? null,
      });
    }
    return items;
  }, [worldInfoCategory, worldMetas, geo, continent, disabled]);

  const countryList = useMemo(
    () =>
      geo
        ? [...geo.countries.values()].filter((c) => !disabled.has(c.iso)).sort((a, b) => a.name.localeCompare(b.name, 'de'))
        : [],
    [geo, disabled],
  );

  const jumpTo = (value: string) => {
    const v = value.trim().toLowerCase();
    const hit = countryList.find(
      (c) => c.name.toLowerCase() === v || c.nameEn.toLowerCase() === v || c.iso.toLowerCase() === v,
    );
    if (hit) {
      select(hit.iso);
      setSearch('');
    }
  };

  const deleteMeta = async (m: Meta) => {
    if (!confirm(`„${m.title || m.category_name}“ wirklich löschen?`)) return;
    await api.deleteMeta(m.id);
    if (selectedIso) await loadMetas(selectedIso);
    await refreshStats();
  };

  const onSaved = async () => {
    setEditing(null);
    if (selectedIso) await loadMetas(selectedIso);
    await refreshStats();
  };

  // Gruppen aus Natural-Earth-Regionen vorschlagen (z.B. Japan: Tohoku, Kanto, …)
  const suggestedGroups = useMemo(() => {
    const byName = new Map<string, string[]>();
    for (const r of regions?.values() ?? []) {
      if (!r.group) continue;
      byName.set(r.group, [...(byName.get(r.group) ?? []), r.id]);
    }
    return byName.size >= 2 ? [...byName.entries()] : [];
  }, [regions]);

  const applySuggestedGroups = async () => {
    if (!selectedIso) return;
    const unassigned = [...(regions?.values() ?? [])].filter((r) => !r.group).map((r) => r.name);
    const msg =
      `${suggestedGroups.length} Gruppen anlegen?\n\n${suggestedGroups.map(([n, refs]) => `${n} (${refs.length})`).join(', ')}` +
      (unassigned.length ? `\n\nOhne Gruppe (bitte selbst zuordnen): ${unassigned.join(', ')}` : '') +
      '\n\nDu kannst die Gruppen danach umbenennen, Farben ändern und Regionen verschieben.';
    if (!confirm(msg)) return;
    try {
      let i = groups.length;
      for (const [name, members] of suggestedGroups) {
        await api.createGroup(selectedIso, { name, members, color: GROUP_COLORS[i++ % GROUP_COLORS.length] });
      }
    } catch (e) {
      setError((e as Error).message);
    }
    await loadGroups(selectedIso);
  };

  const onGroupSaved = async (g: RegionGroup | null) => {
    setGroupEditing(null);
    if (!selectedIso) return;
    await Promise.all([loadGroups(selectedIso), loadMetas(selectedIso)]);
    if (g) selectRegions(g.members);
  };

  const totalMetas = Object.values(stats).reduce((a, b) => a + b, 0);

  return (
    <div className={`app ${country ? 'has-country' : ''} ${(country ? infographic : worldInfographic) ? 'infographic' : ''}`}>
      <header className="topbar">
        <h1>🌍 GeoGuessr Helper</h1>
        <span className="muted">{Object.keys(stats).length} Länder · {totalMetas} Metas</span>
        <input
          className="search"
          list="country-list"
          placeholder="Land suchen…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            jumpTo(e.target.value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && jumpTo(search)}
        />
        <datalist id="country-list">
          {countryList.map((c) => <option key={c.iso} value={c.name} />)}
        </datalist>
        <button className="btn ghost" onClick={() => setOptionsOpen((v) => !v)} title="Optionen: Länder, Kategorien">⚙ Optionen</button>
      </header>

      {error && <div className="banner" onClick={() => setError(null)}>{error}</div>}

      {!country && geo && (
        <div className="world-bar">
          <div className="chips">
            <button className={`chip ${!continent ? 'active' : ''}`} onClick={() => setContinentId(null)}>Welt</button>
            {CONTINENTS.map((c) => (
              <button key={c.id} className={`chip ${continent?.id === c.id ? 'active' : ''}`} onClick={() => setContinentId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
          <label className="world-info">
            🗺 Infografik:
            <select
              value={worldInfoCategory ?? ''}
              onChange={(e) => setWorldInfoCategory(e.target.value ? Number(e.target.value) : null)}
              title="Landesweite Metas einer Kategorie als Infografik zeigen"
            >
              <option value="">aus</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {worldInfographic && (
            <span className="muted">
              {worldInfographic.length
                ? `${new Set(worldInfographic.map((i) => i.iso)).size} Länder · Kasten anklicken öffnet das Land`
                : `Noch keine landesweiten Metas dieser Kategorie${continent ? ` in ${continent.name}` : ''}`}
            </span>
          )}
        </div>
      )}

      <div className={`main ${country && !sidebarCollapsed ? 'with-sidebar' : ''}`}>
      {country && sidebarCollapsed && (
        <button className="sidebar-expand" onClick={() => setSidebarCollapsed(false)} title="Seitenleiste einblenden">
          ⟨ <span>{country.name}</span>
        </button>
      )}
      {country && !sidebarCollapsed && (
        <CountryPanel
          onCollapse={() => setSidebarCollapsed(true)}
          country={country}
          metas={metas}
          loading={loadingMetas}
          categories={categories}
          onClose={() => select(null)}
          regions={regions}
          regionCounts={regionCounts}
          selectedRegions={selectedRegions}
          onSelectRegions={selectRegions}
          metaRefs={metaRefs}
          groups={groups}
          activeGroup={activeGroup}
          suggestedGroupCount={groups.length === 0 ? suggestedGroups.length : 0}
          onSuggestGroups={applySuggestedGroups}
          onNewGroup={() => setGroupEditing({ group: null, members: selectedRegions })}
          onEditGroup={(g) => setGroupEditing({ group: g, members: g.members })}
          infoCategory={infoCategory}
          onInfographic={setInfoCategory}
          onAdd={() =>
            setEditing(
              activeGroup
                ? { meta: null, refs: [], groupIds: [activeGroup.id] }
                : { meta: null, refs: selectedRegions, groupIds: [] },
            )
          }
          onEdit={(m) => setEditing({ meta: m, refs: [], groupIds: [] })}
          onDelete={deleteMeta}
          onOpenImage={setLightbox}
        />
      )}

      {geo ? (
        <WorldMap
          geojson={geo.geojson}
          countries={geo.countries}
          stats={stats}
          selectedIso={country ? selectedIso : null}
          onSelect={select}
          regionData={country ? regionData : null}
          regionCounts={regionCounts}
          selectedRegions={selectedRegions}
          onSelectRegions={selectRegions}
          infographic={country ? infographic : worldInfographic}
          onOpenImage={setLightbox}
          continent={continent}
          showLabels={showLabels}
          onToggleLabels={() => setShowLabels((v) => !v)}
          disabled={disabled}
        />
      ) : (
        <div className="map-wrap loading">Lade Karte…</div>
      )}

      {editing && country && (
        <MetaForm
          country={country}
          categories={categories}
          meta={editing.meta}
          regions={regions}
          groups={groups}
          initialRegionRefs={editing.refs}
          initialGroupIds={editing.groupIds}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onCategoryCreated={(c) => setCategories((cs) => [...cs, c])}
        />
      )}
      {groupEditing && country && (
        <GroupForm
          country={country}
          regions={regions}
          groups={groups}
          group={groupEditing.group}
          initialMembers={groupEditing.members}
          onClose={() => setGroupEditing(null)}
          onSaved={onGroupSaved}
          onError={setError}
        />
      )}
      {optionsOpen && geo && (
        <OptionsDrawer
          countries={geo.countries}
          disabled={disabled}
          stats={stats}
          onDisabledChange={saveDisabled}
          categories={categories}
          onCategoriesChanged={async () => {
            await loadCategories();
            if (selectedIso) await loadMetas(selectedIso);
          }}
          onClose={() => setOptionsOpen(false)}
        />
      )}
      </div>
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
