export const BULLISH = 1 as const;
export const BEARISH = -1 as const;

export type Bias = 1 | -1 | 0;

export type Pivot = {
  currentLevel: number | null;
  lastLevel: number | null;
  crossed: boolean;
  ts: number | null;       // pivot timestamp (bar open time)
  index: number | null;    // bar index
};

export type Trend = { bias: Bias };

export type OrderBlock = {
  high: number;
  low: number;
  ts: number;      // source bar ts
  bias: Bias;      // +1 bullish OB, -1 bearish OB
};

export type SmcEvent =
  | { type: "SWING_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "INTERNAL_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "STRUCTURE_BREAK"; scope: "SWING" | "INTERNAL"; tag: "BOS" | "CHOCH"; dir: Bias; ts: number; level: number }
  | { type: "EQ"; eqType: "EQH" | "EQL"; ts: number; level: number; basePivotTs: number; baseLevel: number }
  | { type: "OB_CREATE"; scope: "SWING" | "INTERNAL"; ts: number; bias: Bias; high: number; low: number; srcTs: number }
  | { type: "OB_MITIGATED"; scope: "SWING" | "INTERNAL"; ts: number; bias: Bias; high: number; low: number; srcTs: number };

export type SmcConfig = {
  swingLen: number;       // like swingsLengthInput (default 50 for 15m)
  internalLen: number;    // internal structure length (default 5)
  eqLen: number;          // equal highs/lows confirmation bars
  eqThr: number;          // threshold multiplier in (0, 0.5), multiplied by ATR200
  atrLenForEq: number;    // default 200
  ob: boolean;
  obMax: number;          // cap stored blocks
  obMitigation: "close" | "highlow";
  volatilityFilter: {
    enabled: boolean;
    atrLen: number; // default 200
    mult: number;   // default 2.0 (bar range >= mult * atr)
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
};
