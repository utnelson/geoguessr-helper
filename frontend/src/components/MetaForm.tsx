import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Category, CountryInfo, Meta, MetaImage, RegionInfo } from '../types';

interface Props {
  country: CountryInfo;
  categories: Category[];
  meta: Meta | null; // null = neu anlegen
  regions: Map<string, RegionInfo> | null;
  /** vorausgewählte admin1-Regionen (adm1_code) für neue Metas, leer = ganzes Land */
  initialRegionRefs: string[];
  onClose: () => void;
  onSaved: () => void;
  onCategoryCreated: (c: Category) => void;
}

interface PendingFile {
  file: File;
  preview: string;
}

/** Region im Formular: admin1 (ref) oder vorhandene Region ohne admin1-Code (id) */
type PickedRegion = { ref: string | null; id: number | null; name: string };
const pickedKey = (r: PickedRegion) => (r.ref ? `ref:${r.ref}` : `id:${r.id}`);

export function MetaForm({ country, categories, meta, regions, initialRegionRefs, onClose, onSaved, onCategoryCreated }: Props) {
  const [categoryId, setCategoryId] = useState<number>(meta?.category_id ?? categories[0]?.id ?? 0);
  const [title, setTitle] = useState(meta?.title ?? '');
  const [text, setText] = useState(meta?.text ?? '');
  const [picked, setPicked] = useState<PickedRegion[]>(() =>
    meta
      ? meta.regions.map((r) => ({ ref: r.ref, id: r.id, name: (r.ref && regions?.get(r.ref)?.name) || r.name }))
      : initialRegionRefs.map((ref) => ({ ref, id: null, name: regions?.get(ref)?.name ?? ref })),
  );
  const pickedRefs = new Set(picked.map((r) => r.ref));
  const addRegion = (ref: string) => {
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
  const backdropDown = useRef(false);

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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    if (!title.trim()) return setError('Titel fehlt');
    setSaving(true);
    setError(null);
    try {
      const input = {
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
    // Schließen erst beim click (nicht mousedown) – sonst landet der Klick nach dem Schließen auf der Karte
    <div
      className="modal-backdrop"
      onMouseDown={(e) => (backdropDown.current = e.target === e.currentTarget)}
      onClick={(e) => backdropDown.current && e.target === e.currentTarget && onClose()}
    >
      <form className="modal" onSubmit={save}>
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
              <span key={pickedKey(r)} className="region-chip">
                {r.name}
                <button type="button" title="Entfernen" onClick={() => setPicked((p) => p.filter((x) => pickedKey(x) !== pickedKey(r)))}>×</button>
              </span>
            ))
          )}
          {regionList.length > 0 && (
            <select value="" onChange={(e) => addRegion(e.target.value)}>
              <option value="">+ Region hinzufügen…</option>
              {regionList.filter((r) => !pickedRefs.has(r.id)).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.type ? ` (${r.type})` : ''}
                </option>
              ))}
            </select>
          )}
          {picked.length > 0 && (
            <button type="button" className="btn ghost small" onClick={() => setPicked([])}>Ganzes Land</button>
          )}
        </div>
        {regions === null && <span className="meta-region-hint">Regionen werden geladen…</span>}

        <label>Titel</label>
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
    </div>
  );
}
