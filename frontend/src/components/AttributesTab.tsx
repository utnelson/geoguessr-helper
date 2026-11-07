import { useMemo, useState } from 'react';
import { api } from '../api';
import { valueCountryCounts } from '../filters';
import type { Attribute, AttributeValueRow, Category } from '../types';

interface Props {
  categories: Category[];
  attributes: Attribute[];
  rows: AttributeValueRow[];
  /** nach jeder Änderung: Merkmale + vergebene Werte neu laden */
  onChanged: () => Promise<void>;
}

/**
 * Optionen → Merkmale: pro Kategorie Merkmale mit möglichen Werten festlegen,
 * z.B. Masten → „Muster“: Waffel, Löcher, glatt. Diese Werte vergibst du im Meta-Formular
 * und filterst danach in der Rückwärtssuche.
 */
export function AttributesTab({ categories, attributes, rows, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<Record<number, string>>({});
  const [newValue, setNewValue] = useState<Record<number, string>>({});
  const [keyEdit, setKeyEdit] = useState<Record<number, string>>({});
  const counts = useMemo(() => valueCountryCounts(rows), [rows]);
  const usedBy = (attrId: number, value: string) => rows.filter((r) => r.attribute_id === attrId && r.value === value).length;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addAttribute = (categoryId: number) => {
    const key = (newKey[categoryId] ?? '').trim();
    if (!key) return;
    run(async () => {
      await api.createAttribute({ category_id: categoryId, key, values: [] });
      setNewKey((n) => ({ ...n, [categoryId]: '' }));
    });
  };
  const addValue = (a: Attribute) => {
    const v = (newValue[a.id] ?? '').trim();
    if (!v || a.values.includes(v)) return;
    run(async () => {
      await api.updateAttribute(a.id, { values: [...a.values, v] });
      setNewValue((n) => ({ ...n, [a.id]: '' }));
    });
  };
  const removeValue = (a: Attribute, v: string) => {
    const n = usedBy(a.id, v);
    if (n && !confirm(`„${v}“ ist an ${n} Meta(s) vergeben und wird dort entfernt. Fortfahren?`)) return;
    run(() => api.updateAttribute(a.id, { values: a.values.filter((x) => x !== v) }));
  };
  const renameValue = (a: Attribute, v: string) => {
    const to = prompt(`Wert „${v}“ umbenennen in:`, v)?.trim();
    if (!to || to === v) return;
    run(() => api.updateAttribute(a.id, { rename: { from: v, to } }));
  };
  const renameKey = (a: Attribute) => {
    const key = (keyEdit[a.id] ?? a.key).trim();
    if (!key || key === a.key) return setKeyEdit((k) => ({ ...k, [a.id]: a.key }));
    run(() => api.updateAttribute(a.id, { key }));
  };
  const removeAttribute = (a: Attribute) => {
    const n = rows.filter((r) => r.attribute_id === a.id).length;
    if (!confirm(`Merkmal „${a.key}“ löschen?${n ? `\n\nEs ist ${n}× an Metas vergeben – diese Angaben gehen verloren.` : ''}`)) return;
    run(() => api.deleteAttribute(a.id));
  };

  return (
    <>
      <p className="muted small-hint">
        Merkmale beschreiben, was man im Spiel sieht – z.B. <em>Masten → Muster: Waffel, Löcher, glatt</em> oder
        <em> Straße → Fahrseite: links, rechts</em>. Im Meta-Formular klickst du die passenden Werte an, über
        <strong> 🔎 Filter</strong> oben grenzt du dann die Länder ein. Wert anklicken = umbenennen.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="attr-options">
        {categories.map((c) => {
          const list = attributes.filter((a) => a.category_id === c.id);
          return (
            <details key={c.id} open={list.length > 0}>
              <summary>
                <strong>{c.name}</strong>
                <span className="muted"> {list.length ? `${list.length} Merkmal${list.length > 1 ? 'e' : ''}` : 'noch keine Merkmale'}</span>
              </summary>
              {list.map((a) => (
                <div key={a.id} className="attr-option">
                  <div className="row">
                    <input
                      className="attr-key"
                      value={keyEdit[a.id] ?? a.key}
                      onChange={(e) => setKeyEdit((k) => ({ ...k, [a.id]: e.target.value }))}
                      onBlur={() => renameKey(a)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                      title="Name des Merkmals"
                    />
                    <button type="button" className="btn ghost small danger" onClick={() => removeAttribute(a)} title="Merkmal löschen">🗑</button>
                  </div>
                  <div className="value-chips">
                    {a.values.map((v) => (
                      <span key={v} className="value-chip">
                        <button type="button" className="value-name" onClick={() => renameValue(a, v)} title="Umbenennen">
                          {v}
                          {counts.get(`${a.id}:${v}`) ? (
                            <span className="chip-count"> {counts.get(`${a.id}:${v}`)} {counts.get(`${a.id}:${v}`) === 1 ? 'Land' : 'Länder'}</span>
                          ) : null}
                        </button>
                        <button type="button" onClick={() => removeValue(a, v)} title="Wert entfernen">×</button>
                      </span>
                    ))}
                    <input
                      className="value-add"
                      placeholder="+ Wert"
                      value={newValue[a.id] ?? ''}
                      onChange={(e) => setNewValue((n) => ({ ...n, [a.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && addValue(a)}
                      onBlur={() => addValue(a)}
                    />
                  </div>
                </div>
              ))}
              <div className="row attr-add">
                <input
                  placeholder={`Neues Merkmal für ${c.name}, z.B. Muster`}
                  value={newKey[c.id] ?? ''}
                  onChange={(e) => setNewKey((n) => ({ ...n, [c.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && addAttribute(c.id)}
                />
                <button type="button" className="btn ghost small" onClick={() => addAttribute(c.id)}>+ Merkmal</button>
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
