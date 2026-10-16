import type { Server } from 'socket.io';
import type { Db } from './db';

/** Process-wide handles, set once at boot (or by tests). */
export const S = {
  db: null as unknown as Db,
  io: null as Server | null,
};
