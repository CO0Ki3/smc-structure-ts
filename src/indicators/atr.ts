import { Bar } from "../io/types.js";

export class Atr {
  private readonly period: number;
  private trs: number[] = [];
  private sum = 0;
  private prevClose: number | null = null;

  constructor(period: number) {
    if (period <= 0) throw new Error("ATR period must be > 0");
    this.period = period;
  }

  update(bar: Bar): number | null {
    const tr = this.trueRange(bar);
    this.trs.push(tr);
    this.sum += tr;
    if (this.trs.length > this.period) {
      this.sum -= this.trs.shift()!;
    }
    this.prevClose = bar.close;
    if (this.trs.length < this.period) return null;
    return this.sum / this.period;
  }

  private trueRange(bar: Bar): number {
    if (this.prevClose === null) return bar.high - bar.low;
    const a = bar.high - bar.low;
    const b = Math.abs(bar.high - this.prevClose);
    const c = Math.abs(bar.low - this.prevClose);
    return Math.max(a, b, c);
  }
}
