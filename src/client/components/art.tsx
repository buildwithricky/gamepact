import type { GameId } from '../../shared/catalog';

const INK = '#0A0B24';
const CHALK = '#FFFDF6';
const s = { stroke: INK, strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

/** Original flat illustrations for each game, drawn on the category colour. */
export function GameArt({ id }: { id: GameId | string }) {
  switch (id) {
    case 'darts':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          <circle cx="44" cy="42" r="32" fill={CHALK} {...s} />
          <circle cx="44" cy="42" r="22" fill={INK} />
          <circle cx="44" cy="42" r="14" fill={CHALK} />
          <circle cx="44" cy="42" r="5" fill="#FF5D73" {...s} strokeWidth={2} />
          <path d="M47 39 L86 10" {...s} strokeWidth={4} />
          <path d="M80 8 l10 -4 l-3 11 z" fill="#FFD23F" {...s} strokeWidth={2.5} />
        </svg>
      );
    case 'cup-pong':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          {[[50, 20], [38, 38], [62, 38], [26, 56], [50, 56], [74, 56]].map(([x, y], i) => (
            <g key={i}><ellipse cx={x} cy={y} rx="11" ry="9" fill={CHALK} {...s} /><ellipse cx={x} cy={y - 1} rx="7" ry="4.5" fill={INK} /></g>
          ))}
          <circle cx="84" cy="18" r="6" fill="#FFD23F" {...s} />
        </svg>
      );
    case 'mini-golf':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          <ellipse cx="56" cy="62" rx="34" ry="10" fill="#2DE1C2" {...s} />
          <ellipse cx="64" cy="61" rx="6" ry="3" fill={INK} />
          <path d="M64 61 V14" {...s} strokeWidth={4} />
          <path d="M64 14 L86 22 L64 30 z" fill="#FFD23F" {...s} />
          <circle cx="32" cy="58" r="7" fill={CHALK} {...s} />
        </svg>
      );
    case 'knockout':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          <circle cx="40" cy="42" r="26" fill={CHALK} {...s} />
          <circle cx="40" cy="42" r="12" fill="#FF5D73" {...s} />
          <path d="M70 18 l16 16 M86 18 l-16 16" {...s} strokeWidth={6} stroke={INK} />
          <path d="M70 18 l16 16 M86 18 l-16 16" stroke={CHALK} strokeWidth={2.5} strokeLinecap="round" />
          <g fill={CHALK} {...s} strokeWidth={2.5}><circle cx="72" cy="58" r="5" /><circle cx="86" cy="58" r="5" fill="none" /></g>
        </svg>
      );
    case 'archery':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          <circle cx="40" cy="40" r="30" fill={CHALK} {...s} />
          <circle cx="40" cy="40" r="21" fill="#4CB8FF" {...s} />
          <circle cx="40" cy="40" r="12" fill="#FF5D73" {...s} />
          <circle cx="40" cy="40" r="4" fill="#FFD23F" {...s} strokeWidth={2} />
          <path d="M42 38 L92 12" {...s} strokeWidth={4} />
          <path d="M84 10 l10 -2 l-4 6 l6 2 l-8 6 z" fill="#FFD23F" {...s} strokeWidth={2} />
        </svg>
      );
    case 'paintball':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          <path d="M50 12 c6 10 18 2 18 14 c10 -2 16 10 8 16 c10 6 2 18 -8 14 c0 12 -14 12 -18 4 c-6 10 -20 4 -16 -6 c-12 0 -14 -14 -4 -18 c-6 -10 4 -18 12 -12 c0 -10 6 -14 8 -12z" fill="#FFD23F" {...s} />
          <circle cx="82" cy="16" r="5" fill="#FFD23F" {...s} />
          <circle cx="18" cy="66" r="4" fill="#FFD23F" {...s} />
        </svg>
      );
    case 'chess':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          <rect x="16" y="56" width="68" height="14" rx="4" fill={CHALK} {...s} />
          <path d="M28 56 L36 30 H64 L72 56 z" fill={CHALK} {...s} />
          <rect x="30" y="24" width="40" height="8" rx="3" fill={CHALK} {...s} />
          <circle cx="50" cy="15" r="9" fill={CHALK} {...s} />
        </svg>
      );
    case 'tic-tac-toe':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          <path d="M38 8 V72 M62 8 V72 M14 30 H86 M14 52 H86" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          <path d="M20 12 l12 12 M32 12 l-12 12" stroke={CHALK} strokeWidth={5} strokeLinecap="round" />
          <circle cx="50" cy="41" r="7" fill="none" stroke="#FFD23F" strokeWidth={5} />
          <path d="M68 56 l12 12 M80 56 l-12 12" stroke={CHALK} strokeWidth={5} strokeLinecap="round" />
        </svg>
      );
    case 'crazy-eights':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          <rect x="20" y="14" width="36" height="52" rx="6" fill={CHALK} {...s} transform="rotate(-12 38 40)" />
          <rect x="44" y="12" width="36" height="52" rx="6" fill={CHALK} {...s} transform="rotate(8 62 38)" />
          <text x="62" y="47" textAnchor="middle" fontFamily="Lilita One, sans-serif" fontSize="30" fill="#E0314E" transform="rotate(8 62 38)">8</text>
        </svg>
      );
    case 'word-duel':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          {['W', 'O', 'R', 'D'].map((l, i) => (
            <g key={l} transform={`translate(${10 + i * 21} ${i % 2 ? 30 : 20})`}>
              <rect width="19" height="22" rx="4" fill={CHALK} {...s} />
              <text x="9.5" y="17" textAnchor="middle" fontFamily="Lilita One, sans-serif" fontSize="15" fill={INK}>{l}</text>
            </g>
          ))}
          <path d="M18 66 h64" stroke={INK} strokeWidth={4} strokeLinecap="round" />
        </svg>
      );
    case 'word-guess':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          {[0, 1, 2].map((r) => [0, 1, 2, 3, 4].map((c) => {
            const fill = r === 2 ? '#2DE1C2' : (r + c) % 3 === 0 ? '#FF5D73' : (r * c) % 4 === 1 ? '#2DE1C2' : CHALK;
            return <rect key={`${r}${c}`} x={12 + c * 16} y={8 + r * 22} width="13" height="18" rx="3" fill={fill} {...s} strokeWidth={2.5} />;
          }))}
        </svg>
      );
    case 'word-scramble':
      return (
        <svg viewBox="0 0 100 80" aria-hidden="true">
          {['S', 'C', 'A', 'R'].map((l, i) => (
            <g key={l} transform={`translate(${12 + i * 20} ${18 + [6, -4, 8, 0][i]}) rotate(${[-10, 8, -6, 12][i]})`}>
              <rect width="18" height="22" rx="4" fill={CHALK} {...s} />
              <text x="9" y="17" textAnchor="middle" fontFamily="Lilita One, sans-serif" fontSize="15" fill={INK}>{l}</text>
            </g>
          ))}
          <path d="M22 62 c12 10 44 10 56 0" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          <path d="M72 56 l8 6 l-9 4" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return <svg viewBox="0 0 100 80" aria-hidden="true"><circle cx="50" cy="40" r="20" fill={CHALK} {...s} /></svg>;
  }
}

export function Logo() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="4" y="8" width="56" height="52" rx="16" fill={INK} />
      <rect x="4" y="4" width="56" height="52" rx="16" fill="#FFD23F" stroke={INK} strokeWidth="4" />
      <circle cx="23" cy="30" r="9" fill="#FF5D73" stroke={INK} strokeWidth="4" />
      <path d="M36 21l12 18H36z" fill="#8B7BFF" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}

const icon = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export const Icons = {
  home: icon(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>),
  games: icon(<><rect x="3" y="7" width="18" height="11" rx="5" /><path d="M8 11v3M6.5 12.5h3" /><circle cx="15.5" cy="11.5" r="1" fill="currentColor" /><circle cx="17.5" cy="13.5" r="1" fill="currentColor" /></>),
  trophy: icon(<><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" /><path d="M12 13v4M8 20h8" /></>),
  ranks: icon(<><path d="M5 20V12M12 20V5M19 20v-6" /></>),
  user: icon(<><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 5-5 8-5s6.5 1 8 5" /></>),
  bell: icon(<><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></>),
  friends: icon(<><circle cx="9" cy="9" r="3.5" /><path d="M3 19c1-3 3.5-4 6-4s5 1 6 4" /><path d="M16 5.5a3 3 0 0 1 0 6M18 15c1.5.6 2.5 2 3 4" /></>),
  settings: icon(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>),
  link: icon(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>),
  chat: icon(<path d="M4 5h16v11H9l-5 4z" />),
  flag: icon(<><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></>),
  close: icon(<path d="M6 6l12 12M18 6L6 18" />),
  back: icon(<path d="M15 5l-7 7 7 7" />),
  info: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>),
  share: icon(<><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v7h14v-7" /></>),
  search: icon(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>),
};
