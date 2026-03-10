import fs from "node:fs";
import path from "node:path";

type Marker = { type: 'MARKER'; time: number; position: 'aboveBar'|'belowBar'; text: string; color: string; shape?: 'arrowUp'|'arrowDown'|'circle'|'square' };
type HSeg  = { type: 'HSEG'; t0: number; t1: number; price: number; text: string; color: string; style?: 'dashed'|'solid'|'dotted' };
type RangeSeg = { type: 'RANGE_SEG'; t0: number; t1: number; high: number; low: number; text: string; color: string; style?: 'dotted'|'solid' };
type ViewerEvent = Marker | HSeg | RangeSeg;

type SmcEvent =
  | { type: "SWING_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "INTERNAL_PIVOT"; pivotType: "HIGH" | "LOW"; ts: number; level: number; index: number }
  | { type: "STRUCTURE_BREAK"; scope: "SWING" | "INTERNAL"; tag: "BOS" | "CHOCH"; dir: 1 | -1 | 0; ts: number; level: number }
  | { type: "EQ"; eqType: "EQH" | "EQL"; ts: number; level: number; basePivotTs: number; baseLevel: number }
  | { type: "OB_CREATE"; scope: "SWING" | "INTERNAL"; ts: number; bias: 1 | -1 | 0; high: number; low: number; srcTs: number }
  | { type: "OB_MITIGATED"; scope: "SWING" | "INTERNAL"; ts: number; bias: 1 | -1 | 0; high: number; low: number; srcTs: number }
  | { type: "FVG_CREATE"; ts: number; bias: 1 | -1 | 0; top: number; bottom: number; srcTs: number }
  | { type: "FVG_FILLED"; ts: number; bias: 1 | -1 | 0; top: number; bottom: number; srcTs: number };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}
function parseIntArg(name: string, def: number): number {
  const v = arg(name);
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

const inEvents = arg('--events');
const inCsv = arg('--csv');
if (!inEvents || !inCsv) {
  console.error('Usage: npm run build-viewer -- --events ./events.jsonl --csv ./data.csv --out ./event_viewer.jsonl [--timecol ts|time] [--maxSwingOb 5] [--maxInternalOb 5] [--mode historical|present]');
  process.exit(1);
}
const outFile = arg('--out') ?? path.resolve(process.cwd(), 'event_viewer.jsonl');
const timecol = arg('--timecol') ?? 'ts';
const mode = (arg('--mode') ?? 'historical') as 'historical'|'present';
const maxSwingOb = parseIntArg('--maxSwingOb', 5);
const maxInternalOb = parseIntArg('--maxInternalOb', 5);

// Load CSV times to map to seconds (UTC)
const csvText = fs.readFileSync(inCsv, 'utf-8');
const lines = csvText.split(/\r?\n/).filter(Boolean);
const header = lines[0].split(',').map(s=>s.trim());
const timeIdx = header.findIndex(h => h.toLowerCase() === timecol.toLowerCase());
if (timeIdx === -1) throw new Error(`CSV missing time column ${timecol}`);

const timesSec: number[] = [];
for (let i=1;i<lines.length;i++){
  const row = lines[i].split(',');
  if (row.length <= timeIdx) continue;
  const ms = Date.parse(row[timeIdx]);
  if (!Number.isFinite(ms)) continue;
  timesSec.push(Math.floor(ms/1000));
}
timesSec.sort((a,b)=>a-b);
const lastChartTime = timesSec.length ? timesSec[timesSec.length-1] : 0;

function toSec(tsLike: any): number | null {
  if (typeof tsLike === 'number') return Math.floor(tsLike/1000);
  if (typeof tsLike === 'string') {
    const ms = Date.parse(tsLike);
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms/1000);
  }
  return null;
}
function nearestExisting(t: number): number {
  if (timesSec.length === 0) return t;
  if (t <= timesSec[0]) return timesSec[0];
  if (t >= timesSec[timesSec.length-1]) return timesSec[timesSec.length-1];
  let lo=0, hi=timesSec.length-1;
  while (lo<=hi){
    const mid=(lo+hi)>>1;
    if (timesSec[mid] <= t) lo=mid+1;
    else hi=mid-1;
  }
  return timesSec[Math.max(0,hi)];
}

function colorFor(obj: any): string {
  if (obj.type === 'STRUCTURE_BREAK') return obj.tag === 'CHOCH' ? '#f59e0b' : '#3b82f6';
  if (obj.type === 'EQ') return '#8b5cf6';
  if (obj.type === 'OB_CREATE') return obj.bias === 1 ? '#10b981' : '#ef4444';
  if (obj.type === 'OB_MITIGATED') return '#6b7280';
  if (obj.type === 'FVG_CREATE') return obj.bias === 1 ? '#22c55e' : '#f43f5e';
  if (obj.type === 'FVG_FILLED') return '#94a3b8';
  return '#111827';
}

const rawLines = fs.readFileSync(inEvents,'utf-8').split(/\r?\n/).filter(Boolean);
const smc: SmcEvent[] = [];
for (const l of rawLines){
  try { smc.push(JSON.parse(l)); } catch {}
}
smc.sort((a,b)=> (a.ts as any) - (b.ts as any));

// Track latest pivots per scope and type
type PivotKey = 'SWING_HIGH'|'SWING_LOW'|'INT_HIGH'|'INT_LOW';
const lastPivot: Record<PivotKey, { ts:number; level:number } | null> = {
  SWING_HIGH: null, SWING_LOW: null, INT_HIGH: null, INT_LOW: null,
};

// Track OB lifetimes by srcTs
type ObRec = { scope:'SWING'|'INTERNAL'; bias:1|-1; high:number; low:number; createTs:number; endTs:number|null; srcTs:number };
const obBySrc = new Map<number, ObRec>();

// We'll also store structure segments and eq segments
const out: ViewerEvent[] = [];

// First pass: build lifetimes (OB end) and track pivots for structure segment start
for (const e of smc) {
  if (e.type === 'SWING_PIVOT') {
    const t = nearestExisting(toSec(e.ts)!);
    if (e.pivotType === 'HIGH') lastPivot.SWING_HIGH = { ts: t, level: e.level };
    else lastPivot.SWING_LOW = { ts: t, level: e.level };
  }
  if (e.type === 'INTERNAL_PIVOT') {
    const t = nearestExisting(toSec(e.ts)!);
    if (e.pivotType === 'HIGH') lastPivot.INT_HIGH = { ts: t, level: e.level };
    else lastPivot.INT_LOW = { ts: t, level: e.level };
  }
  if (e.type === 'OB_CREATE' && (e.bias === 1 || e.bias === -1)) {
    const t = nearestExisting(toSec(e.ts)!);
    obBySrc.set(e.srcTs, {
      scope: e.scope,
      bias: e.bias,
      high: e.high,
      low: e.low,
      createTs: t,
      endTs: null,
      srcTs: e.srcTs,
    });
  }
  if (e.type === 'OB_MITIGATED') {
    const rec = obBySrc.get(e.srcTs);
    if (rec && rec.endTs === null) {
      rec.endTs = nearestExisting(toSec(e.ts)!);
    }
  }
}

// Second pass: emit viewer primitives (segments)
for (const e of smc) {
  const t = nearestExisting(toSec(e.ts)!);
  const color = colorFor(e);

  if (e.type === 'STRUCTURE_BREAK') {
    const scope = e.scope;
    const dir = e.dir === 1 ? 1 : e.dir === -1 ? -1 : 0;
    if (dir === 0) continue;

    // Determine which pivot level was broken (bull break uses HIGH pivot; bear break uses LOW pivot)
    const pivot = scope === 'SWING'
      ? (dir === 1 ? lastPivot.SWING_HIGH : lastPivot.SWING_LOW)
      : (dir === 1 ? lastPivot.INT_HIGH : lastPivot.INT_LOW);

    if (!pivot) continue;

    const position = dir === 1 ? 'belowBar' : 'aboveBar';
    const shape = dir === 1 ? 'arrowUp' : 'arrowDown';
    out.push({ type:'MARKER', time:t, position, shape, color, text:`${scope}:${e.tag}` });

    // Pine-like: draw segment from pivot time to break time at pivot level
    out.push({ type:'HSEG', t0:pivot.ts, t1:t, price:pivot.level, color, style: scope==='INTERNAL' ? 'dashed' : 'solid', text:`${scope}:${e.tag}` });
    continue;
  }

  if (e.type === 'EQ') {
    const t0 = nearestExisting(toSec(e.basePivotTs)!);
    out.push({ type:'MARKER', time:t, position: e.eqType==='EQH' ? 'aboveBar' : 'belowBar', shape:'circle', color, text: e.eqType });
    out.push({ type:'HSEG', t0, t1:t, price:e.level, color, style:'dotted', text: e.eqType });
    continue;
  }
}

// Emit OB segments with lifetimes, limiting to max display (Pine draws only latest N)
const swingObs: ObRec[] = [];
const intObs: ObRec[] = [];
for (const ob of obBySrc.values()) {
  if (ob.scope === 'SWING') swingObs.push(ob);
  else intObs.push(ob);
}
swingObs.sort((a,b)=>b.createTs-a.createTs);
intObs.sort((a,b)=>b.createTs-a.createTs);

const swingTop = swingObs.slice(0, Math.max(0, maxSwingOb));
const intTop = intObs.slice(0, Math.max(0, maxInternalOb));

for (const ob of [...swingTop, ...intTop]) {
  const t0 = ob.createTs;
  const t1 = ob.endTs ?? lastChartTime;
  const color = ob.bias === 1 ? '#10b981' : '#ef4444';
  out.push({ type:'MARKER', time:t0, position: ob.bias===1 ? 'belowBar' : 'aboveBar', shape:'square', color, text:`${ob.scope}:OB` });
  out.push({ type:'RANGE_SEG', t0, t1, high:ob.high, low:ob.low, color, style:'dotted', text:`${ob.scope}:OB` });
}


// Emit FVG segments with lifetimes
type FvgRec = { bias: 1|-1; top: number; bottom: number; createTs: number; fillTs: number | null; srcTs: number };
const fvgBySrc = new Map<number, FvgRec>();
for (const e of smc) {
  if (e.type === 'FVG_CREATE' && (e.bias === 1 || e.bias === -1)) {
    fvgBySrc.set(e.srcTs, {
      bias: e.bias,
      top: e.top,
      bottom: e.bottom,
      createTs: nearestExisting(toSec(e.ts)!),
      fillTs: null,
      srcTs: e.srcTs,
    });
  }
  if (e.type === 'FVG_FILLED') {
    const rec = fvgBySrc.get(e.srcTs);
    if (rec && rec.fillTs === null) rec.fillTs = nearestExisting(toSec(e.ts)!);
  }
}
for (const g of fvgBySrc.values()) {
  const t0 = g.createTs;
  const t1 = g.fillTs ?? lastChartTime;
  const color = g.bias === 1 ? '#22c55e' : '#f43f5e';
  out.push({ type:'MARKER', time:t0, position: g.bias===1 ? 'belowBar' : 'aboveBar', shape:'circle', color, text:`FVG` });
  out.push({ type:'RANGE_SEG', t0, t1, high:g.top, low:g.bottom, color, style:'solid', text:`FVG` });
}

// PRESENT mode: keep only the most recent instances per category (basic)
if (mode === 'present') {
  // Keep last 1 structure marker per scope and last 1 EQ marker per type; OB keep top N already.
  const kept: ViewerEvent[] = [];
  const lastStruct: Record<string, ViewerEvent | null> = { SWING:null, INTERNAL:null };
  const lastEq: Record<string, ViewerEvent | null> = { EQH:null, EQL:null };
  for (const e of out) {
    if (e.type==='MARKER' && typeof (e as any).text === 'string' && (e as any).text.includes(':')) {
      const scope = String((e as any).text).split(':')[0];
      if (scope === 'SWING' || scope === 'INTERNAL') lastStruct[scope] = e;
    } else if (e.type==='MARKER' && ((e as any).text === 'EQH' || (e as any).text === 'EQL')) {
      lastEq[(e as any).text] = e;
    }
  }
  // Include corresponding segments by matching text (rough but workable)
  const keepTexts = new Set<string>();
  for (const k of Object.values(lastStruct)) if (k) keepTexts.add((k as any).text);
  for (const k of Object.values(lastEq)) if (k) keepTexts.add((k as any).text);

  for (const e of out) {
    if (e.type==='RANGE_SEG') { kept.push(e); continue; }
    if (e.type==='MARKER') {
      if ((e as any).text && (keepTexts.has((e as any).text) || String((e as any).text).includes(':OB'))) kept.push(e);
      continue;
    }
    if (e.type==='HSEG') {
      if (keepTexts.has(e.text)) kept.push(e);
      continue;
    }
  }
  fs.writeFileSync(outFile, kept.map(x=>JSON.stringify(x)).join('\n')+'\n','utf-8');
  console.log(`viewerEvents=${kept.length} wrote=${outFile}`);
} else {
  fs.writeFileSync(outFile, out.map(x=>JSON.stringify(x)).join('\n')+'\n','utf-8');
  console.log(`viewerEvents=${out.length} wrote=${outFile}`);
}
