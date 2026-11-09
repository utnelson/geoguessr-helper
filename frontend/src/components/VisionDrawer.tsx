import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CountryInfo, OcrResult, SimilarResult, VisionStatus } from '../types';

interface Props {
  countries: Map<string, CountryInfo>;
  disabled: Set<string>;
  onOpenCountry: (iso: string) => void;
  onOpenMeta: (metaId: number, iso: string) => void;
  onOpenImage: (url: string) => void;
  /** Länder aus dem Ergebnis auf der Karte markieren (null = keine Markierung) */
  onMarks: (isos: Set<string> | null) => void;
  onClose: () => void;
}

type Rect = { x: number; y: number; w: number; h: number }; // in Bildpixeln

/** Bild (ganz oder Ausschnitt) als PNG-Blob */
async function cropToBlob(img: HTMLImageElement, rect: Rect | null): Promise<Blob> {
  const r = rect ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(r.w));
  canvas.height = Math.max(1, Math.round(r.h));
  canvas.getContext('2d')!.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erstellt werden'))), 'image/png'));
}

const pct = (s: number) => `${Math.round(s * 100)} %`;

/**
 * Bilderkennung: Screenshot einfügen (Strg+V), optional Ausschnitt ziehen, dann
 * – Ähnliche Bilder (CLIP): ähnlichste Bilder aus deinen Metas → Länder
 * – Schrift lesen (OCR): Text + Schrift → Länder-Vorschläge aus Sonderzeichen/Schriftsystem
 */
export function VisionDrawer({ countries, disabled, onOpenCountry, onOpenMeta, onOpenImage, onMarks, onClose }: Props) {
  const [status, setStatus] = useState<VisionStatus | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState<'similar' | 'ocr' | null>(null);
  const [similar, setSimilar] = useState<SimilarResult | null>(null);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const name = (iso: string) => countries.get(iso)?.name ?? iso;

  // Status (inkl. Fortschritt der Bild-Indexierung) regelmäßig abfragen
  useEffect(() => {
    let alive = true;
    const load = () => api.visionStatus().then((s) => alive && setStatus(s)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const setImage = (file: File | Blob) => {
    if (src) URL.revokeObjectURL(src);
    setSrc(URL.createObjectURL(file));
    setRect(null);
    setSimilar(null);
    setOcr(null);
    setError(null);
    onMarks(null);
  };

  // Strg+V: Screenshot einfügen
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        setImage(file);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  });

  // Beim Schließen Markierung entfernen
  useEffect(() => () => onMarks(null), [onMarks]);

  // Ausschnitt ziehen (Mauskoordinaten → Bildpixel)
  const toImage = (e: React.PointerEvent) => {
    const img = imgRef.current!;
    const b = img.getBoundingClientRect();
    const sx = img.naturalWidth / b.width;
    const sy = img.naturalHeight / b.height;
    return {
      x: Math.max(0, Math.min(img.naturalWidth, (e.clientX - b.left) * sx)),
      y: Math.max(0, Math.min(img.naturalHeight, (e.clientY - b.top) * sy)),
    };
  };

  const run = async (kind: 'similar' | 'ocr') => {
    if (!imgRef.current) return;
    setBusy(kind);
    setError(null);
    try {
      const blob = await cropToBlob(imgRef.current, rect);
      const allowed = (iso: string) => !disabled.has(iso);
      if (kind === 'similar') {
        const r = await api.similarImages(blob);
        const res = { ...r, images: r.images.filter((i) => allowed(i.country_iso)), countries: r.countries.filter((c) => allowed(c.iso)) };
        setSimilar(res);
        onMarks(new Set(res.countries.slice(0, 5).map((c) => c.iso)));
      } else {
        const r = await api.ocr(blob);
        const res = { ...r, hints: r.hints.filter((h) => allowed(h.iso)) };
        setOcr(res);
        onMarks(res.hints.length ? new Set(res.hints.filter((h) => h.score >= res.hints[0].score * 0.5).map((h) => h.iso)) : null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Rahmen in Anzeige-Prozent (für das Overlay)
  const img = imgRef.current;
  const box = rect && img ? {
    left: `${(rect.x / img.naturalWidth) * 100}%`, top: `${(rect.y / img.naturalHeight) * 100}%`,
    width: `${(rect.w / img.naturalWidth) * 100}%`, height: `${(rect.h / img.naturalHeight) * 100}%`,
  } : null;

  return (
    <aside className="drawer">
      <div className="modal drawer-form vision">
        <div className="drawer-head">
          <h2>📷 Bilderkennung</h2>
          <button className="btn ghost small" onClick={onClose} title="Schließen (Esc)">✕</button>
        </div>

        <div className="muted small-hint vision-status">
          {!status ? (
            'Prüfe Bilderkennung…'
          ) : (
            <>
              <div>
                🔤 Texterkennung (OCR):{' '}
                {!status.ocr.configured ? 'nicht aktiviert' : status.ocr.available ? '✓ bereit' : '⚠ Container „ocr“ nicht erreichbar'}
              </div>
              <div>
                🔍 Bildsuche (CLIP):{' '}
                {!status.clip.configured
                  ? 'nicht aktiviert (optional, siehe README → „CLIP aktivieren“)'
                  : !status.clip.available
                    ? '⚠ Container „clip“ nicht erreichbar'
                    : `✓ bereit · ${status.clip.indexed}/${status.clip.total} Bilder indexiert${status.clip.indexing ? ' (läuft…)' : ''}`}
              </div>
            </>
          )}
        </div>

        {!src ? (
          <div
            className="dropzone vision-drop"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
              if (f) setImage(f);
            }}
          >
            Screenshot mit <kbd>Strg</kbd>+<kbd>V</kbd> einfügen, hierher ziehen oder klicken
          </div>
        ) : (
          <>
            <div
              className="vision-image"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                const p = toImage(e);
                setDrag(p);
                setRect({ x: p.x, y: p.y, w: 0, h: 0 });
              }}
              onPointerMove={(e) => {
                if (!drag) return;
                const p = toImage(e);
                setRect({ x: Math.min(p.x, drag.x), y: Math.min(p.y, drag.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) });
              }}
              onPointerUp={() => {
                setDrag(null);
                setRect((r) => (r && r.w > 8 && r.h > 8 ? r : null)); // Klick ohne Ziehen = ganzes Bild
              }}
            >
              <img ref={imgRef} src={src} alt="" draggable={false} />
              {box && <div className="vision-rect" style={box} />}
            </div>
            <div className="row vision-tools">
              <span className="muted small-hint">
                {rect ? `Ausschnitt ${Math.round(rect.w)}×${Math.round(rect.h)} px` : 'Ganzes Bild – Rahmen ziehen für einen Ausschnitt (z.B. nur der Mast)'}
              </span>
              {rect && <button className="btn ghost small" onClick={() => setRect(null)}>Ausschnitt aufheben</button>}
              <button className="btn ghost small" onClick={() => fileInput.current?.click()}>Anderes Bild</button>
            </div>
          </>
        )}
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setImage(f);
          e.target.value = '';
        }} />

        <div className="row vision-actions">
          <button className="btn primary" disabled={!src || !!busy || !status?.clip.available} onClick={() => run('similar')}
            title={status?.clip.available ? 'CLIP: vergleicht das Bild mit allen Bildern deiner Metas' : 'Bildsuche (CLIP) ist nicht aktiviert'}>
            {busy === 'similar' ? 'Suche…' : '🔍 Ähnliche Bilder'}
          </button>
          <button className="btn primary" disabled={!src || !!busy || !status?.ocr.available} onClick={() => run('ocr')}
            title="OCR: liest Schrift und schlägt Länder anhand von Schriftsystem und Sonderzeichen vor">
            {busy === 'ocr' ? 'Lese…' : '🔤 Schrift lesen'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}

        {similar && (
          <section className="vision-result">
            <h3>Ähnliche Bilder – wahrscheinlichste Länder</h3>
            {similar.indexed === 0 && <p className="muted small-hint">Noch keine Bilder indexiert – füge Metas mit Bildern hinzu.</p>}
            <div className="vision-countries">
              {similar.countries.slice(0, 8).map((c, i) => (
                <button key={c.iso} className="vision-country" onClick={() => onOpenCountry(c.iso)} title="Land öffnen">
                  <span className="rank">{i + 1}.</span> {name(c.iso)}
                  <span className="bar"><i style={{ width: pct(Math.max(0, (c.score - 0.5) * 2)) }} /></span>
                  <span className="muted">{pct(c.score)}</span>
                </button>
              ))}
            </div>
            <div className="vision-images">
              {similar.images.slice(0, 18).map((im) => (
                <figure key={im.image_id} title={`${name(im.country_iso)} · ${im.category_name}${im.title ? ` · ${im.title}` : ''}`}>
                  <img src={im.url} alt="" onClick={() => onOpenImage(im.url)} />
                  <figcaption>
                    <button className="link" onClick={() => onOpenMeta(im.meta_id, im.country_iso)}>{name(im.country_iso)}</button>
                    <span className="muted"> {pct(im.score)}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="muted small-hint">
              Die Top-5-Länder sind auf der Karte markiert. Je mehr Bilder deine Metas haben, desto besser trifft die Suche.
            </p>
          </section>
        )}

        {ocr && (
          <section className="vision-result">
            <h3>
              Erkannte Schrift{ocr.script ? `: ${ocr.script}` : ''}
              {ocr.language && <span className="ocr-lang"> · Sprache vermutlich {ocr.language.name}</span>}
            </h3>
            {ocr.text ? <pre className="ocr-text">{ocr.text}</pre> : <p className="muted small-hint">Kein Text erkannt – Ausschnitt enger um das Schild ziehen.</p>}
            {ocr.variants.length > 1 && (
              <details className="ocr-variants">
                <summary className="muted small-hint">{ocr.variants.length} Lesarten (verschiedene Sprachmodelle)</summary>
                {ocr.variants.map((v) => (
                  <div key={v.lang} className="small-hint"><span className="muted">{v.lang} {Math.round(v.confidence)} %:</span> {v.text}</div>
                ))}
              </details>
            )}
            {ocr.hints.length > 0 ? (
              <div className="vision-countries">
                {ocr.hints.slice(0, 10).map((h) => (
                  <button key={h.iso} className="vision-country" onClick={() => onOpenCountry(h.iso)} title="Land öffnen">
                    {name(h.iso)}
                    <span className="ocr-reasons">{h.reasons.join(' ')}</span>
                  </button>
                ))}
              </div>
            ) : ocr.text ? (
              <p className="muted small-hint">Keine eindeutigen Sonderzeichen oder Schriftsysteme gefunden.</p>
            ) : null}
            <p className="muted small-hint">{ocr.ms} ms · Vorschläge kommen aus Schriftsystem und Sonderzeichen (z.B. ő → Ungarn).</p>
          </section>
        )}
      </div>
    </aside>
  );
}
