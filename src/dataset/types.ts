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
};
