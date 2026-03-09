import fs from "node:fs";
import path from "node:path";
import { loadBarsFromCsv } from "../io/loadCsv.js";
import type { SmcEvent, StrategyParams, TradeLog, TradeTrace } from "../strategy/types.js";
import { runStrategy } from "../strategy/runStrategy.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}
function has(name: string): boolean {
  return process.argv.includes(name);
}
function parseIntArg(name: string, def: number): number {
  const v = arg(name);
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}
function parseFloatArg(name: string, def: number): number {
  const v = arg(name);
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function readEventsJsonl(filePath: string): SmcEvent[] {
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean);
  const out: SmcEvent[] = [];
  for (const l of lines) {
    try { out.push(JSON.parse(l)); } catch {}
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeTradesCsv(filePath: string, trades: TradeLog[]) {
  const cols: (keyof TradeLog)[] = [
    "tradeId","side","biasAtSignal",
    "swingLevelTs","swingLevel","sweepTs","sweepExtreme",
    "confirmTs","confirmTag","obTs","obHigh","obLow",
    "entrySignalTs","entryTs","entryPrice","stopPrice","takePrice",
    "exitTs","exitPrice","exitReason","grossReturn","netReturn","holdBars",
  ];
  const header = cols.join(",") + "\n";
  const rows = trades.map(t => cols.map(c => csvEscape((t as any)[c])).join(",")).join("\n");
  fs.writeFileSync(filePath, header + rows + (rows ? "\n" : ""), "utf-8");
}

function writeTraceJsonl(filePath: string, traces: TradeTrace[]) {
  const jsonl = traces.map(t => JSON.stringify(t)).join("\n") + (traces.length ? "\n" : "");
  fs.writeFileSync(filePath, jsonl, "utf-8");
}

const csvPath = arg("--csv");
const eventsPath = arg("--events");
if (!csvPath || !eventsPath) {
  console.error("Usage: npm run strategy -- --csv ./data.csv --events ./events.jsonl --out ./trades.csv --outTrace ./trade_events.jsonl --timecol time");
  process.exit(1);
}

const outTrades = arg("--out") ?? path.resolve(process.cwd(), "trades.csv");
const outJson = arg("--outJson") ?? path.resolve(process.cwd(), "trades.json");
const outTrace = arg("--outTrace") ?? path.resolve(process.cwd(), "trade_events.jsonl");
const timecol = arg("--timecol") ?? "ts";

const params: StrategyParams = {
  barMinutes: parseIntArg("--barMinutes", 15),
  confirmWindowBars: parseIntArg("--confirmWindowBars", 12),
  entryWindowBars: parseIntArg("--entryWindowBars", 24),
  rr: parseFloatArg("--rr", 2.0),
  feeBps: parseFloatArg("--feeBps", 10),
  useChoChOnly: !has("--allow-bos"),
  timeoutBars: parseIntArg("--timeoutBars", 96 * 3),
};

const bars = loadBarsFromCsv(csvPath, { timeColumn: timecol, timeMode: "iso" });
const events = readEventsJsonl(eventsPath);

const { trades, traces } = runStrategy(bars, events, params);

writeTradesCsv(outTrades, trades);
fs.writeFileSync(outJson, JSON.stringify({ params, trades }, null, 2), "utf-8");
writeTraceJsonl(outTrace, traces);

console.log(`bars=${bars.length} events=${events.length} trades=${trades.length} traces=${traces.length}`);
console.log(`wrote: ${outTrades}`);
console.log(`wrote: ${outJson}`);
console.log(`wrote: ${outTrace}`);
