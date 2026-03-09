import { Bar } from "../io/types.js";

export function isHighVolatilityBar(bar: Bar, volatilityMeasure: number | null, mult: number): boolean {
  if (!volatilityMeasure || volatilityMeasure <= 0) return false;
  return (bar.high - bar.low) >= (mult * volatilityMeasure);
}

// LuxAlgo-style parsed highs/lows for high-volatility candles:
// If high vol: parsedHigh = low, parsedLow = high (swap) to dampen OB selection.
export function parsedHighLow(bar: Bar, highVol: boolean): { parsedHigh: number; parsedLow: number } {
  return highVol ? { parsedHigh: bar.low, parsedLow: bar.high } : { parsedHigh: bar.high, parsedLow: bar.low };
}
