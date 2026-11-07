// Pinsel → Polygon: Die gemalte Fläche (Canvas-Alpha) wird per Marching Squares in Umrisse
// umgewandelt, vereinfacht und in Außenringe + Löcher sortiert. Ohne externe Bibliotheken.
import type { MultiPolygon, Position } from 'geojson';

type Pt = [number, number];

/** Kanten-Mittelpunkte einer Zelle (doppelte Koordinaten, damit alles ganzzahlig bleibt) */
const edge = {
  top: (i: number, j: number): Pt => [2 * i + 1, 2 * j],
  right: (i: number, j: number): Pt => [2 * i + 2, 2 * j + 1],
  bottom: (i: number, j: number): Pt => [2 * i + 1, 2 * j + 2],
  left: (i: number, j: number): Pt => [2 * i, 2 * j + 1],
};
type Edge = keyof typeof edge;

// Index = tl*8 + tr*4 + br*2 + bl*1 → Liniensegmente zwischen Kanten
const CASES: Record<number, [Edge, Edge][]> = {
  1: [['left', 'bottom']],
  2: [['bottom', 'right']],
  3: [['left', 'right']],
  4: [['top', 'right']],
  5: [['left', 'top'], ['bottom', 'right']], // Sattel: getrennt lassen
  6: [['top', 'bottom']],
  7: [['left', 'top']],
  8: [['left', 'top']],
  9: [['top', 'bottom']],
  10: [['top', 'right'], ['left', 'bottom']], // Sattel
  11: [['top', 'right']],
  12: [['left', 'right']],
  13: [['bottom', 'right']],
  14: [['left', 'bottom']],
};

function simplify(ring: Pt[], tol: number): Pt[] {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let max = -1, idx = -1;
    for (let k = a + 1; k < b; k++) {
      const [px, py] = ring[k];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d > max) (max = d), (idx = k);
    }
    if (max > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return ring.filter((_, k) => keep[k]);
}

const area = (r: Pt[]) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
};

function inside([x, y]: Pt, r: Pt[]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Umrisse der gemalten Fläche in Pixelkoordinaten.
 * Ergebnis: Polygone, jeweils [Außenring, ...Löcher] (Ringe nicht geschlossen).
 */
export function traceMask(rgba: Uint8ClampedArray, width: number, height: number, cell = 2): Pt[][][] {
  const gw = Math.ceil(width / cell) + 2; // +2: leerer Rand, damit alle Umrisse geschlossen sind
  const gh = Math.ceil(height / cell) + 2;
  const grid = new Uint8Array(gw * gh);
  for (let j = 1; j < gh - 1; j++) {
    const y = Math.min(height - 1, Math.floor((j - 1) * cell + cell / 2));
    for (let i = 1; i < gw - 1; i++) {
      const x = Math.min(width - 1, Math.floor((i - 1) * cell + cell / 2));
      grid[j * gw + i] = rgba[(y * width + x) * 4 + 3] > 64 ? 1 : 0;
    }
  }

  // Segmente sammeln und an ihren Endpunkten verknüpfen
  const key = (p: Pt) => p[0] * 100003 + p[1];
  const segments: [Pt, Pt][] = [];
  const links = new Map<number, Pt[]>();
  const link = (a: Pt, b: Pt) => {
    segments.push([a, b]);
    for (const [p, q] of [[a, b], [b, a]] as [Pt, Pt][]) {
      const list = links.get(key(p));
      if (list) list.push(q);
      else links.set(key(p), [q]);
    }
  };
  for (let j = 0; j < gh - 1; j++) {
    for (let i = 0; i < gw - 1; i++) {
      const idx = grid[j * gw + i] * 8 + grid[j * gw + i + 1] * 4 + grid[(j + 1) * gw + i + 1] * 2 + grid[(j + 1) * gw + i];
      for (const [a, b] of CASES[idx] ?? []) link(edge[a](i, j), edge[b](i, j));
    }
  }

  // Segmente zu geschlossenen Ringen verbinden (jeder Punkt hat genau zwei Nachbarn)
  const segKey = (a: Pt, b: Pt) => (key(a) < key(b) ? `${key(a)}-${key(b)}` : `${key(b)}-${key(a)}`);
  const used = new Set<string>();
  const rings: Pt[][] = [];
  for (const [a, b] of segments) {
    if (used.has(segKey(a, b))) continue;
    used.add(segKey(a, b));
    const ring: Pt[] = [a];
    let cur = b;
    while (key(cur) !== key(a)) {
      ring.push(cur);
      const next = links.get(key(cur))!.find((p) => !used.has(segKey(cur, p)));
      if (!next) break;
      used.add(segKey(cur, next));
      cur = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }

  // Doppelte Koordinaten → Pixel, vereinfachen, Krümel verwerfen
  const toPx = ([X, Y]: Pt): Pt => [(X / 2 - 1) * cell + cell / 2, (Y / 2 - 1) * cell + cell / 2];
  const cleaned = rings
    .map((r) => simplify([...r.map(toPx), toPx(r[0])], cell * 0.8).slice(0, -1))
    .filter((r) => r.length >= 3 && area(r) >= (cell * 3) ** 2)
    .map((r) => ({ ring: r, area: area(r) }));

  // Außenringe (gerade Verschachtelungstiefe) und Löcher (ungerade) zuordnen
  const depth = cleaned.map((c, k) => cleaned.filter((o, m) => m !== k && o.area > c.area && inside(c.ring[0], o.ring)).length);
  const outers = cleaned.map((c, k) => ({ ...c, k })).filter(({ k }) => depth[k] % 2 === 0);
  const polys = new Map<number, Pt[][]>(outers.map((o) => [o.k, [o.ring]]));
  cleaned.forEach((c, k) => {
    if (depth[k] % 2 === 0) return;
    const parent = outers
      .filter((o) => o.area > c.area && inside(c.ring[0], o.ring))
      .sort((a, b) => a.area - b.area)[0];
    if (parent) polys.get(parent.k)!.push(c.ring);
  });
  return [...polys.values()];
}

/** Pixel-Polygone → GeoJSON (über eine Projektionsfunktion, z.B. map.unproject) */
export function toMultiPolygon(polys: Pt[][][], unproject: (p: Pt) => Pt): MultiPolygon | null {
  if (polys.length === 0) return null;
  const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
  return {
    type: 'MultiPolygon',
    coordinates: polys.map((rings) =>
      rings.map((ring) => {
        const pts: Position[] = ring.map((p) => {
          const [lng, lat] = unproject(p);
          return [r5(lng), r5(lat)];
        });
        pts.push(pts[0]); // GeoJSON-Ringe sind geschlossen
        return pts;
      }),
    ),
  };
}

/** GeoJSON-Fläche auf ein Canvas malen (z.B. um ein Gebiet weiterzubearbeiten) */
export function paintGeometry(ctx: CanvasRenderingContext2D, geom: MultiPolygon, project: (p: Position) => Pt) {
  ctx.beginPath();
  for (const rings of geom.coordinates) {
    for (const ring of rings) {
      ring.forEach((p, k) => {
        const [x, y] = project(p);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
  }
  ctx.fill('evenodd');
}
