import type { Bar } from "../io/types.js";
import type { DatasetRow } from "./types.js";

type SmcEvent =
  | { type: "SWING_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "INTERNAL_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "STRUCTURE_BREAK"; scope: "SWING" | "INTERNAL"; tag: "BOS" | "CHOCH"; dir: 1 | -1 | 0; ts: number; level: number }
  | { type: "EQ"; eqType: "EQH" | "EQL"; ts: number; level: number; basePivotTs: number; baseLevel: number }
  | { type: "OB_CREATE"; scope: "SWING" | "INTERNAL"; ts: number; bias: 1 | -1 | 0; high: number; low: number; srcTs: number }
  | { type: "OB_MITIGATED"; scope: "SWING" | "INTERNAL"; ts: number; bias: 1 | -1 | 0; high: number; low: number; srcTs: number };

type ActiveOB = {
  srcTs: number;
  createTs: number;
  bias: 1 | -1;
  high: number;
  low: number;
  scope: "SWING" | "INTERNAL";
};

function logRet(cur: number, prev: number | null): number | null {
  if (prev === null || prev <= 0 || cur <= 0) return null;
  return Math.log(cur / prev);
}

function safeDiv(num: number, den: number | null): number | null {
  if (den === null || den === 0 || !Number.isFinite(den)) return null;
  return num / den;
}

export function buildStateDataset(datasetId: string, bars: Bar[], events: SmcEvent[]): DatasetRow[] {
  const evByTs = new Map<number, SmcEvent[]>();
  for (const e of events) {
    const arr = evByTs.get(e.ts) ?? [];
    arr.push(e);
    evByTs.set(e.ts, arr);
  }

  const idxByTs = new Map<number, number>();
  for (let i = 0; i < bars.length; i++) idxByTs.set(bars[i].ts, i);

  // ATR(14)
  let prevClose: number | null = null;
  const trBuf: number[] = [];
  let trSum = 0;

  let swingBias = 0;
  let swingBreakTag: string | null = null;
  let swingBreakTs: number | null = null;

  let internalBias = 0;
  let internalBreakTag: string | null = null;
  let internalBreakTs: number | null = null;

  let lastSwingHigh: { level: number; ts: number } | null = null;
  let lastSwingLow: { level: number; ts: number } | null = null;
  let lastInternalHigh: { level: number; ts: number } | null = null;
  let lastInternalLow: { level: number; ts: number } | null = null;

  let eqh: { level: number; ts: number } | null = null;
  let eql: { level: number; ts: number } | null = null;

  const activeObs = new Map<number, ActiveOB>();

  const rows: DatasetRow[] = [];

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const evs = evByTs.get(b.ts) ?? [];

    // Apply all events visible at this bar
    for (const e of evs) {
      if (e.type === "SWING_PIVOT") {
        if (e.pivotType === "HIGH") lastSwingHigh = { level: e.level, ts: e.ts };
        else lastSwingLow = { level: e.level, ts: e.ts };
      }
      if (e.type === "INTERNAL_PIVOT") {
        if (e.pivotType === "HIGH") lastInternalHigh = { level: e.level, ts: e.ts };
        else lastInternalLow = { level: e.level, ts: e.ts };
      }
      if (e.type === "STRUCTURE_BREAK") {
        if (e.scope === "SWING") {
          swingBias = e.dir;
          swingBreakTag = e.tag;
          swingBreakTs = e.ts;
        } else {
          internalBias = e.dir;
          internalBreakTag = e.tag;
          internalBreakTs = e.ts;
        }
      }
      if (e.type === "EQ") {
        if (e.eqType === "EQH") eqh = { level: e.level, ts: e.ts };
        else eql = { level: e.level, ts: e.ts };
      }
      if (e.type === "OB_CREATE" && (e.bias === 1 || e.bias === -1)) {
        activeObs.set(e.srcTs, {
          srcTs: e.srcTs,
          createTs: e.ts,
          bias: e.bias,
          high: e.high,
          low: e.low,
          scope: e.scope,
        });
      }
      if (e.type === "OB_MITIGATED") {
        activeObs.delete(e.srcTs);
      }
    }

    // ATR
    const tr = prevClose === null
      ? (b.high - b.low)
      : Math.max(
          b.high - b.low,
          Math.abs(b.high - prevClose),
          Math.abs(b.low - prevClose),
        );
    trBuf.push(tr);
    trSum += tr;
    if (trBuf.length > 14) trSum -= trBuf.shift()!;
    const atr14 = trBuf.length >= 14 ? (trSum / 14) : null;
    prevClose = b.close;

    // returns
    const r1 = i >= 1 ? logRet(b.close, bars[i - 1].close) : null;
    const r4 = i >= 4 ? logRet(b.close, bars[i - 4].close) : null;
    const r16 = i >= 16 ? logRet(b.close, bars[i - 16].close) : null;

    // distances
    const distToSwingHigh = lastSwingHigh ? safeDiv(lastSwingHigh.level - b.close, atr14) : null;
    const distToSwingLow = lastSwingLow ? safeDiv(b.close - lastSwingLow.level, atr14) : null;
    const distToInternalHigh = lastInternalHigh ? safeDiv(lastInternalHigh.level - b.close, atr14) : null;
    const distToInternalLow = lastInternalLow ? safeDiv(b.close - lastInternalLow.level, atr14) : null;
    const distToEqh = eqh ? safeDiv(eqh.level - b.close, atr14) : null;
    const distToEql = eql ? safeDiv(b.close - eql.level, atr14) : null;

    // active OB summary
    const bullishObs = [...activeObs.values()].filter(x => x.bias === 1);
    const bearishObs = [...activeObs.values()].filter(x => x.bias === -1);

    const pickNearest = (obs: ActiveOB[]) => {
      if (obs.length === 0) return null;
      let best: { ob: ActiveOB; dist: number } | null = null;
      for (const ob of obs) {
        const mid = (ob.high + ob.low) / 2;
        const dist = Math.abs(mid - b.close);
        if (!best || dist < best.dist) best = { ob, dist };
      }
      return best?.ob ?? null;
    };

    const bullOb = pickNearest(bullishObs);
    const bearOb = pickNearest(bearishObs);

    const bullDistMid = bullOb ? safeDiv(Math.abs(((bullOb.high + bullOb.low) / 2) - b.close), atr14) : null;
    const bearDistMid = bearOb ? safeDiv(Math.abs(((bearOb.high + bearOb.low) / 2) - b.close), atr14) : null;

    const row: DatasetRow = {
      dataset_id: datasetId,
      ts: b.ts,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,

      ret_1: r1,
      ret_4: r4,
      ret_16: r16,
      atr_14: atr14,

      swing_bias: swingBias,
      swing_break_tag: swingBreakTag,
      bars_since_swing_break: swingBreakTs !== null ? (i - (idxByTs.get(swingBreakTs) ?? i)) : null,

      internal_bias: internalBias,
      internal_break_tag: internalBreakTag,
      bars_since_internal_break: internalBreakTs !== null ? (i - (idxByTs.get(internalBreakTs) ?? i)) : null,

      last_swing_high: lastSwingHigh?.level ?? null,
      last_swing_low: lastSwingLow?.level ?? null,
      dist_to_last_swing_high_atr: distToSwingHigh,
      dist_to_last_swing_low_atr: distToSwingLow,

      last_internal_high: lastInternalHigh?.level ?? null,
      last_internal_low: lastInternalLow?.level ?? null,
      dist_to_last_internal_high_atr: distToInternalHigh,
      dist_to_last_internal_low_atr: distToInternalLow,

      eqh_level: eqh?.level ?? null,
      bars_since_eqh: eqh ? (i - (idxByTs.get(eqh.ts) ?? i)) : null,
      dist_to_eqh_atr: distToEqh,

      eql_level: eql?.level ?? null,
      bars_since_eql: eql ? (i - (idxByTs.get(eql.ts) ?? i)) : null,
      dist_to_eql_atr: distToEql,

      active_bullish_ob_count: bullishObs.length,
      active_bearish_ob_count: bearishObs.length,

      nearest_bullish_ob_high: bullOb?.high ?? null,
      nearest_bullish_ob_low: bullOb?.low ?? null,
      nearest_bullish_ob_age: bullOb ? (i - (idxByTs.get(bullOb.createTs) ?? i)) : null,
      nearest_bullish_ob_dist_mid_atr: bullDistMid,
      inside_bullish_ob: bullOb ? ((b.low <= bullOb.high && b.high >= bullOb.low) ? 1 : 0) : 0,

      nearest_bearish_ob_high: bearOb?.high ?? null,
      nearest_bearish_ob_low: bearOb?.low ?? null,
      nearest_bearish_ob_age: bearOb ? (i - (idxByTs.get(bearOb.createTs) ?? i)) : null,
      nearest_bearish_ob_dist_mid_atr: bearDistMid,
      inside_bearish_ob: bearOb ? ((b.low <= bearOb.high && b.high >= bearOb.low) ? 1 : 0) : 0,
    };

    rows.push(row);
  }

  return rows;
}
