export interface Match {
  score: number;
  /** Indices in the original text of the matched characters. */
  idx: number[];
}

/**
 * Subsequence match: every query char must appear in order. Returns the best-scoring alignment
 * (matched indices + score), found by DP so "tline" lands on the word "Line", not the l in "Toggle".
 * Scoring: +1 per char, +3 when it follows the previous match directly, +2 at the start of a word,
 * and a small penalty for starting late.
 */
export function fuzzy(query: string, text: string): Match | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, idx: [] };
  const s = text.toLowerCase();
  const n = s.length;

  let prev: number[] = [];
  const back: number[][] = [];
  for (let i = 0; i < q.length; i++) {
    const cur: number[] = new Array<number>(n).fill(-Infinity);
    const from: number[] = new Array<number>(n).fill(-1);
    for (let j = 0; j < n; j++) {
      if (s[j] !== q[i]) continue;
      const here = 1 + (j === 0 || s[j - 1] === ' ' ? 2 : 0);
      if (i === 0) { cur[j] = here - j * 0.1; continue; }
      for (let k = 0; k < j; k++) {
        const p = prev[k]!;
        if (p === -Infinity) continue;
        const sc = p + here + (k === j - 1 ? 3 : 0);
        if (sc > cur[j]!) { cur[j] = sc; from[j] = k; }
      }
    }
    back.push(from);
    prev = cur;
  }

  let end = -1;
  let best = -Infinity;
  prev.forEach((v, j) => { if (v > best) { best = v; end = j; } });
  if (end < 0) return null;

  const idx: number[] = [];
  for (let i = q.length - 1, j = end; i >= 0; i--) {
    idx.unshift(j);
    j = back[i]![j]!;
  }
  return { score: best, idx };
}
