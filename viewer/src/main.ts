import { createChart, CrosshairMode, LineStyle, type UTCTimestamp, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';

type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number; volume?: number };

type ViewerEvent =
  | { type: 'MARKER'; time: UTCTimestamp; position: 'aboveBar'|'belowBar'; text: string; color: string; shape?: 'arrowUp'|'arrowDown'|'circle'|'square' }
  | { type: 'HSEG'; t0: UTCTimestamp; t1: UTCTimestamp; price: number; text: string; color: string; style?: 'dashed'|'solid'|'dotted' }
  | { type: 'RANGE_SEG'; t0: UTCTimestamp; t1: UTCTimestamp; high: number; low: number; text: string; color: string; style?: 'dotted'|'solid' };

type TradeTraceItem =
  | { kind: 'BIAS'; ts: number; tag: 'BOS'|'CHOCH'; dir: 1|-1; level: number }
  | { kind: 'SWING_PIVOT'; ts: number; pivotType: 'HIGH'|'LOW'; level: number }
  | { kind: 'SWEEP'; ts: number; swingLevel: number; extreme: number }
  | { kind: 'CONFIRM'; ts: number; tag: 'BOS'|'CHOCH'; dir: 1|-1; level: number }
  | { kind: 'OB'; ts: number; bias: 1|-1; high: number; low: number; srcTs: number }
  | { kind: 'ENTRY'; ts: number; entryPrice: number; stopPrice: number; takePrice: number };

type TradeTrace = { tradeId: string; side: 'LONG'|'SHORT'; chain: TradeTraceItem[] };

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}
const statusEl = $('status');
const chartEl = $('chart') as HTMLDivElement;

function setStatus(msg: string){ statusEl.textContent = msg; }

const chart = createChart(chartEl, {
  layout: { background: { color: '#ffffff' }, textColor: '#111827' },
  grid: { vertLines: { color: '#f3f4f6' }, horzLines: { color: '#f3f4f6' } },
  crosshair: { mode: CrosshairMode.Normal },
  timeScale: { rightOffset: 6, timeVisible: true, secondsVisible: false },
});
chart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });

const candlesSeries = chart.addSeries(CandlestickSeries, {});
const markersApi = createSeriesMarkers(candlesSeries);
const volSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' });

// segment series (finite lines)
let segSeries: any[] = [];
function clearSegments(){ for (const s of segSeries){ try{ chart.removeSeries(s);}catch{} } segSeries = []; }

volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

let candles: Candle[] = [];
let events: ViewerEvent[] = [];
let tradeEvents: ViewerEvent[] = [];
let rlTradeEvents: ViewerEvent[] = [];

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function parseCsv(text: string): Candle[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV empty');
  const header = lines[0].split(',').map(s => s.trim());
  const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const ti = idx('ts') !== -1 ? idx('ts') : idx('time');
  if (ti === -1) throw new Error('CSV needs ts or time column');
  const oi = idx('open'), hi = idx('high'), li = idx('low'), ci = idx('close');
  const vi = idx('volume') !== -1 ? idx('volume') : idx('Volume');
  if ([oi,hi,li,ci].some(x => x === -1)) throw new Error('CSV needs open/high/low/close');

  const out: Candle[] = [];
  for (let i=1;i<lines.length;i++){
    const row = lines[i].split(',');
    if (row.length <= ci) continue;
    const ms = Date.parse(row[ti]);
    if (!Number.isFinite(ms)) continue;
    const time = Math.floor(ms/1000) as UTCTimestamp;
    const open = Number(row[oi]), high = Number(row[hi]), low = Number(row[li]), close = Number(row[ci]);
    const volume = vi !== -1 ? Number(row[vi]) : undefined;
    if (![open,high,low,close].every(Number.isFinite)) continue;
    out.push({ time, open, high, low, close, volume });
  }
  out.sort((a,b)=>a.time-b.time);
  return out;
}

function parseJsonl(text: string): ViewerEvent[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const out: ViewerEvent[] = [];
  for (const l of lines) {
    try { out.push(JSON.parse(l)); } catch {}
  }
  return out;
}

function parseTradeEventsJsonl(text: string): ViewerEvent[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const out: ViewerEvent[] = [];
  for (const l of lines) {
    let trace: TradeTrace | null = null;
    try { trace = JSON.parse(l); } catch { trace = null; }
    if (!trace) continue;

    for (const item of trace.chain) {
      const time = Math.floor(item.ts / 1000) as UTCTimestamp;
      const baseColor = trace.side === 'LONG' ? '#16a34a' : '#dc2626';
      if (item.kind === 'SWEEP') {
        out.push({ type:'MARKER', time, position: trace.side==='LONG' ? 'belowBar':'aboveBar', shape:'circle', color: baseColor, text: `${trace.tradeId}:SWEEP` });
        out.push({ type:'HSEG', t0: time, t1: time, price: item.swingLevel, color: baseColor, style:'dotted', text: `${trace.tradeId}:swingLvl` });
        continue;
      }
      if (item.kind === 'CONFIRM') {
        out.push({ type:'MARKER', time, position: trace.side==='LONG' ? 'belowBar':'aboveBar', shape:'arrowUp', color: baseColor, text: `${trace.tradeId}:CONF` });
        out.push({ type:'HSEG', t0: time, t1: time, price: item.level, color: baseColor, style:'dashed', text: `${trace.tradeId}:${item.tag}` });
        continue;
      }
      if (item.kind === 'OB') {
        out.push({ type:'RANGE_SEG', t0: time, t1: time, high: item.high, low: item.low, color: baseColor, text: `${trace.tradeId}:OB` });
        continue;
      }
      if (item.kind === 'ENTRY') {
        out.push({ type:'MARKER', time, position: trace.side==='LONG' ? 'belowBar':'aboveBar', shape:'square', color: baseColor, text: `${trace.tradeId}:ENTRY` });
        out.push({ type:'HSEG', t0: time, t1: time, price: item.entryPrice, color: baseColor, style:'solid', text: `${trace.tradeId}:entry` });
        out.push({ type:'HSEG', t0: time, t1: time, price: item.stopPrice, color: '#6b7280', style:'dashed', text: `${trace.tradeId}:stop` });
        out.push({ type:'HSEG', t0: time, t1: time, price: item.takePrice, color: '#6b7280', style:'dashed', text: `${trace.tradeId}:take` });
        continue;
      }
      if (item.kind === 'BIAS') {
        out.push({ type:'HSEG', t0: time, t1: time, price: item.level, color: '#94a3b8', style:'dotted', text: `${trace.tradeId}:bias` });
        continue;
      }
    }
  }
  return out;
}

function parseRlTradesCsv(text: string): ViewerEvent[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(s => s.trim());
  const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const sideI = idx('side');
  const entryTsI = idx('entry_ts');
  const entryPriceI = idx('entry_price');
  const exitTsI = idx('exit_ts');
  const exitPriceI = idx('exit_price');
  const grossReturnI = idx('gross_return');
  const exitReasonI = idx('exit_reason');

  const out: ViewerEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    if (row.length < header.length) continue;

    const side = row[sideI] ?? '';
    const entryTsMs = Number(row[entryTsI]);
    const entryPrice = Number(row[entryPriceI]);
    const exitTsMs = Number(row[exitTsI]);
    const exitPrice = Number(row[exitPriceI]);
    const grossReturn = grossReturnI !== -1 ? Number(row[grossReturnI]) : NaN;
    const exitReason = exitReasonI !== -1 ? row[exitReasonI] : '';

    if (!Number.isFinite(entryTsMs) || !Number.isFinite(entryPrice)) continue;

    const entryTime = Math.floor(entryTsMs / 1000) as UTCTimestamp;
    const entryColor = side === 'LONG' ? '#16a34a' : '#dc2626';
    out.push({
      type: 'MARKER',
      time: entryTime,
      position: side === 'LONG' ? 'belowBar' : 'aboveBar',
      shape: side === 'LONG' ? 'arrowUp' : 'arrowDown',
      color: entryColor,
      text: `${side} IN`,
    });
    // out.push({
    //   type: 'HSEG',
    //   t0: entryTime,
    //   t1: entryTime,
    //   price: entryPrice,
    //   color: entryColor,
    //   style: 'solid',
    //   text: `${side} entry`,
    // });

    if (Number.isFinite(exitTsMs) && Number.isFinite(exitPrice)) {
      const exitTime = Math.floor(exitTsMs / 1000) as UTCTimestamp;
      const exitColor = Number.isFinite(grossReturn) && grossReturn >= 0 ? '#2563eb' : '#6b7280';
      out.push({
        type: 'MARKER',
        time: exitTime,
        position: side === 'LONG' ? 'aboveBar' : 'belowBar',
        shape: 'circle',
        color: exitColor,
        text: 'RL OUT',
      });
      // out.push({
      //   type: 'HSEG',
      //   t0: exitTime,
      //   t1: exitTime,
      //   price: exitPrice,
      //   color: exitColor,
      //   style: 'dashed',
      //   text: `RL exit${exitReason ? ':' + exitReason : ''}`,
      // });
    }
  }
  return out;
}

function render() {
  if (!candles.length) return;
  candlesSeries.setData(candles);
  volSeries.setData(candles.map(c => ({ time: c.time, value: c.volume ?? 0 })));

  const allEvents = events.concat(tradeEvents).concat(rlTradeEvents);
  const markers = allEvents.filter(e=>e.type==='MARKER').map(e=>({
    time: e.time,
    position: e.position,
    color: e.color,
    shape: e.shape ?? (e.position==='aboveBar' ? 'arrowDown':'arrowUp'),
    text: e.text,
  }));
  markersApi.setMarkers(markers);

  clearSegments();
  for (const e of allEvents) {
    if (e.type === 'HSEG') {
      const style = e.style ?? 'solid';
      const lineStyle =
        style === 'dashed' ? LineStyle.Dashed :
        style === 'dotted' ? LineStyle.Dotted :
        LineStyle.Solid;

      const s = chart.addSeries(LineSeries, { color: e.color, lineWidth: 1, lineStyle });
      s.setData([{ time: e.t0, value: e.price }, { time: e.t1, value: e.price }]);
      segSeries.push(s);
      continue;
    }
    if (e.type === 'RANGE_SEG') {
      const style = e.style ?? 'dotted';
      const lineStyle = style === 'solid' ? LineStyle.Solid : LineStyle.Dotted;

      const s1 = chart.addSeries(LineSeries, { color: e.color, lineWidth: 1, lineStyle });
      s1.setData([{ time: e.t0, value: e.high }, { time: e.t1, value: e.high }]);
      segSeries.push(s1);

      const s2 = chart.addSeries(LineSeries, { color: e.color, lineWidth: 1, lineStyle });
      s2.setData([{ time: e.t0, value: e.low }, { time: e.t1, value: e.low }]);
      segSeries.push(s2);
      continue;
    }
  }

  chart.timeScale().fitContent();
  setStatus(`candles=${candles.length} events=${events.length} strategyTrace=${tradeEvents.length} rlTrades=${rlTradeEvents.length} markers=${markers.length}`);
}

($('resetBtn') as HTMLButtonElement).addEventListener('click', ()=>{
  candles = [];
  events = [];
  tradeEvents = [];
  rlTradeEvents = [];
  candlesSeries.setData([]);
  markersApi.setMarkers([]);
  clearSegments();
  setStatus('Reset done. Load files again.');
});

($('csvFile') as HTMLInputElement).addEventListener('change', async ()=>{
  const f = ($('csvFile') as HTMLInputElement).files?.[0];
  if (!f) return;
  setStatus('Loading CSV...');
  const text = await readFile(f);
  candles = parseCsv(text);
  render();
});

($('evFile') as HTMLInputElement).addEventListener('change', async ()=>{
  const f = ($('evFile') as HTMLInputElement).files?.[0];
  if (!f) return;
  setStatus('Loading event_viewer...');
  const text = await readFile(f);
  events = parseJsonl(text);
  render();
});

($('tradeFile') as HTMLInputElement).addEventListener('change', async ()=>{
  const f = ($('tradeFile') as HTMLInputElement).files?.[0];
  if (!f) return;
  setStatus('Loading trade events...');
  const text = await readFile(f);
  tradeEvents = parseTradeEventsJsonl(text);
  render();
});

($('rlTradesFile') as HTMLInputElement).addEventListener('change', async ()=>{
  const f = ($('rlTradesFile') as HTMLInputElement).files?.[0];
  if (!f) return;
  setStatus('Loading RL trades csv...');
  const text = await readFile(f);
  rlTradeEvents = parseRlTradesCsv(text);
  render();
});

new ResizeObserver(()=> {
  chart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
}).observe(chartEl);
