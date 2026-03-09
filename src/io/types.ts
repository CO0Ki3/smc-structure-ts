export type Bar = {
  ts: number; // epoch ms UTC (candle open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TimeParseMode = "iso" | "epoch_ms" | "epoch_s";

export type LoadCsvOptions = {
  timeColumn: string;
  timeMode?: TimeParseMode;
};
