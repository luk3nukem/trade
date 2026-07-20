import type { TradingSession, TradeDirection, TradeStatus, ExitType, AssetClass, TradeRecord } from '../types';

/**
 * Maximum plausible R-multiple value.
 * Any R value beyond this is likely due to a calculation error (e.g., using adjusted stop near entry).
 * Values exceeding this will be clamped and flagged.
 */
export const MAX_PLAUSIBLE_R = 50;

/**
 * Clamp an R-multiple to a plausible range to prevent display issues from calculation errors.
 * If the value is implausible, log a warning in dev mode.
 */
export function clampRValue(r: number | undefined): number | undefined {
  if (r === undefined) return undefined;
  if (Math.abs(r) > MAX_PLAUSIBLE_R) {
    if (import.meta.env.DEV) {
      console.warn(`Implausible R value detected: ${r.toFixed(2)}R - clamping to ±${MAX_PLAUSIBLE_R}R. Check stop distance calculation.`);
    }
    return r > 0 ? MAX_PLAUSIBLE_R : -MAX_PLAUSIBLE_R;
  }
  return r;
}

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
 * Clamped to MAX_PLAUSIBLE_R to prevent display issues from calculation errors.
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
  const raw = signedMove / stopDistance;

  return clampRValue(Number(raw.toFixed(2)));
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
 * Clamped to MAX_PLAUSIBLE_R to prevent display issues from calculation errors.
 */
export function calculateMaeR(
  entryPrice: number,
  maePrice: number | null,
  stopDistance: number | undefined
): number | undefined {
  if (maePrice === null || !stopDistance || stopDistance === 0) return undefined;
  const maeDistance = calculateMaeDistance(entryPrice, maePrice);
  if (maeDistance === undefined) return undefined;
  const raw = maeDistance / stopDistance;
  return clampRValue(Number(raw.toFixed(2)));
}

/**
 * Calculate MFE expressed in R-multiples
 * mfeR = mfeDistance / stopDistance
 * Clamped to MAX_PLAUSIBLE_R to prevent display issues from calculation errors.
 */
export function calculateMfeR(
  entryPrice: number,
  mfePrice: number | null,
  stopDistance: number | undefined
): number | undefined {
  if (mfePrice === null || !stopDistance || stopDistance === 0) return undefined;
  const mfeDistance = calculateMfeDistance(entryPrice, mfePrice);
  if (mfeDistance === undefined) return undefined;
  const raw = mfeDistance / stopDistance;
  return clampRValue(Number(raw.toFixed(2)));
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
// FIRST-TOUCH REACTION ANALYSIS FUNCTIONS
// ============================================

/**
 * Calculate first-touch adverse R - the initial heat taken before the first favourable reaction
 * firstTouchAdverseR = |entryPrice - firstTouchWorstPrice| / stopDistance
 * Clamped to MAX_PLAUSIBLE_R to prevent display issues.
 *
 * This measures how far price moves against you BEFORE the initial reaction in your favour.
 * Lower values indicate cleaner entries where price immediately moves in your direction.
 */
export function calculateFirstTouchAdverseR(
  entryPrice: number,
  firstTouchWorstPrice: number | null,
  stopDistance: number | undefined
): number | undefined {
  if (firstTouchWorstPrice === null || !stopDistance || stopDistance === 0) {
    return undefined;
  }
  const adverseDistance = Math.abs(entryPrice - firstTouchWorstPrice);
  const raw = adverseDistance / stopDistance;
  return clampRValue(Number(raw.toFixed(2)));
}

/**
 * Calculate reaction R - the R-multiple of the initial reaction relative to the first-touch extreme
 * reactionR = |mfePrice - entryPrice| / |entryPrice - firstTouchWorstPrice|
 * Clamped to MAX_PLAUSIBLE_R to prevent display issues.
 *
 * This is the "what could have been" number - if you had placed your stop just beyond
 * the first-touch extreme, what R-multiple would the MFE have delivered?
 *
 * Higher values indicate better risk/reward relative to the actual price action at your entry level.
 */
export function calculateReactionR(
  entryPrice: number,
  mfePrice: number | null,
  firstTouchWorstPrice: number | null
): number | undefined {
  if (mfePrice === null || firstTouchWorstPrice === null) {
    return undefined;
  }

  const firstTouchAdverseDistance = Math.abs(entryPrice - firstTouchWorstPrice);
  if (firstTouchAdverseDistance === 0) {
    return undefined; // Avoid division by zero
  }

  const mfeDistance = Math.abs(mfePrice - entryPrice);
  const raw = mfeDistance / firstTouchAdverseDistance;
  return clampRValue(Number(raw.toFixed(2)));
}

/**
 * Derive all first-touch reaction metrics
 */
export function deriveFirstTouchMetrics(
  entryPrice: number,
  mfePrice: number | null,
  firstTouchWorstPrice: number | null,
  stopDistance: number | undefined
): {
  firstTouchAdverseR: number | undefined;
  reactionR: number | undefined;
  firstTouchAdversePercent: number | undefined;
} {
  const firstTouchAdverseR = calculateFirstTouchAdverseR(entryPrice, firstTouchWorstPrice, stopDistance);
  const reactionR = calculateReactionR(entryPrice, mfePrice, firstTouchWorstPrice);

  // Also calculate as percentage of stop distance for intuitive display
  const firstTouchAdversePercent = firstTouchAdverseR !== undefined
    ? Number((firstTouchAdverseR * 100).toFixed(1))
    : undefined;

  return { firstTouchAdverseR, reactionR, firstTouchAdversePercent };
}

// ============================================
// POST-EXIT TRACKING FUNCTIONS
// ============================================

/**
 * Calculate "missed R" for voluntary exits - how much additional R you would have made if held to post-exit best price
 * missedR = |postExitBestPrice - exitPrice| / stopDistance
 * Clamped to MAX_PLAUSIBLE_R to prevent display issues.
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

  const raw = signedMove / stopDistance;
  return clampRValue(Number(raw.toFixed(2)));
}

/**
 * Calculate post-stop move R for stopouts (sl_hit) - how far price moved in trader's favor after being stopped out
 * This is measured from entry price, NOT from exit price (since stop was a full loss)
 * postStopMoveR = |postExitBestPrice - entryPrice| / stopDistance (if in trader's favor)
 * Clamped to MAX_PLAUSIBLE_R to prevent display issues.
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

  const raw = signedMove / stopDistance;
  return clampRValue(Number(raw.toFixed(2)));
}

/**
 * Calculate "would have R" - the R you would have achieved if held to post-exit best price
 * wouldHaveR = |postExitBestPrice - entryPrice| / stopDistance
 * Clamped to MAX_PLAUSIBLE_R to prevent display issues.
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

  const raw = signedMove / stopDistance;
  return clampRValue(Number(raw.toFixed(2)));
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

/**
 * Check if a post-exit review is complete.
 * A review is only complete when ALL four fields have values:
 * - postExitBestPrice is not null
 * - postExitWorstPrice is not null
 * - reachedTargetPostExit is not null (must be explicitly yes or no)
 * - postExitNotes is not empty string
 */
export function isPostExitReviewComplete(
  postExitBestPrice: number | null | undefined,
  postExitWorstPrice: number | null | undefined,
  reachedTargetPostExit: boolean | null | undefined,
  postExitNotes: string | undefined
): boolean {
  // postExitBestPrice must be a valid number (not null, not undefined, not NaN)
  if (postExitBestPrice === null || postExitBestPrice === undefined || isNaN(postExitBestPrice)) {
    return false;
  }

  // postExitWorstPrice must be a valid number (not null, not undefined, not NaN)
  if (postExitWorstPrice === null || postExitWorstPrice === undefined || isNaN(postExitWorstPrice)) {
    return false;
  }

  // reachedTargetPostExit must be explicitly true or false (not null, not undefined)
  if (reachedTargetPostExit === null || reachedTargetPostExit === undefined) {
    return false;
  }

  // postExitNotes must be a non-empty string
  if (!postExitNotes || postExitNotes.trim() === '') {
    return false;
  }

  return true;
}

/**
 * Check if a post-exit review is partially complete (some fields filled but not all)
 */
export function isPostExitReviewPartial(
  postExitBestPrice: number | null | undefined,
  postExitWorstPrice: number | null | undefined,
  reachedTargetPostExit: boolean | null | undefined,
  postExitNotes: string | undefined
): boolean {
  const hasBestPrice = postExitBestPrice !== null && postExitBestPrice !== undefined && !isNaN(postExitBestPrice);
  const hasWorstPrice = postExitWorstPrice !== null && postExitWorstPrice !== undefined && !isNaN(postExitWorstPrice);
  const hasReachedTarget = reachedTargetPostExit !== null && reachedTargetPostExit !== undefined;
  const hasNotes = postExitNotes !== undefined && postExitNotes.trim() !== '';

  const filledCount = [hasBestPrice, hasWorstPrice, hasReachedTarget, hasNotes].filter(Boolean).length;

  // Partial means at least one field but not all four
  return filledCount > 0 && filledCount < 4;
}

// ============================================
// REVIEW DUE DATE CALCULATION
// ============================================

/**
 * Calculate when a post-exit review is due, accounting for market hours.
 *
 * - Crypto: 24/7 market, so review due = exitTime + 72 hours flat
 * - All other asset classes (forex, commodities, indices, equities):
 *   Review due = exitTime + 72 hours of market time, skipping Saturdays and Sundays entirely.
 *
 * This means weekday hours count normally, but Saturday and Sunday are skipped.
 * Example: Trade closed Friday 09:00 → due Wednesday 09:00
 *   - Fri 09:00→Sat 00:00 = 15 weekday hours
 *   - Sat/Sun = skipped
 *   - Mon 00:00→Tue 00:00 = 24 weekday hours (total: 39)
 *   - Tue 00:00→Wed 00:00 = 24 weekday hours (total: 63)
 *   - Wed 00:00→Wed 09:00 = 9 weekday hours (total: 72)
 */
export function getReviewDueDate(exitTime: Date, assetClass: AssetClass): Date {
  const REVIEW_HOURS = 72;
  const MS_IN_HOUR = 60 * 60 * 1000;

  // Crypto is 24/7, no adjustment needed
  if (assetClass === 'crypto') {
    return new Date(exitTime.getTime() + REVIEW_HOURS * MS_IN_HOUR);
  }

  // For all other asset classes, skip weekends entirely
  let hoursRemaining = REVIEW_HOURS;
  let current = new Date(exitTime);

  while (hoursRemaining > 0) {
    const dayOfWeek = current.getDay(); // 0 = Sunday, 6 = Saturday

    // If we're on a weekend, skip to Monday (keep same time of day)
    if (dayOfWeek === 0) {
      // Sunday → skip to Monday
      current.setDate(current.getDate() + 1);
      continue;
    }
    if (dayOfWeek === 6) {
      // Saturday → skip to Monday
      current.setDate(current.getDate() + 2);
      continue;
    }

    // We're on a weekday (Mon=1, Tue=2, Wed=3, Thu=4, Fri=5)
    // Calculate hours until midnight (start of next day)
    const startOfNextDay = new Date(current);
    startOfNextDay.setDate(startOfNextDay.getDate() + 1);
    startOfNextDay.setHours(0, 0, 0, 0);

    const msUntilMidnight = startOfNextDay.getTime() - current.getTime();
    const hoursUntilMidnight = msUntilMidnight / MS_IN_HOUR;

    if (hoursRemaining <= hoursUntilMidnight) {
      // We'll finish within this day
      current = new Date(current.getTime() + hoursRemaining * MS_IN_HOUR);
      hoursRemaining = 0;
    } else {
      // Move to start of next day, subtract the hours we used
      current = startOfNextDay;
      hoursRemaining -= hoursUntilMidnight;
    }
  }

  return current;
}

/**
 * Check if a trade's post-exit review is due.
 * Uses market-hours-aware calculation based on asset class.
 */
export function isReviewDue(exitTime: Date, assetClass: AssetClass): boolean {
  const dueDate = getReviewDueDate(exitTime, assetClass);
  return new Date() >= dueDate;
}

// ============================================
// CENTRALIZED R-METRICS CALCULATION
// ============================================

/**
 * Result of centralized R-metrics calculation
 */
export interface TradeRMetrics {
  maeR: number;
  mfeR: number;
  stopDistance: number;
  isImplausible: boolean; // True if raw values exceeded MAX_PLAUSIBLE_R
}

/**
 * Centralized function to get properly calculated R-metrics for a trade.
 *
 * CRITICAL: This function ALWAYS uses the original stop distance (|entry - originalStopLoss|)
 * to calculate R-multiples. This ensures consistent R values even when stops are adjusted.
 *
 * Use this instead of reading trade.mfeR/maeR directly, as stored values may have been
 * calculated incorrectly if the stop was adjusted before the trade was saved.
 *
 * @param trade - The trade record to calculate metrics for
 * @returns Recalculated R-metrics, or null if trade lacks required data
 */
export function getTradeRMetrics(trade: TradeRecord): TradeRMetrics | null {
  const entryPrice = trade.entryPrice;
  const mfePrice = trade.mfePrice;
  const maePrice = trade.maePrice;

  // Use original stop loss if available, otherwise fall back to current stop
  const stopLossForCalc = trade.originalStopLoss ?? trade.stopLoss;
  const stopDistance = Math.abs(entryPrice - stopLossForCalc);

  // Can't calculate R without stop distance
  if (stopDistance === 0) {
    return null;
  }

  // Calculate MFE R from price
  let mfeR = 0;
  let mfeImplausible = false;
  if (mfePrice !== null) {
    const mfeDistance = Math.abs(mfePrice - entryPrice);
    const rawMfeR = mfeDistance / stopDistance;
    if (rawMfeR > MAX_PLAUSIBLE_R) {
      mfeImplausible = true;
      mfeR = MAX_PLAUSIBLE_R;
    } else {
      mfeR = rawMfeR;
    }
  }

  // Calculate MAE R from price
  let maeR = 0;
  let maeImplausible = false;
  if (maePrice !== null) {
    const maeDistance = Math.abs(maePrice - entryPrice);
    const rawMaeR = maeDistance / stopDistance;
    if (rawMaeR > MAX_PLAUSIBLE_R) {
      maeImplausible = true;
      maeR = MAX_PLAUSIBLE_R;
    } else {
      maeR = rawMaeR;
    }
  }

  return {
    maeR: Number(maeR.toFixed(2)),
    mfeR: Number(mfeR.toFixed(2)),
    stopDistance,
    isImplausible: mfeImplausible || maeImplausible,
  };
}
