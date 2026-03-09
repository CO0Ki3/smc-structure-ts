import fs from "node:fs";
import path from "node:path";
import { loadBarsFromCsv } from "../io/loadCsv.js";
import type { Bar } from "../io/types.js";
import type { SmcEvent } from "../strategy/types.js";
import type { DatasetRow } from "../dataset/types.js";
import { buildStateDataset } from "../dataset/buildStateDataset.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function has(name: string): boolean {
  return process.argv.includes(name);
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
  fs.writeFileSync(filePath, rows.map(r => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf-8");
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

fs.mkdirSync(outDir, { recursive: true });

const dirs = findDatasetDirs(datasetRoot);
if (dirs.length === 0) {
  console.error(`No subdirectories found in ${datasetRoot}`);
  process.exit(1);
}

const allRows: DatasetRow[] = [];
const summary: Array<{ dataset_id: string; rows: number; start_ts: number; end_ts: number }> = [];

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

  const rows = buildStateDataset(datasetId, bars, events);
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
