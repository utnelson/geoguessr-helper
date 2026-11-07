import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MultiPolygon } from 'geojson';
import { api } from './api';
import { CONTINENTS, GROUP_COLORS, geometryInfo, loadCountries, loadRegions, type CountryCollection, type RegionData } from './geo';
import type {
  Attribute, AttributeValueRow, Category, CountryInfo, DrawSettings, Filter, FilterStatus, InfoItem, Meta, MetaArea, RegionGroup,
  SearchHit,
} from './types';
import { computeFilter } from './filters';
import { SearchBox } from './components/SearchBox';
import { ActiveFilterBar, FilterPanel } from './components/FilterPanel';
import { VisionDrawer } from './components/VisionDrawer';
import { WorldMap, type DrawApi } from './components/WorldMap';
import { CountryPanel } from './components/CountryPanel';
import { CategoryBar, CountryBar, GroupBar } from './components/CountryBar';
import { AREA_COLOR, MetaForm } from './components/MetaForm';
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
  // Pinsel im Meta-Formular (Zeichenmodus auf der Karte) und ausgewähltes Meta in der Seitenleiste
  const [drawing, setDrawing] = useState<DrawSettings | null>(null);
  const [selectedMetaId, setSelectedMetaId] = useState<number | null>(null);
  const drawApi = useRef<DrawApi | null>(null);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [loadingMetas, setLoadingMetas] = useState(false);
  const [editing, setEditing] = useState<{ meta: Meta | null; refs: string[]; groupIds: number[] } | null>(null);
  const [groupEditing, setGroupEditing] = useState<{ group: RegionGroup | null; members: string[] } | null>(null);
  // Aktive Kategorie (Buttons über der Karte): zeigt die Infografik und filtert die Seitenleiste.
  // Gilt für Welt und Land gleichermaßen – beim Öffnen eines Landes bleibt sie erhalten.
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  // Weltansicht: Kontinent-Filter, Welt-Infografik (landesweite Metas einer Kategorie), Ländernamen
  const [continentId, setContinentId] = useState<string | null>(() => localStorage.getItem('continent'));
  const [worldMetas, setWorldMetas] = useState<Meta[]>([]);
  const [showLabels, setShowLabels] = useState(() => localStorage.getItem('labels') !== '0');
  const continent = CONTINENTS.find((c) => c.id === continentId) ?? null;
  // Ausgeschaltete Länder (Optionen) – nicht auswählbar, z.B. ohne GeoGuessr-Coverage
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar') === 'collapsed');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rückwärtssuche: Merkmale, vergebene Werte, aktive Filter, Klappmenü
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [attributeRows, setAttributeRows] = useState<AttributeValueRow[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [optionsTab, setOptionsTab] = useState<'countries' | 'attributes'>('countries');
  // Volltextsuche: Länder mit Treffern (Kartenmarkierung) und Meta, das nach dem Öffnen ausgewählt wird
  const [searchHits, setSearchHits] = useState<Set<string> | null>(null);
  const [pendingMetaId, setPendingMetaId] = useState<number | null>(null);
  // Bilderkennung (CLIP/OCR): Drawer + vorgeschlagene Länder auf der Karte
  const [visionOpen, setVisionOpen] = useState(false);
  const [visionMarks, setVisionMarks] = useState<Set<string> | null>(null);

  const refreshStats = useCallback(async () => {
    const s = await api.stats();
    setStats(Object.fromEntries(s.map((x) => [x.iso, x.count])));
  }, []);

  const loadAttributes = useCallback(async () => {
    const [a, rows] = await Promise.all([api.attributes(), api.attributeValues()]);
    setAttributes(a);
    setAttributeRows(rows);
    // Filter auf gelöschte Merkmale/Werte verwerfen
    setFilters((f) => f.filter((x) => a.some((y) => y.id === x.attribute_id && y.values.includes(x.value))));
  }, []);

  const loadCategories = useCallback(async () => {
    setCategories(await api.categories());
  }, []);

  useEffect(() => {
    loadCountries().then(setGeo).catch((e) => setError(e.message));
    loadCategories().catch((e) => setError(`API nicht erreichbar: ${e.message}`));
    loadAttributes().catch(() => {});
    api.settings().then((s) => setDisabled(new Set(s.disabled_countries))).catch(() => {});
    refreshStats().catch(() => {});
  }, [refreshStats, loadCategories, loadAttributes]);

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
    setDrawing(null);
    setSelectedMetaId(null);
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
    if (activeCategory == null || selectedIso) return;
    let cancelled = false;
    api.categoryMetas(activeCategory)
      .then((m) => !cancelled && setWorldMetas(m))
      .catch((e) => setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [activeCategory, selectedIso]);

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
    (m: Meta) => [
      ...new Set(
        m.regions.flatMap((r) => (r.ref ? [r.ref] : groupsById.get(r.id)?.members ?? [])),
      ),
    ],
    [groupsById],
  );

  // Anzahl Metas pro admin1-Region (für die Einfärbung)
  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of metas) for (const ref of metaRefs(m)) counts[ref] = (counts[ref] ?? 0) + 1;
    return counts;
  }, [metas, metaRefs]);

  // Eingezeichnete Bereiche (Pinsel) je Meta
  const metaAreas = useMemo(() => {
    const out = new Map<number, MetaArea>();
    for (const m of metas) {
      if (!m.area) continue;
      try {
        const geometry = JSON.parse(m.area) as MultiPolygon;
        out.set(m.id, { geometry, ...geometryInfo(geometry) });
      } catch {
        /* kaputte Geometrie ignorieren */
      }
    }
    return out;
  }, [metas]);
  const selectedArea = selectedMetaId != null ? metaAreas.get(selectedMetaId) ?? null : null;

  // Gruppe, deren Mitglieder genau der aktuellen Auswahl entsprechen
  const activeGroup = selectedRegions.length ? groups.find((g) => sameSet(g.members, selectedRegions)) ?? null : null;

  // Infografik: ein Kasten pro Meta der gewählten Kategorie
  const infographic = useMemo<InfoItem[] | null>(() => {
    if (activeCategory == null) return null;
    let next = 0;
    const items = metas
      .filter((m) => m.category_id === activeCategory)
      .map((m) => {
        // Ein Meta mit genau einer Gruppe bekommt deren Farbe
        const onlyGroup = m.regions.length === 1 && m.regions[0].source !== 'admin1' ? m.regions[0] : null;
        const refs = metaRefs(m);
        // Eingezeichneter Bereich → Linie zeigt dorthin (genauer als die Regionen)
        const area = metaAreas.get(m.id);
        const color = m.regions.length === 0 && !area
          ? '#ffffff'
          : onlyGroup?.color ?? GROUP_COLORS[next++ % GROUP_COLORS.length];
        return {
          key: String(m.id),
          color,
          refs,
          anchor: area?.anchor,
          areaId: area ? m.id : undefined,
          label: m.regions.length
            ? m.regions.map((r) => (r.ref && regions?.get(r.ref)?.name) || r.name).join(', ')
            : area ? '🖌 Bereich' : 'Landesweit',
          title: m.title,
          text: m.text,
          images: m.images.map((i) => i.url),
        };
      });
    return items.length ? items : null; // keine Metas dieser Kategorie im Land → normale Karte
  }, [activeCategory, metas, metaRefs, regions, metaAreas]);

  // Sichtbare Bereiche auf der Karte: nur das ausgewählte Meta – und in der Infografik die Bereiche ihrer Metas
  const visibleAreas = useMemo(() => {
    const out: { id: number; color: string; geometry: MultiPolygon }[] = [];
    for (const item of infographic ?? []) {
      const a = item.areaId != null ? metaAreas.get(item.areaId) : undefined;
      if (a && item.areaId !== selectedMetaId) out.push({ id: item.areaId!, color: item.color, geometry: a.geometry });
    }
    if (selectedArea && selectedMetaId != null) out.push({ id: selectedMetaId, color: AREA_COLOR, geometry: selectedArea.geometry });
    return out;
  }, [infographic, metaAreas, selectedArea, selectedMetaId]);

  const refName = useCallback((ref: string) => regions?.get(ref)?.name ?? ref, [regions]);

  // Anzahl Metas je Kategorie im geöffneten Land (für die Kategorie-Leiste)
  const countryCategoryCounts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const m of metas) c[m.category_id] = (c[m.category_id] ?? 0) + 1;
    return c;
  }, [metas]);
  // … und landesweite Metas je Kategorie weltweit (Welt-Infografik)
  const worldCategoryCounts = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.general_count ?? 0])),
    [categories],
  );

  // Ausgeschaltete Länder lassen sich nicht öffnen (auch nicht per Link)
  const country = selectedIso && geo && !disabled.has(selectedIso) ? geo.countries.get(selectedIso) ?? null : null;

  // Rückwärtssuche: welche Länder passen zu den gewählten Merkmalen?
  const filterResult = useMemo(() => {
    if (!geo || filters.length === 0) return null;
    const isos = [...geo.countries.keys()].filter((iso) => !disabled.has(iso));
    return computeFilter(attributeRows, filters, isos);
  }, [geo, filters, attributeRows, disabled]);
  // Karte: Filter-Status je Land – sonst Vorschläge der Bilderkennung oder Treffer der Volltextsuche
  const markHits = visionMarks ?? searchHits;
  const countryMarks = useMemo<Map<string, FilterStatus> | null>(() => {
    if (filterResult) return filterResult.status;
    if (markHits) return new Map([...markHits].map((iso) => [iso, 'match' as const]));
    return null;
  }, [filterResult, markHits]);
  const marksLabel = filterResult ? null : visionMarks ? 'Vorschlag der Bilderkennung' : searchHits ? 'Treffer der Suche' : null;

  // Welt-Infografik: ein Kasten pro Land (bzw. Meta), Linie zum Land, Land in Kastenfarbe
  const worldInfographic = useMemo<InfoItem[] | null>(() => {
    if (activeCategory == null || !geo) return null;
    const colorOf = new Map<string, string>();
    const items: InfoItem[] = [];
    for (const m of worldMetas) {
      if (m.category_id !== activeCategory) continue;
      const c = geo.countries.get(m.country_iso);
      if (!c || disabled.has(c.iso) || (continent && c.continent !== continent.id)) continue;
      if (filterResult && filterResult.status.get(c.iso) !== 'match') continue; // mit Filtern: nur passende Länder
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
        images: m.images.map((i) => i.url),
      });
    }
    return items;
  }, [activeCategory, worldMetas, geo, continent, disabled, filterResult]);

  const countryList = useMemo(
    () =>
      geo
        ? [...geo.countries.values()].filter((c) => !disabled.has(c.iso)).sort((a, b) => a.name.localeCompare(b.name, 'de'))
        : [],
    [geo, disabled],
  );

  // Treffer der Volltextsuche öffnen: Land öffnen, Meta auswählen sobald geladen
  const openMeta = (hit: SearchHit) => {
    if (hit.country_iso !== selectedIso) select(hit.country_iso);
    setPendingMetaId(hit.id);
  };
  useEffect(() => {
    if (pendingMetaId == null || !metas.some((m) => m.id === pendingMetaId)) return;
    setSelectedMetaId(pendingMetaId);
    setSidebarCollapsed(false);
    setPendingMetaId(null);
    // in der Seitenleiste hinscrollen
    setTimeout(() => document.querySelector('.card.selected')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
  }, [pendingMetaId, metas]);

  const deleteMeta = async (m: Meta) => {
    if (!confirm(`„${m.title || m.category_name}“ wirklich löschen?`)) return;
    await api.deleteMeta(m.id);
    if (selectedIso) await loadMetas(selectedIso);
    await Promise.all([refreshStats(), loadCategories(), loadAttributes()]);
  };

  const onSaved = async () => {
    setEditing(null);
    setDrawing(null);
    if (selectedIso) await loadMetas(selectedIso);
    await Promise.all([refreshStats(), loadCategories(), loadAttributes()]);
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
        {geo && (
          <SearchBox
            countries={countryList}
            countryNames={geo.countries}
            onOpenCountry={(iso) => select(iso)}
            onOpenMeta={openMeta}
            onHitsChange={setSearchHits}
          />
        )}
        <button
          className={`btn ${visionOpen ? 'primary' : 'ghost'}`}
          onClick={() => {
            setVisionOpen((v) => !v);
            setOptionsOpen(false);
          }}
          title="Bilderkennung: Screenshot einfügen → ähnliche Bilder (CLIP) oder Schrift lesen (OCR)"
        >
          📷 Bild
        </button>
        <button
          className={`btn ${filterOpen || filters.length ? 'primary' : 'ghost'} filter-toggle`}
          onClick={() => setFilterOpen((v) => !v)}
          title="Rückwärtssuche: Merkmale anklicken, passende Länder finden"
        >
          🔎 Filter{filters.length > 0 && <span className="badge">{filters.length}</span>}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            setOptionsTab('countries');
            setOptionsOpen((v) => !v);
          }}
          title="Optionen: Länder, Kategorien, Merkmale, Backup"
        >
          ⚙ Optionen
        </button>
      </header>
      <ActiveFilterBar
        attributes={attributes}
        categories={categories}
        filters={filters}
        onChange={setFilters}
        matchCount={filterResult?.match.length ?? 0}
        onOpen={() => setFilterOpen(true)}
      />

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
          {activeCategory != null && worldInfographic && (
            <span className="muted">
              {worldInfographic.length
                ? `${new Set(worldInfographic.map((i) => i.iso)).size} Länder · Kasten anklicken öffnet das Land`
                : `Noch keine landesweiten Metas dieser Kategorie${continent ? ` in ${continent.name}` : ''}`}
            </span>
          )}
        </div>
      )}
      {!country && geo && (
        <CategoryBar
          categories={categories}
          counts={worldCategoryCounts}
          active={activeCategory}
          onSelect={setActiveCategory}
          emptyHint="Noch keine landesweiten Metas – Land anklicken und „+ Meta“"
        />
      )}

      <div className={`main ${country && !sidebarCollapsed ? 'with-sidebar' : ''}`}>
      {country && !sidebarCollapsed && (
        <CountryPanel
          country={country}
          metas={metas}
          loading={loadingMetas}
          categories={categories}
          regions={regions}
          selectedRegions={selectedRegions}
          onSelectRegions={selectRegions}
          metaRefs={metaRefs}
          activeGroup={activeGroup}
          activeCategory={activeCategory}
          onClearCategory={() => setActiveCategory(null)}
          refName={refName}
          selectedMetaId={selectedMetaId}
          onSelectMeta={setSelectedMetaId}
          filterMatchIds={filterResult?.matchingMetaIds ?? null}
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

      {/* Kartenspalte: bei geöffnetem Land oben Länder- und Gruppenleiste */}
      <div className="map-col">
      {country && (
        <CountryBar
          country={country}
          metas={metas}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          onBack={() => select(null)}
        />
      )}
      {country && (
        <GroupBar
          groups={groups}
          activeGroup={activeGroup}
          selectedRegions={selectedRegions}
          onSelectRegions={selectRegions}
          onNewGroup={() => setGroupEditing({ group: null, members: selectedRegions })}
          onEditGroup={(g) => setGroupEditing({ group: g, members: g.members })}
          suggestedGroupCount={groups.length === 0 ? suggestedGroups.length : 0}
          onSuggestGroups={applySuggestedGroups}
        />
      )}
      {country && (
        <CategoryBar
          categories={categories}
          counts={countryCategoryCounts}
          active={activeCategory}
          onSelect={setActiveCategory}
          emptyHint={`Noch keine Metas für ${country.name}`}
        />
      )}
      <div className="map-area">
      {filterOpen && geo && (
        <FilterPanel
          categories={categories}
          attributes={attributes}
          rows={attributeRows}
          filters={filters}
          onChange={setFilters}
          result={filterResult}
          countries={geo.countries}
          continentId={!country ? continent?.id ?? null : null}
          onOpenCountry={(iso) => select(iso)}
          onClose={() => setFilterOpen(false)}
          onManage={() => {
            setOptionsTab('attributes');
            setOptionsOpen(true);
          }}
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
          metaAreas={country ? visibleAreas : []}
          focusBBox={country ? selectedArea?.bbox ?? null : null}
          drawing={country ? drawing : null}
          drawApi={drawApi}
          marks={countryMarks}
          marksLabel={marksLabel}
        />
      ) : (
        <div className="map-wrap loading">Lade Karte…</div>
      )}
      </div>
      </div>

      {editing && country && (
        <MetaForm
          country={country}
          categories={categories}
          meta={editing.meta}
          initialCategoryId={activeCategory}
          attributes={attributes}
          onAttributesChanged={loadAttributes}
          regions={regions}
          groups={groups}
          initialRegionRefs={editing.refs}
          initialGroupIds={editing.groupIds}
          drawing={drawing}
          onDrawingChange={setDrawing}
          drawApi={drawApi}
          onClose={() => {
            setEditing(null);
            setDrawing(null);
          }}
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
      {visionOpen && geo && (
        <VisionDrawer
          countries={geo.countries}
          disabled={disabled}
          onOpenCountry={(iso) => select(iso)}
          onOpenMeta={(metaId, iso) => {
            if (iso !== selectedIso) select(iso);
            setPendingMetaId(metaId);
          }}
          onOpenImage={setLightbox}
          onMarks={setVisionMarks}
          onClose={() => setVisionOpen(false)}
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
          attributes={attributes}
          attributeRows={attributeRows}
          onAttributesChanged={async () => {
            await loadAttributes();
            if (selectedIso) await loadMetas(selectedIso);
          }}
          initialTab={optionsTab}
          onClose={() => setOptionsOpen(false)}
        />
      )}
      </div>
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
