import { test } from "node:test";
import assert from "node:assert/strict";
import { resampleBars, buildLastClosedHtfIndex } from "../src/smc/htfResample.js";
import { Bar } from "../src/io/types.js";

// 15m bar spacing in ms.
const MIN_15 = 15 * 60_000;
const MIN_4H = 4 * 60 * 60_000;

function makeLtfBars(count: number, startTs: number, basePrice: number): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const p = basePrice + i;
    out.push({
      ts: startTs + i * MIN_15,
      open: p,
      high: p + 0.5,
      low: p - 0.5,
      close: p,
      volume: 1,
    });
  }
  return out;
}

test("resampleBars: empty input returns empty", () => {
  assert.deepEqual(resampleBars([], 240), []);
});

test("resampleBars: rejects non-positive htfMinutes", () => {
  assert.throws(() => resampleBars([], 0));
  assert.throws(() => resampleBars([], -5));
});

test("resampleBars: 16 LTF 15m bars aligned to 4H → 1 HTF bar (16 × 15m = 4h)", () => {
  // Start at 00:00 UTC on a 4H boundary.
  const startTs = 1764547200000; // arbitrary 4H boundary
  const bars = makeLtfBars(16, startTs, 100);
  const htf = resampleBars(bars, 240);
  assert.equal(htf.length, 1);
  assert.equal(htf[0].ts, startTs);
  assert.equal(htf[0].open, 100); // first bar open
  assert.equal(htf[0].close, 115); // last bar close (price 100..115)
  assert.equal(htf[0].high, 115.5); // max high
  assert.equal(htf[0].low, 99.5); // min low
  assert.equal(htf[0].volume, 16);
});

test("resampleBars: 32 LTF bars across two 4H buckets → 2 HTF bars", () => {
  const startTs = 1764547200000;
  const bars = makeLtfBars(32, startTs, 100);
  const htf = resampleBars(bars, 240);
  assert.equal(htf.length, 2);
  assert.equal(htf[0].ts, startTs);
  assert.equal(htf[1].ts, startTs + MIN_4H);
  assert.equal(htf[0].close, 115);
  assert.equal(htf[1].open, 116);
  assert.equal(htf[1].close, 131);
});

test("resampleBars: partial last bucket still aggregates correctly", () => {
  const startTs = 1764547200000;
  // 20 bars = 1 full 4H bucket + 4 bars (1h) in next bucket
  const bars = makeLtfBars(20, startTs, 100);
  const htf = resampleBars(bars, 240);
  assert.equal(htf.length, 2);
  assert.equal(htf[0].volume, 16);
  assert.equal(htf[1].volume, 4);
});

test("resampleBars: handles non-boundary start (mid-bucket entry)", () => {
  // Start 1h into a 4H bucket — first HTF candle has only 12 LTF bars.
  const boundaryTs = 1764547200000;
  const offset = 4 * MIN_15;
  const bars = makeLtfBars(16, boundaryTs + offset, 100);
  const htf = resampleBars(bars, 240);
  // First HTF bucket: 12 bars (from offset to boundary+4h). Second: 4 bars.
  assert.equal(htf.length, 2);
  assert.equal(htf[0].ts, boundaryTs); // bucket-aligned start, not first-bar ts
  assert.equal(htf[0].volume, 12);
  assert.equal(htf[1].volume, 4);
});

test("resampleBars: 1D (1440min) aggregation across 96 LTF bars", () => {
  const startTs = 1764547200000;
  const bars = makeLtfBars(96, startTs, 100);
  const htf = resampleBars(bars, 1440);
  assert.equal(htf.length, 1);
  assert.equal(htf[0].volume, 96);
});

test("buildLastClosedHtfIndex: empty inputs → empty output", () => {
  assert.deepEqual(buildLastClosedHtfIndex([], [], 240), []);
});

test("buildLastClosedHtfIndex: LTF bars before first HTF close → -1", () => {
  const startTs = 1764547200000;
  const ltf = makeLtfBars(20, startTs, 100);
  const htf = resampleBars(ltf, 240);
  const idx = buildLastClosedHtfIndex(ltf, htf, 240);
  // First 16 LTF bars (4H window) are inside the first HTF candle → -1.
  for (let i = 0; i < 16; i++) {
    assert.equal(idx[i], -1, `bar ${i} expected -1 got ${idx[i]}`);
  }
  // From bar 16 onward, first HTF (index 0) has closed.
  for (let i = 16; i < 20; i++) {
    assert.equal(idx[i], 0, `bar ${i} expected 0 got ${idx[i]}`);
  }
});

test("buildLastClosedHtfIndex: monotonically non-decreasing", () => {
  const startTs = 1764547200000;
  const ltf = makeLtfBars(200, startTs, 100);
  const htf = resampleBars(ltf, 240);
  const idx = buildLastClosedHtfIndex(ltf, htf, 240);
  for (let i = 1; i < idx.length; i++) {
    assert.ok(idx[i] >= idx[i - 1], `non-monotonic at i=${i}: ${idx[i-1]}→${idx[i]}`);
  }
});

test("buildLastClosedHtfIndex: handles gap day (24h skip splitting buckets)", () => {
  // Crypto trades 24/7 but a downtime / dataset gap can produce a hole.
  // Part1 (16 bars) fills one 4H bucket cleanly. Part2 starts +25h
  // later — straddles two 4H buckets (12 bars in the first, 4 in the
  // next). Total HTF candles = 3, not 2; the test is that the index
  // builder still produces a non-decreasing index and every post-gap
  // bar sees at least one closed HTF candle.
  const startTs = 1764547200000;
  const part1: Bar[] = makeLtfBars(16, startTs, 100);
  const gapTs = startTs + 16 * MIN_15 + 25 * 60 * 60_000;
  const part2: Bar[] = makeLtfBars(16, gapTs, 200);
  const ltf = part1.concat(part2);
  const htf = resampleBars(ltf, 240);
  assert.equal(htf.length, 3);
  const idx = buildLastClosedHtfIndex(ltf, htf, 240);
  for (let i = 1; i < idx.length; i++) {
    assert.ok(idx[i] >= idx[i - 1], `non-monotonic at ${i}`);
  }
  for (let i = 16; i < ltf.length; i++) {
    assert.ok(idx[i] >= 0, `post-gap bar ${i} expected ≥0 got ${idx[i]}`);
  }
});
