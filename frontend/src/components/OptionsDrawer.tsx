import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { CONTINENTS } from '../geo';
import type { BackupInfo, Category, CountryInfo } from '../types';

interface Props {
  countries: Map<string, CountryInfo>;
  disabled: Set<string>;
  stats: Record<string, number>;
  onDisabledChange: (isos: string[]) => Promise<void>;
  categories: Category[];
  onCategoriesChanged: () => Promise<void>;
  onClose: () => void;
}

const CONTINENT_NAMES: Record<string, string> = Object.fromEntries(CONTINENTS.map((c) => [c.id, c.name]));
const continentName = (id: string) => CONTINENT_NAMES[id] ?? (id === 'Antarctica' ? 'Antarktis' : 'Sonstige');

/** Optionen: Länder ein-/ausschalten, Kategorien verwalten */
export function OptionsDrawer({ countries, disabled, stats, onDisabledChange, categories, onCategoriesChanged, onClose }: Props) {
  const [tab, setTab] = useState<'countries' | 'categories' | 'backup'>('countries');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="drawer">
      <div className="modal drawer-form">
        <div className="drawer-head">
          <h2>⚙ Optionen</h2>
          <button className="btn ghost small" onClick={onClose} title="Schließen (Esc)">✕</button>
        </div>
        <div className="tabs">
          <button className={`tab ${tab === 'countries' ? 'active' : ''}`} onClick={() => setTab('countries')}>Länder</button>
          <button className={`tab ${tab === 'categories' ? 'active' : ''}`} onClick={() => setTab('categories')}>Kategorien</button>
          <button className={`tab ${tab === 'backup' ? 'active' : ''}`} onClick={() => setTab('backup')}>Backup</button>
        </div>
        {tab === 'countries' && <CountriesTab countries={countries} disabled={disabled} stats={stats} onChange={onDisabledChange} />}
        {tab === 'categories' && <CategoriesTab categories={categories} onChanged={onCategoriesChanged} />}
        {tab === 'backup' && <BackupTab />}
      </div>
    </aside>
  );
}

// ---------- Länder ----------

function CountriesTab({ countries, disabled, stats, onChange }: {
  countries: Map<string, CountryInfo>;
  disabled: Set<string>;
  stats: Record<string, number>;
  onChange: (isos: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const byContinent = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<string, CountryInfo[]>();
    for (const c of countries.values()) {
      if (q && !c.name.toLowerCase().includes(q) && !c.nameEn.toLowerCase().includes(q) && c.iso.toLowerCase() !== q) continue;
      const key = continentName(c.continent);
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    const order = [...CONTINENTS.map((c) => c.name), 'Antarktis', 'Sonstige'];
    return [...groups.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([name, list]) => [name, list.sort((a, b) => a.name.localeCompare(b.name, 'de'))] as const);
  }, [countries, query]);

  const save = async (next: Set<string>) => {
    setBusy(true);
    try {
      await onChange([...next]);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (iso: string) => {
    const next = new Set(disabled);
    if (next.has(iso)) next.delete(iso);
    else next.add(iso);
    save(next);
  };
  const setAll = (list: readonly CountryInfo[], off: boolean) => {
    const next = new Set(disabled);
    for (const c of list) {
      if (off) next.add(c.iso);
      else next.delete(c.iso);
    }
    save(next);
  };

  return (
    <>
      <p className="muted small-hint">
        Ausgeschaltete Länder sind auf der Karte grau und nicht anklickbar und tauchen nicht in Suche und Infografik auf –
        z.B. Länder ohne GeoGuessr-Coverage. Metas bleiben erhalten. {disabled.size} von {countries.size} ausgeschaltet.
      </p>
      <input placeholder="Land suchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="country-options">
        {byContinent.map(([name, list]) => {
          const active = list.filter((c) => !disabled.has(c.iso)).length;
          return (
            <details key={name} open={!!query}>
              <summary>
                <strong>{name}</strong>
                <span className="muted"> {active}/{list.length} aktiv</span>
                <span className="summary-actions">
                  <button type="button" className="btn ghost small" disabled={busy} onClick={(e) => { e.preventDefault(); setAll(list, false); }}>alle an</button>
                  <button type="button" className="btn ghost small" disabled={busy} onClick={(e) => { e.preventDefault(); setAll(list, true); }}>alle aus</button>
                </span>
              </summary>
              {list.map((c) => (
                <label key={c.iso} className={`country-option ${disabled.has(c.iso) ? 'off' : ''}`}>
                  <input type="checkbox" checked={!disabled.has(c.iso)} disabled={busy} onChange={() => toggle(c.iso)} />
                  {c.name}
                  {stats[c.iso] ? <span className="muted"> · {stats[c.iso]} Metas</span> : null}
                </label>
              ))}
            </details>
          );
        })}
      </div>
    </>
  );
}

// ---------- Kategorien ----------

function CategoriesTab({ categories, onChanged }: { categories: Category[]; onChanged: () => Promise<void> }) {
  const [names, setNames] = useState<Record<number, string>>({});
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<{ id: number; moveTo: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rename = (c: Category) => {
    const name = (names[c.id] ?? c.name).trim();
    if (!name || name === c.name) return setNames((n) => ({ ...n, [c.id]: c.name }));
    run(() => api.renameCategory(c.id, name));
  };
  const move = (i: number, dir: -1 | 1) => {
    const ids = categories.map((c) => c.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    run(() => api.orderCategories(ids));
  };
  const remove = (c: Category) => {
    if (c.meta_count) {
      const other = categories.find((x) => x.id !== c.id);
      if (other) setDeleting({ id: c.id, moveTo: other.id });
      return;
    }
    if (confirm(`Kategorie „${c.name}“ löschen?`)) run(() => api.deleteCategory(c.id));
  };
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    run(async () => {
      await api.createCategory(name);
      setNewName('');
    });
  };

  return (
    <>
      <p className="muted small-hint">Reihenfolge = Reihenfolge im Panel und in den Auswahllisten. Umbenennen: Namen ändern und Enter.</p>
      <div className="category-options">
        {categories.map((c, i) => (
          <div key={c.id} className="category-option">
            <div className="row">
              <button type="button" className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} title="Nach oben">↑</button>
              <button type="button" className="btn ghost small" disabled={i === categories.length - 1} onClick={() => move(i, 1)} title="Nach unten">↓</button>
              <input
                value={names[c.id] ?? c.name}
                onChange={(e) => setNames((n) => ({ ...n, [c.id]: e.target.value }))}
                onBlur={() => rename(c)}
                onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              />
              <span className="muted count">{c.meta_count ?? 0}</span>
              <button type="button" className="btn ghost small danger" onClick={() => remove(c)} title="Löschen">🗑</button>
            </div>
            {deleting?.id === c.id && (
              <div className="row delete-move">
                <span className="muted">{c.meta_count} Metas verschieben nach</span>
                <select value={deleting.moveTo} onChange={(e) => setDeleting({ id: c.id, moveTo: Number(e.target.value) })}>
                  {categories.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <button type="button" className="btn small danger" onClick={() => run(async () => {
                  await api.deleteCategory(c.id, deleting.moveTo);
                  setDeleting(null);
                })}>Löschen</button>
                <button type="button" className="btn ghost small" onClick={() => setDeleting(null)}>Abbrechen</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <input placeholder="Neue Kategorie, z.B. Bäume" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className="btn primary" onClick={add}>Anlegen</button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

// ---------- Backup ----------

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function BackupTab() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.backupInfo().then(setInfo).catch((e) => setMessage({ ok: false, text: (e as Error).message }));
  }, []);

  const restore = async () => {
    if (!file) return;
    const ok = confirm(
      `Backup „${file.name}“ einspielen?

Alle aktuellen Metas, Bilder, Gruppen und Einstellungen werden ersetzt. ` +
        'Der jetzige Stand wird vorher auf dem Server in einem Ordner „vor-restore-…“ gesichert.',
    );
    if (!ok) return;
    setMessage(null);
    setProgress(0);
    try {
      const r = await api.restoreBackup(file, setProgress);
      setMessage({ ok: true, text: `Eingespielt: ${r.metas} Metas, ${r.images} Bilder. Seite wird neu geladen…` });
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
      setProgress(null);
    }
  };

  return (
    <>
      <h3 className="options-h">Backup herunterladen</h3>
      <p className="muted small-hint">
        ZIP-Datei mit der Datenbank (Metas, Kategorien, Regionen, Gruppen, Einstellungen) und allen Bildern.
        Kann im laufenden Betrieb erstellt werden.
      </p>
      {info && (
        <p className="small-hint">
          {info.metas} Metas in {info.countries} Ländern · Datenbank {mb(info.db_bytes)} · {info.images} Bilder ({mb(info.image_bytes)})
        </p>
      )}
      <a className="btn primary" href="/api/backup" download>⬇ Backup herunterladen</a>

      <h3 className="options-h">Backup einspielen</h3>
      <p className="muted small-hint">
        Ersetzt <strong>alle</strong> aktuellen Daten durch das Backup. Der bisherige Stand wird auf dem Server vorher in
        <code> data/vor-restore-…</code> gesichert (die letzten 3 bleiben erhalten).
      </p>
      <input type="file" accept=".zip,application/zip" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMessage(null); }} />
      <button className="btn danger-solid" disabled={!file || progress !== null} onClick={restore}>
        {progress === null ? '⬆ Backup einspielen' : progress < 1 ? `Lade hoch… ${Math.round(progress * 100)} %` : 'Spiele ein…'}
      </button>
      {message && <p className={message.ok ? 'success' : 'error'}>{message.text}</p>}
      {info && info.restore_points.length > 0 && (
        <p className="muted small-hint">
          Automatische Sicherungen auf dem Server: {info.restore_points.map((p) => p.replace('vor-restore-', '')).join(', ')}
        </p>
      )}
    </>
  );
}
