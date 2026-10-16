// Game catalog shared by server and client. Adding a game = add an entry here,
// an engine in src/server/games, and a board component in src/client/games.

export type GameId =
  | 'darts' | 'cup-pong' | 'mini-golf' | 'knockout' | 'archery' | 'paintball'
  | 'chess' | 'tic-tac-toe' | 'crazy-eights'
  | 'word-duel' | 'word-guess' | 'word-scramble';

export type Category = 'arcade' | 'board' | 'word';
export type MatchMode = 'practice' | 'casual' | 'ranked' | 'private' | 'tournament';

export interface OptionChoice { value: string; label: string }
export interface GameOption { key: string; label: string; choices: OptionChoice[]; default: string }

export interface GameMeta {
  id: GameId;
  name: string;
  category: Category;
  blurb: string;
  minPlayers: number;
  maxPlayers: number;
  duration: string;
  status: 'live' | 'soon';
  /** Practice can be played alone or against a bot. */
  practice: 'solo' | 'bot' | 'none';
  ranked: boolean;
  rules: string[];
  options: GameOption[];
}

export const CATEGORY_LABEL: Record<Category, string> = {
  arcade: 'Arcade',
  board: 'Board & cards',
  word: 'Words',
};

export const GAMES: GameMeta[] = [
  {
    id: 'tic-tac-toe', name: 'Tic-Tac-Toe', category: 'board',
    blurb: 'Three in a row. Best of three, no mercy.',
    minPlayers: 2, maxPlayers: 2, duration: '2 min', status: 'live', practice: 'bot', ranked: true,
    rules: [
      'Players take turns placing X or O on a 3×3 grid.',
      'Three in a row — across, down or diagonal — wins the round.',
      'Starts alternate each round. First to win the majority of rounds takes the match.',
      'You have 30 seconds per move. Running out of time forfeits the match.',
    ],
    options: [{ key: 'bestOf', label: 'Rounds', default: '3', choices: [{ value: '1', label: 'Single game' }, { value: '3', label: 'Best of 3' }, { value: '5', label: 'Best of 5' }] }],
  },
  {
    id: 'chess', name: 'Chess', category: 'board',
    blurb: 'The full game with clocks, draws and promotions.',
    minPlayers: 2, maxPlayers: 2, duration: '10–25 min', status: 'live', practice: 'bot', ranked: true,
    rules: [
      'Standard chess rules, including castling, en passant and promotion.',
      'The host plays white in private rooms; colours are random in quick play.',
      'Checkmate wins. Stalemate, repetition, insufficient material and the 50-move rule are draws.',
      'Running out of clock loses. You can offer a draw or resign at any time.',
    ],
    options: [{ key: 'tc', label: 'Time control', default: 'rapid', choices: [{ value: 'blitz', label: 'Blitz 5+0' }, { value: 'rapid', label: 'Rapid 10+5' }, { value: 'untimed', label: 'No clock' }] }],
  },
  {
    id: 'crazy-eights', name: 'Crazy Eights', category: 'board',
    blurb: 'Match the suit or rank. Eights change everything.',
    minPlayers: 2, maxPlayers: 4, duration: '5 min', status: 'live', practice: 'bot', ranked: true,
    rules: [
      'Play a card that matches the top card’s suit or rank.',
      'Eights are wild: play one any time and choose the next suit.',
      'Can’t play? Draw one card. Play it if you can, otherwise pass.',
      'First to empty their hand wins the round and scores the cards left in other hands (8 = 50, faces = 10, aces = 1).',
    ],
    options: [
      { key: 'target', label: 'Match length', default: '0', choices: [{ value: '0', label: 'One round' }, { value: '100', label: 'First to 100' }] },
      { key: 'draw', label: 'When stuck', default: 'one', choices: [{ value: 'one', label: 'Draw one' }, { value: 'until', label: 'Draw until playable' }] },
    ],
  },
  {
    id: 'darts', name: 'Darts', category: 'arcade',
    blurb: 'Steady your hand and count down to zero.',
    minPlayers: 2, maxPlayers: 2, duration: '5 min', status: 'live', practice: 'bot', ranked: true,
    rules: [
      'Drag to aim. The ring around your aim breathes — release when it is smallest for a tighter throw.',
      'Three darts per turn. Score by sector; the outer thin ring doubles, the inner ring triples, the bull is 50 and the ring around it 25.',
      '301 / 501: count down to exactly zero. Going below zero is a bust and your turn’s score is wiped.',
      'High score: most points after five turns wins.',
    ],
    options: [{ key: 'mode', label: 'Format', default: '301', choices: [{ value: '301', label: '301' }, { value: '501', label: '501' }, { value: 'high', label: 'High score' }] }],
  },
  {
    id: 'archery', name: 'Archery', category: 'arcade',
    blurb: 'Read the wind, hold your breath, hit gold.',
    minPlayers: 2, maxPlayers: 4, duration: '4 min', status: 'live', practice: 'bot', ranked: true,
    rules: [
      'Drag to aim, release when the sight is steady.',
      'Wind pushes the arrow. Its strength and direction are shown before each shot — aim off to compensate.',
      'Rings score 10 (centre) down to 1. Five ends, two arrows each.',
      'Ties are settled with a single-arrow shoot-off: closest to centre wins.',
    ],
    options: [{ key: 'ends', label: 'Length', default: '5', choices: [{ value: '3', label: '3 ends' }, { value: '5', label: '5 ends' }] }],
  },
  {
    id: 'mini-golf', name: 'Mini Golf', category: 'arcade',
    blurb: 'Bank shots, sand traps and water. Six holes, one scorecard.',
    minPlayers: 1, maxPlayers: 4, duration: '6 min', status: 'live', practice: 'solo', ranked: true,
    rules: [
      'Drag back from the ball to set direction and power, then release.',
      'Players take turns stroke by stroke. Sand slows you down, water costs a penalty stroke and resets your ball.',
      'Each hole is capped at 8 strokes.',
      'Lowest total strokes wins.',
    ],
    options: [{ key: 'holes', label: 'Course', default: '3', choices: [{ value: '3', label: 'Front 3' }, { value: '6', label: 'All 6 holes' }] }],
  },
  {
    id: 'cup-pong', name: 'Cup Pong', category: 'arcade',
    blurb: 'Ten cups, two balls a turn. Clear the rack.',
    minPlayers: 2, maxPlayers: 2, duration: '5 min', status: 'live', practice: 'bot', ranked: true,
    rules: [
      'Swipe up from the ball: the angle sets direction, the length sets distance.',
      'Two throws per turn. Land in a cup to remove it.',
      'Sink both throws in a turn and you get the balls back for another go.',
      'First to clear all ten of the opponent’s cups wins.',
    ],
    options: [],
  },
  {
    id: 'knockout', name: 'Knockout', category: 'arcade',
    blurb: 'One shot each. Miss and you lose a life.',
    minPlayers: 2, maxPlayers: 4, duration: '3 min', status: 'live', practice: 'bot', ranked: true,
    rules: [
      'Each round, every player gets one shot at the target.',
      'Miss and you lose a life. If everyone misses, nobody does — the round is replayed.',
      'The target shrinks and your sight steadies faster each round.',
      'Last player with lives left wins.',
    ],
    options: [{ key: 'lives', label: 'Lives', default: '3', choices: [{ value: '2', label: '2 lives' }, { value: '3', label: '3 lives' }] }],
  },
  {
    id: 'word-guess', name: 'Word Guess', category: 'word',
    blurb: 'Same secret word, six tries, race your friends.',
    minPlayers: 1, maxPlayers: 4, duration: '3 min', status: 'live', practice: 'solo', ranked: true,
    rules: [
      'Everyone gets the same hidden five-letter word and six guesses.',
      'Green: right letter, right spot. Yellow: in the word, wrong spot. Grey: not in the word.',
      'You can see how your opponents are doing, but not their letters.',
      'Solvers beat non-solvers; fewer guesses, then faster time, breaks ties. Three-minute limit.',
    ],
    options: [],
  },
  {
    id: 'word-scramble', name: 'Word Scramble', category: 'word',
    blurb: 'Unscramble it before anyone else does.',
    minPlayers: 1, maxPlayers: 6, duration: '3 min', status: 'live', practice: 'solo', ranked: true,
    rules: [
      'Each round shows the same scrambled letters to everyone.',
      'First correct answer scores 10 points plus up to 5 for speed. Any real word that uses every letter counts.',
      'Rounds last 25 seconds. Most points after all rounds wins.',
    ],
    options: [{ key: 'rounds', label: 'Rounds', default: '5', choices: [{ value: '5', label: '5 rounds' }, { value: '8', label: '8 rounds' }] }],
  },
  {
    id: 'word-duel', name: 'Word Duel', category: 'word',
    blurb: 'Nine letters, ninety seconds, as many words as you can find.',
    minPlayers: 2, maxPlayers: 2, duration: '5 min', status: 'live', practice: 'solo', ranked: true,
    rules: [
      'Both players get the same rack of nine letters.',
      'Make words of three letters or more; each letter in the rack can be used once per word.',
      'Rarer letters score more, and longer words earn a bonus.',
      'Three rounds of 90 seconds. Your words are revealed when each round ends.',
    ],
    options: [],
  },
  {
    id: 'paintball', name: 'Paintball', category: 'arcade',
    blurb: 'Tactical arena splats. In the workshop now.',
    minPlayers: 2, maxPlayers: 4, duration: '5 min', status: 'soon', practice: 'none', ranked: false,
    rules: ['Paintball is being built and tested. It will appear here once matches can be played start to finish.'],
    options: [],
  },
];

export const GAME_BY_ID: Record<string, GameMeta> = Object.fromEntries(GAMES.map((g) => [g.id, g]));

export function defaultOptions(g: GameMeta): Record<string, string> {
  return Object.fromEntries(g.options.map((o) => [o.key, o.default]));
}

export function sanitizeOptions(g: GameMeta, input: unknown): Record<string, string> {
  const out = defaultOptions(g);
  if (input && typeof input === 'object') {
    for (const o of g.options) {
      const v = (input as Record<string, unknown>)[o.key];
      if (typeof v === 'string' && o.choices.some((c) => c.value === v)) out[o.key] = v;
    }
  }
  return out;
}
