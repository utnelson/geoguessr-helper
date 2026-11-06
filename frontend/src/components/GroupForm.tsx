import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { GROUP_COLORS } from '../geo';
import type { CountryInfo, RegionGroup, RegionInfo } from '../types';

interface Props {
  country: CountryInfo;
  regions: Map<string, RegionInfo> | null;
  groups: RegionGroup[];
  group: RegionGroup | null; // null = neue Gruppe
  initialMembers: string[];
  onClose: () => void;
  onSaved: (g: RegionGroup | null) => void;
  onError: (msg: string) => void;
}

/** Regionsgruppe anlegen/bearbeiten, z.B. „Kansai“ aus mehreren Präfekturen */
export function GroupForm({ country, regions, groups, group, initialMembers, onClose, onSaved, onError }: Props) {
  const [name, setName] = useState(group?.name ?? '');
  const [color, setColor] = useState(group?.color ?? GROUP_COLORS[groups.length % GROUP_COLORS.length]);
  const [members, setMembers] = useState<string[]>(initialMembers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropDown = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const regionList = useMemo(
    () => (regions ? [...regions.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')) : []),
    [regions],
  );
  // In welcher anderen Gruppe steckt eine Region schon? (nur Hinweis – Überschneidungen sind erlaubt)
  const otherGroupOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) if (g.id !== group?.id) for (const ref of g.members) m.set(ref, g.name);
    return m;
  }, [groups, group]);

  const regionName = (ref: string) => regions?.get(ref)?.name ?? ref;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Name fehlt');
    if (members.length === 0) return setError('Mindestens eine Region auswählen');
    setSaving(true);
    setError(null);
    try {
      const input = { name: name.trim(), color, members };
      const saved = group ? await api.updateGroup(group.id, input) : await api.createGroup(country.iso, input);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!group) return;
    const uses = group.meta_count;
    const msg = uses
      ? `Gruppe „${group.name}“ löschen?\n\n${uses} Meta(s) nutzen sie – diese gelten danach für die einzelnen Regionen der Gruppe.`
      : `Gruppe „${group.name}“ löschen?`;
    if (!confirm(msg)) return;
    try {
      await api.deleteGroup(group.id, group.members.map((ref) => ({ ref, name: regionName(ref) })));
      onSaved(null);
    } catch (err) {
      onError((err as Error).message);
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
        <h2>{group ? 'Gruppe bearbeiten' : 'Neue Regionsgruppe'} · {country.name}</h2>

        <label>Name</label>
        <div className="row">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Kansai" />
          <input type="color" className="color-input" value={color} onChange={(e) => setColor(e.target.value)} title="Farbe auf der Karte" />
        </div>
        <div className="color-swatches">
          {GROUP_COLORS.map((c) => (
            <button key={c} type="button" className={`swatch ${c === color ? 'active' : ''}`} style={{ background: c }}
              onClick={() => setColor(c)} title={c} />
          ))}
        </div>

        <label>Regionen ({members.length})</label>
        <div className="region-picker">
          {members.map((ref) => (
            <span key={ref} className="region-chip" style={{ borderColor: color }}>
              {regionName(ref)}
              <button type="button" title="Entfernen" onClick={() => setMembers((m) => m.filter((x) => x !== ref))}>×</button>
            </span>
          ))}
          {regionList.length > 0 && (
            <select value="" onChange={(e) => e.target.value && setMembers((m) => [...m, e.target.value])}>
              <option value="">+ Region hinzufügen…</option>
              {regionList.filter((r) => !members.includes(r.id)).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{otherGroupOf.has(r.id) ? ` – in ${otherGroupOf.get(r.id)}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        <span className="meta-region-hint">
          Tipp: Regionen auf der Karte mit Strg+Klick markieren und dann „+ Gruppe aus Auswahl“ – die Auswahl wird hier übernommen.
        </span>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          {group && (
            <button type="button" className="btn ghost danger" onClick={remove} disabled={saving} style={{ marginRight: 'auto' }}>
              Gruppe löschen
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Speichere…' : 'Speichern'}</button>
        </div>
      </form>
    </div>
  );
}
