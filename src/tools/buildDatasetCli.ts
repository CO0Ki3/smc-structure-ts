import fs from "node:fs";
import path from "node:path";
import { loadBarsFromCsv } from "../io/loadCsv.js";
import type { Bar } from "../io/types.js";
import type { DatasetRow } from "../dataset/types.js";
import { buildStateDataset, precomputeGlobalHtfContext } from "../dataset/buildStateDataset.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(filePath: string, rows: DatasetRow[]) {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "", "utf-8");
    return;
  }
  const cols = Object.keys(rows[0]) as (keyof DatasetRow)[];
  const header = cols.join(",") + "\n";
  const body = rows.map(r => cols.map(c => csvEscape(r[c])).join(",")).join("\n") + "\n";
  fs.writeFileSync(filePath, header + body, "utf-8");
}

function writeJsonl(filePath: string, rows: DatasetRow[]) {
  const fd = fs.openSync(filePath, "w");
  for (const r of rows) {
    fs.writeSync(fd, JSON.stringify(r) + "\n");
  }
  fs.closeSync(fd);
}

function readEventsJsonl(filePath: string): any[] {
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean);
  const out: any[] = [];
  for (const l of lines) {
    try { out.push(JSON.parse(l)); } catch {}
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function findDatasetDirs(rootDir: string): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => path.join(rootDir, e.name)).sort();
}

function datasetIdFromDir(dir: string): string {
  return path.basename(dir);
}

const datasetRoot = arg("--datasetRoot");
if (!datasetRoot) {
  console.error("Usage: npm run build-dataset -- --datasetRoot ./dataset --out ./dataset_out [--bars bars.csv] [--events events.jsonl] [--timecol ts|time]");
  process.exit(1);
}

const outDir = arg("--out") ?? path.resolve(process.cwd(), "dataset_out");
const barsName = arg("--bars") ?? "bars.csv";
const eventsName = arg("--events") ?? "events.jsonl";
const timecol = arg("--timecol") ?? "ts";

// Phase 1 / Stage C-1: optional HTF feature attach + warmup prefix
// skip. Defaults preserve the pre-C-1 behaviour (no skip, HTF
// columns still attach with full-row context) so existing callers
// keep working. Set --no-htf to drop the HTF columns entirely
// (smaller schema for ablation runs).
const outputStartBar = (() => {
  const v = arg("--outputStartBar");
  if (!v) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`--outputStartBar must be a non-negative integer (got "${v}")`);
    process.exit(1);
  }
  return n;
})();
const noHtf = process.argv.includes("--no-htf");
const globalHtfFlag = process.argv.includes("--globalHtf");
// Phase J (4H SMC): allow overriding the HTF aggregation minutes from
// the CLI. Defaults stay at 4H (240) and 1D (1440) for the 15m phase.
// For 4H input streams, the natural override is 1D (1440) and 1W
// (10080) so the policy sees one-step-up + two-steps-up context.
const htf4hMinutesArg = arg("--htf4hMinutes");
const htf1dMinutesArg = arg("--htf1dMinutes");
const htf4hMinutes = htf4hMinutesArg ? Number(htf4hMinutesArg) : 240;
const htf1dMinutes = htf1dMinutesArg ? Number(htf1dMinutesArg) : 1440;
if (!Number.isFinite(htf4hMinutes) || htf4hMinutes <= 0) {
  console.error(`--htf4hMinutes must be a positive number (got "${htf4hMinutesArg}")`);
  process.exit(1);
}
if (!Number.isFinite(htf1dMinutes) || htf1dMinutes <= 0) {
  console.error(`--htf1dMinutes must be a positive number (got "${htf1dMinutesArg}")`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const dirs = findDatasetDirs(datasetRoot);
if (dirs.length === 0) {
  console.error(`No subdirectories found in ${datasetRoot}`);
  process.exit(1);
}

const allRows: DatasetRow[] = [];
const summary: Array<{ dataset_id: string; rows: number; start_ts: number; end_ts: number }> = [];

// Phase 1 / Option 5: when --globalHtf is set, gather every slice's
// bars into a single timestamp-sorted stream and run trackHtfState
// once. This is what production trading does — 1D pivot is a
// function of all prior history, not "the most recent 28 days".
// Without it, 1D pivots never stabilise inside a single 28-day
// slice (swing detection needs ~50 days lookback).
type LoadedSlice = { dir: string; datasetId: string; bars: Bar[]; events: any[] };
const loaded: LoadedSlice[] = [];
for (const dir of dirs) {
  const datasetId = datasetIdFromDir(dir);
  const barsPath = path.join(dir, barsName);
  const eventsPath = path.join(dir, eventsName);
  if (!fs.existsSync(barsPath) || !fs.existsSync(eventsPath)) {
    console.warn(`skip ${datasetId}: missing ${barsName} or ${eventsName}`);
    continue;
  }
  const bars = loadBarsFromCsv(barsPath, { timeColumn: timecol, timeMode: "iso" }) as Bar[];
  const events = readEventsJsonl(eventsPath);
  loaded.push({ dir, datasetId, bars, events });
}

let globalCtx: ReturnType<typeof precomputeGlobalHtfContext> | undefined;
if (globalHtfFlag && !noHtf) {
  // Merge + dedupe by ts (overlapping slices share bars by design).
  const tsSeen = new Set<number>();
  const stream: Bar[] = [];
  for (const s of loaded) {
    for (const b of s.bars) {
      if (tsSeen.has(b.ts)) continue;
      tsSeen.add(b.ts);
      stream.push(b);
    }
  }
  stream.sort((a, b) => a.ts - b.ts);
  console.log(`[globalHtf] merged ${stream.length} unique LTF bars across ${loaded.length} slices`);
  globalCtx = precomputeGlobalHtfContext(stream, htf4hMinutes, htf1dMinutes);
  console.log(`[globalHtf] HTF1 (${htf4hMinutes}min) snapshots=${globalCtx.snapshots4h.length}, HTF2 (${htf1dMinutes}min) snapshots=${globalCtx.snapshots1d.length}`);
}

for (const { datasetId, bars, events } of loaded) {
  const rows = buildStateDataset(datasetId, bars, events, {
    htf4hMinutes,
    htf1dMinutes,
    outputStartBar,
    attachHtf: !noHtf,
    globalHtf: globalCtx,
  });
  if (rows.length === 0) {
    console.warn(`skip ${datasetId}: no rows`);
    continue;
  }
  const perDir = path.join(outDir, datasetId);
  fs.mkdirSync(perDir, { recursive: true });
  writeCsv(path.join(perDir, "state_dataset.csv"), rows);
  writeJsonl(path.join(perDir, "state_dataset.jsonl"), rows);
  allRows.push(...rows);
  summary.push({
    dataset_id: datasetId,
    rows: rows.length,
    start_ts: rows[0].ts,
    end_ts: rows[rows.length - 1].ts,
  });
  console.log(`dataset=${datasetId} rows=${rows.length} wrote=${perDir}`);
}

if (allRows.length === 0) {
  console.error("No datasets processed");
  process.exit(1);
}

writeCsv(path.join(outDir, "state_dataset_all.csv"), allRows);
writeJsonl(path.join(outDir, "state_dataset_all.jsonl"), allRows);
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");

console.log(`all_rows=${allRows.length}`);
console.log(`wrote merged files in ${outDir}`);
