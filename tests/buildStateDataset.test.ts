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
