import fs from "node:fs";
import path from "node:path";
import { loadBarsFromCsv } from "./io/loadCsv.js";
import { defaultConfig, runSmc } from "./smc/engine.js";
import { SmcConfig } from "./smc/types.js";

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

const inFile = arg("--in");
if (!inFile) {
  console.error("Usage: npm run smc -- --in <csv> --out <events.jsonl> [--timecol ts|time]");
  process.exit(1);
}

const outFile = arg("--out") ?? path.resolve(process.cwd(), "events.jsonl");
const timecol = arg("--timecol") ?? "ts";

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

const bars = loadBarsFromCsv(inFile, { timeColumn: timecol, timeMode: "iso" });
const events = runSmc(bars, cfg);

const lines = events.map(e => JSON.stringify(e)).join("\n") + "\n";
fs.writeFileSync(outFile, lines, "utf-8");

console.log(`bars=${bars.length} events=${events.length}`);
console.log(`wrote: ${outFile}`);
