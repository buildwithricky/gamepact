// Geometry and scoring shared by the arcade engines (server) and their boards (client).
// The server is the only place where shots are resolved; the client uses these to draw.

/** Aim spread: the sight "breathes" — widest at t=0, tightest at half a period. Fatigue after 5s. */
export function breathe(holdMs: number, periodMs: number, min: number, max: number): number {
  const t = Math.max(0, Math.min(holdMs, 20000));
  const base = min + (max - min) * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / periodMs));
  const fatigue = t > 5000 ? ((t - 5000) / 1000) * (max - min) * 0.15 : 0;
  return base + fatigue;
}

// ---------------- Darts (millimetres, origin = bull, y grows downward) ----------------
export const DARTS = {
  bullInner: 6.35,
  bullOuter: 15.9,
  trebleInner: 99,
  trebleOuter: 107,
  doubleInner: 162,
  doubleOuter: 170,
  frame: 225,
  sectors: [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5],
  spread: { period: 1600, min: 6, max: 34 },
};

export interface DartHit { score: number; label: string; ring: 'miss' | 'single' | 'double' | 'treble' | 'outer-bull' | 'bull' }

export function scoreDart(x: number, y: number): DartHit {
  const r = Math.hypot(x, y);
  if (r <= DARTS.bullInner) return { score: 50, label: 'Bull', ring: 'bull' };
  if (r <= DARTS.bullOuter) return { score: 25, label: '25', ring: 'outer-bull' };
  if (r > DARTS.doubleOuter) return { score: 0, label: 'Miss', ring: 'miss' };
  const deg = ((Math.atan2(x, -y) * 180) / Math.PI + 360 + 9) % 360;
  const n = DARTS.sectors[Math.floor(deg / 18) % 20];
  if (r >= DARTS.doubleInner) return { score: n * 2, label: `D${n}`, ring: 'double' };
  if (r >= DARTS.trebleInner && r <= DARTS.trebleOuter) return { score: n * 3, label: `T${n}`, ring: 'treble' };
  return { score: n, label: `${n}`, ring: 'single' };
}

/** Centre point of a named target such as T20, D16, 19, 25 or Bull — used by bots and tests. */
export function dartTarget(label: string): { x: number; y: number } {
  if (label === 'Bull') return { x: 0, y: 0 };
  if (label === '25') return { x: 0, y: -11 };
  const m = /^([DT]?)(\d+)$/.exec(label);
  if (!m) return { x: 0, y: 0 };
  const n = Number(m[2]);
  const idx = DARTS.sectors.indexOf(n);
  const r = m[1] === 'D' ? 166 : m[1] === 'T' ? 103 : 135;
  const a = (idx * 18 * Math.PI) / 180;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

// ---------------- Archery (target units; ring width 6, radius 60) ----------------
export const ARCHERY = {
  radius: 60,
  ring: 6,
  field: 90,
  driftPerWind: 5,
  spread: { period: 2000, min: 2.2, max: 13 },
};

export function scoreArrow(x: number, y: number): number {
  const r = Math.hypot(x, y);
  if (r >= ARCHERY.radius) return 0;
  return 10 - Math.floor(r / ARCHERY.ring);
}

// ---------------- Knockout (field units, field radius 100) ----------------
export const KNOCKOUT = {
  field: 100,
  targetRadius: (round: number) => Math.max(9, 26 - 3 * (round - 1)),
  period: (round: number) => Math.max(700, 1700 - 120 * (round - 1)),
  spread: { min: 3, max: 20 },
};

// ---------------- Cup pong (centimetres; shooter at y=0, x across the table) ----------------
export const PONG = {
  tableHalfWidth: 30,
  tableLength: 245,
  cupRadius: 4.75,
  ballRadius: 2,
  minDistance: 140,
  maxDistance: 265,
  maxAngle: 0.22,
  noise: 1.5,
};

export interface Cup { id: number; x: number; y: number }

export function pongRack(): Cup[] {
  const cups: Cup[] = [];
  const spacing = PONG.cupRadius * 2 + 0.3;
  const rowGap = spacing * Math.sin(Math.PI / 3);
  let id = 0;
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k <= row; k++) {
      cups.push({ id: id++, x: (k - row / 2) * spacing, y: 205 + row * rowGap });
    }
  }
  return cups;
}

/** Where a throw with exact input would land, before noise. */
export function pongLanding(angle: number, power: number): { x: number; y: number } {
  const a = Math.max(-PONG.maxAngle, Math.min(PONG.maxAngle, angle));
  const p = Math.max(0, Math.min(1, power));
  const d = PONG.minDistance + p * (PONG.maxDistance - PONG.minDistance);
  return { x: Math.sin(a) * d, y: Math.cos(a) * d };
}
