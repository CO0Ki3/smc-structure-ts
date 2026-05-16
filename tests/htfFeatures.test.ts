import { test } from "node:test";
import assert from "node:assert/strict";
import { trackHtfState, premiumDiscount } from "../src/smc/htfFeatures.js";
import { Bar } from "../src/io/types.js";

const MIN_4H = 4 * 60 * 60_000;

function makeUptrend(count: number, startTs: number, startPrice: number, step = 1): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const p = startPrice + i * step;
    out.push({ ts: startTs + i * MIN_4H, open: p, high: p + 0.5, low: p - 0.5, close: p, volume: 1 });
  }
  return out;
}

/**
 * A monotonic ramp leaves no swings for SMC to detect (the engine
 * needs a high-low-higher_high cycle to declare a swing). This
 * helper synthesizes a zigzag that climbs over the long run but
 * pulls back every `pullbackEvery` bars so swing pivots actually
 * form. Used to verify trackHtfState picks up bullish bias on a
 * trending series.
 */
function makeZigzagUptrend(count: number, startTs: number, startPrice: number,
                          pullbackEvery: number = 8, legSize: number = 6): Bar[] {
  const out: Bar[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    // Within each pullback cycle, climb (pullbackEvery - 2) bars then dip 2.
    const phase = i % pullbackEvery;
    if (phase < pullbackEvery - 2) price += legSize;
    else price -= legSize * 1.3; // pullback less than the prior leg → higher lows
    out.push({
      ts: startTs + i * MIN_4H,
      open: price,
      high: price + 0.5,
      low: price - 0.5,
      close: price,
      volume: 1,
    });
  }
  return out;
}

test("trackHtfState: empty input → empty snapshots", () => {
  assert.deepEqual(trackHtfState([]), []);
});

test("trackHtfState: snapshots length matches bars length", () => {
  const bars = makeUptrend(100, 1764547200000, 100);
  const snaps = trackHtfState(bars);
  assert.equal(snaps.length, 100);
});

test("trackHtfState: zigzag uptrend produces bullish bias", () => {
  // Monotonic ramps have no swings — SMC needs zigzags to confirm
  // structure. Use a zigzag that drifts up so swing breaks fire.
  const bars = makeZigzagUptrend(300, 1764547200000, 100);
  const snaps = trackHtfState(bars);
  const last = snaps[snaps.length - 1];
  assert.ok(
    last.swingBias === 1 || last.internalBias === 1,
    `expected bullish bias by end of zigzag uptrend, got swing=${last.swingBias} internal=${last.internalBias}`,
  );
});

test("trackHtfState: monotonic ramp leaves bias neutral (no swings to detect)", () => {
  // Sanity: pure monotonic ramp has no pivots → bias stays 0.
  // This documents the engine semantics — a single sweep is not
  // a "trend" for SMC, you need at least one zigzag.
  const bars = makeUptrend(200, 1764547200000, 100);
  const snaps = trackHtfState(bars);
  const last = snaps[snaps.length - 1];
  assert.equal(last.swingBias, 0);
});

test("trackHtfState: barsSinceSwingBreak monotonically increases between breaks", () => {
  const bars = makeZigzagUptrend(300, 1764547200000, 100);
  const snaps = trackHtfState(bars);
  // Find first non-null entry, then check it never resets to a smaller value
  // except when a STRUCTURE_BREAK happens (then it resets to 0).
  let prevAfterFirst: number | null = null;
  for (const s of snaps) {
    if (s.barsSinceSwingBreak === null) continue;
    if (prevAfterFirst !== null) {
      // Either +1 (normal increment) or reset to 0 (new break)
      assert.ok(
        s.barsSinceSwingBreak === prevAfterFirst + 1 || s.barsSinceSwingBreak === 0,
        `unexpected delta: prev=${prevAfterFirst} now=${s.barsSinceSwingBreak}`,
      );
    }
    prevAfterFirst = s.barsSinceSwingBreak;
  }
});

test("trackHtfState: pivots are populated once swing detected", () => {
  const bars = makeZigzagUptrend(300, 1764547200000, 100);
  const snaps = trackHtfState(bars);
  const last = snaps[snaps.length - 1];
  assert.ok(
    last.lastSwingHigh !== null || last.lastSwingLow !== null,
    "expected at least one swing pivot set after zigzag uptrend",
  );
});

test("premiumDiscount: null when pivots missing", () => {
  assert.equal(
    premiumDiscount(100, {
      swingBias: 0, internalBias: 0,
      lastSwingHigh: null, lastSwingLow: null,
      lastInternalHigh: null, lastInternalLow: null,
      barsSinceSwingBreak: null, barsSinceInternalBreak: null,
    }),
    null,
  );
});

test("premiumDiscount: 0.5 when close is mid-range", () => {
  const v = premiumDiscount(105, {
    swingBias: 1, internalBias: 1,
    lastSwingHigh: 110, lastSwingLow: 100,
    lastInternalHigh: null, lastInternalLow: null,
    barsSinceSwingBreak: 5, barsSinceInternalBreak: 5,
  });
  assert.equal(v, 0.5);
});

test("premiumDiscount: 0 at swing low, 1 at swing high", () => {
  const snap = {
    swingBias: 1, internalBias: 1,
    lastSwingHigh: 110, lastSwingLow: 100,
    lastInternalHigh: null, lastInternalLow: null,
    barsSinceSwingBreak: 5, barsSinceInternalBreak: 5,
  };
  assert.equal(premiumDiscount(100, snap), 0);
  assert.equal(premiumDiscount(110, snap), 1);
});

test("premiumDiscount: null on degenerate range", () => {
  // high == low → range 0
  assert.equal(
    premiumDiscount(105, {
      swingBias: 0, internalBias: 0,
      lastSwingHigh: 100, lastSwingLow: 100,
      lastInternalHigh: null, lastInternalLow: null,
      barsSinceSwingBreak: 0, barsSinceInternalBreak: 0,
    }),
    null,
  );
  // high < low → range negative
  assert.equal(
    premiumDiscount(105, {
      swingBias: 0, internalBias: 0,
      lastSwingHigh: 100, lastSwingLow: 110,
      lastInternalHigh: null, lastInternalLow: null,
      barsSinceSwingBreak: 0, barsSinceInternalBreak: 0,
    }),
    null,
  );
});
