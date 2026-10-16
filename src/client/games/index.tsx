import type { ComponentType } from 'react';
import { ArcheryBoard, CupPongBoard, DartsBoard, KnockoutBoard, MiniGolfBoard } from './ArcadeGames';
import { ChessBoard, CrazyEightsBoard, TicTacToeBoard } from './BoardGames';
import type { BoardProps } from './common';
import { WordDuelBoard, WordGuessBoard, WordScrambleBoard } from './WordGames';

export const BOARDS: Record<string, ComponentType<BoardProps>> = {
  'tic-tac-toe': TicTacToeBoard,
  chess: ChessBoard,
  'crazy-eights': CrazyEightsBoard,
  darts: DartsBoard,
  archery: ArcheryBoard,
  knockout: KnockoutBoard,
  'cup-pong': CupPongBoard,
  'mini-golf': MiniGolfBoard,
  'word-guess': WordGuessBoard,
  'word-scramble': WordScrambleBoard,
  'word-duel': WordDuelBoard,
};
