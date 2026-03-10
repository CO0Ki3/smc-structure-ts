export const BULLISH = 1 as const;
export const BEARISH = -1 as const;

export type Bias = 1 | -1 | 0;

export type Pivot = {
  currentLevel: number | null;
  lastLevel: number | null;
  crossed: boolean;
  ts: number | null;
  index: number | null;
};

export type Trend = { bias: Bias };

export type OrderBlock = {
  high: number;
  low: number;
  ts: number;
  bias: Bias;
};

export type FairValueGap = {
  top: number;
  bottom: number;
  ts: number;     // creation ts
  bias: Bias;     // +1 bullish, -1 bearish
};

export type SmcEvent =
  | { type: "SWING_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "INTERNAL_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "STRUCTURE_BREAK"; scope: "SWING" | "INTERNAL"; tag: "BOS" | "CHOCH"; dir: Bias; ts: number; level: number }
  | { type: "EQ"; eqType: "EQH" | "EQL"; ts: number; level: number; basePivotTs: number; baseLevel: number }
  | { type: "OB_CREATE"; scope: "SWING" | "INTERNAL"; ts: number; bias: Bias; high: number; low: number; srcTs: number }
  | { type: "OB_MITIGATED"; scope: "SWING" | "INTERNAL"; ts: number; bias: Bias; high: number; low: number; srcTs: number }
  | { type: "FVG_CREATE"; ts: number; bias: Bias; top: number; bottom: number; srcTs: number }
  | { type: "FVG_FILLED"; ts: number; bias: Bias; top: number; bottom: number; srcTs: number };

export type SmcConfig = {
  swingLen: number;
  internalLen: number;
  eqLen: number;
  eqThr: number;
  atrLenForEq: number;
  ob: boolean;
  obMax: number;
  obMitigation: "close" | "highlow";
  volatilityFilter: {
    enabled: boolean;
    atrLen: number;
    mult: number;
  };
  fvg: {
    enabled: boolean;
    autoThreshold: boolean;
    extendBars: number;
  };
};

export type SmcState = {
  swingHigh: Pivot;
  swingLow: Pivot;
  internalHigh: Pivot;
  internalLow: Pivot;
  equalHigh: Pivot;
  equalLow: Pivot;
  swingTrend: Trend;
  internalTrend: Trend;
  swingOrderBlocks: OrderBlock[];
  internalOrderBlocks: OrderBlock[];
  fairValueGaps: FairValueGap[];
};
