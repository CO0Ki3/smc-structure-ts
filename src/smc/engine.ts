import { Bar } from "../io/types.js";
import { Atr } from "../indicators/atr.js";
import { SmcConfig, SmcEvent, SmcState } from "./types.js";
import { newPivot } from "./pivots.js";
import { SmcStructure } from "./structure.js";

export function defaultConfig(): SmcConfig {
  return {
    swingLen: 50,
    internalLen: 5,
    eqLen: 3,
    eqThr: 0.1,
    atrLenForEq: 200,
    ob: true,
    obMax: 100,
    obMitigation: "highlow",
    volatilityFilter: { enabled: true, atrLen: 200, mult: 2.0 },
  };
}

export function newState(): SmcState {
  return {
    swingHigh: newPivot(),
    swingLow: newPivot(),
    internalHigh: newPivot(),
    internalLow: newPivot(),
    equalHigh: newPivot(),
    equalLow: newPivot(),
    swingTrend: { bias: 0 },
    internalTrend: { bias: 0 },
    swingOrderBlocks: [],
    internalOrderBlocks: [],
  };
}

export function runSmc(bars: Bar[], cfg: SmcConfig): SmcEvent[] {
  const state = newState();
  const atrEq = new Atr(cfg.atrLenForEq);
  const atrVol = new Atr(cfg.volatilityFilter.atrLen);

  const smc = new SmcStructure(cfg, state);
  const events: SmcEvent[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const atrEqVal = atrEq.update(bar);
    const atrVolVal = atrVol.update(bar);

    const ev = smc.step(bar, i, atrEqVal, atrVolVal);
    for (const e of ev) events.push(e);
  }

  return events;
}
