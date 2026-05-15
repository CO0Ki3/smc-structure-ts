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
};
