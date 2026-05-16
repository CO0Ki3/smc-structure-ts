import { Bar } from "../io/types.js";
import { Atr } from "../indicators/atr.js";
import { SmcConfig, SmcState, BULLISH, BEARISH } from "./types.js";
import { newState, defaultConfig } from "./engine.js";
import { SmcStructure } from "./structure.js";

/**
 * Snapshot of the HTF SMC state after a given HTF bar has closed.
 * `swingBias` / `internalBias`: -1 bear, 0 neutral, +1 bull
 * `lastSwingHigh` / `lastSwingLow`: most recent confirmed pivot level
 *   (used to read HTF premium/discount + opposing-liquidity zones)
 * `lastInternalHigh` / `lastInternalLow`: internal pivots
 * `barsSinceSwingBreak`: how many HTF bars since the last
 *   STRUCTURE_BREAK at swing scope (proxy for HTF trend freshness).
 * `barsSinceInternalBreak`: same for internal scope.
 *
 * Stage Phase 1 / C-1: these snapshots feed the LTF state dataset
 * so the policy gets explicit HTF context (PDF chapter 4 — "LTF
 * entries respect HTF bias").
 */
export type HtfSnapshot = {
  swingBias: number;
  internalBias: number;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  lastInternalHigh: number | null;
  lastInternalLow: number | null;
  barsSinceSwingBreak: number | null;
  barsSinceInternalBreak: number | null;
};

/**
 * Run the SMC engine on the HTF bars and capture a snapshot of the
 * structural state after every HTF bar closes. Returns an array of
 * the same length as `htfBars`; `out[k]` is the state *as of HTF
 * bar k's close*.
 *
 * Uses defaultConfig() — same swing/internal lookbacks as LTF. If
 * Phase 1 audit shows HTF needs longer swing window, knob is here.
 */
export function trackHtfState(htfBars: Bar[], cfg: SmcConfig = defaultConfig()): HtfSnapshot[] {
  if (htfBars.length === 0) return [];
  const state: SmcState = newState();
  const atrEq = new Atr(cfg.atrLenForEq);
  const atrVol = new Atr(cfg.volatilityFilter.atrLen);
  const smc = new SmcStructure(cfg, state);

  const snapshots: HtfSnapshot[] = [];
  let lastSwingBreakIdx: number | null = null;
  let lastInternalBreakIdx: number | null = null;

  for (let i = 0; i < htfBars.length; i++) {
    const bar = htfBars[i];
    const atrEqVal = atrEq.update(bar);
    const atrVolVal = atrVol.update(bar);
    const events = smc.step(bar, i, htfBars, atrEqVal, atrVolVal);
    for (const e of events) {
      if (e.type === "STRUCTURE_BREAK") {
        if (e.scope === "SWING") lastSwingBreakIdx = i;
        else if (e.scope === "INTERNAL") lastInternalBreakIdx = i;
      }
    }
    snapshots.push({
      swingBias: state.swingTrend.bias === BULLISH ? 1 : state.swingTrend.bias === BEARISH ? -1 : 0,
      internalBias: state.internalTrend.bias === BULLISH ? 1 : state.internalTrend.bias === BEARISH ? -1 : 0,
      lastSwingHigh: state.swingHigh.currentLevel,
      lastSwingLow: state.swingLow.currentLevel,
      lastInternalHigh: state.internalHigh.currentLevel,
      lastInternalLow: state.internalLow.currentLevel,
      barsSinceSwingBreak: lastSwingBreakIdx !== null ? (i - lastSwingBreakIdx) : null,
      barsSinceInternalBreak: lastInternalBreakIdx !== null ? (i - lastInternalBreakIdx) : null,
    });
  }
  return snapshots;
}

/**
 * Premium/discount zone position on the HTF: where does `close`
 * sit between the last swing low (= 0) and last swing high (= 1)?
 * Returns null when the swing range is degenerate (high ≤ low) or
 * either pivot missing.
 *
 * Same definition PDF uses for LTF; reused here for HTF row attach.
 */
export function premiumDiscount(close: number, snap: HtfSnapshot): number | null {
  if (snap.lastSwingHigh === null || snap.lastSwingLow === null) return null;
  const range = snap.lastSwingHigh - snap.lastSwingLow;
  if (!Number.isFinite(range) || range <= 0) return null;
  return (close - snap.lastSwingLow) / range;
}
