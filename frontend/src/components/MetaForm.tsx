import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import type { MultiPolygon } from 'geojson';
import { api } from '../api';
import type { Category, CountryInfo, DrawSettings, Meta, MetaImage, RegionGroup, RegionInfo } from '../types';
import type { DrawApi } from './WorldMap';

/** Farbe für eingezeichnete Bereiche (Zeichnen und Anzeige des ausgewählten Metas) */
export const AREA_COLOR = '#e64980';

interface Props {
  country: CountryInfo;
  categories: Category[];
  meta: Meta | null; // null = neu anlegen
  /** vorausgewählte Kategorie für neue Metas (aktive Kategorie der Leiste) */
  initialCategoryId: number | null;
  regions: Map<string, RegionInfo> | null;
  groups: RegionGroup[];
  /** vorausgewählte admin1-Regionen (adm1_code) / Gruppen für neue Metas, beides leer = ganzes Land */
  initialRegionRefs: string[];
  initialGroupIds: number[];
  onClose: () => void;
  onSaved: () => void;
  onCategoryCreated: (c: Category) => void;
  /** Pinsel: Zeichenmodus auf der Karte (null = aus) */
  drawing: DrawSettings | null;
  onDrawingChange: (s: DrawSettings | null) => void;
  drawApi: MutableRefObject<DrawApi | null>;
}

interface PendingFile {
  file: File;
  preview: string;
}

/** Region im Formular: admin1 (ref) oder vorhandene Region/Gruppe ohne admin1-Code (id) */
type PickedRegion = { ref: string | null; id: number | null; name: string; color?: string | null };
const pickedKey = (r: PickedRegion) => (r.ref ? `ref:${r.ref}` : `id:${r.id}`);

export function MetaForm({
  country, categories, meta, initialCategoryId, regions, groups, initialRegionRefs, initialGroupIds, onClose, onSaved,
  onCategoryCreated, drawing, onDrawingChange, drawApi,
}: Props) {
  const named = groups.map((g) => ({ id: g.id, name: g.name, color: g.color }));
  // Mit dem Pinsel eingezeichneter Bereich – gehört nur zu diesem Meta
  const [area, setArea] = useState<MultiPolygon | null>(() => {
    try {
      return meta?.area ? (JSON.parse(meta.area) as MultiPolygon) : null;
    } catch {
      return null;
    }
  });
  const startDraw = () =>
    onDrawingChange({ area, color: AREA_COLOR, brush: 28, mode: 'paint', clearToken: 0 });
  /** Gemaltes übernehmen (null, wenn nichts gemalt ist) */
  const finishDraw = () => {
    const g = drawApi.current?.toGeometry() ?? null;
    setArea(g);
    onDrawingChange(null);
    return g;
  };
  const setDraw = (patch: Partial<DrawSettings>) => drawing && onDrawingChange({ ...drawing, ...patch });
  const [categoryId, setCategoryId] = useState<number>(meta?.category_id ?? initialCategoryId ?? categories[0]?.id ?? 0);
  const [title, setTitle] = useState(meta?.title ?? '');
  const [text, setText] = useState(meta?.text ?? '');
  const [picked, setPicked] = useState<PickedRegion[]>(() =>
    meta
      ? meta.regions.map((r) => ({ ref: r.ref, id: r.id, name: (r.ref && regions?.get(r.ref)?.name) || r.name, color: r.color }))
      : [
          ...named.filter((g) => initialGroupIds.includes(g.id)).map((g) => ({ ref: null, id: g.id, name: g.name, color: g.color })),
          ...initialRegionRefs.map((ref) => ({ ref, id: null, name: regions?.get(ref)?.name ?? ref })),
        ],
  );
  const pickedRefs = new Set(picked.map((r) => r.ref));
  const pickedIds = new Set(picked.map((r) => r.id));
  // Wert aus dem Dropdown: "ref:<adm1_code>" oder "group:<id>"
  const addRegion = (value: string) => {
    if (value.startsWith('group:')) {
      const g = named.find((x) => x.id === Number(value.slice(6)));
      if (g && !pickedIds.has(g.id)) setPicked((p) => [...p, { ref: null, id: g.id, name: g.name, color: g.color }]);
      return;
    }
    const ref = value.slice(4);
    const info = regions?.get(ref);
    if (info && !pickedRefs.has(ref)) setPicked((p) => [...p, { ref, id: null, name: info.name }]);
  };
  const regionList = useMemo(
    () => (regions ? [...regions.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')) : []),
    [regions],
  );
  const [existing, setExisting] = useState<MetaImage[]>(meta?.images ?? []);
  const [removed, setRemoved] = useState<number[]>([]);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = (files: Iterable<File>) => {
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    setPending((p) => [...p, ...imgs.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };

  // Screenshots direkt mit Strg+V einfügen
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drawing) onDrawingChange(null); // erst nur das Zeichnen abbrechen
        else onClose();
        return;
      }
      // Pinsel-Tasten: B Pinsel, E Radierer, + / − Größe
      const tag = (e.target as HTMLElement).tagName;
      if (!drawing || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'b') setDraw({ mode: 'paint' });
      if (e.key === 'e') setDraw({ mode: 'erase' });
      if (e.key === '-' || e.key === '_') setDraw({ brush: Math.max(4, drawing.brush - 6) });
      if (e.key === '+' || e.key === '=') setDraw({ brush: Math.min(120, drawing.brush + 6) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const createCategory = async () => {
    if (!newCat?.trim()) return;
    try {
      const c = await api.createCategory(newCat.trim());
      onCategoryCreated(c);
      setCategoryId(c.id);
      setNewCat(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !text.trim() && existing.length + pending.length === 0) {
      return setError('Bitte mindestens Titel, Beschreibung oder ein Bild angeben');
    }
    // Noch im Zeichenmodus → Gemaltes automatisch übernehmen
    const finalArea = drawing ? finishDraw() : area;
    setSaving(true);
    setError(null);
    try {
      const input = {
        area: finalArea,
        country_iso: country.iso,
        category_id: categoryId,
        title: title.trim(),
        text,
        admin1: picked.flatMap((r) => (r.ref ? [{ ref: r.ref, name: r.name }] : [])),
        region_ids: picked.flatMap((r) => (!r.ref && r.id != null ? [r.id] : [])),
      };
      const saved = meta ? await api.updateMeta(meta.id, input) : await api.createMeta(input);
      for (const id of removed) await api.deleteImage(id);
      for (const p of pending) await api.uploadImage(saved.id, p.file);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    // Als Seitenleiste – die Karte bleibt sichtbar und bedienbar
    <aside className="drawer">
      <form className="modal drawer-form" onSubmit={save}>
        <h2>{meta ? 'Meta bearbeiten' : 'Neues Meta'} · {country.name}</h2>

        <label>Kategorie</label>
        {newCat === null ? (
          <div className="row">
            <select value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="btn ghost" onClick={() => setNewCat('')}>+ Neue</button>
          </div>
        ) : (
          <div className="row">
            <input autoFocus placeholder="z.B. Bäume" value={newCat} onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), createCategory())} />
            <button type="button" className="btn primary" onClick={createCategory}>Anlegen</button>
            <button type="button" className="btn ghost" onClick={() => setNewCat(null)}>Abbrechen</button>
          </div>
        )}

        <label>Gilt für</label>
        <div className="region-picker">
          {picked.length === 0 ? (
            <span className="region-chip whole">Ganzes Land ({country.name})</span>
          ) : (
            picked.map((r) => (
              <span key={pickedKey(r)} className="region-chip" style={r.color ? { borderColor: r.color } : undefined}>
                {r.color && <i className="group-dot" style={{ background: r.color }} />}
                {r.name}
                <button type="button" title="Entfernen" onClick={() => setPicked((p) => p.filter((x) => pickedKey(x) !== pickedKey(r)))}>×</button>
              </span>
            ))
          )}
          {(regionList.length > 0 || named.length > 0) && (
            <select value="" onChange={(e) => e.target.value && addRegion(e.target.value)}>
              <option value="">+ Region / Gruppe hinzufügen…</option>
              {groups.length > 0 && (
                <optgroup label="Gruppen">
                  {groups.filter((g) => !pickedIds.has(g.id)).map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>{g.name} ({g.members.length} Regionen)</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Regionen">
                {regionList.filter((r) => !pickedRefs.has(r.id)).map((r) => (
                  <option key={r.id} value={`ref:${r.id}`}>
                    {r.name}{r.type ? ` (${r.type})` : ''}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
          {picked.length > 0 && (
            <button type="button" className="btn ghost small" onClick={() => setPicked([])}>Ganzes Land</button>
          )}
        </div>
        {regions === null && <span className="meta-region-hint">Regionen werden geladen…</span>}

        <label>Bereich auf der Karte (optional)</label>
        {drawing ? (
          <div className="draw-box">
            <p className="muted small-hint">
              Mit gedrückter Maus auf die Karte malen – nur innerhalb von {country.name}.
              Die Karte ist währenddessen fixiert{area ? ' und auf den Bereich gezoomt' : ', also vorher passend zoomen'}.
            </p>
            <div className="row tool-row">
              <button type="button" className={`btn small ${drawing.mode === 'paint' ? 'primary' : 'ghost'}`}
                onClick={() => setDraw({ mode: 'paint' })} title="Pinsel (B)">🖌 Pinsel</button>
              <button type="button" className={`btn small ${drawing.mode === 'erase' ? 'primary' : 'ghost'}`}
                onClick={() => setDraw({ mode: 'erase' })} title="Radierer (E)">⌫ Radierer</button>
              <button type="button" className="btn small ghost" onClick={() => setDraw({ clearToken: Date.now() })}>Alles löschen</button>
            </div>
            <span className="small-hint">Pinselgröße: {drawing.brush} px</span>
            <input type="range" min={4} max={120} step={2} value={drawing.brush}
              onChange={(e) => setDraw({ brush: Number(e.target.value) })} />
            <span className="muted small-hint">Tasten: B Pinsel · E Radierer · + / − Größe · Esc Zeichnen abbrechen</span>
            <div className="row">
              <button type="button" className="btn primary small" onClick={finishDraw}>✓ Bereich übernehmen</button>
              <button type="button" className="btn ghost small" onClick={() => onDrawingChange(null)}>Abbrechen</button>
            </div>
          </div>
        ) : area ? (
          <div className="row area-row">
            <span className="region-chip area-chip">🖌 Bereich eingezeichnet</span>
            <button type="button" className="btn ghost small" onClick={startDraw}>Bearbeiten</button>
            <button type="button" className="btn ghost small danger" onClick={() => setArea(null)}>Entfernen</button>
          </div>
        ) : (
          <button type="button" className="btn ghost draw-start" onClick={startDraw}
            title="Nur für dieses Meta einen Bereich auf die Karte malen">
            🖌 Bereich einzeichnen
          </button>
        )}

        <label>Titel (optional)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Gelbe Kennzeichen hinten" autoFocus={!meta} />

        <label>Beschreibung</label>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Woran erkennt man es? Wo kommt es vor? Verwechslungsgefahr mit…" />

        <label>Bilder</label>
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        >
          Bilder hierher ziehen, klicken oder Screenshot mit <kbd>Strg</kbd>+<kbd>V</kbd> einfügen
          <input ref={fileInput} type="file" accept="image/*" multiple hidden
            onChange={(e) => { addFiles(e.target.files ?? []); e.target.value = ''; }} />
        </div>
        {(existing.length > 0 || pending.length > 0) && (
          <div className="thumbs">
            {existing.map((img) => (
              <div key={img.id} className="thumb">
                <img src={img.url} alt="" />
                <button type="button" title="Entfernen" onClick={() => {
                  setExisting((x) => x.filter((i) => i.id !== img.id));
                  setRemoved((r) => [...r, img.id]);
                }}>×</button>
              </div>
            ))}
            {pending.map((p, i) => (
              <div key={p.preview} className="thumb new">
                <img src={p.preview} alt="" />
                <button type="button" title="Entfernen" onClick={() => {
                  URL.revokeObjectURL(p.preview);
                  setPending((x) => x.filter((_, j) => j !== i));
                }}>×</button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="submit" className="btn primary" disabled={saving || !categoryId}>
            {saving ? 'Speichere…' : 'Speichern'}
          </button>
        </div>
      </form>
    </aside>
  );
}
