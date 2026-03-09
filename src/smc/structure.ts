import { Bar } from "../io/types.js";
import { Bias, Pivot, SmcEvent, SmcState, SmcConfig, BULLISH, BEARISH, OrderBlock } from "./types.js";
import { leg, startOfNewLeg, startOfBearishLeg, startOfBullishLeg } from "./leg.js";
import { updatePivot } from "./pivots.js";
import { tryEqualHighLow } from "./equalHighLow.js";
import { storeOrderBlock, mitigateBlocks } from "./orderBlocks.js";
import { isHighVolatilityBar, parsedHighLow } from "./volatility.js";

export class SmcStructure {
  private readonly cfg: SmcConfig;

  private prevSwingLeg: 0 | 1 = 0;
  private prevInternalLeg: 0 | 1 = 0;
  private prevEqLeg: 0 | 1 = 0;

  // arrays for OB selection
  private parsedHighs: number[] = [];
  private parsedLows: number[] = [];
  private highs: number[] = [];
  private lows: number[] = [];
  private times: number[] = [];

  constructor(cfg: SmcConfig, private readonly state: SmcState) {
    this.cfg = cfg;
  }

  step(bar: Bar, index: number, atrForEq: number | null, atrForVol: number | null): SmcEvent[] {
    const ev: SmcEvent[] = [];

    // volatility parsing
    const highVol = this.cfg.volatilityFilter.enabled
      ? isHighVolatilityBar(bar, atrForVol, this.cfg.volatilityFilter.mult)
      : false;
    const { parsedHigh, parsedLow } = parsedHighLow(bar, highVol);

    this.parsedHighs.push(parsedHigh);
    this.parsedLows.push(parsedLow);
    this.highs.push(bar.high);
    this.lows.push(bar.low);
    this.times.push(bar.ts);

    // 1) Pivots: swing and internal
    ev.push(...this.updatePivots(bar, index, atrForEq));

    // 2) Structure breaks: internal then swing
    ev.push(...this.displayStructure(bar, index, true));
    ev.push(...this.displayStructure(bar, index, false));

    // 3) Mitigate order blocks
    if (this.cfg.ob) {
      const bearSource = (this.cfg.obMitigation === "close") ? bar.close : bar.high;
      const bullSource = (this.cfg.obMitigation === "close") ? bar.close : bar.low;

      const intRes = mitigateBlocks(this.state.internalOrderBlocks, bar.high, bar.low, bullSource, bearSource);
      if (intRes.mitigated.length) {
        for (const b of intRes.mitigated) ev.push({ type: "OB_MITIGATED", scope: "INTERNAL", ts: bar.ts, bias: b.bias, high: b.high, low: b.low, srcTs: b.ts });
      }
      this.state.internalOrderBlocks = intRes.kept;

      const swRes = mitigateBlocks(this.state.swingOrderBlocks, bar.high, bar.low, bullSource, bearSource);
      if (swRes.mitigated.length) {
        for (const b of swRes.mitigated) ev.push({ type: "OB_MITIGATED", scope: "SWING", ts: bar.ts, bias: b.bias, high: b.high, low: b.low, srcTs: b.ts });
      }
      this.state.swingOrderBlocks = swRes.kept;
    }

    return ev;
  }

  private updatePivots(bar: Bar, index: number, atrForEq: number | null): SmcEvent[] {
    const ev: SmcEvent[] = [];

    // Swing pivots
    const swingSize = this.cfg.swingLen;
    const swingLeg = legFromBars(this.highs, this.lows, index, swingSize);
    if (startOfNewLeg(this.prevSwingLeg, swingLeg)) {
      if (startOfBullishLeg(this.prevSwingLeg, swingLeg)) {
        // pivot low at index - size
        const j = index - swingSize;
        const level = this.lows[j];
        updatePivot(this.state.swingLow, level, this.times[j], j);
        ev.push({ type: "SWING_PIVOT", pivotType: "LOW", ts: this.times[j], level, index: j });
      } else if (startOfBearishLeg(this.prevSwingLeg, swingLeg)) {
        const j = index - swingSize;
        const level = this.highs[j];
        updatePivot(this.state.swingHigh, level, this.times[j], j);
        ev.push({ type: "SWING_PIVOT", pivotType: "HIGH", ts: this.times[j], level, index: j });
      }
    }
    this.prevSwingLeg = swingLeg;

    // Internal pivots (smaller size)
    const internalSize = this.cfg.internalLen;
    const internalLeg = legFromBars(this.highs, this.lows, index, internalSize);
    if (startOfNewLeg(this.prevInternalLeg, internalLeg)) {
      if (startOfBullishLeg(this.prevInternalLeg, internalLeg)) {
        const j = index - internalSize;
        const level = this.lows[j];
        updatePivot(this.state.internalLow, level, this.times[j], j);
        ev.push({ type: "INTERNAL_PIVOT", pivotType: "LOW", ts: this.times[j], level, index: j });
      } else if (startOfBearishLeg(this.prevInternalLeg, internalLeg)) {
        const j = index - internalSize;
        const level = this.highs[j];
        updatePivot(this.state.internalHigh, level, this.times[j], j);
        ev.push({ type: "INTERNAL_PIVOT", pivotType: "HIGH", ts: this.times[j], level, index: j });
      }
    }
    this.prevInternalLeg = internalLeg;

    // Equal highs/lows (using eqLen)
    const eqSize = this.cfg.eqLen;
    const eqLeg = legFromBars(this.highs, this.lows, index, eqSize);
    if (startOfNewLeg(this.prevEqLeg, eqLeg)) {
      // pivot low/high at index - eqSize
      const j = index - eqSize;
      if (j >= 0) {
        // if bullish leg starts -> low pivot
        if (startOfBullishLeg(this.prevEqLeg, eqLeg)) {
          const level = this.lows[j];
          const eq = tryEqualHighLow(this.state.equalLow, level, false, eqSize, this.times[j], atrForEq, this.cfg.eqThr);
          // update equalLow pivot
          updatePivot(this.state.equalLow, level, this.times[j], j);
          if (eq) ev.push(eq);
        } else if (startOfBearishLeg(this.prevEqLeg, eqLeg)) {
          const level = this.highs[j];
          const eq = tryEqualHighLow(this.state.equalHigh, level, true, eqSize, this.times[j], atrForEq, this.cfg.eqThr);
          updatePivot(this.state.equalHigh, level, this.times[j], j);
          if (eq) ev.push(eq);
        }
      }
    }
    this.prevEqLeg = eqLeg;

    return ev;
  }

  private displayStructure(bar: Bar, index: number, internal: boolean): SmcEvent[] {
    const ev: SmcEvent[] = [];
    const pHigh: Pivot = internal ? this.state.internalHigh : this.state.swingHigh;
    const pLow: Pivot = internal ? this.state.internalLow : this.state.swingLow;
    const t = internal ? this.state.internalTrend : this.state.swingTrend;
    const scope = internal ? "INTERNAL" as const : "SWING" as const;

    // Bullish break: close crosses above pivot high level
    if (pHigh.currentLevel !== null && !pHigh.crossed && bar.close > pHigh.currentLevel) {
      const tag = (t.bias === BEARISH) ? "CHOCH" : "BOS";
      pHigh.crossed = true;
      t.bias = BULLISH;
      ev.push({ type: "STRUCTURE_BREAK", scope, tag, dir: 1, ts: bar.ts, level: pHigh.currentLevel });

      if (this.cfg.ob && pHigh.index !== null) {
        const ob = storeOrderBlock(this.parsedHighs, this.parsedLows, this.times, pHigh.index, index, 1);
        if (ob) this.unshiftOb(internal, ob, bar.ts, ev);
      }
    }

    // Bearish break: close crosses below pivot low level
    if (pLow.currentLevel !== null && !pLow.crossed && bar.close < pLow.currentLevel) {
      const tag = (t.bias === BULLISH) ? "CHOCH" : "BOS";
      pLow.crossed = true;
      t.bias = BEARISH;
      ev.push({ type: "STRUCTURE_BREAK", scope, tag, dir: -1, ts: bar.ts, level: pLow.currentLevel });

      if (this.cfg.ob && pLow.index !== null) {
        const ob = storeOrderBlock(this.parsedHighs, this.parsedLows, this.times, pLow.index, index, -1);
        if (ob) this.unshiftOb(internal, ob, bar.ts, ev);
      }
    }

    return ev;
  }

  private unshiftOb(internal: boolean, ob: OrderBlock, nowTs: number, ev: SmcEvent[]) {
    const list = internal ? this.state.internalOrderBlocks : this.state.swingOrderBlocks;
    list.unshift(ob);
    if (list.length > this.cfg.obMax) list.pop();
    ev.push({ type: "OB_CREATE", scope: internal ? "INTERNAL" : "SWING", ts: nowTs, bias: ob.bias, high: ob.high, low: ob.low, srcTs: ob.ts });
  }
}

// Helper: leg logic using arrays (no Bar allocation)
function legFromBars(highs: number[], lows: number[], i: number, size: number): 0 | 1 {
  if (i < size) return 0;
  const j = i - size;
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = j + 1; k <= i; k++) {
    hi = Math.max(hi, highs[k]);
    lo = Math.min(lo, lows[k]);
  }
  const newLegHigh = highs[j] > hi;
  const newLegLow = lows[j] < lo;
  if (newLegHigh) return 0;
  if (newLegLow) return 1;
  return 0;
}
