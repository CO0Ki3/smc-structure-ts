# smc-structure-ts

TypeScript implementation of **SMC structure primitives** (swing/internal pivots, BOS/CHOCH, EQH/EQL, order blocks) using **sequential (no-lookahead) processing**.

## Why this exists
- TradingView Pine scripts are great for visualization but can hide confirmation delays / lookahead.
- This project processes OHLCV bars **left-to-right only**, emitting events when they become knowable.

> NOTE (license): The LuxAlgo script you referenced is CC BY-NC-SA 4.0.  
> This repo is a clean-room re-implementation of concepts, not a copy/paste of their code.  
> You must ensure your use complies with the original license and your distribution/commercial intent.

## Install
```bash
npm i
```

## Input CSV format
Default expects:
- `ts` as ISO-8601 string or epoch ms
- `open,high,low,close,volume`

If your column is `time` (TradingView), use `--timecol time`.

## Run: emit SMC events
```bash
npm run smc -- --in ./data.csv --out ./events.jsonl
```

Options:
- `--timecol <col>` default `ts`
- `--tz utc` (default)
- `--mode swing|internal|both` (default both)
- `--swingLen <n>` default 50 (15m)
- `--internalLen <n>` default 5 (15m)
- `--eqLen <n>` default 3
- `--eqThr <float>` default 0.1  (multiplied by ATR200)
- `--ob` enable order blocks (default on)
- `--obMitigation close|highlow` default highlow
- `--obMax <n>` default 100

## Resample 15m -> 30m/1h/4h
```bash
npm run resample -- --in ./data.csv --out ./outDir
```

## Output
- events.jsonl: one JSON object per event (BOS/CHOCH/EQH/EQL/OB_CREATE/OB_MITIGATED)
- optional state dump can be added easily (see src/index.ts)



## Visualize (local web viewer)

This repo supports two outputs:
- `events.jsonl`: raw SMC events (keep it clean; no UI-only fields)
- `event_viewer.jsonl`: viewer overlay hints (generated separately)

### 1) Generate raw events
```bash
npm run smc -- --in ./data.csv --out ./events.jsonl --timecol time
```

### 2) Generate viewer events (no contamination)
```bash
npm run build-viewer -- --events ./events.jsonl --csv ./data.csv --out ./event_viewer.jsonl --timecol time
```

### 3) Run viewer
```bash
cd viewer
npm i
npm run dev
```

Then open the local URL, and load:
- CSV (same input)
- `event_viewer.jsonl`

Notes:
- BOS/CHOCH are shown as markers + dashed horizontal level line.
- EQH/EQL are shown as circle markers + dotted horizontal level line.
- OB is approximated as two dotted lines (high/low) + a square marker at creation.


## Strategy runner (CSV + events.jsonl -> trades log)

Implements checklist MVP:
1) Bias from latest SWING `STRUCTURE_BREAK`
2) Liquidity sweep vs latest SWING pivot (wick-through + close back)
3) Confirmation via INTERNAL `STRUCTURE_BREAK` (CHOCH by default)
4) Entry on OB retest (aligned OB_CREATE)
5) SL at sweep extreme, TP = RR * risk (default RR=2)
6) Intrabar SL/TP (conservative SL-first), fee as round-trip bps

Run:
```bash
npm run strategy -- \
  --csv ./data.csv \
  --events ./events.jsonl \
  --out ./trades.csv \
  --outJson ./trades.json \
  --timecol time
```

Tuning:
- `--confirmWindowBars 12`
- `--entryWindowBars 24`
- `--rr 2.0`
- `--feeBps 10` (0.10% round-trip)
- `--allow-bos` (default CHOCH-only confirmation)
- `--timeoutBars 288` (3 days on 15m)


### Trade reasoning trace output
```bash
npm run strategy -- \
  --csv ./data.csv \
  --events ./events.jsonl \
  --out ./trades.csv \
  --outJson ./trades.json \
  --outTrace ./trade_events.jsonl \
  --timecol time
```


## Viewer: overlay trade reasoning (trade_events.jsonl)
After running strategy with `--outTrace ./trade_events.jsonl`, you can overlay that file in the viewer:
- Load CSV
- Load event_viewer.jsonl (structure overlay)
- Load trade_events.jsonl (trade reasoning overlay: SWEEP/CONFIRM/OB/ENTRY)



## Build RL state dataset from multiple labeled segments

Recommended folder layout:
```text
dataset/
  data1/
    bars.csv
    events.jsonl
  data2/
    bars.csv
    events.jsonl
  ...
```

Build per-dataset state tables and merged output:
```bash
npm run build-dataset -- \
  --datasetRoot ./dataset \
  --out ./dataset_out \
  --bars bars.csv \
  --events events.jsonl \
  --timecol time
```
- data1 : 횡보
- data2 : 하락세
- data3 : 상승세
- data4 : 위아래 휩쏘 많은
- data5~ : 랜덤

Outputs:
- `dataset_out/<dataN>/state_dataset.csv`
- `dataset_out/<dataN>/state_dataset.jsonl`
- `dataset_out/state_dataset_all.csv`
- `dataset_out/state_dataset_all.jsonl`
- `dataset_out/summary.json`

Current columns include:
- price/volume: `open,high,low,close,volume`
- returns: `ret_1, ret_4, ret_16`
- volatility: `atr_14`
- structure: `swing_bias, swing_break_tag, bars_since_swing_break`
- internal structure: `internal_bias, internal_break_tag, bars_since_internal_break`
- swing/internal distances: `dist_to_last_*_atr`
- EQ labels: `eqh_level, eql_level, bars_since_eqh/eql, dist_to_eqh/eql_atr`
- active OB summary: count, nearest bullish/bearish OB, age, distance, inside flags

All features are built sequentially using only information known at each bar.
