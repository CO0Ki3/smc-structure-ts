export type DatasetRow = {
  dataset_id: string;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;

  ret_1: number | null;
  ret_4: number | null;
  ret_16: number | null;
  atr_14: number | null;

  swing_bias: number;
  swing_break_tag: string | null;
  bars_since_swing_break: number | null;

  internal_bias: number;
  internal_break_tag: string | null;
  bars_since_internal_break: number | null;

  last_swing_high: number | null;
  last_swing_low: number | null;
  dist_to_last_swing_high_atr: number | null;
  dist_to_last_swing_low_atr: number | null;

  last_internal_high: number | null;
  last_internal_low: number | null;
  dist_to_last_internal_high_atr: number | null;
  dist_to_last_internal_low_atr: number | null;

  eqh_level: number | null;
  bars_since_eqh: number | null;
  dist_to_eqh_atr: number | null;

  eql_level: number | null;
  bars_since_eql: number | null;
  dist_to_eql_atr: number | null;

  active_bullish_ob_count: number;
  active_bearish_ob_count: number;

  nearest_bullish_ob_high: number | null;
  nearest_bullish_ob_low: number | null;
  nearest_bullish_ob_age: number | null;
  nearest_bullish_ob_dist_mid_atr: number | null;
  inside_bullish_ob: number;

  nearest_bearish_ob_high: number | null;
  nearest_bearish_ob_low: number | null;
  nearest_bearish_ob_age: number | null;
  nearest_bearish_ob_dist_mid_atr: number | null;
  inside_bearish_ob: number;

  active_bullish_fvg_count: number;
  active_bearish_fvg_count: number;

  nearest_bullish_fvg_top: number | null;
  nearest_bullish_fvg_bottom: number | null;
  nearest_bullish_fvg_age: number | null;
  nearest_bullish_fvg_dist_mid_atr: number | null;
  inside_bullish_fvg: number;

  nearest_bearish_fvg_top: number | null;
  nearest_bearish_fvg_bottom: number | null;
  nearest_bearish_fvg_age: number | null;
  nearest_bearish_fvg_dist_mid_atr: number | null;
  inside_bearish_fvg: number;

  // PDF positive-trade context: swing & internal structure aligned in
  // the same direction (1 = both bullish or both bearish, 0 otherwise).
  structure_alignment: number;

  // PDF premium/discount: where in the active swing range the current
  // close sits, normalised 0..1 (0 = at last swing low = deepest
  // discount; 1 = at last swing high = deepest premium; 0.5 = equilibrium).
  // Null when both swing pivots are not yet known or the range is
  // degenerate.
  distance_to_premium_discount: number | null;

  // PDF chapter 9.6-7: stop-loss anchored at the LTF structural
  // invalidation point (last_internal_low for long, last_internal_high
  // for short) and take-profit at the next HTF opposing liquidity pool
  // (last_swing_high for long, last_swing_low for short). All distances
  // are ATR-normalised so the policy sees direction-agnostic
  // magnitudes. Nulls propagate when the relevant pivot or ATR is
  // missing OR when the candidate level is on the wrong side of the
  // current close (e.g., last_internal_low above close → invalid long
  // SL → null). rr_ratio = tp_distance / sl_distance; null when either
  // leg is null or sl_distance is zero.
  internal_sl_distance_long: number | null;
  swing_tp_distance_long: number | null;
  rr_ratio_long: number | null;
  internal_sl_distance_short: number | null;
  swing_tp_distance_short: number | null;
  rr_ratio_short: number | null;

  // Phase 1 / Stage C-1: HTF (4H + 1D) context. Each LTF row carries
  // the SMC state of the *last closed* HTF candle as of that ts —
  // the in-progress HTF candle is excluded to avoid lookahead. Nulls
  // appear during the HTF warmup window (first ~50 HTF bars need to
  // pass before swing pivots stabilise). All HTF distances are
  // ATR-normalised by the LTF ATR_14, matching how LTF features are
  // already scaled — keeps the policy seeing a single magnitude
  // language across timeframes.
  htf_4h_swing_bias: number;
  htf_4h_internal_bias: number;
  htf_4h_bars_since_swing_break: number | null;
  htf_4h_bars_since_internal_break: number | null;
  htf_4h_premium_discount: number | null;
  htf_4h_dist_to_swing_high_atr: number | null;
  htf_4h_dist_to_swing_low_atr: number | null;

  htf_1d_swing_bias: number;
  htf_1d_internal_bias: number;
  htf_1d_bars_since_swing_break: number | null;
  htf_1d_premium_discount: number | null;

  // Stage I (SMC reframe): liquidity-sweep signals. PDF treats every
  // entry as "structure-aligned", but the actual SMC entry trigger is
  // a sweep — price punches through a recent swing high/low (or EQH/
  // EQL) to trip retail stops and reverses back inside. Sweep + a
  // follow-up LTF CHoCH is the high-probability entry pattern.
  //
  // Reviewer-capped to 4 core features for incremental rollout (the
  // 8-feature draft included bars_since_sweep / sweep_at_eqh|eql,
  // moved to Stage I.2 if I.1 shows train-metric lift).
  //
  //   sweep_bullish_event: this bar's low < last_swing_low (or
  //     internal_low / EQL) AND this bar's close > the same level —
  //     price stabbed below sell-side liquidity and recovered. LONG
  //     opportunity signal.
  //   sweep_bearish_event: mirror condition for buy-side liquidity →
  //     SHORT opportunity.
  //   sweep_with_choch_bullish: 1 when a bullish sweep is followed by
  //     a bullish LTF CHoCH within 5 bars. The "graduated" sweep —
  //     high-probability LONG entry pattern in SMC.
  //   sweep_with_choch_bearish: mirror for SHORT.
  sweep_bullish_event: number;
  sweep_bearish_event: number;
  sweep_with_choch_bullish: number;
  sweep_with_choch_bearish: number;
};
