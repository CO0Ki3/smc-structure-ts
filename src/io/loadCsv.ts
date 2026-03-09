import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { Bar, LoadCsvOptions } from "./types.js";

function parseTs(v: string, mode: LoadCsvOptions["timeMode"]): number {
  const m = mode ?? "iso";
  if (m === "iso") {
    const ms = Date.parse(v);
    if (!Number.isFinite(ms)) throw new Error(`Bad ISO timestamp: ${v}`);
    return ms;
  }
  if (m === "epoch_s") {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`Bad epoch_s: ${v}`);
    return Math.round(n * 1000);
  }
  // epoch_ms
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Bad epoch_ms: ${v}`);
  return Math.round(n);
}

export function loadBarsFromCsv(filePath: string, opts: LoadCsvOptions): Bar[] {
  const text = fs.readFileSync(filePath, "utf-8");
  const records = parse(text, { columns: true, skip_empty_lines: true });
  const out: Bar[] = records.map((r: any) => {
    const ts = parseTs(String(r[opts.timeColumn]), opts.timeMode);
    return {
      ts,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume ?? r.Volume ?? r.vol ?? 0),
    };
  });
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
