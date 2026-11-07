import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import type { MultiPolygon } from 'geojson';
import { api } from '../api';
import type { Attribute, Category, CountryInfo, DrawSettings, Meta, MetaImage, RegionGroup, RegionInfo } from '../types';
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
  /** Merkmale aller Kategorien (Rückwärtssuche) */
  attributes: Attribute[];
  onAttributesChanged: () => Promise<void>;
  /** Pinsel: Zeichenmodus auf der Karte (null = aus) */
  drawing: DrawSettings | null;
  onDrawingChange: (s: DrawSettings | null) => void;
  drawApi: MutableRefObject<DrawApi | null>;
}

/** Bild im Formular: schon gespeichert oder neu (noch hochzuladen) – gemeinsam sortierbar */
type ImageItem =
  | { key: string; kind: 'existing'; img: MetaImage }
  | { key: string; kind: 'pending'; file: File; preview: string };

/** Region im Formular: admin1 (ref) oder vorhandene Region/Gruppe ohne admin1-Code (id) */
type PickedRegion = { ref: string | null; id: number | null; name: string; color?: string | null };
const pickedKey = (r: PickedRegion) => (r.ref ? `ref:${r.ref}` : `id:${r.id}`);

export function MetaForm({
  country, categories, meta, initialCategoryId, regions, groups, initialRegionRefs, initialGroupIds, onClose, onSaved,
  onCategoryCreated, drawing, onDrawingChange, drawApi, attributes, onAttributesChanged,
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
  // Merkmale: gewählte Werte als "attributId:wert"
  const [tags, setTags] = useState<Set<string>>(
    () => new Set((meta?.attributes ?? []).map((a) => `${a.attribute_id}:${a.value}`)),
  );
  const [newTagValue, setNewTagValue] = useState<Record<number, string>>({});
  const [newAttrKey, setNewAttrKey] = useState('');
  const catAttributes = attributes.filter((a) => a.category_id === categoryId);
  const toggleTag = (k: string) =>
    setTags((t) => {
      const n = new Set(t);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const addTagValue = async (a: Attribute) => {
    const v = (newTagValue[a.id] ?? '').trim();
    if (!v) return;
    try {
      if (!a.values.includes(v)) await api.updateAttribute(a.id, { values: [...a.values, v] });
      await onAttributesChanged();
      setTags((t) => new Set(t).add(`${a.id}:${v}`));
      setNewTagValue((n) => ({ ...n, [a.id]: '' }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const addAttr = async () => {
    const key = newAttrKey.trim();
    if (!key) return;
    try {
      await api.createAttribute({ category_id: categoryId, key, values: [] });
      await onAttributesChanged();
      setNewAttrKey('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
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
  const [images, setImages] = useState<ImageItem[]>(
    () => meta?.images.map((img) => ({ key: `e${img.id}`, kind: 'existing' as const, img })) ?? [],
  );
  const [removed, setRemoved] = useState<number[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const removeImage = (item: ImageItem) => {
    if (item.kind === 'existing') setRemoved((r) => [...r, item.img.id]);
    else URL.revokeObjectURL(item.preview);
    setImages((list) => list.filter((x) => x.key !== item.key));
  };
  /** Bild an Position `to` verschieben (Drag & Drop bzw. Pfeiltasten) */
  const moveImage = (key: string, to: number) =>
    setImages((list) => {
      const from = list.findIndex((x) => x.key === key);
      if (from < 0) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to > from ? to - 1 : to, 0, item);
      return next;
    });
  const [newCat, setNewCat] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = (files: Iterable<File>) => {
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    setImages((list) => [
      ...list,
      ...imgs.map((file) => {
        const preview = URL.createObjectURL(file);
        return { key: preview, kind: 'pending' as const, file, preview };
      }),
    ]);
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
    if (!title.trim() && !text.trim() && images.length === 0) {
      return setError('Bitte mindestens Titel, Beschreibung oder ein Bild angeben');
    }
    // Noch im Zeichenmodus → Gemaltes automatisch übernehmen
    const finalArea = drawing ? finishDraw() : area;
    setSaving(true);
    setError(null);
    try {
      const ownAttrIds = new Set(catAttributes.map((a) => a.id));
      const input = {
        area: finalArea,
        // nur Merkmale der aktuellen Kategorie (nach Kategoriewechsel fallen die alten weg)
        attributes: [...tags]
          .map((k) => {
            const i = k.indexOf(':');
            return { attribute_id: Number(k.slice(0, i)), value: k.slice(i + 1) };
          })
          .filter((t) => ownAttrIds.has(t.attribute_id)),
        country_iso: country.iso,
        category_id: categoryId,
        title: title.trim(),
        text,
        admin1: picked.flatMap((r) => (r.ref ? [{ ref: r.ref, name: r.name }] : [])),
        region_ids: picked.flatMap((r) => (!r.ref && r.id != null ? [r.id] : [])),
      };
      const saved = meta ? await api.updateMeta(meta.id, input) : await api.createMeta(input);
      for (const id of removed) await api.deleteImage(id);
      // Neue Bilder hochladen, dann die Reihenfolge der Liste übernehmen
      const ids: number[] = [];
      for (const item of images) {
        ids.push(item.kind === 'existing' ? item.img.id : (await api.uploadImage(saved.id, item.file)).id);
      }
      if (ids.length > 1) await api.orderImages(saved.id, ids);
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

        <label>Merkmale <span className="muted">(für die Rückwärtssuche 🔎)</span></label>
        <div className="tag-box">
          {catAttributes.length === 0 && (
            <span className="muted small-hint">
              Für diese Kategorie gibt es noch keine Merkmale – hier eins anlegen (z.B. „Muster“) oder in ⚙ Optionen → Merkmale.
            </span>
          )}
          {catAttributes.map((a) => (
            <div key={a.id} className="tag-row">
              <span className="tag-key">{a.key}</span>
              <span className="value-chips">
                {a.values.map((v) => {
                  const k = `${a.id}:${v}`;
                  return (
                    <button type="button" key={k} className={`chip ${tags.has(k) ? 'active' : ''}`} onClick={() => toggleTag(k)}>
                      {v}
                    </button>
                  );
                })}
                <input
                  className="value-add"
                  placeholder="+ Wert"
                  value={newTagValue[a.id] ?? ''}
                  onChange={(e) => setNewTagValue((n) => ({ ...n, [a.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTagValue(a))}
                />
              </span>
            </div>
          ))}
          <div className="row tag-new">
            <input
              placeholder="+ neues Merkmal, z.B. Farbe"
              value={newAttrKey}
              onChange={(e) => setNewAttrKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAttr())}
            />
            {newAttrKey.trim() && <button type="button" className="btn ghost small" onClick={addAttr}>Anlegen</button>}
          </div>
        </div>

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
        {images.length > 0 && (
          <>
            <div
              className="thumbs sortable"
              onDragOver={(e) => dragKey && e.preventDefault()}
              onDrop={(e) => {
                if (!dragKey) return;
                e.preventDefault();
                e.stopPropagation();
                moveImage(dragKey, dropIndex ?? images.length);
                setDragKey(null);
                setDropIndex(null);
              }}
            >
              {images.map((item, i) => (
                <div
                  key={item.key}
                  className={`thumb ${item.kind === 'pending' ? 'new' : ''} ${dragKey === item.key ? 'dragging' : ''} ${
                    dragKey && dropIndex === i ? 'drop-before' : ''
                  } ${dragKey && dropIndex === i + 1 && i === images.length - 1 ? 'drop-after' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setDragKey(item.key);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', item.key); // nötig für Firefox
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setDropIndex(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragKey) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDropIndex(e.clientX < r.left + r.width / 2 ? i : i + 1);
                  }}
                  title="Ziehen zum Sortieren – das erste Bild ist das Titelbild"
                >
                  <img src={item.kind === 'existing' ? item.img.url : item.preview} alt="" draggable={false} />
                  {i === 0 && images.length > 1 && <span className="thumb-badge">Titelbild</span>}
                  {images.length > 1 && <span className="thumb-num">{i + 1}</span>}
                  <button type="button" title="Entfernen" onClick={() => removeImage(item)}>×</button>
                </div>
              ))}
            </div>
            {images.length > 1 && (
              <span className="meta-region-hint">Bilder per Drag &amp; Drop sortieren – das erste ist das Titelbild in der Infografik.</span>
            )}
          </>
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
