import type { Ctx } from './types';

/** Parse and clamp an aim intent {x, y, hold}. Returns null if malformed. */
export function readAim(raw: unknown, limit: number): { x: number; y: number; hold: number } | null {
  const a = raw as { x?: unknown; y?: unknown; hold?: unknown };
  const x = Number(a?.x), y = Number(a?.y), hold = Number(a?.hold);
  if (![x, y, hold].every(Number.isFinite)) return null;
  const r = Math.hypot(x, y);
  const k = r > limit ? limit / r : 1;
  return { x: x * k, y: y * k, hold: Math.max(0, Math.min(hold, 20_000)) };
}

/** Scatter a shot around the aim point using server-side randomness. */
export function scatter(ctx: Ctx, x: number, y: number, spread: number) {
  return { x: x + ctx.gauss() * spread * 0.6, y: y + ctx.gauss() * spread * 0.6 };
}

/** A human-ish release: near the steadiest moment, with some error. */
export function botHold(ctx: Ctx, period: number, skill = 0.8) {
  return period / 2 + ctx.gauss() * period * 0.18 * (1.2 - skill);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
