import fs from "node:fs";
import path from "node:path";

type Marker = { type: 'MARKER'; time: number; position: 'aboveBar'|'belowBar'; text: string; color: string; shape?: 'arrowUp'|'arrowDown'|'circle'|'square' };
type HLine  = { type: 'HLINE'; time: number; price: number; text: string; color: string; style?: 'dashed'|'solid'|'dotted' };
type RangeHint = { type: 'RANGE_HINT'; time: number; high: number; low: number; text: string; color: string };
type ViewerEvent = Marker | HLine | RangeHint;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

const inEvents = arg('--events');
const inCsv = arg('--csv');
if (!inEvents || !inCsv) {
  console.error('Usage: npm run build-viewer -- --events ./events.jsonl --csv ./data.csv --out ./event_viewer.jsonl [--timecol ts|time]');
  process.exit(1);
}
const outFile = arg('--out') ?? path.resolve(process.cwd(), 'event_viewer.jsonl');
const timecol = arg('--timecol') ?? 'ts';

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
  return '#111827';
}

const evLines = fs.readFileSync(inEvents,'utf-8').split(/\r?\n/).filter(Boolean);
const out: ViewerEvent[] = [];

for (const line of evLines){
  let obj:any;
  try{ obj=JSON.parse(line);}catch{continue;}
  const t0 = toSec(obj.ts);
  if (t0===null) continue;
  const t = nearestExisting(t0);
  const color = colorFor(obj);

  if (obj.type === 'STRUCTURE_BREAK') {
    const position = obj.dir === 1 ? 'belowBar' : 'aboveBar';
    const shape = obj.dir === 1 ? 'arrowUp' : 'arrowDown';
    out.push({ type:'MARKER', time:t, position, shape, color, text:`${obj.scope}:${obj.tag}` });
    out.push({ type:'HLINE', time:t, price:Number(obj.level), color, style:'dashed', text:`${obj.scope}:${obj.tag}` });
    continue;
  }

  if (obj.type === 'EQ') {
    out.push({ type:'MARKER', time:t, position: obj.eqType==='EQH' ? 'aboveBar':'belowBar', shape:'circle', color, text: obj.eqType });
    out.push({ type:'HLINE', time:t, price:Number(obj.level), color, style:'dotted', text: obj.eqType });
    continue;
  }

  if (obj.type === 'OB_CREATE') {
    out.push({ type:'MARKER', time:t, position: obj.bias===1 ? 'belowBar':'aboveBar', shape:'square', color, text:`${obj.scope}:OB` });
    out.push({ type:'RANGE_HINT', time:t, high:Number(obj.high), low:Number(obj.low), color, text:`${obj.scope}:OB` });
    continue;
  }

  if (obj.type === 'OB_MITIGATED') {
    out.push({ type:'MARKER', time:t, position: obj.bias===1 ? 'aboveBar':'belowBar', shape:'circle', color, text:`${obj.scope}:OB_X` });
    continue;
  }
}

fs.writeFileSync(outFile, out.map(x=>JSON.stringify(x)).join('\n')+'\n','utf-8');
console.log(`viewerEvents=${out.length} wrote=${outFile}`);
