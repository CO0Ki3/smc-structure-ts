import { Bar } from "../io/types.js";

/**
 * Resample LTF (e.g. 15-minute) bars into a higher timeframe by
 * collapsing every consecutive block of `barsPerHtfCandle` LTF
 * bars into a single HTF bar. OHLCV aggregation:
 *   - ts:     first LTF bar's ts (HTF candle open time)
 *   - open:   first LTF bar's open
 *   - high:   max(LTF.high)
 *   - low:    min(LTF.low)
 *   - close:  last LTF bar's close
 *   - volume: sum(LTF.volume)
 *
 * The implementation aligns HTF candle boundaries to ts modulo the
 * HTF candle duration in milliseconds — this is what TradingView /
 * Binance use, so a "4H" candle covers 00:00-03:59:59, 04:00-07:59:59,
 * etc. UTC. Bars that don't fall on a boundary still aggregate cleanly
 * because we group by `floor(ts / htfMs) * htfMs`.
 *
 * Used by buildStateDataset to give the SMC engine HTF context (Stage
 * C-1 / Phase 1: HTF swing_bias / internal_bias / premium_discount).
 */
export function resampleBars(bars: Bar[], htfMinutes: number): Bar[] {
  if (htfMinutes <= 0) throw new Error(`htfMinutes must be > 0: ${htfMinutes}`);
  if (bars.length === 0) return [];

  const htfMs = htfMinutes * 60_000;
  const out: Bar[] = [];
  let currentBucketStart: number | null = null;
  let bucket: Bar | null = null;

  for (const b of bars) {
    const bucketStart = Math.floor(b.ts / htfMs) * htfMs;
    if (currentBucketStart === null || bucketStart !== currentBucketStart) {
      if (bucket !== null) out.push(bucket);
      currentBucketStart = bucketStart;
      bucket = {
        ts: bucketStart,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      };
      continue;
    }
    // Same bucket — fold in.
    if (b.high > bucket!.high) bucket!.high = b.high;
    if (b.low < bucket!.low) bucket!.low = b.low;
    bucket!.close = b.close;
    bucket!.volume += b.volume;
  }
  if (bucket !== null) out.push(bucket);
  return out;
}

/**
 * Build a mapping from LTF bar index → index of the LAST CLOSED HTF
 * bar at that LTF moment. "Closed" means the HTF candle's open time
 * + htfMs ≤ the LTF bar's open time. Returns -1 for LTF bars that
 * fall inside the first HTF candle (no closed HTF bar yet).
 *
 * The reason for "last closed" rather than "current": the SMC
 * structure of the HTF candle is only known at HTF close. Using the
 * in-progress HTF candle for the LTF row would be a lookahead bug.
 */
export function buildLastClosedHtfIndex(
  ltfBars: Bar[],
  htfBars: Bar[],
  htfMinutes: number,
): number[] {
  const htfMs = htfMinutes * 60_000;
  const out = new Array<number>(ltfBars.length).fill(-1);
  let htfPtr = 0;
  for (let i = 0; i < ltfBars.length; i++) {
    const ts = ltfBars[i].ts;
    // Advance htfPtr while the next HTF bar has closed by ts.
    while (
      htfPtr < htfBars.length &&
      htfBars[htfPtr].ts + htfMs <= ts
    ) {
      htfPtr += 1;
    }
    // htfPtr now points to the FIRST HTF bar whose close > ts (or end).
    // Last CLOSED HTF bar is therefore htfPtr - 1.
    out[i] = htfPtr - 1;
  }
  return out;
}
