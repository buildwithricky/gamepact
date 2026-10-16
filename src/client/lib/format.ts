export function timeAgo(iso: string | number | Date) {
  const d = typeof iso === 'object' ? iso.getTime() : new Date(iso).getTime();
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function when(iso: string) {
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  const sameDay = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diff < 0 && diff > -60_000) return 'now';
  if (sameDay) return `today, ${t}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${t}`;
}

export function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
