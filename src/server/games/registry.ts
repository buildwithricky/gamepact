import type { GameId } from '../../shared/catalog';
import { archery } from './archery';
import { chess } from './chess';
import { crazyEights } from './crazyEights';
import { cupPong } from './cupPong';
import { darts } from './darts';
import { knockout } from './knockout';
import { miniGolf } from './miniGolf';
import { ticTacToe } from './ticTacToe';
import type { Engine } from './types';
import { wordDuel } from './wordDuel';
import { wordGuess } from './wordGuess';
import { wordScramble } from './wordScramble';

export const ENGINES: Partial<Record<GameId, Engine>> = {
  'tic-tac-toe': ticTacToe,
  chess,
  'crazy-eights': crazyEights,
  darts,
  archery,
  'mini-golf': miniGolf,
  'cup-pong': cupPong,
  knockout,
  'word-guess': wordGuess,
  'word-scramble': wordScramble,
  'word-duel': wordDuel,
};

export const engineFor = (id: string): Engine | undefined => ENGINES[id as GameId];
