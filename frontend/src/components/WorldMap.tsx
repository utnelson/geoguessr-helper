import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CountryCollection, RegionData } from '../geo';
import type { CountryInfo } from '../types';

interface Props {
  geojson: CountryCollection;
  countries: Map<string, CountryInfo>;
  stats: Record<string, number>;
  selectedIso: string | null;
  onSelect: (iso: string | null) => void;
  /** admin1-Regionen des ausgewählten Landes (null = noch nicht geladen) */
  regionData: RegionData | null;
  regionCounts: Record<string, number>;
  selectedRegions: string[];
  /** Strg/Shift/Cmd+Klick erweitert die Auswahl, normaler Klick ersetzt sie */
  onSelectRegions: (refs: string[]) => void;
}

const WORLD_VIEW = { center: [10, 25] as [number, number], zoom: 1.4 };
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

type Hover = { kind: 'country' | 'region'; id: string; name: string; sub?: string; x: number; y: number };

export function WorldMap({
  geojson, countries, stats, selectedIso, onSelect, regionData, regionCounts, selectedRegions, onSelectRegions,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const prevSelected = useRef<string | null>(null);
  const prevRegions = useRef<string[]>([]);
  const lastTarget = useRef<string | null>(null);
  // Auswahl, die per Strg+Klick entstanden ist → dafür die Ansicht nicht verändern
  const additiveSelection = useRef<string | null>(null);
  const handlers = useRef({ onSelect, onSelectRegions, selectedIso, selectedRegions });
  handlers.current = { onSelect, onSelectRegions, selectedIso, selectedRegions };

  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);

  // Karte einmalig aufbauen
  useEffect(() => {
    const container = containerRef.current!;
    const map = new maplibregl.Map({
      container,
      // Kein Kachel-Server nötig: nur Ozean-Hintergrund + Länderpolygone
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': '#0d1b2a' } }],
      },
      ...WORLD_VIEW,
      minZoom: 0.8,
      maxZoom: 10,
      renderWorldCopies: false,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    map.on('load', () => {
      map.addSource('countries', { type: 'geojson', data: geojson, promoteId: 'iso' });
      map.addLayer({
        id: 'country-fill',
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            '#f4b400',
            ['boolean', ['feature-state', 'hover'], false],
            '#5aa9e6',
            [
              'interpolate',
              ['linear'],
              ['to-number', ['coalesce', ['feature-state', 'count'], 0]],
              0, '#34495e',
              1, '#2e7d5b',
              10, '#43c08a',
              25, '#a3e05f',
            ],
          ],
          'fill-opacity': 0.92,
        },
      });

      // admin1-Regionen des ausgewählten Landes – werden beim Hineinzoomen eingeblendet
      map.addSource('regions', { type: 'geojson', data: EMPTY, promoteId: 'id' });
      map.addLayer({
        id: 'region-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#e8590c',
            ['boolean', ['feature-state', 'hover'], false], '#ffffff',
            ['>', ['to-number', ['coalesce', ['feature-state', 'count'], 0]], 0], '#2e9e6b',
            '#000000',
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 0.75,
            ['boolean', ['feature-state', 'hover'], false], 0.3,
            ['>', ['to-number', ['coalesce', ['feature-state', 'count'], 0]], 0], 0.65,
            0,
          ],
        },
      });
      map.addLayer({
        id: 'region-line',
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': '#5a3d00',
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 6, 1.2],
          'line-dasharray': [3, 2],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 1.5, 0, 3, 0.9],
        },
      });

      map.addLayer({
        id: 'country-line',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#fff3c4', '#0d1b2a'],
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 0.6],
        },
      });
      setReady(true);
    });

    let hovered: { source: string; id: string } | null = null;
    const clearHover = () => {
      if (hovered) map.setFeatureState(hovered, { hover: false });
      hovered = null;
    };
    const setHovered = (source: string, id: string) => {
      if (hovered?.source === source && hovered.id === id) return;
      clearHover();
      hovered = { source, id };
      map.setFeatureState(hovered, { hover: true });
    };

    map.on('mousemove', (e) => {
      const [f] = map.queryRenderedFeatures(e.point, { layers: ['region-fill', 'country-fill'] });
      if (!f) {
        clearHover();
        map.getCanvas().style.cursor = '';
        setHover(null);
        return;
      }
      map.getCanvas().style.cursor = 'pointer';
      if (f.layer.id === 'region-fill') {
        const id = String(f.properties.id);
        setHovered('regions', id);
        const sub = [f.properties.type, f.properties.code].filter(Boolean).join(' · ');
        setHover({ kind: 'region', id, name: String(f.properties.name), sub, x: e.point.x, y: e.point.y });
      } else {
        const iso = String(f.properties.iso);
        setHovered('countries', iso);
        setHover({ kind: 'country', id: iso, name: String(f.properties.name), x: e.point.x, y: e.point.y });
      }
    });
    map.on('mouseout', () => {
      clearHover();
      map.getCanvas().style.cursor = '';
      setHover(null);
    });
    map.on('click', (e) => {
      const [f] = map.queryRenderedFeatures(e.point, { layers: ['region-fill', 'country-fill'] });
      if (!f) return;
      const { onSelect, onSelectRegions, selectedIso, selectedRegions } = handlers.current;
      const ev = e.originalEvent;
      const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;
      if (f.layer.id === 'region-fill') {
        const id = String(f.properties.id);
        let next = [id];
        if (additive) {
          next = selectedRegions.includes(id) ? selectedRegions.filter((r) => r !== id) : [...selectedRegions, id];
          additiveSelection.current = next.join(',');
        }
        onSelectRegions(next);
      } else {
        const iso = String(f.properties.iso);
        // Klick ins ausgewählte Land außerhalb einer Region (z.B. Lücke) → Regionen abwählen
        if (iso === selectedIso) {
          if (!additive) onSelectRegions([]);
        } else onSelect(iso);
      }
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      prevSelected.current = null;
      prevRegions.current = [];
      lastTarget.current = null;
      setReady(false);
    };
  }, [geojson]);

  // Einfärbung nach Anzahl Metas
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const iso of countries.keys()) {
      map.setFeatureState({ source: 'countries', id: iso }, { count: stats[iso] ?? 0 });
    }
  }, [ready, stats, countries]);

  // Regionen des ausgewählten Landes einblenden
  const regions = regionData && regionData.iso === selectedIso ? regionData : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('regions') as GeoJSONSource).setData(regions?.geojson ?? EMPTY);
    prevRegions.current = []; // Feature-States gehen mit setData verloren
  }, [ready, regions]);

  // Regionen-Einfärbung + Auswahl
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !regions) return;
    for (const id of regions.regions.keys()) {
      map.setFeatureState({ source: 'regions', id }, { count: regionCounts[id] ?? 0 });
    }
  }, [ready, regions, regionCounts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !regions) return;
    for (const id of prevRegions.current) {
      if (regions.regions.has(id)) map.setFeatureState({ source: 'regions', id }, { selected: false });
    }
    prevRegions.current = selectedRegions;
    for (const id of selectedRegions) {
      if (regions.regions.has(id)) map.setFeatureState({ source: 'regions', id }, { selected: true });
    }
  }, [ready, regions, selectedRegions]);

  // Länder-Auswahl hervorheben
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (prevSelected.current) {
      map.setFeatureState({ source: 'countries', id: prevSelected.current }, { selected: false });
    }
    prevSelected.current = selectedIso;
    map.resize(); // Layout hat sich evtl. geändert (Panel oben)
    if (selectedIso) {
      map.setFeatureState({ source: 'countries', id: selectedIso }, { selected: true });
      map.setPaintProperty('country-fill', 'fill-opacity', [
        'case', ['boolean', ['feature-state', 'selected'], false], 0.95, 0.4,
      ]);
    } else {
      map.setPaintProperty('country-fill', 'fill-opacity', 0.92);
    }
  }, [ready, selectedIso]);

  // Hineinzoomen: auf die (einzelne) Region, sonst aufs Land, sonst Weltansicht.
  // Bei Mehrfachauswahl (Strg+Klick) bleibt die Ansicht stehen.
  const multi = selectedRegions.length > 1;
  const regionInfo = selectedRegions.length === 1 ? regions?.regions.get(selectedRegions[0]) : undefined;
  const countryInfo = selectedIso ? countries.get(selectedIso) : undefined;
  const target = multi ? 'multi' : regionInfo ? `r:${regionInfo.id}` : countryInfo ? `c:${countryInfo.iso}` : 'world';
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || lastTarget.current === target) return;
    const from = lastTarget.current;
    lastTarget.current = target;
    // Strg+Klick oder Abwählen aus einer Mehrfachauswahl: Ansicht nicht verändern
    const keepView = additiveSelection.current === selectedRegions.join(',') || (from === 'multi' && target.startsWith('r:'));
    additiveSelection.current = null;
    if (keepView && from !== null && from !== 'world') return;
    // Region per Link geöffnet, Grenzen aber noch nicht geladen → erst einmal aufs Land
    map.resize();
    const bbox = regionInfo?.bbox ?? countryInfo?.bbox;
    if (bbox) {
      const [w, s, e, n] = bbox;
      map.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: regionInfo ? 8 : 7, duration: 1100 });
    } else {
      map.flyTo({ ...WORLD_VIEW, duration: 900 });
    }
  }, [ready, target, regionInfo, countryInfo]);

  const regionCount = regions?.regions.size ?? 0;

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      {hover && (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hover.name}</strong>
          {hover.sub && <span>{hover.sub}</span>}
          <span>
            {hover.kind === 'region' ? regionCounts[hover.id] ?? 0 : stats[hover.id] ?? 0} Metas
            {hover.kind === 'region' && (selectedRegions.includes(hover.id) ? ' · Strg+Klick: abwählen' : ' · Strg+Klick: dazunehmen')}
          </span>
        </div>
      )}
      <div className="map-legend">
        {selectedIso ? (
          <>
            <span><i style={{ background: '#2e9e6b' }} /> Region mit Metas</span>
            <span><i style={{ background: '#e8590c' }} /> ausgewählt{multi ? ` (${selectedRegions.length})` : ''}</span>
            <span>Strg+Klick: mehrere Regionen</span>
            <span>{regionCount ? `${regionCount} Regionen` : regions ? 'keine Regionsgrenzen' : 'lade Regionen…'}</span>
          </>
        ) : (
          <>
            <span><i style={{ background: '#34495e' }} /> keine Metas</span>
            <span><i style={{ background: '#2e7d5b' }} /> wenige</span>
            <span><i style={{ background: '#a3e05f' }} /> viele</span>
          </>
        )}
      </div>
    </div>
  );
}
