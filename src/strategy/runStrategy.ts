import type { Bar, SmcEvent, StrategyParams, TradeLog, Bias, TradeTrace, TradeTraceItem } from "./types.js";

function bpsToRate(bps: number): number {
  return bps / 10_000;
}

function newId(i: number): string {
  return `T${String(i).padStart(6, "0")}`;
}

type PivotRef = { ts: number; level: number; type: "HIGH" | "LOW" };
type OrderBlockRef = { ts: number; high: number; low: number; bias: 1 | -1; srcTs?: number };

export function runStrategy(
  bars: Bar[],
  events: SmcEvent[],
  params: StrategyParams
): { trades: TradeLog[]; traces: TradeTrace[] } {
  const BAR_MS = params.barMinutes * 60_000;

  const evByTs = new Map<number, SmcEvent[]>();
  for (const e of events) {
    const arr = evByTs.get(e.ts) ?? [];
    arr.push(e);
    evByTs.set(e.ts, arr);
  }

  let bias: Bias = 0;
  let lastSwingHigh: PivotRef | null = null;
  let lastSwingLow: PivotRef | null = null;

  let lastBiasEvent: { ts: number; tag: "BOS" | "CHOCH"; dir: 1 | -1; level: number } | null = null;

  type Phase = "IDLE" | "SWEPT" | "CONFIRMED" | "IN_TRADE";
  let phase: Phase = "IDLE";

  let sweep: { ts: number; side: "LONG" | "SHORT"; extreme: number; swing: PivotRef } | null = null;
  let confirm: { ts: number; tag: "CHOCH" | "BOS"; dir: 1 | -1; level: number } | null = null;
  let ob: OrderBlockRef | null = null;

  let tradeCore:
    | Omit<TradeLog, "exitTs" | "exitPrice" | "exitReason" | "grossReturn" | "netReturn" | "holdBars">
    | null = null;

  let traceChain: TradeTraceItem[] = [];

  const trades: TradeLog[] = [];
  const traces: TradeTrace[] = [];
  let tradeSeq = 0;

  const feeRate = bpsToRate(params.feeBps);

  const idxByTs = new Map<number, number>();
  for (let i = 0; i < bars.length; i++) idxByTs.set(bars[i].ts, i);

  const barsSince = (t0: number, t1: number) => Math.floor((t1 - t0) / BAR_MS);

  function resetState() {
    phase = "IDLE";
    sweep = null;
    confirm = null;
    ob = null;
    tradeCore = null;
    traceChain = [];
  }

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const evs = evByTs.get(bar.ts) ?? [];

    for (const e of evs) {
      if (e.type === "SWING_PIVOT") {
        if (e.pivotType === "HIGH") lastSwingHigh = { ts: e.ts, level: e.level, type: "HIGH" };
        else lastSwingLow = { ts: e.ts, level: e.level, type: "LOW" };
      }

      if (e.type === "STRUCTURE_BREAK" && e.scope === "SWING" && (e.dir === 1 || e.dir === -1)) {
        bias = e.dir;
        lastBiasEvent = { ts: e.ts, tag: e.tag, dir: e.dir as 1 | -1, level: e.level };
      }

      if (e.type === "OB_CREATE" && (e.bias === 1 || e.bias === -1)) {
        ob = { ts: e.ts, high: e.high, low: e.low, bias: e.bias as 1 | -1, srcTs: e.srcTs };
      }

      if (e.type === "OB_MITIGATED") {
        if (ob && ob.ts === e.srcTs) ob = null;
      }
    }

    // In-trade management
    if (phase === "IN_TRADE" && tradeCore) {
      const side = tradeCore.side;

      const hitSL = side === "LONG" ? bar.low <= tradeCore.stopPrice : bar.high >= tradeCore.stopPrice;
      const hitTP = side === "LONG" ? bar.high >= tradeCore.takePrice : bar.low <= tradeCore.takePrice;

      let exitReason: "SL" | "TP" | "TIMEOUT" | null = null;
      let exitPrice = Number.NaN;

      if (hitSL && hitTP) { exitReason = "SL"; exitPrice = tradeCore.stopPrice; }
      else if (hitSL) { exitReason = "SL"; exitPrice = tradeCore.stopPrice; }
      else if (hitTP) { exitReason = "TP"; exitPrice = tradeCore.takePrice; }

      const entryIdx = idxByTs.get(tradeCore.entryTs) ?? i;
      const held = i - entryIdx;

      if (!exitReason && held >= params.timeoutBars) {
        exitReason = "TIMEOUT";
        exitPrice = bar.close;
      }

      if (exitReason) {
        const gross = side === "LONG"
          ? (exitPrice / tradeCore.entryPrice - 1)
          : (tradeCore.entryPrice / exitPrice - 1);

        const net = gross - feeRate;

        const log: TradeLog = {
          ...tradeCore,
          exitTs: bar.ts,
          exitPrice,
          exitReason,
          grossReturn: gross,
          netReturn: net,
          holdBars: held,
        };
        trades.push(log);

        traces.push({ tradeId: tradeCore.tradeId, side: tradeCore.side, chain: traceChain });

        resetState();
        continue;
      }
    }

    // IDLE -> sweep detection
    if (phase === "IDLE") {
      if ((bias === 1 || bias === -1) && lastBiasEvent && traceChain.length === 0) {
        traceChain.push({ kind: "BIAS", ...lastBiasEvent });
      }

      if (bias === 1 && lastSwingLow) {
        const swept = bar.low < lastSwingLow.level && bar.close > lastSwingLow.level;
        if (swept) {
          sweep = { ts: bar.ts, side: "LONG", extreme: bar.low, swing: lastSwingLow };
          phase = "SWEPT";
          traceChain.push({ kind: "SWING_PIVOT", ts: lastSwingLow.ts, pivotType: "LOW", level: lastSwingLow.level });
          traceChain.push({ kind: "SWEEP", ts: bar.ts, swingLevel: lastSwingLow.level, extreme: bar.low });
          continue;
        }
      }

      if (bias === -1 && lastSwingHigh) {
        const swept = bar.high > lastSwingHigh.level && bar.close < lastSwingHigh.level;
        if (swept) {
          sweep = { ts: bar.ts, side: "SHORT", extreme: bar.high, swing: lastSwingHigh };
          phase = "SWEPT";
          traceChain.push({ kind: "SWING_PIVOT", ts: lastSwingHigh.ts, pivotType: "HIGH", level: lastSwingHigh.level });
          traceChain.push({ kind: "SWEEP", ts: bar.ts, swingLevel: lastSwingHigh.level, extreme: bar.high });
          continue;
        }
      }
    }

    // SWEPT -> confirmation
    if (phase === "SWEPT" && sweep) {
      if (barsSince(sweep.ts, bar.ts) > params.confirmWindowBars) {
        resetState();
        continue;
      }

      for (const e of evs) {
        if (e.type === "STRUCTURE_BREAK" && e.scope === "INTERNAL") {
          if (params.useChoChOnly && e.tag !== "CHOCH") continue;
          const neededDir = sweep.side === "LONG" ? 1 : -1;
          if (e.dir === neededDir) {
            confirm = { ts: e.ts, tag: e.tag, dir: neededDir as 1 | -1, level: e.level };
            phase = "CONFIRMED";
            traceChain.push({ kind: "CONFIRM", ts: confirm.ts, tag: confirm.tag, dir: confirm.dir, level: confirm.level });
            break;
          }
        }
      }
    }

    // CONFIRMED -> entry on OB retest
    if (phase === "CONFIRMED" && sweep && confirm) {
      if (barsSince(confirm.ts, bar.ts) > params.entryWindowBars) {
        resetState();
        continue;
      }

      if (!ob) continue;
      if (sweep.side === "LONG" && ob.bias !== 1) continue;
      if (sweep.side === "SHORT" && ob.bias !== -1) continue;

      const intersects = bar.low <= ob.high && bar.high >= ob.low;
      if (!intersects) continue;

      if (i + 1 >= bars.length) continue;
      const entryBar = bars[i + 1];
      const entryPrice = entryBar.open;

      const stopPrice = sweep.extreme;
      const risk = sweep.side === "LONG" ? (entryPrice - stopPrice) : (stopPrice - entryPrice);
      if (risk <= 0) continue;

      const takePrice = sweep.side === "LONG" ? (entryPrice + params.rr * risk) : (entryPrice - params.rr * risk);

      tradeSeq += 1;
      const tradeId = newId(tradeSeq);

      tradeCore = {
        tradeId,
        side: sweep.side,
        biasAtSignal: sweep.side === "LONG" ? 1 : -1,

        swingLevelTs: sweep.swing.ts,
        swingLevel: sweep.swing.level,

        sweepTs: sweep.ts,
        sweepExtreme: sweep.extreme,

        confirmTs: confirm.ts,
        confirmTag: confirm.tag,

        obTs: ob.ts,
        obHigh: ob.high,
        obLow: ob.low,

        entrySignalTs: bar.ts,
        entryTs: entryBar.ts,
        entryPrice,
        stopPrice,
        takePrice,
      };

      traceChain.push({ kind: "OB", ts: ob.ts, bias: ob.bias, high: ob.high, low: ob.low, srcTs: ob.srcTs ?? ob.ts });
      traceChain.push({ kind: "ENTRY", ts: entryBar.ts, entryPrice, stopPrice, takePrice });

      phase = "IN_TRADE";
      continue;
    }
  }

  return { trades, traces };
}
