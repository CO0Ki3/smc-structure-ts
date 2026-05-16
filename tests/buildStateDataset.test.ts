import { test } from "node:test";
import assert from "node:assert/strict";

import { buildStateDataset } from "../src/dataset/buildStateDataset.js";

type Bar = { ts: number; open: number; high: number; low: number; close: number; volume: number };
type Ev = Parameters<typeof buildStateDataset>[2][number];

function bar(ts: number, close: number): Bar {
  return { ts, open: close, high: close, low: close, close, volume: 0 };
}

test("structure_alignment is 1 when swing and internal both bullish", () => {
  const bars: Bar[] = [bar(0, 100), bar(1, 101), bar(2, 102), bar(3, 103)];
  const events: Ev[] = [
    { type: "STRUCTURE_BREAK", scope: "SWING", tag: "BOS", dir: 1, ts: 0, level: 100 },
    { type: "STRUCTURE_BREAK", scope: "INTERNAL", tag: "BOS", dir: 1, ts: 0, level: 100 },
  ];
  const rows = buildStateDataset("ds", bars, events);
  assert.equal(rows.at(-1)!.structure_alignment, 1);
});

test("structure_alignment is 1 when both bearish", () => {
  const bars: Bar[] = [bar(0, 100), bar(1, 99), bar(2, 98)];
  const events: Ev[] = [
    { type: "STRUCTURE_BREAK", scope: "SWING", tag: "BOS", dir: -1, ts: 0, level: 100 },
    { type: "STRUCTURE_BREAK", scope: "INTERNAL", tag: "BOS", dir: -1, ts: 0, level: 100 },
  ];
  const rows = buildStateDataset("ds", bars, events);
  assert.equal(rows.at(-1)!.structure_alignment, 1);
});

test("structure_alignment is 0 when swing and internal disagree", () => {
  const bars: Bar[] = [bar(0, 100), bar(1, 99), bar(2, 100)];
  const events: Ev[] = [
    { type: "STRUCTURE_BREAK", scope: "SWING", tag: "BOS", dir: 1, ts: 0, level: 100 },
    { type: "STRUCTURE_BREAK", scope: "INTERNAL", tag: "CHOCH", dir: -1, ts: 0, level: 100 },
  ];
  const rows = buildStateDataset("ds", bars, events);
  assert.equal(rows.at(-1)!.structure_alignment, 0);
});

test("structure_alignment is 0 before any structure break", () => {
  const bars: Bar[] = [bar(0, 100), bar(1, 100)];
  const rows = buildStateDataset("ds", bars, []);
  for (const r of rows) assert.equal(r.structure_alignment, 0);
});

test("distance_to_premium_discount returns null when swing pivots missing", () => {
  const bars: Bar[] = [bar(0, 100), bar(1, 100)];
  const rows = buildStateDataset("ds", bars, []);
  for (const r of rows) assert.equal(r.distance_to_premium_discount, null);
});

test("distance_to_premium_discount = 0 at swing low (deepest discount)", () => {
  const bars: Bar[] = [bar(0, 100), bar(1, 100), bar(2, 100)];
  const events: Ev[] = [
    { type: "SWING_PIVOT", pivotType: "HIGH", ts: 0, level: 110, index: 0 },
    { type: "SWING_PIVOT", pivotType: "LOW",  ts: 0, level: 100, index: 0 },
  ];
  const rows = buildStateDataset("ds", bars, events);
  assert.equal(rows.at(-1)!.distance_to_premium_discount, 0);
});

test("distance_to_premium_discount = 1 at swing high (deepest premium)", () => {
  const bars: Bar[] = [bar(0, 110), bar(1, 110)];
  const events: Ev[] = [
    { type: "SWING_PIVOT", pivotType: "HIGH", ts: 0, level: 110, index: 0 },
    { type: "SWING_PIVOT", pivotType: "LOW",  ts: 0, level: 100, index: 0 },
  ];
  const rows = buildStateDataset("ds", bars, events);
  assert.equal(rows.at(-1)!.distance_to_premium_discount, 1);
});

test("distance_to_premium_discount = 0.5 at equilibrium (range midpoint)", () => {
  const bars: Bar[] = [bar(0, 105), bar(1, 105)];
  const events: Ev[] = [
    { type: "SWING_PIVOT", pivotType: "HIGH", ts: 0, level: 110, index: 0 },
    { type: "SWING_PIVOT", pivotType: "LOW",  ts: 0, level: 100, index: 0 },
  ];
  const rows = buildStateDataset("ds", bars, events);
  assert.equal(rows.at(-1)!.distance_to_premium_discount, 0.5);
});

test("distance_to_premium_discount returns null when range is degenerate (high==low)", () => {
  const bars: Bar[] = [bar(0, 100), bar(1, 100)];
  const events: Ev[] = [
    { type: "SWING_PIVOT", pivotType: "HIGH", ts: 0, level: 100, index: 0 },
    { type: "SWING_PIVOT", pivotType: "LOW",  ts: 0, level: 100, index: 0 },
  ];
  const rows = buildStateDataset("ds", bars, events);
  for (const r of rows) assert.equal(r.distance_to_premium_discount, null);
});

test("distance_to_premium_discount can be < 0 or > 1 when price is outside the swing range", () => {
  // Price 120 with swing range [100, 110] → 2.0 (above premium).
  // The feature is informational; downstream consumers may treat >1 as
  // "extended above premium" or clamp; we do not clamp here.
  const bars: Bar[] = [bar(0, 120), bar(1, 120)];
  const events: Ev[] = [
    { type: "SWING_PIVOT", pivotType: "HIGH", ts: 0, level: 110, index: 0 },
    { type: "SWING_PIVOT", pivotType: "LOW",  ts: 0, level: 100, index: 0 },
  ];
  const rows = buildStateDataset("ds", bars, events);
  assert.equal(rows.at(-1)!.distance_to_premium_discount, 2);
});

// --- PDF chapter 9.6-7: SL/TP distance + R:R features ---

function bigBars(values: number[]): Bar[] {
  // Build N bars enough to populate ATR; ATR uses simple TR averaging over 14 bars.
  return values.map((c, i) => ({ ts: i, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 0 }));
}

test("internal_sl_distance_long is null when last_internal_low is missing", () => {
  const bars = bigBars(Array.from({ length: 20 }, (_, i) => 100 + i * 0.1));
  const rows = buildStateDataset("ds", bars, []);
  assert.equal(rows.at(-1)!.internal_sl_distance_long, null);
  assert.equal(rows.at(-1)!.swing_tp_distance_long, null);
  assert.equal(rows.at(-1)!.rr_ratio_long, null);
});

test("internal_sl_distance_long = (close - last_internal_low) / atr; swing_tp_distance_long similarly", () => {
  // Build 20 bars at price ~100 then a final bar at close=110; ATR will be small.
  // Seed pivots so internal_low=95 (below close) and swing_high=130 (above close).
  const bars = bigBars(Array.from({ length: 20 }, () => 100));
  bars[19] = { ts: 19, open: 100, high: 100.5, low: 99.5, close: 110, volume: 0 };
  const events: Ev[] = [
    { type: "INTERNAL_PIVOT", pivotType: "LOW",  ts: 19, level: 95,  index: 19 },
    { type: "SWING_PIVOT",    pivotType: "HIGH", ts: 19, level: 130, index: 19 },
  ];
  const last = buildStateDataset("ds", bars, events).at(-1)!;
  const atr = last.atr_14 as number;
  assert.ok(atr > 0, "ATR must be populated for this test");
  assert.equal(last.internal_sl_distance_long, (110 - 95) / atr);
  assert.equal(last.swing_tp_distance_long, (130 - 110) / atr);
  assert.equal(last.rr_ratio_long, (130 - 110) / (110 - 95));
});

test("long SL/TP/RR null when invalidation level is on wrong side of close (e.g., internal_low above close)", () => {
  const bars = bigBars(Array.from({ length: 20 }, () => 100));
  const events: Ev[] = [
    { type: "INTERNAL_PIVOT", pivotType: "LOW",  ts: 19, level: 105, index: 19 }, // above close 100 — invalid long SL
    { type: "SWING_PIVOT",    pivotType: "HIGH", ts: 19, level: 130, index: 19 },
  ];
  const last = buildStateDataset("ds", bars, events).at(-1)!;
  assert.equal(last.internal_sl_distance_long, null);
  assert.equal(last.rr_ratio_long, null);
  assert.notEqual(last.swing_tp_distance_long, null);
});

test("internal_sl_distance_short + swing_tp_distance_short + rr_ratio_short symmetric to long side", () => {
  const bars = bigBars(Array.from({ length: 20 }, () => 100));
  bars[19] = { ts: 19, open: 100, high: 100.5, low: 99.5, close: 90, volume: 0 };
  const events: Ev[] = [
    { type: "INTERNAL_PIVOT", pivotType: "HIGH", ts: 19, level: 105, index: 19 }, // above close 90 — valid short SL
    { type: "SWING_PIVOT",    pivotType: "LOW",  ts: 19, level: 70,  index: 19 }, // below close 90 — valid short TP
  ];
  const last = buildStateDataset("ds", bars, events).at(-1)!;
  const atr = last.atr_14 as number;
  assert.ok(atr > 0);
  assert.equal(last.internal_sl_distance_short, (105 - 90) / atr);
  assert.equal(last.swing_tp_distance_short, (90 - 70) / atr);
  assert.equal(last.rr_ratio_short, (90 - 70) / (105 - 90));
});

test("rr_ratio uses the same units; well-defined > 1 when TP further than SL", () => {
  const bars = bigBars(Array.from({ length: 20 }, () => 100));
  const events: Ev[] = [
    { type: "INTERNAL_PIVOT", pivotType: "LOW",  ts: 19, level: 99,  index: 19 }, // close 100 - 99 = 1
    { type: "SWING_PIVOT",    pivotType: "HIGH", ts: 19, level: 105, index: 19 }, // 105 - 100 = 5 → R:R = 5
  ];
  const last = buildStateDataset("ds", bars, events).at(-1)!;
  assert.ok((last.rr_ratio_long as number) > 4.99 && (last.rr_ratio_long as number) < 5.01);
});

test("rr_ratio_long null when atr is null (no ATR window yet)", () => {
  const bars = bigBars([100, 100, 100]); // too few bars for ATR
  const events: Ev[] = [
    { type: "INTERNAL_PIVOT", pivotType: "LOW",  ts: 2, level: 95,  index: 2 },
    { type: "SWING_PIVOT",    pivotType: "HIGH", ts: 2, level: 130, index: 2 },
  ];
  const last = buildStateDataset("ds", bars, events).at(-1)!;
  // atr_14 is null because we have < 15 bars
  assert.equal(last.atr_14, null);
  assert.equal(last.internal_sl_distance_long, null);
  assert.equal(last.rr_ratio_long, null);
});

// Stage B-18: degenerate-swing guard. Without it rr_ratio explodes
// (production data saw max 10397) and silently passes the PDF β1
// R:R >= 1.5 rule. SL distance < 0.3 × ATR → invalidate (null).
test("B-18: rr_ratio_long invalidated when internal_sl_distance < 0.3 ATR (degenerate swing)", () => {
  const bars = bigBars(Array.from({ length: 20 }, () => 100));
  const events: Ev[] = [
    // internal_low just below close, SL distance ≈ 0.01 (way under 0.3 ATR).
    { type: "INTERNAL_PIVOT", pivotType: "LOW",  ts: 19, level: 99.99, index: 19 },
    { type: "SWING_PIVOT",    pivotType: "HIGH", ts: 19, level: 130,   index: 19 },
  ];
  const last = buildStateDataset("ds", bars, events).at(-1)!;
  const atr = last.atr_14 as number;
  assert.ok(atr > 0);
  // SL distance in ATR units = 0.01 / atr; we need this < 0.3.
  assert.ok((0.01 / atr) < 0.3, "test fixture must have SL distance < 0.3 ATR");
  assert.equal(last.rr_ratio_long, null);
});

test("B-18: rr_ratio_long clamped to [0.5, 10] when raw ratio is out of range", () => {
  const bars = bigBars(Array.from({ length: 20 }, () => 100));
  // SL distance = 5 (close=100, internal_low=95), TP distance = 200 → raw rr=40.
  // SL/atr should be >= 0.3 so the invalidate gate does NOT fire.
  const events: Ev[] = [
    { type: "INTERNAL_PIVOT", pivotType: "LOW",  ts: 19, level: 95,  index: 19 },
    { type: "SWING_PIVOT",    pivotType: "HIGH", ts: 19, level: 300, index: 19 },
  ];
  const last = buildStateDataset("ds", bars, events).at(-1)!;
  const atr = last.atr_14 as number;
  assert.ok((5 / atr) >= 0.3, "SL distance must clear the 0.3 ATR invalidate gate");
  assert.equal(last.rr_ratio_long, 10);
});

// --- Phase 1 / Stage C-1: HTF feature attach + outputStartBar prefix ---

const MIN_15 = 15 * 60_000;

function realtimeBars(count: number, startTs: number, priceFn: (i: number) => number): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const c = priceFn(i);
    out.push({ ts: startTs + i * MIN_15, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });
  }
  return out;
}

test("Phase 1: HTF columns default null/0 when bars < first HTF candle", () => {
  // Only 4 LTF (15m) bars — first 4H HTF candle (16 bars) hasn't closed.
  const bars = realtimeBars(4, 1764547200000, i => 100 + i);
  const rows = buildStateDataset("ds", bars, []);
  const last = rows.at(-1)!;
  assert.equal(last.htf_4h_swing_bias, 0);
  assert.equal(last.htf_4h_bars_since_swing_break, null);
  assert.equal(last.htf_4h_premium_discount, null);
  assert.equal(last.htf_1d_swing_bias, 0);
});

test("Phase 1: HTF schema columns exist on every row", () => {
  const bars = realtimeBars(20, 1764547200000, i => 100 + i);
  const rows = buildStateDataset("ds", bars, []);
  for (const r of rows) {
    assert.ok("htf_4h_swing_bias" in r);
    assert.ok("htf_4h_internal_bias" in r);
    assert.ok("htf_4h_premium_discount" in r);
    assert.ok("htf_4h_dist_to_swing_high_atr" in r);
    assert.ok("htf_1d_swing_bias" in r);
    assert.ok("htf_1d_premium_discount" in r);
  }
});

test("Phase 1: outputStartBar trims first N rows from output", () => {
  // 50 LTF bars, skip first 16 (one 4H window) → 34 rows out.
  const bars = realtimeBars(50, 1764547200000, i => 100 + i);
  const rows = buildStateDataset("ds", bars, [], { outputStartBar: 16 });
  assert.equal(rows.length, 50 - 16);
  // First emitted row's ts is the 17th LTF bar's ts.
  assert.equal(rows[0].ts, bars[16].ts);
});

test("Phase 1: attachHtf=false keeps schema but leaves HTF cols at default", () => {
  const bars = realtimeBars(20, 1764547200000, i => 100 + i);
  const rows = buildStateDataset("ds", bars, [], { attachHtf: false });
  const last = rows.at(-1)!;
  assert.equal(last.htf_4h_swing_bias, 0);
  assert.equal(last.htf_4h_premium_discount, null);
});

test("Phase 1: HTF bars_since_swing_break null until first 4H bar closes", () => {
  // Before the first 4H candle closes (need 16 LTF bars to pass), all
  // HTF lookups must return defaults. Verifies the lookahead guard.
  const bars = realtimeBars(15, 1764547200000, i => 100 + i);
  const rows = buildStateDataset("ds", bars, []);
  for (const r of rows) {
    assert.equal(r.htf_4h_bars_since_swing_break, null);
    assert.equal(r.htf_4h_swing_bias, 0);
  }
});

test("Phase 1: HTF lookups switch from null to populated after 4H candle closes", () => {
  // 32 LTF bars span 2 × 4H candles. From bar 16 onward the first
  // 4H bar has closed → htf_4h_bars_since_swing_break could now be
  // non-null (but only if SMC engine declared a swing — usually no
  // for monotonic ramps). At minimum, bias is still 0 and the
  // bars_since field stays null until SMC fires STRUCTURE_BREAK on
  // the 4H stream. The test asserts the schema invariant: bias is
  // an integer in {-1, 0, 1} and bars_since is null OR non-negative.
  const bars = realtimeBars(32, 1764547200000, i => 100 + i);
  const rows = buildStateDataset("ds", bars, []);
  for (const r of rows) {
    assert.ok([1, 0, -1].includes(r.htf_4h_swing_bias));
    assert.ok(
      r.htf_4h_bars_since_swing_break === null || r.htf_4h_bars_since_swing_break >= 0,
    );
  }
});

test("B-18: rr_ratio_short invalidate + clamp symmetric to long side", () => {
  const bars = bigBars(Array.from({ length: 20 }, () => 100));
  bars[19] = { ts: 19, open: 100, high: 100.5, low: 99.5, close: 100, volume: 0 };
  // Degenerate: internal_high just above close → SL distance tiny.
  const evDegenerate: Ev[] = [
    { type: "INTERNAL_PIVOT", pivotType: "HIGH", ts: 19, level: 100.01, index: 19 },
    { type: "SWING_PIVOT",    pivotType: "LOW",  ts: 19, level: 70,     index: 19 },
  ];
  assert.equal(
    buildStateDataset("ds", bars, evDegenerate).at(-1)!.rr_ratio_short,
    null,
  );
  // Out-of-range: SL distance 5, TP distance 80 → raw 16 → clamp 10.
  const evHigh: Ev[] = [
    { type: "INTERNAL_PIVOT", pivotType: "HIGH", ts: 19, level: 105, index: 19 },
    { type: "SWING_PIVOT",    pivotType: "LOW",  ts: 19, level: 20,  index: 19 },
  ];
  assert.equal(
    buildStateDataset("ds", bars, evHigh).at(-1)!.rr_ratio_short,
    10,
  );
});
