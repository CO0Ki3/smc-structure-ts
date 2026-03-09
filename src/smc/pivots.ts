import { Pivot } from "./types.js";

export function newPivot(): Pivot {
  return { currentLevel: null, lastLevel: null, crossed: false, ts: null, index: null };
}

export function updatePivot(p: Pivot, level: number, ts: number, index: number): void {
  p.lastLevel = p.currentLevel;
  p.currentLevel = level;
  p.crossed = false;
  p.ts = ts;
  p.index = index;
}
