import type { TradingSession, TradeDirection, TradeStatus, ExitType } from '../types';

/**
 * Derive trading session from entry time (UTC)
 * Asian: 00:00-08:00 UTC
 * London: 08:00-13:00 UTC
 * NY: 13:00-21:00 UTC
 * Overlap: 13:00-16:00 UTC (London/NY overlap)
 */
export function deriveSession(entryTime: Date): TradingSession {
  const hour = entryTime.getUTCHours();

  // Overlap takes precedence (13:00-16:00 UTC)
  if (hour >= 13 && hour < 16) {
    return 'overlap';
  }

  // Asian session: 00:00-08:00 UTC
  if (hour >= 0 && hour < 8) {
    return 'asian';
  }

  // London session: 08:00-13:00 UTC
  if (hour >= 8 && hour < 13) {
    return 'london';
  }

  // NY session: 13:00-21:00 UTC (excluding overlap which is already handled)
  if (hour >= 13 && hour < 21) {
    return 'new_york';
  }

  return 'other';
}

/**
 * Derive trade status from exit time
 */
export function deriveStatus(exitTime?: Date): TradeStatus {
  return exitTime ? 'closed' : 'open';
}

/**
 * Calculate stop distance: |entryPrice - stopLoss|
 */
export function calculateStopDistance(entryPrice: number, stopLoss: number): number {
  return Math.abs(entryPrice - stopLoss);
}

/**
 * Calculate planned R:R ratio: |entryPrice - TP1| / |entryPrice - stopLoss|
 */
export function calculatePlannedRR(
  entryPrice: number,
  stopLoss: number,
  takeProfit1?: number
): number | undefined {
  if (!takeProfit1) return undefined;

  const stopDistance = calculateStopDistance(entryPrice, stopLoss);
  if (stopDistance === 0) return undefined;

  const tpDistance = Math.abs(entryPrice - takeProfit1);
  return Number((tpDistance / stopDistance).toFixed(2));
}

/**
 * Calculate actual R:R ratio: |exitPrice - entryPrice| / |entryPrice - stopLoss|
 */
export function calculateActualRR(
  entryPrice: number,
  stopLoss: number,
  exitPrice?: number
): number | undefined {
  if (exitPrice === undefined) return undefined;

  const stopDistance = calculateStopDistance(entryPrice, stopLoss);
  if (stopDistance === 0) return undefined;

  const moveDistance = Math.abs(exitPrice - entryPrice);
  return Number((moveDistance / stopDistance).toFixed(2));
}

/**
 * Calculate R-Multiple (signed actualRR - positive for winners, negative for losers)
 */
export function calculateRMultiple(
  entryPrice: number,
  stopLoss: number,
  exitPrice: number | undefined,
  direction: TradeDirection
): number | undefined {
  if (exitPrice === undefined) return undefined;

  const stopDistance = calculateStopDistance(entryPrice, stopLoss);
  if (stopDistance === 0) return undefined;

  const priceDiff = exitPrice - entryPrice;
  // For longs: positive priceDiff = win; For shorts: negative priceDiff = win
  const signedMove = direction === 'long' ? priceDiff : -priceDiff;

  return Number((signedMove / stopDistance).toFixed(2));
}

/**
 * Calculate P&L using R-based method (instrument-agnostic)
 * Formula: ((exitPrice - entryPrice) / stopDistance) × riskAmount
 * This derives dollar P&L from the R-multiple and risk amount
 */
export function calculatePnl(
  entryPrice: number,
  exitPrice: number | undefined,
  stopLoss: number,
  riskAmount: number,
  direction: TradeDirection
): number | undefined {
  if (exitPrice === undefined) return undefined;

  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (stopDistance === 0) return undefined;

  const priceDiff = exitPrice - entryPrice;
  // For longs: positive diff = profit; For shorts: negative diff = profit
  const signedMove = direction === 'long' ? priceDiff : -priceDiff;
  const rMultiple = signedMove / stopDistance;

  return Number((rMultiple * riskAmount).toFixed(2));
}

/**
 * Calculate P&L for a single exit using R-based method
 * Formula: ((exitPrice - entryPrice) / stopDistance) × riskAmount × (exitSize / positionSize)
 */
export function calculateExitPnl(
  entryPrice: number,
  exitPrice: number,
  stopLoss: number,
  riskAmount: number,
  exitSize: number,
  positionSize: number,
  direction: TradeDirection
): number {
  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (stopDistance === 0 || positionSize === 0) return 0;

  const priceDiff = exitPrice - entryPrice;
  // For longs: positive diff = profit; For shorts: negative diff = profit
  const signedMove = direction === 'long' ? priceDiff : -priceDiff;
  const rMultiple = signedMove / stopDistance;
  const sizePortion = exitSize / positionSize;

  return Number((rMultiple * riskAmount * sizePortion).toFixed(2));
}

/**
 * Calculate total P&L from all exits using R-based method
 */
export function calculateTotalExitsPnl(
  entryPrice: number,
  stopLoss: number,
  riskAmount: number,
  positionSize: number,
  direction: TradeDirection,
  exits: Array<{ price: number; size: number }>
): number {
  if (exits.length === 0) return 0;

  let totalPnl = 0;
  for (const exit of exits) {
    totalPnl += calculateExitPnl(
      entryPrice,
      exit.price,
      stopLoss,
      riskAmount,
      exit.size,
      positionSize,
      direction
    );
  }

  return Number(totalPnl.toFixed(2));
}

/**
 * Calculate Net P&L: pnl - commissions - swap
 */
export function calculateNetPnl(
  pnl: number | undefined,
  commissions: number = 0,
  swap: number = 0
): number | undefined {
  if (pnl === undefined) return undefined;
  return Number((pnl - commissions - swap).toFixed(2));
}

/**
 * Calculate hold duration in minutes
 */
export function calculateHoldDuration(entryTime: Date, exitTime?: Date): number | undefined {
  if (!exitTime) return undefined;
  const diffMs = exitTime.getTime() - entryTime.getTime();
  return Math.round(diffMs / (1000 * 60));
}

/**
 * Format duration in minutes to human readable string
 */
export function formatDuration(minutes: number | undefined): string {
  if (minutes === undefined) return '-';

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours < 24) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Validate stop loss position relative to entry and direction
 */
export function validateStopLoss(
  entryPrice: number,
  stopLoss: number,
  direction: TradeDirection
): { valid: boolean; message?: string } {
  if (direction === 'long' && stopLoss >= entryPrice) {
    return { valid: false, message: 'Stop loss must be below entry for long trades' };
  }
  if (direction === 'short' && stopLoss <= entryPrice) {
    return { valid: false, message: 'Stop loss must be above entry for short trades' };
  }
  return { valid: true };
}

/**
 * Convert datetime-local string to Date
 */
export function parseLocalDateTime(value: string): Date | undefined {
  if (!value) return undefined;
  return new Date(value);
}

/**
 * Convert Date to datetime-local string format
 */
export function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Get current datetime as datetime-local string
 */
export function getCurrentDateTimeString(): string {
  return toLocalDateTimeString(new Date());
}

// ============================================
// MAE/MFE DERIVATION FUNCTIONS
// ============================================

/**
 * Calculate MAE distance from price level
 * maeDistance = |entryPrice - maePrice|
 */
export function calculateMaeDistance(
  entryPrice: number,
  maePrice: number | null
): number | undefined {
  if (maePrice === null) return undefined;
  return Math.abs(entryPrice - maePrice);
}

/**
 * Calculate MFE distance from price level
 * mfeDistance = |entryPrice - mfePrice|
 */
export function calculateMfeDistance(
  entryPrice: number,
  mfePrice: number | null
): number | undefined {
  if (mfePrice === null) return undefined;
  return Math.abs(entryPrice - mfePrice);
}

/**
 * Calculate MAE expressed in R-multiples
 * maeR = maeDistance / stopDistance
 */
export function calculateMaeR(
  entryPrice: number,
  maePrice: number | null,
  stopDistance: number | undefined
): number | undefined {
  if (maePrice === null || !stopDistance || stopDistance === 0) return undefined;
  const maeDistance = calculateMaeDistance(entryPrice, maePrice);
  if (maeDistance === undefined) return undefined;
  return Number((maeDistance / stopDistance).toFixed(2));
}

/**
 * Calculate MFE expressed in R-multiples
 * mfeR = mfeDistance / stopDistance
 */
export function calculateMfeR(
  entryPrice: number,
  mfePrice: number | null,
  stopDistance: number | undefined
): number | undefined {
  if (mfePrice === null || !stopDistance || stopDistance === 0) return undefined;
  const mfeDistance = calculateMfeDistance(entryPrice, mfePrice);
  if (mfeDistance === undefined) return undefined;
  return Number((mfeDistance / stopDistance).toFixed(2));
}

/**
 * Derive all MAE/MFE values from trade data
 * Returns distance values and R-multiples from price levels
 */
export function deriveMaeMetrics(
  entryPrice: number,
  maePrice: number | null,
  stopDistance: number | undefined
): { maeDistance: number | undefined; maeR: number | undefined } {
  const maeDistance = calculateMaeDistance(entryPrice, maePrice);
  const maeR = calculateMaeR(entryPrice, maePrice, stopDistance);
  return { maeDistance, maeR };
}

/**
 * Derive all MFE values from trade data
 * Returns distance values and R-multiples from price levels
 */
export function deriveMfeMetrics(
  entryPrice: number,
  mfePrice: number | null,
  stopDistance: number | undefined
): { mfeDistance: number | undefined; mfeR: number | undefined } {
  const mfeDistance = calculateMfeDistance(entryPrice, mfePrice);
  const mfeR = calculateMfeR(entryPrice, mfePrice, stopDistance);
  return { mfeDistance, mfeR };
}

// ============================================
// POST-EXIT TRACKING FUNCTIONS
// ============================================

/**
 * Calculate "missed R" for voluntary exits - how much additional R you would have made if held to post-exit best price
 * missedR = |postExitBestPrice - exitPrice| / stopDistance
 *
 * NOTE: This is the original behavior, kept for voluntary exits (tp_hit, manual_close, trail_stop_hit, be_stop_hit, time_exit)
 */
export function calculateMissedR(
  exitPrice: number | undefined,
  postExitBestPrice: number | null,
  stopDistance: number | undefined,
  direction: TradeDirection
): number | undefined {
  if (exitPrice === undefined || postExitBestPrice === null || !stopDistance || stopDistance === 0) {
    return undefined;
  }

  // For longs: best price is higher than exit, so positive missed R
  // For shorts: best price is lower than exit, so positive missed R
  const priceDiff = postExitBestPrice - exitPrice;
  const signedMove = direction === 'long' ? priceDiff : -priceDiff;

  // Only count as "missed" if it went further in your favor
  if (signedMove <= 0) return 0;

  return Number((signedMove / stopDistance).toFixed(2));
}

/**
 * Calculate post-stop move R for stopouts (sl_hit) - how far price moved in trader's favor after being stopped out
 * This is measured from entry price, NOT from exit price (since stop was a full loss)
 * postStopMoveR = |postExitBestPrice - entryPrice| / stopDistance (if in trader's favor)
 *
 * This metric answers: "After I got stopped, did price move in my direction?"
 * A positive value indicates the thesis may have been correct but stop placement was the issue.
 */
export function calculatePostStopMoveR(
  entryPrice: number,
  postExitBestPrice: number | null,
  stopDistance: number | undefined,
  direction: TradeDirection
): number | undefined {
  if (postExitBestPrice === null || !stopDistance || stopDistance === 0) {
    return undefined;
  }

  const priceDiff = postExitBestPrice - entryPrice;
  // For longs: positive priceDiff = move in trader's favor
  // For shorts: negative priceDiff = move in trader's favor
  const signedMove = direction === 'long' ? priceDiff : -priceDiff;

  // Only count if it moved in trader's favor after the stop
  if (signedMove <= 0) return 0;

  return Number((signedMove / stopDistance).toFixed(2));
}

/**
 * Calculate "would have R" - the R you would have achieved if held to post-exit best price
 * wouldHaveR = |postExitBestPrice - entryPrice| / stopDistance
 */
export function calculateWouldHaveR(
  entryPrice: number,
  postExitBestPrice: number | null,
  stopDistance: number | undefined,
  direction: TradeDirection
): number | undefined {
  if (postExitBestPrice === null || !stopDistance || stopDistance === 0) {
    return undefined;
  }

  const priceDiff = postExitBestPrice - entryPrice;
  // For longs: positive priceDiff = win; For shorts: negative priceDiff = win
  const signedMove = direction === 'long' ? priceDiff : -priceDiff;

  return Number((signedMove / stopDistance).toFixed(2));
}

/**
 * Calculate exit efficiency - what percentage of the total available move you captured
 * exitEfficiency = actualR / wouldHaveR × 100
 * 100% = perfect exit (you captured all available R)
 */
export function calculateExitEfficiency(
  actualR: number | undefined,
  wouldHaveR: number | undefined
): number | undefined {
  if (actualR === undefined || wouldHaveR === undefined || wouldHaveR <= 0) {
    return undefined;
  }

  // If actualR is negative (losing trade), efficiency doesn't make sense
  if (actualR < 0) {
    return undefined;
  }

  const efficiency = (actualR / wouldHaveR) * 100;
  return Number(efficiency.toFixed(1));
}

/**
 * Derive all post-exit metrics from trade data
 *
 * For stopouts (sl_hit): missedR uses postStopMoveR - just the post-exit move in trader's favor from entry
 * For voluntary exits: missedR uses the traditional calculation - move from exit price to best price
 */
export function derivePostExitMetrics(
  entryPrice: number,
  exitPrice: number | undefined,
  postExitBestPrice: number | null,
  stopDistance: number | undefined,
  direction: TradeDirection,
  actualR: number | undefined,
  exitType?: ExitType
): {
  missedR: number | undefined;
  wouldHaveR: number | undefined;
  exitEfficiency: number | undefined;
  isStopout: boolean;
  postStopMoveR: number | undefined;
} {
  const wouldHaveR = calculateWouldHaveR(entryPrice, postExitBestPrice, stopDistance, direction);
  const exitEfficiency = calculateExitEfficiency(actualR, wouldHaveR);

  // Check if this is a stopout (sl_hit)
  const isStopout = exitType === 'sl_hit';

  // Calculate both metrics - let the caller decide which to display
  const postStopMoveR = calculatePostStopMoveR(entryPrice, postExitBestPrice, stopDistance, direction);
  const voluntaryMissedR = calculateMissedR(exitPrice, postExitBestPrice, stopDistance, direction);

  // For stopouts: use postStopMoveR (move from entry after stop)
  // For voluntary exits: use traditional missedR (additional move from exit price)
  const missedR = isStopout ? postStopMoveR : voluntaryMissedR;

  return { missedR, wouldHaveR, exitEfficiency, isStopout, postStopMoveR };
}
