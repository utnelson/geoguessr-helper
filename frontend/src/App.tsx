import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { loadCountries, loadRegions, type CountryCollection, type RegionData } from './geo';
import type { Category, CountryInfo, Meta } from './types';
import { WorldMap } from './components/WorldMap';
import { CountryPanel } from './components/CountryPanel';
import { MetaForm } from './components/MetaForm';
import { Lightbox } from './components/Lightbox';

// Hash: #DE (Land) oder #DE/DEU-1591,DEU-1601 (Land + eine oder mehrere admin1-Regionen)
type Selection = { iso: string | null; regions: string[] };
function parseHash(): Selection {
  const [iso, regions] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { iso: iso?.toUpperCase() || null, regions: iso && regions ? regions.split(',').filter(Boolean) : [] };
}
const selectionHash = ({ iso, regions }: Selection) => (iso ? (regions.length ? `${iso}/${regions.join(',')}` : iso) : '');
const EMPTY_REGIONS: string[] = [];

export default function App() {
  const [geo, setGeo] = useState<{ geojson: CountryCollection; countries: Map<string, CountryInfo> } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState(parseHash);
  const selectedIso = selection.iso;
  const selectedRegions = selection.iso ? selection.regions : EMPTY_REGIONS;
  const [regionData, setRegionData] = useState<RegionData | null>(null);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [loadingMetas, setLoadingMetas] = useState(false);
  const [editing, setEditing] = useState<{ meta: Meta | null; regionRefs: string[] } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const refreshStats = useCallback(async () => {
    const s = await api.stats();
    setStats(Object.fromEntries(s.map((x) => [x.iso, x.count])));
  }, []);

  useEffect(() => {
    loadCountries().then(setGeo).catch((e) => setError(e.message));
    api.categories().then(setCategories).catch((e) => setError(`API nicht erreichbar: ${e.message}`));
    refreshStats().catch(() => {});
  }, [refreshStats]);

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

  useEffect(() => {
    setMetas([]);
    if (selectedIso) loadMetas(selectedIso);
  }, [selectedIso, loadMetas]);

  // admin1-Grenzen des Landes nachladen (werden gecacht)
  useEffect(() => {
    if (!selectedIso) return;
    let cancelled = false;
    loadRegions(selectedIso)
      .then((d) => !cancelled && setRegionData(d))
      .catch(() => !cancelled && setRegionData({ iso: selectedIso, geojson: { type: 'FeatureCollection', features: [] }, regions: new Map() }));
    return () => {
      cancelled = true;
    };
  }, [selectedIso]);

  const regions = regionData && regionData.iso === selectedIso ? regionData.regions : null;

  // Anzahl Metas pro admin1-Region (für die Einfärbung)
  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of metas) for (const r of m.regions) if (r.ref) counts[r.ref] = (counts[r.ref] ?? 0) + 1;
    return counts;
  }, [metas]);

  const country = selectedIso && geo ? geo.countries.get(selectedIso) ?? null : null;

  const countryList = useMemo(
    () => (geo ? [...geo.countries.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')) : []),
    [geo],
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
    if (!confirm(`„${m.title}“ wirklich löschen?`)) return;
    await api.deleteMeta(m.id);
    if (selectedIso) await loadMetas(selectedIso);
    await refreshStats();
  };

  const onSaved = async () => {
    setEditing(null);
    if (selectedIso) await loadMetas(selectedIso);
    await refreshStats();
  };

  const totalMetas = Object.values(stats).reduce((a, b) => a + b, 0);

  return (
    <div className={`app ${country ? 'has-country' : ''}`}>
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
      </header>

      {error && <div className="banner" onClick={() => setError(null)}>{error}</div>}

      {country && (
        <CountryPanel
          country={country}
          metas={metas}
          loading={loadingMetas}
          categories={categories}
          onClose={() => select(null)}
          regions={regions}
          regionCounts={regionCounts}
          selectedRegions={selectedRegions}
          onSelectRegions={selectRegions}
          onAdd={() => setEditing({ meta: null, regionRefs: selectedRegions })}
          onEdit={(m) => setEditing({ meta: m, regionRefs: [] })}
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
          initialRegionRefs={editing.regionRefs}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onCategoryCreated={(c) => setCategories((cs) => [...cs, c])}
        />
      )}
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
