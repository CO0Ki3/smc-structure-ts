export type Bias = 1 | -1 | 0;

export type Bar = {
  ts: number; // ms epoch UTC (candle open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type SmcEvent =
  | { type: "SWING_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "INTERNAL_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "STRUCTURE_BREAK"; scope: "SWING" | "INTERNAL"; tag: "BOS" | "CHOCH"; dir: Bias; ts: number; level: number }
  | { type: "EQ"; eqType: "EQH" | "EQL"; ts: number; level: number; basePivotTs: number; baseLevel: number }
  | { type: "OB_CREATE"; scope: "SWING" | "INTERNAL"; ts: number; bias: Bias; high: number; low: number; srcTs: number }
  | { type: "OB_MITIGATED"; scope: "SWING" | "INTERNAL"; ts: number; bias: Bias; high: number; low: number; srcTs: number };

export type StrategyParams = {
  barMinutes: number;        // 15 for current pipeline
  confirmWindowBars: number; // sweep->confirm window
  entryWindowBars: number;   // confirm->entry window
  rr: number;                // take profit RR
  feeBps: number;            // round trip bps (e.g., 10 = 0.10%)
  useChoChOnly: boolean;     // confirmation tag filter
  timeoutBars: number;       // max holding bars
};

export type TradeLog = {
  tradeId: string;
  side: "LONG" | "SHORT";

  biasAtSignal: 1 | -1;

  swingLevelTs: number;
  swingLevel: number;

  sweepTs: number;
  sweepExtreme: number;

  confirmTs: number;
  confirmTag: "CHOCH" | "BOS";

  obTs: number;
  obHigh: number;
  obLow: number;

  entrySignalTs: number;
  entryTs: number;
  entryPrice: number;
  stopPrice: number;
  takePrice: number;

  exitTs: number;
  exitPrice: number;
  exitReason: "SL" | "TP" | "TIMEOUT";

  grossReturn: number;
  netReturn: number;
  holdBars: number;
};


export type TradeTraceItem =
  | { kind: "BIAS"; ts: number; tag: "BOS" | "CHOCH"; dir: 1 | -1; level: number }
  | { kind: "SWING_PIVOT"; ts: number; pivotType: "HIGH" | "LOW"; level: number }
  | { kind: "SWEEP"; ts: number; swingLevel: number; extreme: number }
  | { kind: "CONFIRM"; ts: number; tag: "BOS" | "CHOCH"; dir: 1 | -1; level: number }
  | { kind: "OB"; ts: number; bias: 1 | -1; high: number; low: number; srcTs: number }
  | { kind: "ENTRY"; ts: number; entryPrice: number; stopPrice: number; takePrice: number };

export type TradeTrace = {
  tradeId: string;
  side: "LONG" | "SHORT";
  chain: TradeTraceItem[];
};
