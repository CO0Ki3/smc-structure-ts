import fs from "node:fs";
import path from "node:path";
import { loadBarsFromCsv } from "../io/loadCsv.js";
import { Bar } from "../io/types.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

const inFile = arg("--in");
if (!inFile) {
  console.error("Usage: npm run resample -- --in <15m.csv> --out <dir> [--timecol ts|time]");
  process.exit(1);
}
const outDir = arg("--out") ?? path.resolve(process.cwd(), "out");
const timecol = arg("--timecol") ?? "ts";
fs.mkdirSync(outDir, { recursive: true });

const bars = loadBarsFromCsv(inFile, { timeColumn: timecol, timeMode: "iso" });

type TF = { name: string; minutes: number };
const tfs: TF[] = [
  { name: "30m", minutes: 30 },
  { name: "1h", minutes: 60 },
  { name: "4h", minutes: 240 },
];

function floorTo(tfMin: number, ts: number): number {
  const ms = tfMin * 60_000;
  return Math.floor(ts / ms) * ms;
}

function resample(tfMin: number, bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let bucketTs: number | null = null;
  let cur: Bar | null = null;

  for (const b of bars) {
    const bt = floorTo(tfMin, b.ts);
    if (bucketTs === null || bt !== bucketTs) {
      if (cur) out.push(cur);
      bucketTs = bt;
      cur = { ts: bt, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur!.high = Math.max(cur!.high, b.high);
      cur!.low = Math.min(cur!.low, b.low);
      cur!.close = b.close;
      cur!.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function toCsv(bars: Bar[]): string {
  const header = "ts,open,high,low,close,volume\n";
  const rows = bars.map(b => `${new Date(b.ts).toISOString()},${b.open},${b.high},${b.low},${b.close},${b.volume}`).join("\n");
  return header + rows + "\n";
}

for (const tf of tfs) {
  const r = resample(tf.minutes, bars);
  const outPath = path.join(outDir, `derived_${tf.name}.csv`);
  fs.writeFileSync(outPath, toCsv(r), "utf-8");
  console.log(`wrote ${outPath} rows=${r.length}`);
}
