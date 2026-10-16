import type { Q } from './db';
import { newId } from './security';
import { S } from './state';

export type After = (() => void)[];

/** Store a notification and push it to the user's open tabs (after commit when `after` is given). */
export async function notify(q: Q, userId: string, type: string, payload: Record<string, unknown>, after?: After) {
  const id = newId(10);
  await q.query('INSERT INTO notifications (id, user_id, type, payload) VALUES ($1, $2, $3, $4)', [id, userId, type, JSON.stringify(payload)]);
  const emit = () => S.io?.to(`user:${userId}`).emit('notify', { id, type, payload, createdAt: new Date().toISOString(), readAt: null });
  if (after) after.push(emit);
  else emit();
}

export async function audit(q: Q, actorId: string | null, action: string, target: string | null, detail?: unknown) {
  await q.query('INSERT INTO audit_log (actor_id, action, target, detail) VALUES ($1, $2, $3, $4)', [actorId, action, target, detail ? JSON.stringify(detail) : null]);
}
