import fs from "node:fs";
import path from "node:path";
import { loadBarsFromCsv } from "../io/loadCsv.js";
import { defaultConfig, runSmc } from "../smc/engine.js";
import { SmcConfig } from "../smc/types.js";

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
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

function parseFloatArg(name: string, def: number): number {
  const v = arg(name);
  if (!v) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return n;
}

function buildConfig(): SmcConfig {
  const cfg: SmcConfig = defaultConfig();
  cfg.swingLen = parseIntArg("--swingLen", cfg.swingLen);
  cfg.internalLen = parseIntArg("--internalLen", cfg.internalLen);
  cfg.eqLen = parseIntArg("--eqLen", cfg.eqLen);
  cfg.eqThr = parseFloatArg("--eqThr", cfg.eqThr);
  cfg.ob = !has("--no-ob");
  cfg.obMitigation = (arg("--obMitigation") as any) ?? cfg.obMitigation;
  cfg.obMax = parseIntArg("--obMax", cfg.obMax);
  cfg.fvg.enabled = !has("--no-fvg");
  cfg.fvg.autoThreshold = !has("--no-fvg-auto-threshold");
  cfg.fvg.extendBars = parseIntArg("--fvgExtendBars", cfg.fvg.extendBars);
  cfg.volatilityFilter.enabled = !has("--no-vol-filter");
  cfg.volatilityFilter.mult = parseFloatArg("--volMult", cfg.volatilityFilter.mult);
  return cfg;
}

function findDatasetDirs(rootDir: string): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => path.join(rootDir, e.name)).sort();
}

const datasetRoot = arg("--datasetRoot");
if (!datasetRoot) {
  console.error("Usage: npm run smc-batch -- --datasetRoot ./dataset [--bars bars.csv] [--out events.jsonl] [--timecol ts|time] [--no-fvg]");
  process.exit(1);
}

const barsName = arg("--bars") ?? "bars.csv";
const outName = arg("--out") ?? "events.jsonl";
const timecol = arg("--timecol") ?? "ts";
const overwrite = has("--overwrite");
const cfg = buildConfig();

const dirs = findDatasetDirs(datasetRoot);
if (dirs.length === 0) {
  console.error(`No subdirectories found in ${datasetRoot}`);
  process.exit(1);
}

let processed = 0;
let skipped = 0;
let totalEvents = 0;

for (const dir of dirs) {
  const datasetId = path.basename(dir);
  const barsPath = path.join(dir, barsName);
  const outPath = path.join(dir, outName);

  if (!fs.existsSync(barsPath)) {
    console.warn(`skip ${datasetId}: missing ${barsName}`);
    skipped += 1;
    continue;
  }

  if (fs.existsSync(outPath) && !overwrite) {
    console.warn(`skip ${datasetId}: ${outName} already exists (use --overwrite)`);
    skipped += 1;
    continue;
  }

  const bars = loadBarsFromCsv(barsPath, { timeColumn: timecol, timeMode: "iso" });
  const events = runSmc(bars, cfg);

  const lines = events.map(e => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(outPath, lines, "utf-8");

  processed += 1;
  totalEvents += events.length;
  console.log(`dataset=${datasetId} bars=${bars.length} events=${events.length} wrote=${outPath}`);
}

console.log(`processed=${processed} skipped=${skipped} total_events=${totalEvents}`);
