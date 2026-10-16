// Mini golf courses and the deterministic ball simulation.
// The server runs simulate() to resolve every stroke and sends the path to clients to animate.

export type Seg = [number, number, number, number];
export interface Rect { x: number; y: number; w: number; h: number }
export interface Slope extends Rect { ax: number; ay: number }

export interface Hole {
  name: string;
  par: number;
  tee: { x: number; y: number };
  cup: { x: number; y: number };
  /** Closed outline of the green, clockwise. */
  outline: [number, number][];
  blocks: Rect[];
  sand: Rect[];
  water: Rect[];
  slopes: Slope[];
}

export const COURSE_W = 360;
export const COURSE_H = 640;
export const BALL_R = 6;
export const CUP_R = 11;
export const MAX_SPEED = 720;
export const MAX_STROKES = 8;

const box = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

export const HOLES: Hole[] = [
  {
    name: 'Straight away', par: 2,
    tee: { x: 180, y: 540 }, cup: { x: 180, y: 130 },
    outline: box(100, 60, 260, 600),
    blocks: [{ x: 150, y: 320, w: 60, h: 24 }], sand: [], water: [], slopes: [],
  },
  {
    name: 'Dogleg', par: 3,
    tee: { x: 120, y: 550 }, cup: { x: 255, y: 125 },
    outline: [[60, 60], [300, 60], [300, 210], [180, 210], [180, 600], [60, 600]],
    blocks: [], sand: [{ x: 200, y: 60, w: 100, h: 34 }], water: [], slopes: [],
  },
  {
    name: 'Bunker hill', par: 3,
    tee: { x: 180, y: 560 }, cup: { x: 180, y: 110 },
    outline: box(60, 60, 300, 600),
    blocks: [{ x: 140, y: 310, w: 80, h: 36 }],
    sand: [{ x: 100, y: 165, w: 160, h: 50 }], water: [], slopes: [],
  },
  {
    name: 'The moat', par: 3,
    tee: { x: 120, y: 560 }, cup: { x: 120, y: 115 },
    outline: box(60, 60, 300, 600),
    blocks: [], sand: [], water: [{ x: 60, y: 300, w: 180, h: 56 }], slopes: [],
  },
  {
    name: 'Uphill battle', par: 2,
    tee: { x: 180, y: 560 }, cup: { x: 180, y: 120 },
    outline: box(80, 60, 280, 600),
    blocks: [], sand: [], water: [],
    slopes: [{ x: 80, y: 200, w: 200, h: 200, ax: 0, ay: 230 }],
  },
  {
    name: 'Zigzag', par: 4,
    tee: { x: 85, y: 560 }, cup: { x: 280, y: 115 },
    outline: box(40, 60, 320, 600),
    blocks: [{ x: 40, y: 410, w: 190, h: 20 }, { x: 130, y: 230, w: 190, h: 20 }],
    sand: [{ x: 230, y: 470, w: 90, h: 40 }], water: [], slopes: [],
  },
];

function rectSegs(r: Rect): Seg[] {
  const { x, y, w, h } = r;
  return [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]];
}

export function holeSegments(h: Hole): Seg[] {
  const segs: Seg[] = [];
  for (let i = 0; i < h.outline.length; i++) {
    const [ax, ay] = h.outline[i];
    const [bx, by] = h.outline[(i + 1) % h.outline.length];
    segs.push([ax, ay, bx, by]);
  }
  for (const b of h.blocks) segs.push(...rectSegs(b));
  return segs;
}

const inRect = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export interface ShotResult {
  path: [number, number][];
  end: { x: number; y: number };
  sunk: boolean;
  water: boolean;
}

export function simulate(h: Hole, start: { x: number; y: number }, angle: number, power: number): ShotResult {
  const segs = holeSegments(h);
  const p = { x: start.x, y: start.y };
  const speed0 = Math.max(0, Math.min(1, power)) * MAX_SPEED;
  const v = { x: Math.cos(angle) * speed0, y: Math.sin(angle) * speed0 };
  const dt = 1 / 240;
  const path: [number, number][] = [[round1(p.x), round1(p.y)]];
  let sunk = false;
  let water = false;

  for (let step = 0; step < 240 * 14; step++) {
    let ax = 0;
    let ay = 0;
    let decel = 170;
    for (const s of h.slopes) if (inRect(s, p.x, p.y)) { ax += s.ax; ay += s.ay; }
    for (const s of h.sand) if (inRect(s, p.x, p.y)) decel = 900;

    v.x += ax * dt;
    v.y += ay * dt;
    const sp = Math.hypot(v.x, v.y);
    if (sp > 0) {
      const ns = Math.max(0, sp - decel * dt) * (1 - 0.25 * dt);
      v.x = (v.x / sp) * ns;
      v.y = (v.y / sp) * ns;
    }
    p.x += v.x * dt;
    p.y += v.y * dt;

    for (const [x1, y1, x2, y2] of segs) {
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / len2));
      const cx = x1 + t * dx, cy = y1 + t * dy;
      const ox = p.x - cx, oy = p.y - cy;
      const d = Math.hypot(ox, oy);
      if (d < BALL_R && d > 1e-9) {
        const nx = ox / d, ny = oy / d;
        p.x = cx + nx * BALL_R;
        p.y = cy + ny * BALL_R;
        const vn = v.x * nx + v.y * ny;
        if (vn < 0) { v.x -= 1.78 * vn * nx; v.y -= 1.78 * vn * ny; }
      }
    }

    const cupD = Math.hypot(p.x - h.cup.x, p.y - h.cup.y);
    const speed = Math.hypot(v.x, v.y);
    if (cupD < CUP_R - 2 && speed < 330) { sunk = true; p.x = h.cup.x; p.y = h.cup.y; path.push([p.x, p.y]); break; }
    if (cupD < CUP_R && speed < 330) {
      // Gravity pulls a slow ball over the lip into the cup.
      v.x += ((h.cup.x - p.x) / cupD) * 900 * dt;
      v.y += ((h.cup.y - p.y) / cupD) * 900 * dt;
    }
    if (h.water.some((w) => inRect(w, p.x, p.y))) { water = true; path.push([round1(p.x), round1(p.y)]); break; }

    if (step % 4 === 0) path.push([round1(p.x), round1(p.y)]);
    const slopePull = Math.hypot(ax, ay);
    if (speed < 5 && slopePull < decel) break;
  }
  const end = water ? { ...start } : { x: round1(p.x), y: round1(p.y) };
  if (!sunk && !water) path.push([end.x, end.y]);
  return { path, end, sunk, water };
}

function round1(n: number) { return Math.round(n * 10) / 10; }
