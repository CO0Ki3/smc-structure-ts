import { Pivot, SmcEvent } from "./types.js";

export function tryEqualHighLow(
  basePivot: Pivot,
  newLevel: number,
  isEqualHigh: boolean,
  size: number,
  confirmTs: number,
  atrForEq: number | null,
  eqThr: number
): SmcEvent | null {
  // condition: abs(basePivot.currentLevel - newLevel) < eqThr * atr
  if (!basePivot.currentLevel || atrForEq === null || atrForEq <= 0) return null;
  const ok = Math.abs(basePivot.currentLevel - newLevel) < (eqThr * atrForEq);
  if (!ok) return null;

  return {
    type: "EQ",
    eqType: isEqualHigh ? "EQH" : "EQL",
    ts: confirmTs,
    level: newLevel,
    basePivotTs: basePivot.ts ?? confirmTs,
    baseLevel: basePivot.currentLevel,
  };
}
