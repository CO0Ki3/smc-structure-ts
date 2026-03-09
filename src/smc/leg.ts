import { Bar } from "../io/types.js";

export const BULLISH_LEG = 1 as const;
export const BEARISH_LEG = 0 as const;

export function leg(bars: Bar[], i: number, size: number): 0 | 1 {
  // Mirrors Pine idea: compare high[size]/low[size] to highest/lowest of last `size` bars.
  // At index i, we examine bar i-size.
  if (i < size) return BEARISH_LEG;
  const j = i - size;

  // highest over bars (j+1..i)
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = j + 1; k <= i; k++) {
    hi = Math.max(hi, bars[k].high);
    lo = Math.min(lo, bars[k].low);
  }

  const newLegHigh = bars[j].high > hi;
  const newLegLow = bars[j].low < lo;

  if (newLegHigh) return BEARISH_LEG;
  if (newLegLow) return BULLISH_LEG;
  return BEARISH_LEG; // default stable
}

export function startOfNewLeg(prevLeg: 0 | 1, nextLeg: 0 | 1): boolean {
  return prevLeg !== nextLeg;
}

export function startOfBearishLeg(prevLeg: 0 | 1, nextLeg: 0 | 1): boolean {
  return (nextLeg - prevLeg) === -1;
}

export function startOfBullishLeg(prevLeg: 0 | 1, nextLeg: 0 | 1): boolean {
  return (nextLeg - prevLeg) === +1;
}
