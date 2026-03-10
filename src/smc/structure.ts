import { Bar } from "../io/types.js";
import { Bias, Pivot, SmcEvent, SmcState, SmcConfig, BULLISH, BEARISH, OrderBlock, FairValueGap } from "./types.js";
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

  private parsedHighs: number[] = [];
  private parsedLows: number[] = [];
  private highs: number[] = [];
  private lows: number[] = [];
  private times: number[] = [];

  private cumulativeAbsBarDeltaPct = 0;
  private cumulativeBarCount = 0;

  constructor(cfg: SmcConfig, private readonly state: SmcState) {
    this.cfg = cfg;
  }

  step(bar: Bar, index: number, bars: Bar[], atrForEq: number | null, atrForVol: number | null): SmcEvent[] {
    const ev: SmcEvent[] = [];

    const highVol = this.cfg.volatilityFilter.enabled
      ? isHighVolatilityBar(bar, atrForVol, this.cfg.volatilityFilter.mult)
      : false;
    const { parsedHigh, parsedLow } = parsedHighLow(bar, highVol);

    this.parsedHighs.push(parsedHigh);
    this.parsedLows.push(parsedLow);
    this.highs.push(bar.high);
    this.lows.push(bar.low);
    this.times.push(bar.ts);

    ev.push(...this.updatePivots(bar, index, atrForEq));
    ev.push(...this.displayStructure(bar, index, true));
    ev.push(...this.displayStructure(bar, index, false));

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

    if (this.cfg.fvg.enabled) {
      ev.push(...this.updateFvgs(bar, index, bars));
    }

    return ev;
  }

  private updatePivots(bar: Bar, index: number, atrForEq: number | null): SmcEvent[] {
    const ev: SmcEvent[] = [];

    const swingSize = this.cfg.swingLen;
    const swingLeg = legFromBars(this.highs, this.lows, index, swingSize);
    if (startOfNewLeg(this.prevSwingLeg, swingLeg)) {
      if (startOfBullishLeg(this.prevSwingLeg, swingLeg)) {
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

    const eqSize = this.cfg.eqLen;
    const eqLeg = legFromBars(this.highs, this.lows, index, eqSize);
    if (startOfNewLeg(this.prevEqLeg, eqLeg)) {
      const j = index - eqSize;
      if (j >= 0) {
        if (startOfBullishLeg(this.prevEqLeg, eqLeg)) {
          const level = this.lows[j];
          const eq = tryEqualHighLow(this.state.equalLow, level, false, eqSize, this.times[j], atrForEq, this.cfg.eqThr);
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

  private updateFvgs(bar: Bar, index: number, bars: Bar[]): SmcEvent[] {
    const ev: SmcEvent[] = [];

    // fill existing
    const kept: FairValueGap[] = [];
    for (const g of this.state.fairValueGaps) {
      const filled = (g.bias === BULLISH && bar.low < g.bottom) || (g.bias === BEARISH && bar.high > g.top);
      if (filled) {
        ev.push({ type: "FVG_FILLED", ts: bar.ts, bias: g.bias, top: g.top, bottom: g.bottom, srcTs: g.ts });
      } else {
        kept.push(g);
      }
    }
    this.state.fairValueGaps = kept;

    if (index < 2) return ev;

    const prev = bars[index - 1];
    const prev2 = bars[index - 2];

    const barDeltaPct = prev.open !== 0 ? Math.abs((prev.close - prev.open) / (prev.open * 100)) : 0;
    this.cumulativeAbsBarDeltaPct += barDeltaPct;
    this.cumulativeBarCount += 1;
    const avgAbsPct = this.cumulativeBarCount > 0 ? this.cumulativeAbsBarDeltaPct / this.cumulativeBarCount : 0;
    const threshold = this.cfg.fvg.autoThreshold ? avgAbsPct * 2 : 0;

    const bullish = bar.low > prev2.high && prev.close > prev2.high && barDeltaPct > threshold;
    const bearish = bar.high < prev2.low && prev.close < prev2.low && barDeltaPct > threshold;

    if (bullish) {
      const g: FairValueGap = { top: bar.low, bottom: prev2.high, ts: bar.ts, bias: BULLISH };
      this.state.fairValueGaps.unshift(g);
      ev.push({ type: "FVG_CREATE", ts: bar.ts, bias: BULLISH, top: g.top, bottom: g.bottom, srcTs: g.ts });
    }

    if (bearish) {
      const g: FairValueGap = { top: bar.high, bottom: prev2.low, ts: bar.ts, bias: BEARISH };
      this.state.fairValueGaps.unshift(g);
      ev.push({ type: "FVG_CREATE", ts: bar.ts, bias: BEARISH, top: g.top, bottom: g.bottom, srcTs: g.ts });
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
