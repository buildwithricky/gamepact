import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { FIVE, SEVEN, SIX } from './lists';

// ~275k-word MIT-licensed list (an-array-of-english-words), loaded once into memory.
let dict: Set<string> | null = null;

export function dictionary(): Set<string> {
  if (!dict) {
    const require = createRequire(import.meta.url);
    const file = require.resolve('an-array-of-english-words/index.json');
    const words: string[] = JSON.parse(readFileSync(file, 'utf8'));
    dict = new Set(words.filter((w) => /^[a-z]+$/.test(w)));
  }
  return dict;
}

export const isWord = (w: string) => dictionary().has(w.toLowerCase());

let answers: { five: string[]; scramble: string[] } | null = null;
export function answerLists() {
  if (!answers) {
    const d = dictionary();
    answers = {
      five: [...new Set(FIVE)].filter((w) => w.length === 5 && d.has(w)),
      scramble: [...new Set([...SIX, ...SEVEN])].filter((w) => d.has(w)),
    };
  }
  return answers;
}

const sorted = (w: string) => w.split('').sort().join('');
let anagramIndex: Map<string, string[]> | null = null;
/** All dictionary words that use exactly these letters. */
export function anagramsOf(word: string): string[] {
  if (!anagramIndex) {
    anagramIndex = new Map();
    for (const w of dictionary()) {
      if (w.length < 5 || w.length > 8) continue;
      const k = sorted(w);
      const list = anagramIndex.get(k);
      if (list) list.push(w);
      else anagramIndex.set(k, [w]);
    }
  }
  return anagramIndex.get(sorted(word.toLowerCase())) ?? [];
}

/** Every dictionary word of 3+ letters that can be built from a rack (multiset). */
export function wordsFromRack(rack: string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of rack) counts.set(l, (counts.get(l) ?? 0) + 1);
  const out: string[] = [];
  for (const w of dictionary()) {
    if (w.length < 3 || w.length > rack.length) continue;
    if (fitsRack(w, counts)) out.push(w);
  }
  return out;
}

export function fitsRack(word: string, counts: Map<string, number>): boolean {
  const used = new Map<string, number>();
  for (const ch of word) {
    const n = (used.get(ch) ?? 0) + 1;
    if (n > (counts.get(ch) ?? 0)) return false;
    used.set(ch, n);
  }
  return true;
}
