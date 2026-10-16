import type { GameId, MatchMode } from './catalog';

export type MatchStatus = 'WAITING' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ABANDONED' | 'DISPUTED' | 'VOIDED';

export interface Avatar { color: number; glyph: number }

export interface PublicUser { id: string; username: string; avatar: Avatar }

export interface SeatInfo {
  seat: number;
  user: PublicUser | null;
  bot: string | null;
  connected: boolean;
  ready: boolean;
  rating: number | null;
  out: boolean;
}

export interface MatchResult {
  kind: 'win' | 'draw' | 'ranking';
  /** Seats grouped by finishing place: [[winner], [second], ...] */
  ranking: number[][];
  scores: number[];
  summary: string;
  reason: string;
  ratingChanges?: Record<number, { before: number; after: number }>;
}

export interface MatchSnapshot {
  id: string;
  gameId: GameId;
  mode: MatchMode;
  status: MatchStatus;
  code: string | null;
  hostId: string | null;
  options: Record<string, string>;
  seats: SeatInfo[];
  maxSeats: number;
  you: number | null;
  spectators: number;
  deadline: { seat: number | null; at: number } | null;
  serverNow: number;
  view: unknown;
  result: MatchResult | null;
  rematch: { requested: number[]; nextId: string | null };
  tournament: { id: string; title: string; round: number } | null;
  expiresAt: number | null;
  claimableAt: number | null;
}

export interface ChatMessage { id: string; userId: string; username: string; text: string; at: number }

export interface NotificationItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface AdsConfig {
  enabled: boolean;
  provider: 'adsense' | 'none';
  client: string | null;
  slots: { banner: string | null; results: string | null; sidebar: string | null };
  interstitial: boolean;
  test: boolean;
}

export interface PublicConfig {
  ads: AdsConfig;
  passwordMinLength: number;
}

export const AVATAR_COLORS = ['#FF5D73', '#8B7BFF', '#FFD23F', '#2DE1C2', '#4CB8FF', '#FF9F43', '#F368E0', '#9BE15D'];
export const AVATAR_GLYPHS = ['●', '▲', '■', '◆', '★', '✚', '⬢', '☾'];

export const ACHIEVEMENTS: Record<string, { name: string; description: string }> = {
  first_win: { name: 'First victory', description: 'Win your first match.' },
  ten_matches: { name: 'Regular', description: 'Finish ten matches.' },
  streak_5: { name: 'On fire', description: 'Win five matches in a row.' },
  checkmate: { name: 'Checkmate', description: 'Win a chess game by checkmate.' },
  under_par: { name: 'Under par', description: 'Finish a mini golf round under par.' },
  finalist: { name: 'Finalist', description: 'Reach a tournament final.' },
  champion: { name: 'Champion', description: 'Win a tournament.' },
  host: { name: 'Organiser', description: 'Host a tournament that runs to completion.' },
};
