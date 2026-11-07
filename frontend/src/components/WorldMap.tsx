import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MultiPolygon, Polygon } from 'geojson';
import { geometryInfo, regionsAnchor, type CountryCollection, type RegionData } from '../geo';
import { paintGeometry, toMultiPolygon, traceMask } from '../brush';
import type { BBox, CountryInfo, DrawSettings, FilterStatus, InfoItem } from '../types';

/** Schnittstelle des Zeichenmodus für das Formular (Speichern / Löschen) */
export interface DrawApi {
  toGeometry: () => MultiPolygon | null;
  clear: () => void;
}

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
  /** Infografik-Ansicht: Kästen mit Linien zu ihren Regionen (null = aus) */
  infographic: InfoItem[] | null;
  onOpenImage: (url: string) => void;
  /** Weltansicht auf einen Kontinent beschränken (andere Länder abgedunkelt) */
  continent: { id: string; bbox: BBox } | null;
  showLabels: boolean;
  onToggleLabels: () => void;
  /** ausgeschaltete Länder: grau, nicht anklickbar, Name gedämpft */
  disabled: Set<string>;
  /** Rückwärtssuche/Volltextsuche: Status je Land (null = keine Markierung) */
  marks: Map<string, FilterStatus> | null;
  /** Markierung stammt aus der Volltextsuche (nur Treffer, keine Ausschlüsse) */
  marksFromSearch: boolean;
  /** eingezeichnete Meta-Bereiche, die gerade sichtbar sein sollen (ausgewähltes Meta, Infografik) */
  metaAreas: { id: number; color: string; geometry: MultiPolygon }[];
  /** Bereich des ausgewählten Metas → dorthin zoomen */
  focusBBox: BBox | null;
  /** Zeichenmodus (Pinsel) – null = aus */
  drawing: DrawSettings | null;
  drawApi: MutableRefObject<DrawApi | null>;
}

// ---------- Paint-Ausdrücke: normale Ansicht vs. Infografik ----------
const STATE = (k: string) => ['feature-state', k] as ExpressionSpecification;
const IS = (k: string) => ['boolean', STATE(k), false] as ExpressionSpecification;
const HAS_METAS = ['>', ['to-number', ['coalesce', STATE('count'), 0]], 0] as ExpressionSpecification;
const HAS_INFO = ['==', ['typeof', STATE('info')], 'string'] as ExpressionSpecification;

const DIM = '#1a2531'; // Länder außerhalb des gewählten Kontinents
const OFF = '#4a4f56'; // ausgeschaltete Länder (Optionen): neutral grau, Karte bleibt erkennbar
// Rückwärtssuche / Volltextsuche
const MATCH = '#20c997';
const UNKNOWN = '#2b3542';
const EXCLUDED = '#0f1720';
const MARK = (v: FilterStatus) => ['==', STATE('mark'), v] as ExpressionSpecification;
const COUNTRY_FILL: ExpressionSpecification = [
  'case',
  IS('dim'), DIM,
  IS('off'), OFF,
  MARK('excluded'), EXCLUDED,
  IS('selected'), '#f4b400',
  IS('hover'), '#5aa9e6',
  MARK('match'), MATCH,
  MARK('unknown'), UNKNOWN,
  ['interpolate', ['linear'], ['to-number', ['coalesce', STATE('count'), 0]], 0, '#34495e', 1, '#2e7d5b', 10, '#43c08a', 25, '#a3e05f'],
];
const COUNTRY_FILL_INFO: ExpressionSpecification = [
  'case', IS('off'), OFF, MARK('excluded'), EXCLUDED, IS('selected'), '#e9edf2', IS('hover'), '#5aa9e6', '#34495e',
];
// Welt-Infografik: Länder in der Farbe ihres Kastens
const COUNTRY_FILL_WORLD_INFO: ExpressionSpecification = [
  'case', IS('dim'), DIM, IS('off'), OFF, MARK('excluded'), EXCLUDED, HAS_INFO, ['to-color', STATE('info')], IS('hover'), '#5aa9e6',
  MARK('unknown'), UNKNOWN, '#4b5d70',
];

const REGION_FILL: ExpressionSpecification = ['case', IS('selected'), '#e8590c', IS('hover'), '#ffffff', HAS_METAS, '#2e9e6b', '#000000'];
const REGION_OPACITY: ExpressionSpecification = ['case', IS('selected'), 0.75, IS('hover'), 0.3, HAS_METAS, 0.65, 0];
const REGION_FILL_INFO: ExpressionSpecification = [
  'case', IS('selected'), '#e8590c', HAS_INFO, ['to-color', STATE('info')], IS('hover'), '#ffffff', '#000000',
];
const REGION_OPACITY_INFO: ExpressionSpecification = ['case', IS('selected'), 0.85, HAS_INFO, ['case', IS('hover'), 0.7, 0.95], IS('hover'), 0.3, 0];


// ---------- Infografik-Layout ----------
const CARD_W = 190;
const CARD_MAX_H = 240;
const CARD_MIN_H = 64;
const MARGIN = 12;
const MARGIN_BOTTOM = 72; // Platz für die Zoom-Knöpfe unten rechts
const GAP = 10;

interface PlacedCard {
  item: InfoItem;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: { x: number; y: number } | null;
  side: 'left' | 'right';
}

/** Kästen links/rechts der Karte verteilen – nach Lage des Ankers, ohne Überlappung */
function layoutCards(
  entries: { item: InfoItem; anchor: { x: number; y: number } | null }[], W: number, H: number, cardW: number,
): PlacedCard[] {
  const anchored = entries.filter((e) => e.anchor).sort((a, b) => a.anchor!.x - b.anchor!.x);
  const loose = entries.filter((e) => !e.anchor); // landesweit: rechts unten, ohne Linie
  const leftCount = Math.ceil((anchored.length + loose.length) / 2);
  const left = anchored.slice(0, Math.min(leftCount, anchored.length));
  const right = [...anchored.slice(left.length), ...loose];

  // Eine Seite: bei vielen Kästen bis zu 3 Spalten (abwechselnd nach Höhe verteilt, Spalte 0 = außen)
  const side = (list: typeof entries, s: 'left' | 'right'): PlacedCard[] => {
    if (list.length === 0) return [];
    const perCol = Math.max(1, Math.floor((H - MARGIN - MARGIN_BOTTOM + GAP) / (CARD_MIN_H + GAP)));
    const cols = Math.min(3, Math.ceil(list.length / perCol));
    const w = cols > 1 ? Math.min(cardW, 150) : cardW;
    const sorted = [...list].sort((a, b) => (a.anchor?.y ?? Infinity) - (b.anchor?.y ?? Infinity));
    return Array.from({ length: cols }, (_, c) => {
      const x = s === 'left' ? MARGIN + c * (w + GAP) : W - MARGIN - w - c * (w + GAP);
      return column(sorted.filter((_, i) => i % cols === c), s, x, w);
    }).flat();
  };

  const column = (list: typeof entries, side: 'left' | 'right', x: number, cardW: number): PlacedCard[] => {
    if (list.length === 0) return [];
    const n = list.length;
    const h = Math.max(48, Math.min(CARD_MAX_H, (H - MARGIN - MARGIN_BOTTOM - GAP * (n - 1)) / n));
    const sorted = [...list].sort((a, b) => (a.anchor?.y ?? Infinity) - (b.anchor?.y ?? Infinity));
    const bottom = H - MARGIN_BOTTOM - h;
    const ys = sorted.map((e) => Math.min(Math.max((e.anchor?.y ?? H) - h / 2, MARGIN), bottom));
    for (let i = 1; i < n; i++) ys[i] = Math.max(ys[i], ys[i - 1] + h + GAP); // nach unten schieben
    if (ys[n - 1] > bottom) {
      ys[n - 1] = bottom;
      for (let i = n - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - h - GAP); // von unten zurück
    }
    return sorted.map((e, i) => ({ item: e.item, x, y: Math.max(ys[i], MARGIN), w: cardW, h, anchor: e.anchor, side }));
  };
  return [...side(left, 'left'), ...side(right, 'right')];
}

/** Ländernamen platzieren: große Länder zuerst, überlappende Namen weglassen */
function layoutLabels(list: CountryInfo[], map: MLMap, W: number, H: number) {
  const placed: { iso: string; name: string; x: number; y: number; w: number }[] = [];
  const boxes: [number, number, number, number][] = [];
  // Fläche auf dem Bildschirm grob ~ Grad² · 4^zoom → kleine Länder/Inseln erst beim Hineinzoomen
  const scale = 4 ** map.getZoom();
  for (const c of list) {
    if (c.area * scale < 40) continue;
    const p = map.project(c.label);
    if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) continue;
    const w = c.name.length * 6.4 + 8;
    const box: [number, number, number, number] = [p.x - w / 2, p.y - 8, p.x + w / 2, p.y + 8];
    if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    placed.push({ iso: c.iso, name: c.name, x: p.x, y: p.y, w });
  }
  return placed;
}

const WORLD_VIEW = { center: [10, 25] as [number, number], zoom: 1.4 };
const WORLD_BBOX: BBox = [-170, -56, 180, 78];
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

type Hover = { kind: 'country' | 'region'; id: string; name: string; sub?: string; x: number; y: number };

export function WorldMap({
  geojson, countries, stats, selectedIso, onSelect, regionData, regionCounts, selectedRegions, onSelectRegions,
  infographic, onOpenImage, continent, showLabels, onToggleLabels, disabled, metaAreas, focusBBox, drawing, drawApi,
  marks, marksFromSearch,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const prevSelected = useRef<string | null>(null);
  const prevRegions = useRef<string[]>([]);
  const lastTarget = useRef<string | null>(null);
  // Auswahl, die per Strg+Klick entstanden ist → dafür die Ansicht nicht verändern
  const additiveSelection = useRef<string | null>(null);
  const handlers = useRef({ onSelect, onSelectRegions, selectedIso, selectedRegions, disabled });
  handlers.current = { onSelect, onSelectRegions, selectedIso, selectedRegions, disabled };

  const [ready, setReady] = useState(false);
  // true erst nach dem load-Event der aktuellen Karteninstanz (schützt vor Zugriffen beim Neuaufbau)
  const loadedRef = useRef(false);
  const [hover, setHover] = useState<Hover | null>(null);
  // Infografik/Ländernamen: bei jeder Kartenbewegung neu layouten
  const infoActive = useRef(false);
  infoActive.current = !!infographic || showLabels;
  const prevInfo = useRef<string[]>([]);
  const prevCountryInfo = useRef<string[]>([]);
  const [, setViewTick] = useState(0);
  // Infografik-Karussell: aktuelles Bild je Kasten
  const [slides, setSlides] = useState<Record<string, number>>({});
  const slide = (key: string, to: number, count: number) =>
    setSlides((s) => ({ ...s, [key]: (to + count) % count }));
  // Neue Daten (z.B. Bilder umsortiert) → jeder Kasten startet wieder beim Titelbild
  useEffect(() => setSlides({}), [infographic]);

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
        paint: { 'fill-color': COUNTRY_FILL, 'fill-opacity': 0.92 },
      });

      // admin1-Regionen des ausgewählten Landes – werden beim Hineinzoomen eingeblendet
      map.addSource('regions', { type: 'geojson', data: EMPTY, promoteId: 'id' });
      map.addLayer({
        id: 'region-fill',
        type: 'fill',
        source: 'regions',
        paint: { 'fill-color': REGION_FILL, 'fill-opacity': REGION_OPACITY },
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

      // Mit dem Pinsel eingezeichnete Bereiche von Metas (nur Anzeige, nicht anklickbar)
      map.addSource('meta-areas', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'meta-area-fill',
        type: 'fill',
        source: 'meta-areas',
        paint: { 'fill-color': ['to-color', ['get', 'color']], 'fill-opacity': 0.55 },
      });
      map.addLayer({
        id: 'meta-area-line',
        type: 'line',
        source: 'meta-areas',
        paint: { 'line-color': ['to-color', ['get', 'color']], 'line-width': 2.5, 'line-dasharray': [2, 1] },
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
      loadedRef.current = true;
      setReady(true);
    });

    let hovered: { source: string; id: string | number } | null = null;
    const clearHover = () => {
      if (hovered) map.setFeatureState(hovered, { hover: false });
      hovered = null;
    };
    const setHovered = (source: string, id: string | number) => {
      if (hovered?.source === source && hovered.id === id) return;
      clearHover();
      hovered = { source, id };
      map.setFeatureState(hovered, { hover: true });
    };

    // Oberstes Feature unter der Maus – ausgeschaltete Länder zählen nicht
    const pick = (point: maplibregl.PointLike) => {
      const [f] = map.queryRenderedFeatures(point, { layers: ['region-fill', 'country-fill'] });
      if (f && f.layer.id === 'country-fill' && handlers.current.disabled.has(String(f.properties.iso))) return undefined;
      return f;
    };
    map.on('mousemove', (e) => {
      const f = pick(e.point);
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
      const f = pick(e.point);
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

    let frame = 0;
    const relayout = () => {
      if (!infoActive.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setViewTick((t) => t + 1);
      });
    };
    map.on('move', relayout);
    map.on('resize', relayout);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    mapRef.current = map;
    return () => {
      loadedRef.current = false;
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      prevSelected.current = null;
      prevRegions.current = [];
      prevInfo.current = [];
      prevCountryInfo.current = [];
      lastTarget.current = null;
      if (frame) cancelAnimationFrame(frame);
      setReady(false);
    };
  }, [geojson]);

  // Einfärbung nach Anzahl Metas
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map) return;
    for (const iso of countries.keys()) {
      map.setFeatureState({ source: 'countries', id: iso }, { count: stats[iso] ?? 0 });
    }
  }, [ready, stats, countries]);

  // Rückwärtssuche / Volltextsuche: Status je Land
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map) return;
    for (const iso of countries.keys()) {
      map.setFeatureState({ source: 'countries', id: iso }, { mark: marks?.get(iso) ?? null });
    }
  }, [ready, countries, marks]);

  // Ausgeschaltete Länder
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map) return;
    for (const iso of countries.keys()) map.setFeatureState({ source: 'countries', id: iso }, { off: disabled.has(iso) });
  }, [ready, countries, disabled]);

  // Kontinent: andere Länder abdunkeln (nur in der Weltansicht)
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map) return;
    for (const c of countries.values()) {
      map.setFeatureState(
        { source: 'countries', id: c.iso },
        { dim: !selectedIso && !!continent && c.continent !== continent.id },
      );
    }
  }, [ready, countries, continent, selectedIso]);

  // Regionen des ausgewählten Landes einblenden
  const regions = regionData && regionData.iso === selectedIso ? regionData : null;
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map) return;
    (map.getSource('regions') as GeoJSONSource).setData(regions?.geojson ?? EMPTY);
    prevRegions.current = []; // Feature-States gehen mit setData verloren
    prevInfo.current = [];
  }, [ready, regions]);

  // Regionen-Einfärbung + Auswahl
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map || !regions) return;
    for (const id of regions.regions.keys()) {
      map.setFeatureState({ source: 'regions', id }, { count: regionCounts[id] ?? 0 });
    }
  }, [ready, regions, regionCounts]);

  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map || !regions) return;
    for (const id of prevRegions.current) {
      if (regions.regions.has(id)) map.setFeatureState({ source: 'regions', id }, { selected: false });
    }
    prevRegions.current = selectedRegions;
    for (const id of selectedRegions) {
      if (regions.regions.has(id)) map.setFeatureState({ source: 'regions', id }, { selected: true });
    }
  }, [ready, regions, selectedRegions]);

  // Meta-Bereiche anzeigen (im Zeichenmodus nicht – dort liegt das Gemalte auf dem Canvas)
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map) return;
    (map.getSource('meta-areas') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: drawing
        ? []
        : metaAreas.map((a) => ({ type: 'Feature', properties: { id: a.id, color: a.color }, geometry: a.geometry })),
    });
  }, [ready, metaAreas, drawing]);

  // Ausgewähltes Meta mit Bereich → hinzoomen
  const focusKey = focusBBox?.join(',') ?? null;
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map || !focusBBox) return;
    const [w, s, e, n] = focusBBox;
    map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 9, duration: 700 });
  }, [ready, focusKey]);

  // Länder-Auswahl hervorheben
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
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

  // ---------- Infografik ----------
  const infoMode = !!infographic;
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map) return;
    map.setPaintProperty(
      'country-fill', 'fill-color', !infoMode ? COUNTRY_FILL : selectedIso ? COUNTRY_FILL_INFO : COUNTRY_FILL_WORLD_INFO,
    );
    map.setPaintProperty('region-fill', 'fill-color', infoMode ? REGION_FILL_INFO : REGION_FILL);
    map.setPaintProperty('region-fill', 'fill-opacity', infoMode ? REGION_OPACITY_INFO : REGION_OPACITY);
    map.setPaintProperty('region-line', 'line-color', infoMode ? '#4a5868' : '#5a3d00');
    map.setPaintProperty('region-line', 'line-dasharray', infoMode ? [1, 0] : [3, 2]);
  }, [ready, infoMode, selectedIso]);

  // Welt-Infografik: Länder in der Farbe ihres Kastens einfärben
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map) return;
    for (const iso of prevCountryInfo.current) map.setFeatureState({ source: 'countries', id: iso }, { info: null });
    const next: string[] = [];
    for (const item of infographic ?? []) {
      if (!item.iso || !countries.has(item.iso)) continue;
      map.setFeatureState({ source: 'countries', id: item.iso }, { info: item.color });
      next.push(item.iso);
    }
    prevCountryInfo.current = next;
  }, [ready, infographic, countries]);

  // Regionen in der Farbe ihres Kastens einfärben
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map || !regions) return;
    for (const id of prevInfo.current) {
      if (regions.regions.has(id)) map.setFeatureState({ source: 'regions', id }, { info: null });
    }
    const next: string[] = [];
    for (const item of infographic ?? []) {
      for (const id of item.refs) {
        if (!regions.regions.has(id)) continue;
        map.setFeatureState({ source: 'regions', id }, { info: item.color });
        next.push(id);
      }
    }
    prevInfo.current = next;
  }, [ready, regions, infographic]);

  /** Ausschnitt einpassen – in der Infografik mit Platz für die Kasten-Spalten links/rechts */
  const fitView = (map: MLMap, bbox: BBox, maxZoom: number, duration: number) => {
    const [w, s, e, n] = bbox;
    const side = infographic ? Math.min(CARD_W + 40, map.getContainer().clientWidth / 3) : 40;
    const pad = infographic ? { top: 30, bottom: 30, left: side, right: side } : 40;
    map.fitBounds([[w, s], [e, n]], { padding: pad, maxZoom, duration });
  };

  // Beim Einschalten der Infografik: Land bzw. Kontinent zwischen die Kasten-Spalten einpassen
  const countryForInfo = selectedIso ? countries.get(selectedIso) : undefined;
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map || !infoMode) return;
    fitView(map, countryForInfo?.bbox ?? continent?.bbox ?? WORLD_BBOX, 7, 800);
  }, [ready, infoMode, countryForInfo]);

  // Ankerpunkte (geografisch) der Kästen
  const anchors = useMemo(() => {
    const m = new Map<string, [number, number] | null>();
    if (!infographic) return m;
    for (const item of infographic) {
      m.set(item.key, item.anchor ?? (item.refs.length && regions ? regionsAnchor(regions, item.refs) : null));
    }
    return m;
  }, [infographic, regions]);

  let placed: PlacedCard[] = [];
  let labels: ReturnType<typeof layoutLabels> = [];
  let size = { W: 0, H: 0 };
  const map = loadedRef.current ? mapRef.current : null;
  if (map && ready && containerRef.current) {
    size = { W: containerRef.current.clientWidth, H: containerRef.current.clientHeight };
  }
  // Ländernamen (nicht für das gerade geöffnete Land – dort stehen die Regionen im Vordergrund)
  const labelCountries = useMemo(
    () =>
      [...countries.values()]
        .filter((c) => c.iso !== selectedIso && (selectedIso || !continent || c.continent === continent.id))
        .sort((a, b) => b.area - a.area),
    [countries, selectedIso, continent, disabled],
  );
  if (showLabels && map && size.W) labels = layoutLabels(labelCountries, map, size.W, size.H);

  if (infographic && infographic.length && map && size.W) {
    const { W, H } = size;
    const cardW = Math.min(CARD_W, Math.max(110, W / 4.5));
    placed = layoutCards(
      infographic.map((item) => {
        const ll = anchors.get(item.key);
        const pt = ll ? map.project(ll) : null;
        return { item, anchor: pt ? { x: pt.x, y: pt.y } : null };
      }),
      W, H, cardW,
    );
  }

  // Hineinzoomen: auf die (einzelne) Region, sonst aufs Land, sonst Weltansicht.
  // Bei Mehrfachauswahl (Strg+Klick) bleibt die Ansicht stehen.
  const multi = selectedRegions.length > 1;
  const regionInfo = selectedRegions.length === 1 ? regions?.regions.get(selectedRegions[0]) : undefined;
  const countryInfo = selectedIso ? countries.get(selectedIso) : undefined;
  const target = multi
    ? 'multi'
    : regionInfo ? `r:${regionInfo.id}` : countryInfo ? `c:${countryInfo.iso}` : continent ? `w:${continent.id}` : 'world';
  useEffect(() => {
    const map = loadedRef.current ? mapRef.current : null;
    if (!ready || !map || lastTarget.current === target) return;
    const from = lastTarget.current;
    lastTarget.current = target;
    // Strg+Klick oder Abwählen aus einer Mehrfachauswahl: Ansicht nicht verändern
    const keepView = additiveSelection.current === selectedRegions.join(',') || (from === 'multi' && target.startsWith('r:'));
    additiveSelection.current = null;
    if (keepView && from !== null && from !== 'world') return;
    // Region per Link geöffnet, Grenzen aber noch nicht geladen → erst einmal aufs Land
    map.resize();
    const bbox = regionInfo?.bbox ?? countryInfo?.bbox ?? continent?.bbox ?? (infographic ? WORLD_BBOX : null);
    if (bbox) {
      fitView(map, bbox, regionInfo ? 8 : 7, 1100);
    } else {
      map.flyTo({ ...WORLD_VIEW, duration: 900 });
    }
  }, [ready, target, regionInfo, countryInfo]);

  const regionCount = regions?.regions.size ?? 0;
  // Landesgrenze des geöffneten Landes – der Pinsel malt nur innerhalb
  const clipGeometry = useMemo(
    () => (selectedIso ? geojson.features.find((f) => f.properties.iso === selectedIso)?.geometry ?? null : null),
    [geojson, selectedIso],
  );

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      {drawing && map && <DrawCanvas map={map} settings={drawing} apiRef={drawApi} clip={clipGeometry} />}
      {labels.length > 0 && (
        <div className="country-labels">
          {labels.map((l) => (
            <span key={l.iso} className={disabled.has(l.iso) ? 'off' : undefined} style={{ left: l.x, top: l.y }}>{l.name}</span>
          ))}
        </div>
      )}
      <button className={`labels-toggle ${showLabels ? 'active' : ''}`} onClick={onToggleLabels} title="Ländernamen ein-/ausblenden">
        Aa Ländernamen
      </button>
      {placed.length > 0 && (
        <div className="info-overlay">
          <svg width={size.W} height={size.H}>
            {placed.map((c) => {
              if (!c.anchor) return null;
              const x1 = c.side === 'left' ? c.x + c.w : c.x;
              const y1 = c.y + c.h / 2;
              return (
                <g key={c.item.key}>
                  <line x1={x1} y1={y1} x2={c.anchor.x} y2={c.anchor.y} stroke={c.item.color} strokeWidth={2.5} />
                  <circle cx={c.anchor.x} cy={c.anchor.y} r={7} fill={c.item.color} stroke="#fff" strokeWidth={2} />
                </g>
              );
            })}
          </svg>
          {placed.map((c) => {
            const imgs = c.item.images;
            const idx = Math.min(slides[c.item.key] ?? 0, Math.max(0, imgs.length - 1));
            const showImage = imgs.length > 0 && c.h >= 100;
            const showText = !!c.item.text && c.h >= (showImage ? 200 : 90);
            return (
              <div
                key={c.item.key}
                className={`info-card ${c.item.iso ? 'clickable' : ''}`}
                style={{ left: c.x, top: c.y, width: c.w, height: c.h, borderColor: c.item.color }}
                onClick={() => c.item.iso && onSelect(c.item.iso)}
                title={c.item.iso ? `${c.item.label} öffnen` : undefined}
              >
                <div className="info-card-label" style={{ color: c.item.color }}>{c.item.label}</div>
                {showImage && (
                  <div className="info-carousel">
                    <img
                      src={imgs[idx]}
                      alt={c.item.title}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenImage(imgs[idx]);
                      }}
                    />
                    {imgs.length > 1 && (
                      <>
                        <button className="carousel-btn prev" title="Vorheriges Bild"
                          onClick={(e) => { e.stopPropagation(); slide(c.item.key, idx - 1, imgs.length); }}>‹</button>
                        <button className="carousel-btn next" title="Nächstes Bild"
                          onClick={(e) => { e.stopPropagation(); slide(c.item.key, idx + 1, imgs.length); }}>›</button>
                        <span className="carousel-count">{idx + 1}/{imgs.length}</span>
                        <span className="carousel-dots">
                          {imgs.map((_, k) => (
                            <i key={k} className={k === idx ? 'on' : ''}
                              onClick={(e) => { e.stopPropagation(); slide(c.item.key, k, imgs.length); }} />
                          ))}
                        </span>
                      </>
                    )}
                  </div>
                )}
                {!showImage && imgs.length > 1 && <span className="carousel-count inline">🖼 {imgs.length} Bilder</span>}
                {c.item.title && <div className="info-card-title">{c.item.title}</div>}
                {showText && <div className="info-card-text">{c.item.text}</div>}
              </div>
            );
          })}
        </div>
      )}
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
      {!infographic && <div className="map-legend">
        {marks ? (
          marksFromSearch ? (
            <span><i style={{ background: MATCH }} /> Treffer der Suche</span>
          ) : (
            <>
              <span><i style={{ background: MATCH }} /> passt</span>
              <span><i style={{ background: UNKNOWN }} /> ohne Angabe</span>
              <span><i style={{ background: EXCLUDED, outline: '1px solid #3a4b5f' }} /> ausgeschlossen</span>
            </>
          )
        ) : selectedIso ? (
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
            {disabled.size > 0 && <span><i style={{ background: OFF }} /> ausgeschaltet</span>}
          </>
        )}
      </div>}
    </div>
  );
}

/**
 * Pinsel-Overlay: Während des Zeichnens ist die Karte fixiert, gemalt wird auf ein Canvas über der Karte.
 * Beim Speichern wird das Gemalte per traceMask() in ein Polygon umgewandelt.
 */
function DrawCanvas({ map, settings, apiRef, clip }: {
  map: MLMap;
  settings: DrawSettings;
  apiRef: MutableRefObject<DrawApi | null>;
  /** nur innerhalb dieser Fläche malen (Landesgrenze) */
  clip: Polygon | MultiPolygon | null;
}) {
  const clipPath = useRef<Path2D | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Karte fixieren, Canvas vorbereiten, ggf. vorhandenes Gebiet vormalen
  useEffect(() => {
    const handlers = [map.dragPan, map.scrollZoom, map.boxZoom, map.doubleClickZoom, map.keyboard, map.touchZoomRotate];
    const area = settingsRef.current.area;
    if (area) {
      const [w, s, e, n] = geometryInfo(area).bbox;
      map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 9, duration: 0 });
    }
    handlers.forEach((h) => h.disable());
    const canvas = canvasRef.current!;
    const { clientWidth: W, clientHeight: H } = map.getContainer();
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // Landesgrenze als Pfad (Ansicht ist fixiert, also nur einmal berechnen)
    clipPath.current = null;
    if (clip) {
      const path = new Path2D();
      const polys = clip.type === 'Polygon' ? [clip.coordinates] : clip.coordinates;
      for (const rings of polys) {
        for (const ring of rings) {
          ring.forEach((p, k) => {
            const pt = map.project(p as [number, number]);
            if (k === 0) path.moveTo(pt.x, pt.y);
            else path.lineTo(pt.x, pt.y);
          });
          path.closePath();
        }
      }
      clipPath.current = path;
    }
    if (area) {
      ctx.save();
      if (clipPath.current) ctx.clip(clipPath.current, 'evenodd');
      ctx.fillStyle = settingsRef.current.color;
      paintGeometry(ctx, area, (p) => {
        const pt = map.project(p as [number, number]);
        return [pt.x, pt.y];
      });
      ctx.restore();
    }
    apiRef.current = {
      toGeometry: () => {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return toMultiPolygon(traceMask(img.data, canvas.width, canvas.height, 2), (p) => {
          const ll = map.unproject(p);
          return [ll.lng, ll.lat];
        });
      },
      clear: () => ctx.clearRect(0, 0, canvas.width, canvas.height),
    };
    return () => {
      handlers.forEach((h) => h.enable());
      map.touchZoomRotate.disableRotation();
      apiRef.current = null;
    };
  }, [map, apiRef, clip]);

  // „Alles löschen“
  useEffect(() => {
    if (settings.clearToken) apiRef.current?.clear();
  }, [settings.clearToken, apiRef]);

  // Farbe geändert → bisher Gemaltes umfärben
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = settings.color;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }, [settings.color]);

  const stroke = (x: number, y: number) => {
    const ctx = canvasRef.current!.getContext('2d')!;
    const { color, brush, mode } = settingsRef.current;
    ctx.save();
    if (clipPath.current) ctx.clip(clipPath.current, 'evenodd'); // nicht über die Landesgrenze hinaus
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = brush;
    ctx.lineCap = ctx.lineJoin = 'round';
    const from = last.current ?? { x, y };
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    last.current = { x, y };
  };

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="draw-canvas"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = null;
          const p = pos(e);
          stroke(p.x, p.y);
        }}
        onPointerMove={(e) => {
          const p = pos(e);
          setCursor(p);
          if (e.buttons & 1) stroke(p.x, p.y);
        }}
        onPointerUp={() => (last.current = null)}
        onPointerLeave={() => setCursor(null)}
      />
      {cursor && (
        <div
          className={`brush-cursor ${settings.mode}`}
          style={{ left: cursor.x, top: cursor.y, width: settings.brush, height: settings.brush, borderColor: settings.color }}
        />
      )}
    </>
  );
}
