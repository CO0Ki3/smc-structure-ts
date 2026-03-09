import { OrderBlock, Bias } from "./types.js";

export function storeOrderBlock(
  parsedHighs: number[],
  parsedLows: number[],
  times: number[],
  pivotIndex: number,
  currentIndex: number,
  bias: Bias
): OrderBlock | null {
  if (pivotIndex < 0 || pivotIndex >= currentIndex) return null;

  if (bias === -1) {
    // bearish: choose max parsedHigh in [pivotIndex..currentIndex]
    let maxH = -Infinity;
    let idx = -1;
    for (let i = pivotIndex; i <= currentIndex; i++) {
      if (parsedHighs[i] > maxH) { maxH = parsedHighs[i]; idx = i; }
    }
    if (idx < 0) return null;
    return { high: parsedHighs[idx], low: parsedLows[idx], ts: times[idx], bias: -1 };
  } else if (bias === 1) {
    // bullish: choose min parsedLow
    let minL = Infinity;
    let idx = -1;
    for (let i = pivotIndex; i <= currentIndex; i++) {
      if (parsedLows[i] < minL) { minL = parsedLows[i]; idx = i; }
    }
    if (idx < 0) return null;
    return { high: parsedHighs[idx], low: parsedLows[idx], ts: times[idx], bias: 1 };
  }
  return null;
}

export function mitigateBlocks(
  blocks: OrderBlock[],
  mitigationSourceHigh: number,
  mitigationSourceLow: number,
  bullishSource: number,
  bearishSource: number
): { kept: OrderBlock[]; mitigated: OrderBlock[] } {
  const kept: OrderBlock[] = [];
  const mitigated: OrderBlock[] = [];

  for (const b of blocks) {
    let crossed = false;
    if (b.bias === -1) {
      // bearish block mitigated if bearishSource > block.high
      crossed = bearishSource > b.high;
    } else if (b.bias === 1) {
      // bullish block mitigated if bullishSource < block.low
      crossed = bullishSource < b.low;
    }
    if (crossed) mitigated.push(b);
    else kept.push(b);
  }
  return { kept, mitigated };
}
