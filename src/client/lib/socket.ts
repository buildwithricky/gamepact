import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** One socket per tab. Recreate after sign-in/out so the server sees the new session cookie. */
export function getSocket(): Socket {
  if (!socket) socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], withCredentials: true });
  return socket;
}

export function resetSocket() {
  socket?.disconnect();
  socket = null;
}

export function emit<T = any>(event: string, payload: unknown = {}): Promise<T & { ok: boolean; error?: string }> {
  const s = getSocket();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'The server didn’t answer. Check your connection.' } as any), 8000);
    s.emit(event, payload, (res: any) => { clearTimeout(timer); resolve(res); });
  });
}
