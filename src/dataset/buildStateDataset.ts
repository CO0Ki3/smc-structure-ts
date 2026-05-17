import type { Bar } from "../io/types.js";
import type { DatasetRow } from "./types.js";
import { resampleBars, buildLastClosedHtfIndex } from "../smc/htfResample.js";
import { trackHtfState, premiumDiscount, type HtfSnapshot } from "../smc/htfFeatures.js";

/**
 * Option 5 helper: pre-compute HTF state for an entire LTF stream
 * spanning multiple slices, then return per-LTF-ts lookup maps the
 * caller hands to buildStateDataset for each individual slice. The
 * returned `htf*IdxByLtfTs` maps include every LTF ts that fell in
 * the input stream, so slice processing is a simple lookup.
 */
export function precomputeGlobalHtfContext(
  ltfStream: Bar[],
  htf4hMinutes: number = 240,
  htf1dMinutes: number = 1440,
): {
  snapshots4h: HtfSnapshot[];
  snapshots1d: HtfSnapshot[];
  htf4hIdxByLtfTs: Map<number, number>;
  htf1dIdxByLtfTs: Map<number, number>;
} {
  const htf4hBars = resampleBars(ltfStream, htf4hMinutes);
  const htf1dBars = resampleBars(ltfStream, htf1dMinutes);
  const snapshots4h = trackHtfState(htf4hBars);
  const snapshots1d = trackHtfState(htf1dBars);
  const htf4hIdx = buildLastClosedHtfIndex(ltfStream, htf4hBars, htf4hMinutes);
  const htf1dIdx = buildLastClosedHtfIndex(ltfStream, htf1dBars, htf1dMinutes);
  const htf4hIdxByLtfTs = new Map<number, number>();
  const htf1dIdxByLtfTs = new Map<number, number>();
  for (let i = 0; i < ltfStream.length; i++) {
    htf4hIdxByLtfTs.set(ltfStream[i].ts, htf4hIdx[i]);
    htf1dIdxByLtfTs.set(ltfStream[i].ts, htf1dIdx[i]);
  }
  return { snapshots4h, snapshots1d, htf4hIdxByLtfTs, htf1dIdxByLtfTs };
}

/**
 * Phase 1 (Stage C-1): HTF context attach options.
 *
 * `htf4hMinutes` and `htf1dMinutes` control the two HTF aggregation
 * windows the policy will see — defaults 240 (4H) and 1440 (1D)
 * match PDF SMC chapter 4 multi-timeframe analysis.
 *
 * `outputStartBar` skips the first N LTF rows from the output —
 * the SMC engine still scans them so swing/internal/HTF state warm
 * up correctly, but the model only sees rows from bar N onward.
 * Phase 1 uses 768 (8 days × 96 bars/day for the HTF 4H pivot
 * lookback) when the source slice is 28 days long; 0 keeps the
 * legacy behaviour. When omitted, no rows are skipped.
 *
 * `attachHtf` defaults to true. Setting false reverts to the pre-
 * Phase-1 schema (HTF columns get null/0 fill).
 *
 * `globalHtf` is the reviewer-driven Option 5 fix: when provided,
 * HTF state is read from pre-computed maps keyed on LTF bar ts
 * instead of being re-computed from this slice's bars. This lets a
 * caller run trackHtfState on the entire 24-month BTC stream once
 * (so 1D swing pivots stabilise — they need ~50 days lookback) and
 * have each slice see the full-stream state at its timestamps.
 * PDF SMC chapter 4 treats HTF context as a backward-looking
 * function of all prior history — slice-resetting is an artifact
 * of the per-slice pipeline, not the SMC definition. When supplied,
 * `htf4hMinutes` / `htf1dMinutes` are ignored (the maps are already
 * computed at the chosen TFs).
 */
export type BuildStateDatasetOptions = {
  htf4hMinutes?: number;
  htf1dMinutes?: number;
  outputStartBar?: number;
  attachHtf?: boolean;
  globalHtf?: {
    snapshots4h: HtfSnapshot[];
    snapshots1d: HtfSnapshot[];
    htf4hIdxByLtfTs: Map<number, number>;
    htf1dIdxByLtfTs: Map<number, number>;
  };
};

type SmcEvent =
  | { type: "SWING_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "INTERNAL_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "STRUCTURE_BREAK"; scope: "SWING" | "INTERNAL"; tag: "BOS" | "CHOCH"; dir: 1 | -1 | 0; ts: number; level: number }
  | { type: "EQ"; eqType: "EQH" | "EQL"; ts: number; level: number; basePivotTs: number; baseLevel: number }
  | { type: "OB_CREATE"; scope: "SWING" | "INTERNAL"; ts: number; bias: 1 | -1 | 0; high: number; low: number; srcTs: number }
  | { type: "OB_MITIGATED"; scope: "SWING" | "INTERNAL"; ts: number; bias: 1 | -1 | 0; high: number; low: number; srcTs: number }
  | { type: "FVG_CREATE"; ts: number; bias: 1 | -1 | 0; top: number; bottom: number; srcTs: number }
  | { type: "FVG_FILLED"; ts: number; bias: 1 | -1 | 0; top: number; bottom: number; srcTs: number };

type ActiveOB = {
  srcTs: number;
  createTs: number;
  bias: 1 | -1;
  high: number;
  low: number;
  scope: "SWING" | "INTERNAL";
};

type ActiveFVG = {
  srcTs: number;
  createTs: number;
  bias: 1 | -1;
  top: number;
  bottom: number;
};

function logRet(cur: number, prev: number | null): number | null {
  if (prev === null || prev <= 0 || cur <= 0) return null;
  return Math.log(cur / prev);
}

function safeDiv(num: number, den: number | null): number | null {
  if (den === null || den === 0 || !Number.isFinite(den)) return null;
  return num / den;
}

export function buildStateDataset(
  datasetId: string,
  bars: Bar[],
  events: SmcEvent[],
  opts: BuildStateDatasetOptions = {},
): DatasetRow[] {
  const htf4hMin = opts.htf4hMinutes ?? 240;
  const htf1dMin = opts.htf1dMinutes ?? 1440;
  const outputStartBar = Math.max(0, opts.outputStartBar ?? 0);
  const attachHtf = opts.attachHtf !== false;
  const globalHtf = opts.globalHtf;

  // HTF context source:
  // - Caller passed globalHtf (Option 5 reviewer fix) → use pre-
  //   computed maps from the full multi-slice stream. This lets 1D
  //   swing pivots stabilise — they need ~50 days lookback that no
  //   single 28-day slice can provide.
  // - Otherwise → compute slice-locally (legacy / backward-compatible).
  const htf4hSnapshots: HtfSnapshot[] = attachHtf
    ? (globalHtf ? globalHtf.snapshots4h : trackHtfState(resampleBars(bars, htf4hMin)))
    : [];
  const htf1dSnapshots: HtfSnapshot[] = attachHtf
    ? (globalHtf ? globalHtf.snapshots1d : trackHtfState(resampleBars(bars, htf1dMin)))
    : [];
  const htf4hIdxForLtf: number[] = attachHtf
    ? (globalHtf
        ? bars.map(b => globalHtf.htf4hIdxByLtfTs.get(b.ts) ?? -1)
        : buildLastClosedHtfIndex(bars, resampleBars(bars, htf4hMin), htf4hMin))
    : [];
  const htf1dIdxForLtf: number[] = attachHtf
    ? (globalHtf
        ? bars.map(b => globalHtf.htf1dIdxByLtfTs.get(b.ts) ?? -1)
        : buildLastClosedHtfIndex(bars, resampleBars(bars, htf1dMin), htf1dMin))
    : [];

  const evByTs = new Map<number, SmcEvent[]>();
  for (const e of events) {
    const arr = evByTs.get(e.ts) ?? [];
    arr.push(e);
    evByTs.set(e.ts, arr);
  }

  const idxByTs = new Map<number, number>();
  for (let i = 0; i < bars.length; i++) idxByTs.set(bars[i].ts, i);

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

  // Stage I (liquidity sweep) tracking. We record the bar index of
  // the most recent bullish/bearish sweep and the most recent same-
  // direction CHoCH; sweep_with_choch_* fires when both happened
  // within the SWEEP_CHOCH_WINDOW (5 bars).
  const SWEEP_CHOCH_WINDOW = 5;
  let lastSweepBullishIdx: number | null = null;
  let lastSweepBearishIdx: number | null = null;
  let lastChochBullishIdx: number | null = null;
  let lastChochBearishIdx: number | null = null;

  const activeObs = new Map<number, ActiveOB>();
  const activeFvgs = new Map<number, ActiveFVG>();

  const rows: DatasetRow[] = [];

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const evs = evByTs.get(b.ts) ?? [];

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
        // Stage I: track CHoCH events for sweep-with-choch confirmation.
        // Either scope (SWING or INTERNAL) counts; LTF is what we feed
        // the policy.
        if (e.tag === "CHOCH") {
          if (e.dir === 1) lastChochBullishIdx = i;
          else if (e.dir === -1) lastChochBearishIdx = i;
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
      if (e.type === "OB_MITIGATED") activeObs.delete(e.srcTs);

      if (e.type === "FVG_CREATE" && (e.bias === 1 || e.bias === -1)) {
        activeFvgs.set(e.srcTs, {
          srcTs: e.srcTs,
          createTs: e.ts,
          bias: e.bias,
          top: e.top,
          bottom: e.bottom,
        });
      }
      if (e.type === "FVG_FILLED") activeFvgs.delete(e.srcTs);
    }

    const tr = prevClose === null
      ? (b.high - b.low)
      : Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
    trBuf.push(tr);
    trSum += tr;
    if (trBuf.length > 14) trSum -= trBuf.shift()!;
    const atr14 = trBuf.length >= 14 ? (trSum / 14) : null;
    prevClose = b.close;

    const r1 = i >= 1 ? logRet(b.close, bars[i - 1].close) : null;
    const r4 = i >= 4 ? logRet(b.close, bars[i - 4].close) : null;
    const r16 = i >= 16 ? logRet(b.close, bars[i - 16].close) : null;

    const distToSwingHigh = lastSwingHigh ? safeDiv(lastSwingHigh.level - b.close, atr14) : null;
    const distToSwingLow = lastSwingLow ? safeDiv(b.close - lastSwingLow.level, atr14) : null;
    const distToInternalHigh = lastInternalHigh ? safeDiv(lastInternalHigh.level - b.close, atr14) : null;
    const distToInternalLow = lastInternalLow ? safeDiv(b.close - lastInternalLow.level, atr14) : null;
    const distToEqh = eqh ? safeDiv(eqh.level - b.close, atr14) : null;
    const distToEql = eql ? safeDiv(b.close - eql.level, atr14) : null;

    const bullishObs = [...activeObs.values()].filter(x => x.bias === 1);
    const bearishObs = [...activeObs.values()].filter(x => x.bias === -1);

    const pickNearestOb = (obs: ActiveOB[]) => {
      if (obs.length === 0) return null;
      let best: { ob: ActiveOB; dist: number } | null = null;
      for (const ob of obs) {
        const mid = (ob.high + ob.low) / 2;
        const dist = Math.abs(mid - b.close);
        if (!best || dist < best.dist) best = { ob, dist };
      }
      return best?.ob ?? null;
    };

    const bullOb = pickNearestOb(bullishObs);
    const bearOb = pickNearestOb(bearishObs);
    const bullDistMid = bullOb ? safeDiv(Math.abs(((bullOb.high + bullOb.low) / 2) - b.close), atr14) : null;
    const bearDistMid = bearOb ? safeDiv(Math.abs(((bearOb.high + bearOb.low) / 2) - b.close), atr14) : null;

    const bullishFvgs = [...activeFvgs.values()].filter(x => x.bias === 1);
    const bearishFvgs = [...activeFvgs.values()].filter(x => x.bias === -1);

    const pickNearestFvg = (fvgs: ActiveFVG[]) => {
      if (fvgs.length === 0) return null;
      let best: { fvg: ActiveFVG; dist: number } | null = null;
      for (const fvg of fvgs) {
        const mid = (fvg.top + fvg.bottom) / 2;
        const dist = Math.abs(mid - b.close);
        if (!best || dist < best.dist) best = { fvg, dist };
      }
      return best?.fvg ?? null;
    };

    const bullFvg = pickNearestFvg(bullishFvgs);
    const bearFvg = pickNearestFvg(bearishFvgs);
    const bullFvgDistMid = bullFvg ? safeDiv(Math.abs(((bullFvg.top + bullFvg.bottom) / 2) - b.close), atr14) : null;
    const bearFvgDistMid = bearFvg ? safeDiv(Math.abs(((bearFvg.top + bearFvg.bottom) / 2) - b.close), atr14) : null;

    // Stage I sweep detection. Uses the swing/internal/EQ levels as
    // they stand AFTER this bar's events have been applied — pivots
    // confirmed on prior bars; this bar's wick + close determine if a
    // sweep occurred. Either side of the swing/internal/EQ stack
    // triggers (binary; Stage I.2 may split EQH/EQL from swing).
    const bullishSweepLevels: Array<number | null> = [
      lastSwingLow?.level ?? null,
      lastInternalLow?.level ?? null,
      eql?.level ?? null,
    ];
    const bearishSweepLevels: Array<number | null> = [
      lastSwingHigh?.level ?? null,
      lastInternalHigh?.level ?? null,
      eqh?.level ?? null,
    ];
    let sweepBullishEvent = 0;
    for (const lvl of bullishSweepLevels) {
      if (lvl !== null && b.low < lvl && b.close > lvl) {
        sweepBullishEvent = 1;
        break;
      }
    }
    let sweepBearishEvent = 0;
    for (const lvl of bearishSweepLevels) {
      if (lvl !== null && b.high > lvl && b.close < lvl) {
        sweepBearishEvent = 1;
        break;
      }
    }
    if (sweepBullishEvent) lastSweepBullishIdx = i;
    if (sweepBearishEvent) lastSweepBearishIdx = i;

    // sweep_with_choch: 1 when a same-direction sweep + CHoCH both
    // fell within the last SWEEP_CHOCH_WINDOW bars.
    const inWindow = (idx: number | null) =>
      idx !== null && (i - idx) <= SWEEP_CHOCH_WINDOW && (i - idx) >= 0;
    const sweepWithChochBullish =
      inWindow(lastSweepBullishIdx) && inWindow(lastChochBullishIdx) ? 1 : 0;
    const sweepWithChochBearish =
      inWindow(lastSweepBearishIdx) && inWindow(lastChochBearishIdx) ? 1 : 0;

    // Skip prefix rows that exist only so HTF + ATR can warm up.
    if (i < outputStartBar) continue;

    // Look up the HTF state as of the *last closed* HTF bar at this
    // LTF ts (in-progress HTF candle is intentionally excluded).
    const htf4hIdx = attachHtf ? (htf4hIdxForLtf[i] ?? -1) : -1;
    const htf1dIdx = attachHtf ? (htf1dIdxForLtf[i] ?? -1) : -1;
    const htf4hSnap = htf4hIdx >= 0 ? htf4hSnapshots[htf4hIdx] : null;
    const htf1dSnap = htf1dIdx >= 0 ? htf1dSnapshots[htf1dIdx] : null;

    const htf4hDistSwingHigh = htf4hSnap?.lastSwingHigh != null
      ? safeDiv(htf4hSnap.lastSwingHigh - b.close, atr14) : null;
    const htf4hDistSwingLow = htf4hSnap?.lastSwingLow != null
      ? safeDiv(b.close - htf4hSnap.lastSwingLow, atr14) : null;

    rows.push({
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

      active_bullish_fvg_count: bullishFvgs.length,
      active_bearish_fvg_count: bearishFvgs.length,

      nearest_bullish_fvg_top: bullFvg?.top ?? null,
      nearest_bullish_fvg_bottom: bullFvg?.bottom ?? null,
      nearest_bullish_fvg_age: bullFvg ? (i - (idxByTs.get(bullFvg.createTs) ?? i)) : null,
      nearest_bullish_fvg_dist_mid_atr: bullFvgDistMid,
      inside_bullish_fvg: bullFvg ? ((b.low <= bullFvg.top && b.high >= bullFvg.bottom) ? 1 : 0) : 0,

      nearest_bearish_fvg_top: bearFvg?.top ?? null,
      nearest_bearish_fvg_bottom: bearFvg?.bottom ?? null,
      nearest_bearish_fvg_age: bearFvg ? (i - (idxByTs.get(bearFvg.createTs) ?? i)) : null,
      nearest_bearish_fvg_dist_mid_atr: bearFvgDistMid,
      inside_bearish_fvg: bearFvg ? ((b.low <= bearFvg.top && b.high >= bearFvg.bottom) ? 1 : 0) : 0,

      structure_alignment: (swingBias !== 0 && internalBias !== 0 && swingBias === internalBias) ? 1 : 0,
      distance_to_premium_discount: (() => {
        if (!lastSwingHigh || !lastSwingLow) return null;
        const range = lastSwingHigh.level - lastSwingLow.level;
        if (!Number.isFinite(range) || range <= 0) return null;
        return (b.close - lastSwingLow.level) / range;
      })(),
      ...((): {
        internal_sl_distance_long: number | null;
        swing_tp_distance_long: number | null;
        rr_ratio_long: number | null;
        internal_sl_distance_short: number | null;
        swing_tp_distance_short: number | null;
        rr_ratio_short: number | null;
      } => {
        const atrOk = atr14 !== null && Number.isFinite(atr14) && atr14 > 0;
        const norm = (v: number) => (atrOk ? v / (atr14 as number) : null);

        // Long-side: SL at last_internal_low (must be below close); TP at last_swing_high (must be above close).
        const longSlRaw = lastInternalLow && lastInternalLow.level < b.close
          ? b.close - lastInternalLow.level
          : null;
        const longTpRaw = lastSwingHigh && lastSwingHigh.level > b.close
          ? lastSwingHigh.level - b.close
          : null;
        const longSl = longSlRaw !== null ? norm(longSlRaw) : null;
        const longTp = longTpRaw !== null ? norm(longTpRaw) : null;
        // Stage B-18: invalidate rr_ratio when the structural SL is
        // closer than 0.3 × ATR (degenerate swing pivot stuck on the
        // current wick) — without the gate rr_ratio explodes to
        // 10000+ and silently passes the PDF β1 R:R >= 1.5 rule.
        // After the gate, clamp to [0.5, 10] as a sanity fallback.
        const rrLong = (longSl !== null && longTp !== null && longSl >= 0.3)
          ? Math.max(0.5, Math.min(10, longTp / longSl))
          : null;

        // Short-side: SL at last_internal_high (must be above close); TP at last_swing_low (must be below close).
        const shortSlRaw = lastInternalHigh && lastInternalHigh.level > b.close
          ? lastInternalHigh.level - b.close
          : null;
        const shortTpRaw = lastSwingLow && lastSwingLow.level < b.close
          ? b.close - lastSwingLow.level
          : null;
        const shortSl = shortSlRaw !== null ? norm(shortSlRaw) : null;
        const shortTp = shortTpRaw !== null ? norm(shortTpRaw) : null;
        const rrShort = (shortSl !== null && shortTp !== null && shortSl >= 0.3)
          ? Math.max(0.5, Math.min(10, shortTp / shortSl))
          : null;

        return {
          internal_sl_distance_long: longSl,
          swing_tp_distance_long: longTp,
          rr_ratio_long: rrLong,
          internal_sl_distance_short: shortSl,
          swing_tp_distance_short: shortTp,
          rr_ratio_short: rrShort,
        };
      })(),

      htf_4h_swing_bias: htf4hSnap?.swingBias ?? 0,
      htf_4h_internal_bias: htf4hSnap?.internalBias ?? 0,
      htf_4h_bars_since_swing_break: htf4hSnap?.barsSinceSwingBreak ?? null,
      htf_4h_bars_since_internal_break: htf4hSnap?.barsSinceInternalBreak ?? null,
      htf_4h_premium_discount: htf4hSnap !== null ? premiumDiscount(b.close, htf4hSnap) : null,
      htf_4h_dist_to_swing_high_atr: htf4hDistSwingHigh,
      htf_4h_dist_to_swing_low_atr: htf4hDistSwingLow,

      htf_1d_swing_bias: htf1dSnap?.swingBias ?? 0,
      htf_1d_internal_bias: htf1dSnap?.internalBias ?? 0,
      htf_1d_bars_since_swing_break: htf1dSnap?.barsSinceSwingBreak ?? null,
      htf_1d_premium_discount: htf1dSnap !== null ? premiumDiscount(b.close, htf1dSnap) : null,

      sweep_bullish_event: sweepBullishEvent,
      sweep_bearish_event: sweepBearishEvent,
      sweep_with_choch_bullish: sweepWithChochBullish,
      sweep_with_choch_bearish: sweepWithChochBearish,
    });
  }

  return rows;
}
