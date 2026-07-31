import type { TradingSession, TradeDirection, TradeStatus, ExitType, TradeRecord, TradeEvent, LevelEntry } from '../types';
import { HIGH_LOW_ZONE_TYPES } from '../types';

/**
 * Maximum plausible R-multiple value.
 * Any R value beyond this is likely due to a calculation error.
 * Values exceeding this will be clamped and flagged.
 */
export const MAX_PLAUSIBLE_R = 50;

/**
 * Clamp an R-multiple to a plausible range to prevent display issues from calculation errors.
 */
export function clampRValue(r: number | undefined): number | undefined {
  if (r === undefined) return undefined;
  if (Math.abs(r) > MAX_PLAUSIBLE_R) {
    if (import.meta.env.DEV) {
      console.warn(`Implausible R value detected: ${r.toFixed(2)}R - clamping to ±${MAX_PLAUSIBLE_R}R.`);
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
export function deriveSession(entryTime: Date | null | undefined): TradingSession {
  if (!entryTime) return 'other';
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
 * Calculate stop distance: |entryPrice - stopLoss|
 */
export function calculateStopDistance(entryPrice: number, stopLoss: number): number {
  return Math.abs(entryPrice - stopLoss);
}

/**
 * Calculate planned R:R ratio: |entryPrice - targetPrice| / |entryPrice - stopLoss|
 */
export function calculatePlannedRR(
  entryPrice: number,
  stopLoss: number,
  targetPrice?: number
): number | undefined {
  if (!targetPrice) return undefined;

  const stopDistance = calculateStopDistance(entryPrice, stopLoss);
  if (stopDistance === 0) return undefined;

  const tpDistance = Math.abs(entryPrice - targetPrice);
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
 * Clamped to MAX_PLAUSIBLE_R to prevent display issues.
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
  const signedMove = direction === 'long' ? priceDiff : -priceDiff;
  const rMultiple = signedMove / stopDistance;

  return Number((rMultiple * riskAmount).toFixed(2));
}

/**
 * Calculate P&L for a single exit using R-based method
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
 * Calculate counterfactual R for a blind entry trade.
 * Given the counterfactual entry price (where confirmation would have filled),
 * calculate what R the trade would have achieved using the same stop and target.
 *
 * For simplicity, uses target-vs-stop binary: did price reach target before breaching stop?
 * Returns the planned R if target was reached, or -1R if stop was hit.
 */

/**
 * Counterfactual R calculation result
 */
export type CounterfactualRResult = {
  r: number;
  plannedRR: number; // The planned R:R of the counterfactual entry
  status: 'determinate';
} | {
  r: null;
  plannedRR: number;
  status: 'indeterminate'; // Both target and stop were breached, can't determine order
} | {
  r: null;
  plannedRR: number | null;
  status: 'no_data'; // Insufficient data (either for planned R:R or for outcome)
};

/**
 * Calculate counterfactual R for a blind entry trade.
 * Uses counterfactual entry AND counterfactual stop (or trade's stop as fallback).
 * Risk unit = |cfEntry − cfStop| (each variant in its own risk units).
 */
export function calculateCounterfactualR(
  trade: TradeRecord
): number | null {
  const result = calculateCounterfactualRDetailed(trade);
  return result.r;
}

/**
 * Detailed counterfactual R calculation with indeterminate status.
 */
export function calculateCounterfactualRDetailed(
  trade: TradeRecord
): CounterfactualRResult {
  // Only for blind entries with counterfactual data
  if (!trade.confirmationCounterfactual) return { r: null, plannedRR: null, status: 'no_data' };
  if (trade.confirmationCounterfactual === 'never_appeared') return { r: null, plannedRR: null, status: 'no_data' };
  if (!trade.counterfactualEntryPrice) return { r: null, plannedRR: null, status: 'no_data' };
  if (!trade.targetPrice) return { r: null, plannedRR: null, status: 'no_data' };

  const cfEntry = trade.counterfactualEntryPrice;
  // Use counterfactual stop if provided, otherwise fall back to trade's stop
  const cfStop = trade.counterfactualStopPrice ?? trade.stopLoss;
  if (!cfStop) return { r: null, plannedRR: null, status: 'no_data' };

  const target = trade.targetPrice;
  const direction = trade.direction;

  // Calculate the risk unit from counterfactual entry to counterfactual stop
  const cfRiskUnit = Math.abs(cfEntry - cfStop);
  if (cfRiskUnit === 0) return { r: null, plannedRR: null, status: 'no_data' };

  // Check if the counterfactual entry would even be valid (stop not already breached)
  if (direction === 'long') {
    if (cfEntry <= cfStop) return { r: null, plannedRR: null, status: 'no_data' }; // Invalid: entry at/below stop for long
  } else {
    if (cfEntry >= cfStop) return { r: null, plannedRR: null, status: 'no_data' }; // Invalid: entry at/above stop for short
  }

  // Calculate planned R:R from counterfactual entry (in counterfactual risk units)
  const cfTargetDistance = Math.abs(target - cfEntry);
  const plannedRR = Number((cfTargetDistance / cfRiskUnit).toFixed(2));

  // Walk the timeline/exits to determine if target or stop was hit first
  // Use the actual trade's price action from the counterfactual entry point

  // Get the MFE (most favorable excursion) and MAE (most adverse excursion) from timeline
  const timeline = trade.timeline || [];
  let mfe: number | null = null;
  let mae: number | null = null;

  for (const event of timeline) {
    if (!event.price) continue;
    if (event.eventType === 'trade_high' || event.eventType === 'post_exit_high') {
      if (mfe === null || event.price > mfe) mfe = event.price;
    }
    if (event.eventType === 'trade_low' || event.eventType === 'post_exit_low') {
      if (mae === null || event.price < mae) mae = event.price;
    }
  }

  // Also check the actual exit prices
  const exits = trade.exits || [];
  for (const exit of exits) {
    if (direction === 'long') {
      if (mfe === null || exit.price > mfe) mfe = exit.price;
    } else {
      if (mae === null || exit.price < mae) mae = exit.price;
    }
  }

  // Determine outcome based on direction
  if (direction === 'long') {
    // For long: check if high reached target, or if low breached counterfactual stop
    const targetReached = mfe !== null && mfe >= target;
    const stopHit = mae !== null && mae <= cfStop;

    if (targetReached && stopHit) {
      // Both hit - can't determine order from extremes alone
      return { r: null, plannedRR, status: 'indeterminate' };
    }
    if (targetReached && !stopHit) {
      // Target reached without hitting stop
      return { r: plannedRR, plannedRR, status: 'determinate' };
    }
    if (stopHit) {
      // Stop hit
      return { r: -1, plannedRR, status: 'determinate' };
    }
    // Neither clearly hit - use actual trade outcome as proxy
    const actualR = calculateRMultiple(cfEntry, cfStop, trade.exits?.[0]?.price, direction);
    const clampedR = clampRValue(actualR);
    if (clampedR !== undefined) {
      return { r: Number(clampedR.toFixed(2)), plannedRR, status: 'determinate' };
    }
    return { r: null, plannedRR, status: 'no_data' };
  } else {
    // For short: check if low reached target, or if high breached counterfactual stop
    const targetReached = mae !== null && mae <= target;
    const stopHit = mfe !== null && mfe >= cfStop;

    if (targetReached && stopHit) {
      // Both hit - can't determine order from extremes alone
      return { r: null, plannedRR, status: 'indeterminate' };
    }
    if (targetReached && !stopHit) {
      // Target reached without hitting stop
      return { r: plannedRR, plannedRR, status: 'determinate' };
    }
    if (stopHit) {
      // Stop hit
      return { r: -1, plannedRR, status: 'determinate' };
    }
    // Neither clearly hit - use actual trade outcome as proxy
    const actualR = calculateRMultiple(cfEntry, cfStop, trade.exits?.[0]?.price, direction);
    const clampedR = clampRValue(actualR);
    if (clampedR !== undefined) {
      return { r: Number(clampedR.toFixed(2)), plannedRR, status: 'determinate' };
    }
    return { r: null, plannedRR, status: 'no_data' };
  }
}

/**
 * Calculate blind counterfactual R for a confirmed entry trade.
 * What R would you have achieved if you entered blind at the first level price?
 */
export function calculateBlindCounterfactualR(
  trade: TradeRecord
): number | null {
  // Only for confirmed entries (not blind)
  if (trade.entryConfirmation === 'blind_limit' || trade.entryConfirmation === 'blind_market') {
    return null;
  }

  // Get the first level price as the blind entry point
  const levelSequence = trade.levelSequence || [];
  if (levelSequence.length === 0) return null;
  const blindEntry = levelSequence[0].price;
  if (!blindEntry) return null;

  if (!trade.targetPrice || !trade.stopLoss) return null;

  const stop = trade.stopLoss;
  const target = trade.targetPrice;
  const direction = trade.direction;

  // Calculate the stop distance from blind entry
  const blindStopDistance = Math.abs(blindEntry - stop);
  if (blindStopDistance === 0) return null;

  // Check if the blind entry would even be valid
  if (direction === 'long') {
    if (blindEntry <= stop) return null;
  } else {
    if (blindEntry >= stop) return null;
  }

  // Calculate planned R from blind entry
  const blindTargetDistance = Math.abs(target - blindEntry);
  const plannedR = blindTargetDistance / blindStopDistance;

  // Use the same logic as counterfactualR to determine outcome
  const timeline = trade.timeline || [];
  let mfe: number | null = null;
  let mae: number | null = null;

  for (const event of timeline) {
    if (!event.price) continue;
    if (event.eventType === 'trade_high' || event.eventType === 'post_exit_high') {
      if (mfe === null || event.price > mfe) mfe = event.price;
    }
    if (event.eventType === 'trade_low' || event.eventType === 'post_exit_low') {
      if (mae === null || event.price < mae) mae = event.price;
    }
  }

  const exits = trade.exits || [];
  for (const exit of exits) {
    if (direction === 'long') {
      if (mfe === null || exit.price > mfe) mfe = exit.price;
    } else {
      if (mae === null || exit.price < mae) mae = exit.price;
    }
  }

  if (direction === 'long') {
    const targetReached = mfe !== null && mfe >= target;
    const stopHit = mae !== null && mae <= stop;

    if (targetReached && !stopHit) {
      return Number(plannedR.toFixed(2));
    }
    if (stopHit) {
      return -1;
    }
    const actualR = calculateRMultiple(blindEntry, stop, trade.exits?.[0]?.price, direction);
    return clampRValue(actualR) ?? null;
  } else {
    const targetReached = mae !== null && mae <= target;
    const stopHit = mfe !== null && mfe >= stop;

    if (targetReached && !stopHit) {
      return Number(plannedR.toFixed(2));
    }
    if (stopHit) {
      return -1;
    }
    const actualR = calculateRMultiple(blindEntry, stop, trade.exits?.[0]?.price, direction);
    return clampRValue(actualR) ?? null;
  }
}

/**
 * Check if a trade is a blind entry
 */
export function isBlindEntry(trade: TradeRecord): boolean {
  return trade.entryConfirmation === 'blind_limit' || trade.entryConfirmation === 'blind_market';
}

/**
 * Calculate hold duration in minutes
 */
export function calculateHoldDuration(entryTime: Date | null | undefined, exitTime?: Date | null): number | undefined {
  if (!entryTime || !exitTime) return undefined;
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
export function toLocalDateTimeString(date: Date | null | undefined): string {
  if (!date) return '';
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
// TIMELINE HELPERS
// ============================================

/**
 * Normalize legacy event types to new direction-neutral names.
 * - worst_price/best_price → trade_high/trade_low based on price vs entry
 * - favourable_extreme/adverse_extreme → post_exit_high/post_exit_low based on price vs exit
 *
 * This is a migration helper for existing v2 trades.
 */
export function normalizeEventTypes(trade: TradeRecord): TradeEvent[] {
  const avgExitPrice = deriveExitPrice(trade);

  return trade.timeline.map(event => {
    const price = event.price;

    // worst_price → trade_low or trade_high based on actual price vs entry
    if (event.eventType === 'worst_price') {
      if (price === null) return event; // Can't determine without price
      // worst_price was direction-dependent: for long it was low, for short it was high
      // Map based on actual price: below entry = trade_low, above entry = trade_high
      const newType = price < trade.entryPrice ? 'trade_low' : 'trade_high';
      return { ...event, eventType: newType };
    }

    // best_price → trade_high or trade_low based on actual price vs entry
    if (event.eventType === 'best_price') {
      if (price === null) return event;
      // best_price was direction-dependent: for long it was high, for short it was low
      const newType = price > trade.entryPrice ? 'trade_high' : 'trade_low';
      return { ...event, eventType: newType };
    }

    // favourable_extreme → post_exit_high or post_exit_low based on price vs exit
    if (event.eventType === 'favourable_extreme') {
      if (price === null || avgExitPrice === null) return event;
      const newType = price > avgExitPrice ? 'post_exit_high' : 'post_exit_low';
      return { ...event, eventType: newType };
    }

    // adverse_extreme → post_exit_high or post_exit_low based on price vs exit
    if (event.eventType === 'adverse_extreme') {
      if (price === null || avgExitPrice === null) return event;
      const newType = price > avgExitPrice ? 'post_exit_high' : 'post_exit_low';
      return { ...event, eventType: newType };
    }

    return event;
  });
}

/**
 * Check if a trade has legacy event types that need normalization
 */
export function hasLegacyEventTypes(trade: TradeRecord): boolean {
  const legacyTypes = ['worst_price', 'best_price', 'favourable_extreme', 'adverse_extreme'];
  return trade.timeline.some(e => legacyTypes.includes(e.eventType));
}

/**
 * Get timeline events sorted by order
 */
export function getSortedTimeline(trade: TradeRecord): TradeEvent[] {
  return [...trade.timeline].sort((a, b) => a.order - b.order);
}

/**
 * Get the first exit order from a trade (used to partition pre/post exit events)
 * Returns Infinity if no exits
 */
export function getFirstExitOrder(trade: TradeRecord): number {
  if (trade.exits.length === 0) return Infinity;

  // Look for first post-exit event (post_exit_high, post_exit_low, or leg)
  const sortedTimeline = getSortedTimeline(trade);
  const postExitTypes = ['post_exit_high', 'post_exit_low', 'leg'];

  for (const event of sortedTimeline) {
    if (postExitTypes.includes(event.eventType)) {
      return event.order;
    }
  }

  return Infinity;
}

/**
 * Check if an event is a post-exit event
 */
export function isPostExitEvent(event: TradeEvent, _trade: TradeRecord): boolean {
  const postExitTypes = ['post_exit_high', 'post_exit_low', 'leg'];
  return postExitTypes.includes(event.eventType);
}

/**
 * Get pre-exit timeline events (trade_high, trade_low, stop_moved, etc.)
 */
export function getPreExitEvents(trade: TradeRecord): TradeEvent[] {
  return getSortedTimeline(trade).filter(e => !isPostExitEvent(e, trade));
}

/**
 * Get post-exit timeline events (post_exit_high, post_exit_low, leg)
 */
export function getPostExitEvents(trade: TradeRecord): TradeEvent[] {
  return getSortedTimeline(trade).filter(e => isPostExitEvent(e, trade));
}

/**
 * Alias for getPostExitEvents - post-exit milestones for replay analysis
 */
export function getPostExitMilestones(trade: TradeRecord): TradeEvent[] {
  return getPostExitEvents(trade);
}

/**
 * Get all stop_moved events from the timeline, ordered by their position
 */
export function getStopMoves(trade: TradeRecord): TradeEvent[] {
  return getSortedTimeline(trade).filter(e => e.eventType === 'stop_moved');
}

/**
 * Get the effective stop loss at a given time.
 * Returns the most recent stop_moved price before the given time, or the original stopLoss.
 * For untimed stop_moved events, uses order position relative to timed neighbours.
 */
export function getEffectiveStopAt(trade: TradeRecord, time: Date | null | undefined): number {
  if (!time) return trade.stopLoss;

  const stopMoves = getStopMoves(trade).filter(e => e.price !== null);

  if (stopMoves.length === 0) {
    return trade.stopLoss;
  }

  const targetTime = time.getTime();
  let effectiveStop = trade.stopLoss;

  for (const move of stopMoves) {
    if (move.time) {
      const moveTime = new Date(move.time).getTime();
      if (moveTime <= targetTime) {
        effectiveStop = move.price!;
      }
    } else {
      // Untimed event - check by order position relative to exits
      // If there are exits with times, use them to determine if this stop_moved happened "before"
      const exitTime = deriveExitTime(trade);
      if (exitTime && exitTime.getTime() >= targetTime) {
        // The query time is before or at exit, so pre-exit stop moves apply
        effectiveStop = move.price!;
      }
    }
  }

  return effectiveStop;
}

/**
 * Get the favourable extreme from post-exit milestones (direction-aware)
 * For longs: post_exit_high (highest price after exit)
 * For shorts: post_exit_low (lowest price after exit)
 */
export function getFavourableExtreme(trade: TradeRecord): { price: number; r: number } | null {
  const postExitEvents = getPostExitMilestones(trade);
  // Favourable for longs = high, for shorts = low
  const targetType = trade.direction === 'long' ? 'post_exit_high' : 'post_exit_low';
  const favourableEvent = postExitEvents.find(e => e.eventType === targetType);

  if (!favourableEvent || favourableEvent.price === null) {
    return null;
  }

  const stopDistance = calculateStopDistance(trade.entryPrice, trade.stopLoss);
  if (stopDistance === 0) return null;

  const priceDiff = favourableEvent.price - trade.entryPrice;
  const signedMove = trade.direction === 'long' ? priceDiff : -priceDiff;
  const r = Number((signedMove / stopDistance).toFixed(2));

  return { price: favourableEvent.price, r };
}

/**
 * Get the adverse extreme from post-exit milestones (direction-aware)
 * For longs: post_exit_low (lowest price after exit)
 * For shorts: post_exit_high (highest price after exit)
 */
export function getAdverseExtreme(trade: TradeRecord): { price: number; r: number } | null {
  const postExitEvents = getPostExitMilestones(trade);
  // Adverse for longs = low, for shorts = high
  const targetType = trade.direction === 'long' ? 'post_exit_low' : 'post_exit_high';
  const adverseEvent = postExitEvents.find(e => e.eventType === targetType);

  if (!adverseEvent || adverseEvent.price === null) {
    return null;
  }

  const stopDistance = calculateStopDistance(trade.entryPrice, trade.stopLoss);
  if (stopDistance === 0) return null;

  const priceDiff = adverseEvent.price - trade.entryPrice;
  // For adverse, the sign is reversed (adverse for long is negative move)
  const signedMove = trade.direction === 'long' ? priceDiff : -priceDiff;
  const r = Number((signedMove / stopDistance).toFixed(2));

  return { price: adverseEvent.price, r };
}

/**
 * Get the effective stop loss at a given timeline order.
 * Returns the most recent stop_moved price before the given order, or the original stopLoss.
 */
export function getEffectiveStop(trade: TradeRecord, asOfOrder?: number): number {
  const timeline = getSortedTimeline(trade);
  const stopMoves = timeline.filter(e =>
    e.eventType === 'stop_moved' &&
    e.price !== null &&
    (asOfOrder === undefined || e.order < asOfOrder)
  );

  if (stopMoves.length === 0) {
    return trade.stopLoss;
  }

  // Return the last stop move price
  return stopMoves[stopMoves.length - 1].price!;
}

/**
 * Derive MAE (Maximum Adverse Excursion) price from pre-exit timeline events.
 * MAE = trade_low for longs, trade_high for shorts
 */
export function deriveMAE(trade: TradeRecord): number | null {
  const preExitEvents = getPreExitEvents(trade);

  // MAE for longs = trade_low (most adverse), for shorts = trade_high
  const targetType = trade.direction === 'long' ? 'trade_low' : 'trade_high';
  const maeEvent = preExitEvents.find(e => e.eventType === targetType && e.price !== null);
  if (maeEvent) {
    return maeEvent.price;
  }

  // Fallback: find the most adverse price from any event
  // For longs: lowest price; for shorts: highest price
  const pricesWithValues = preExitEvents
    .filter(e => e.price !== null)
    .map(e => e.price!);

  if (pricesWithValues.length === 0) return null;

  if (trade.direction === 'long') {
    // MAE is the lowest price (most adverse for long)
    return Math.min(...pricesWithValues);
  } else {
    // MAE is the highest price (most adverse for short)
    return Math.max(...pricesWithValues);
  }
}

/**
 * Derive MFE (Maximum Favorable Excursion) price from pre-exit timeline events.
 * MFE = trade_high for longs, trade_low for shorts
 */
export function deriveMFE(trade: TradeRecord): number | null {
  const preExitEvents = getPreExitEvents(trade);

  // MFE for longs = trade_high (most favorable), for shorts = trade_low
  const targetType = trade.direction === 'long' ? 'trade_high' : 'trade_low';
  const mfeEvent = preExitEvents.find(e => e.eventType === targetType && e.price !== null);
  if (mfeEvent) {
    return mfeEvent.price;
  }

  // Fallback: find the most favorable price from any event
  // For longs: highest price; for shorts: lowest price
  const pricesWithValues = preExitEvents
    .filter(e => e.price !== null)
    .map(e => e.price!);

  if (pricesWithValues.length === 0) return null;

  if (trade.direction === 'long') {
    // MFE is the highest price (most favorable for long)
    return Math.max(...pricesWithValues);
  } else {
    // MFE is the lowest price (most favorable for short)
    return Math.min(...pricesWithValues);
  }
}

/**
 * Derive analysis timeframes from level sequence
 */
export function deriveAnalysisTFs(trade: TradeRecord): string[] {
  const tfs = new Set<string>();
  for (const level of trade.levelSequence) {
    if (level.timeframe && level.timeframe.trim()) {
      tfs.add(level.timeframe);
    }
  }
  return Array.from(tfs);
}

/**
 * Calculate entry depth percent for a zone level.
 * Measures where the entry price sits within the zone, direction-relative:
 * - 0% = premium edge for the trade's direction (least favorable entry)
 * - 100% = full discount (most favorable entry within the zone)
 *
 * For longs: depth = (highEdge − entryPrice) / (highEdge − lowEdge) × 100
 * For shorts: depth = (entryPrice − lowEdge) / (highEdge − lowEdge) × 100
 *
 * Returns null for line levels (no priceFar) or if edges are equal.
 */
export function getEntryDepthPercent(
  trade: TradeRecord,
  level: LevelEntry
): number | null {
  // Line levels have no depth concept
  if (level.priceFar === null) {
    return null;
  }

  // Determine high and low edges (ignore near/far semantics)
  const highEdge = Math.max(level.price, level.priceFar);
  const lowEdge = Math.min(level.price, level.priceFar);
  const zoneWidth = highEdge - lowEdge;

  // Guard against zero-width zones
  if (zoneWidth === 0) {
    return null;
  }

  const entryPrice = trade.entryPrice;
  let depth: number;

  if (trade.direction === 'long') {
    // For longs: entering at the low edge is 100% depth (full discount)
    // entering at the high edge is 0% depth (premium)
    depth = ((highEdge - entryPrice) / zoneWidth) * 100;
  } else {
    // For shorts: entering at the high edge is 100% depth (full discount)
    // entering at the low edge is 0% depth (premium)
    depth = ((entryPrice - lowEdge) / zoneWidth) * 100;
  }

  // Clamp to 0-100 (entries slightly outside zone are common)
  return Math.max(0, Math.min(100, Number(depth.toFixed(1))));
}

/**
 * Check if a level type uses high/low edge semantics (symmetric range types)
 * vs near/far edge semantics (approach-dependent zones).
 */
export function isHighLowZoneType(levelType: string): boolean {
  return HIGH_LOW_ZONE_TYPES.includes(levelType as typeof HIGH_LOW_ZONE_TYPES[number]);
}

/**
 * Calculate range consumed percent for high_low zone types.
 * Measures how much of the zone's range was traversed before the turn,
 * with direction inferred from where deepest price sits relative to edges.
 *
 * - If deepest is nearer the low: consumption = (high − deepest) / (high − low) × 100
 * - If deepest is nearer the high: consumption = (deepest − low) / (high − low) × 100
 *
 * Returns null for line levels, non-high_low zones, or missing deepest price.
 */
export function getRangeConsumedPercent(level: LevelEntry): number | null {
  // Only for high_low zone types
  if (!isHighLowZoneType(level.levelType)) {
    return null;
  }

  // Need both edges and deepest price
  if (level.priceFar === null || level.deepestPrice === null || level.deepestPrice === undefined) {
    return null;
  }

  // For high_low types: price = high, priceFar = low
  const highEdge = Math.max(level.price, level.priceFar);
  const lowEdge = Math.min(level.price, level.priceFar);
  const zoneWidth = highEdge - lowEdge;

  if (zoneWidth === 0) {
    return null;
  }

  const deepest = level.deepestPrice;

  // Infer traversal direction from where deepest sits
  const distanceToLow = Math.abs(deepest - lowEdge);
  const distanceToHigh = Math.abs(deepest - highEdge);

  let consumed: number;
  if (distanceToLow <= distanceToHigh) {
    // Deepest is nearer the low — price came from high, consumed from top
    consumed = ((highEdge - deepest) / zoneWidth) * 100;
  } else {
    // Deepest is nearer the high — price came from low, consumed from bottom
    consumed = ((deepest - lowEdge) / zoneWidth) * 100;
  }

  return Math.max(0, Math.min(100, Number(consumed.toFixed(1))));
}

/**
 * Get the overshoot amount for a high_low zone where deepest went beyond an edge.
 * Returns the absolute distance beyond the edge, or null if no overshoot.
 */
export function getZoneOvershoot(level: LevelEntry): { amount: number; edge: 'high' | 'low' } | null {
  if (!isHighLowZoneType(level.levelType)) return null;
  if (level.priceFar === null || level.deepestPrice === null || level.deepestPrice === undefined) return null;

  const highEdge = Math.max(level.price, level.priceFar);
  const lowEdge = Math.min(level.price, level.priceFar);
  const deepest = level.deepestPrice;

  if (deepest > highEdge) {
    return { amount: deepest - highEdge, edge: 'high' };
  }
  if (deepest < lowEdge) {
    return { amount: lowEdge - deepest, edge: 'low' };
  }
  return null;
}

/**
 * Normalize a high_low zone level's edges to ensure price = high, priceFar = low.
 * Returns a new level object with edges swapped if necessary.
 */
export function normalizeHighLowZoneEdges(level: LevelEntry): LevelEntry {
  if (!isHighLowZoneType(level.levelType) || level.priceFar === null) {
    return level;
  }

  // If already correct (price >= priceFar), return as-is
  if (level.price >= level.priceFar) {
    return level;
  }

  // Swap edges: price should be high, priceFar should be low
  return {
    ...level,
    price: level.priceFar,
    priceFar: level.price,
  };
}

/**
 * Derive exit time from exits array
 */
export function deriveExitTime(trade: TradeRecord): Date | null {
  if (trade.exits.length === 0) return null;

  // Return the time of the last exit
  const sortedExits = [...trade.exits].sort((a, b) =>
    new Date(a.time).getTime() - new Date(b.time).getTime()
  );

  return new Date(sortedExits[sortedExits.length - 1].time);
}

/**
 * Derive weighted average exit price from exits
 */
export function deriveExitPrice(trade: TradeRecord): number | null {
  if (trade.exits.length === 0) return null;

  let totalSize = 0;
  let weightedSum = 0;

  for (const exit of trade.exits) {
    totalSize += exit.size;
    weightedSum += exit.price * exit.size;
  }

  if (totalSize === 0) return null;

  return weightedSum / totalSize;
}

/**
 * Derive trade status from exits array
 * - 'open': no exits
 * - 'partial': exits exist but don't cover full position
 * - 'closed': exits cover full position
 */
export function deriveStatus(trade: TradeRecord): TradeStatus {
  if (trade.exits.length === 0) return 'open';

  const totalExitSize = trade.exits.reduce((sum, e) => sum + e.size, 0);

  // Allow small floating point tolerance
  if (Math.abs(totalExitSize - trade.positionSize) < 0.0001) {
    return 'closed';
  }

  if (totalExitSize < trade.positionSize) {
    return 'partial';
  }

  return 'closed';
}

/**
 * Derive primary exit type from exits
 * Returns the type of the exit that closed the most size, or undefined for multiple
 */
export function deriveExitType(trade: TradeRecord): ExitType | undefined {
  if (trade.exits.length === 0) return undefined;
  if (trade.exits.length === 1) return trade.exits[0].type;

  // Multiple exits - return type of largest exit
  const sorted = [...trade.exits].sort((a, b) => b.size - a.size);
  return sorted[0].type;
}

// ============================================
// CENTRALIZED R-METRICS CALCULATION
// ============================================

/**
 * Result of centralized R-metrics calculation
 */
export interface TradeRMetrics {
  stopDistance: number;
  plannedRR: number | null;
  exitPrice: number | null;
  actualRR: number | null;
  rMultiple: number | null;
  pnl: number | null;
  maePrice: number | null;
  maeR: number | null;
  mfePrice: number | null;
  mfeR: number | null;
  holdDuration: number | null;
  status: TradeStatus;
  exitTime: Date | null;
  session: TradingSession;
  isImplausible: boolean;
}

/**
 * Centralized function to get all R-metrics for a trade.
 * Derives MAE/MFE from timeline events, exit info from exits array, etc.
 */
export function getTradeRMetrics(trade: TradeRecord): TradeRMetrics {
  const entryPrice = trade.entryPrice;
  const stopLoss = trade.stopLoss;
  const stopDistance = calculateStopDistance(entryPrice, stopLoss);

  // Derive values from exits
  const exitPrice = deriveExitPrice(trade);
  const exitTime = deriveExitTime(trade);
  const status = deriveStatus(trade);
  const session = deriveSession(trade.entryTime);

  // Calculate R metrics (convert undefined to null for interface compatibility)
  const plannedRR = calculatePlannedRR(entryPrice, stopLoss, trade.targetPrice) ?? null;
  const actualRR = calculateActualRR(entryPrice, stopLoss, exitPrice ?? undefined) ?? null;
  const rMultiple = calculateRMultiple(entryPrice, stopLoss, exitPrice ?? undefined, trade.direction) ?? null;

  // Calculate PnL
  let pnl: number | null = null;
  if (trade.riskAmount && trade.exits.length > 0) {
    pnl = calculateTotalExitsPnl(
      entryPrice,
      stopLoss,
      trade.riskAmount,
      trade.positionSize,
      trade.direction,
      trade.exits
    );
  }

  // Calculate hold duration
  const holdDuration = exitTime ? calculateHoldDuration(trade.entryTime, exitTime) ?? null : null;

  // Derive MAE/MFE from timeline
  const maePrice = deriveMAE(trade);
  const mfePrice = deriveMFE(trade);

  // Calculate MAE/MFE in R
  let maeR: number | null = null;
  let mfeR: number | null = null;
  let isImplausible = false;

  if (stopDistance > 0) {
    if (maePrice !== null) {
      const maeDistance = Math.abs(maePrice - entryPrice);
      const rawMaeR = maeDistance / stopDistance;
      if (rawMaeR > MAX_PLAUSIBLE_R) {
        isImplausible = true;
        maeR = MAX_PLAUSIBLE_R;
      } else {
        maeR = Number(rawMaeR.toFixed(2));
      }
    }

    if (mfePrice !== null) {
      const mfeDistance = Math.abs(mfePrice - entryPrice);
      const rawMfeR = mfeDistance / stopDistance;
      if (rawMfeR > MAX_PLAUSIBLE_R) {
        isImplausible = true;
        mfeR = MAX_PLAUSIBLE_R;
      } else {
        mfeR = Number(rawMfeR.toFixed(2));
      }
    }
  }

  return {
    stopDistance,
    plannedRR,
    exitPrice,
    actualRR,
    rMultiple,
    pnl,
    maePrice,
    maeR,
    mfePrice,
    mfeR,
    holdDuration,
    status,
    exitTime,
    session,
    isImplausible,
  };
}

// ============================================
// POST-EXIT TRACKING FUNCTIONS
// ============================================

/**
 * Calculate "missed R" for voluntary exits
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

  const priceDiff = postExitBestPrice - exitPrice;
  const signedMove = direction === 'long' ? priceDiff : -priceDiff;

  if (signedMove <= 0) return 0;

  const raw = signedMove / stopDistance;
  return clampRValue(Number(raw.toFixed(2)));
}

/**
 * Calculate "would have R" - the R you would have achieved if held to post-exit best price
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
  const signedMove = direction === 'long' ? priceDiff : -priceDiff;

  const raw = signedMove / stopDistance;
  return clampRValue(Number(raw.toFixed(2)));
}

/**
 * Calculate exit efficiency - what percentage of the total available move you captured
 */
export function calculateExitEfficiency(
  actualR: number | undefined,
  wouldHaveR: number | undefined
): number | undefined {
  if (actualR === undefined || wouldHaveR === undefined || wouldHaveR <= 0) {
    return undefined;
  }

  if (actualR < 0) {
    return undefined;
  }

  const efficiency = (actualR / wouldHaveR) * 100;
  return Number(efficiency.toFixed(1));
}

/**
 * Derive post-exit metrics from timeline events
 */
export function derivePostExitMetrics(
  trade: TradeRecord
): {
  missedR: number | undefined;
  wouldHaveR: number | undefined;
  exitEfficiency: number | undefined;
  postExitBestPrice: number | null;
  postExitWorstPrice: number | null;
} {
  const postExitEvents = getPostExitEvents(trade);
  const metrics = getTradeRMetrics(trade);

  // Find favourable and adverse extremes from post-exit events (direction-aware)
  // Favourable for longs = post_exit_high, for shorts = post_exit_low
  const favourableType = trade.direction === 'long' ? 'post_exit_high' : 'post_exit_low';
  const adverseType = trade.direction === 'long' ? 'post_exit_low' : 'post_exit_high';

  const favourableExtreme = postExitEvents.find(e => e.eventType === favourableType);
  const adverseExtreme = postExitEvents.find(e => e.eventType === adverseType);

  const postExitBestPrice = favourableExtreme?.price ?? null;
  const postExitWorstPrice = adverseExtreme?.price ?? null;

  const wouldHaveR = calculateWouldHaveR(
    trade.entryPrice,
    postExitBestPrice,
    metrics.stopDistance,
    trade.direction
  );

  const missedR = calculateMissedR(
    metrics.exitPrice ?? undefined,
    postExitBestPrice,
    metrics.stopDistance,
    trade.direction
  );

  const exitEfficiency = calculateExitEfficiency(metrics.rMultiple ?? undefined, wouldHaveR);

  return {
    missedR,
    wouldHaveR,
    exitEfficiency,
    postExitBestPrice,
    postExitWorstPrice,
  };
}

/**
 * Check if a post-exit review is complete.
 * For taken trades: requires both post_exit_high AND post_exit_low in timeline, postExitNotes non-empty
 * For not-taken trades: requires reachedTargetPostExit set (manual), postExitNotes non-empty
 */
export function isPostExitReviewComplete(trade: TradeRecord): boolean {
  // Notes are always required
  if (!trade.postExitNotes || trade.postExitNotes.trim() === '') {
    return false;
  }

  // For not-taken trades: need manual reachedTargetPostExit
  if (trade.tradeTaken === false) {
    return trade.reachedTargetPostExit !== null && trade.reachedTargetPostExit !== undefined;
  }

  // For taken trades: need both milestones (reachedTargetPostExit is derived)
  const postExitEvents = getPostExitEvents(trade);
  const hasPostExitHigh = postExitEvents.some(e => e.eventType === 'post_exit_high');
  const hasPostExitLow = postExitEvents.some(e => e.eventType === 'post_exit_low');

  return hasPostExitHigh && hasPostExitLow;
}

/**
 * Check if a post-exit review is partially complete
 */
export function isPostExitReviewPartial(trade: TradeRecord): boolean {
  const postExitEvents = getPostExitEvents(trade);

  const hasPostExitHigh = postExitEvents.some(e => e.eventType === 'post_exit_high');
  const hasPostExitLow = postExitEvents.some(e => e.eventType === 'post_exit_low');
  const hasNotes = trade.postExitNotes !== undefined && trade.postExitNotes.trim() !== '';

  // For not-taken trades: also check manual reachedTargetPostExit
  if (trade.tradeTaken === false) {
    const hasReachedTarget = trade.reachedTargetPostExit !== null && trade.reachedTargetPostExit !== undefined;
    const filledCount = [hasReachedTarget, hasNotes].filter(Boolean).length;
    return filledCount > 0 && filledCount < 2;
  }

  // For taken trades: check milestones and notes
  const filledCount = [hasPostExitHigh, hasPostExitLow, hasNotes].filter(Boolean).length;
  return filledCount > 0 && filledCount < 3;
}

// ============================================
// REVIEW DUE DATE CALCULATION
// ============================================

/**
 * Calculate when a post-exit review is due.
 * Due at exit + 7 flat calendar days (no weekend logic).
 */
export function getReviewDueDate(exitTime: Date | null | undefined): Date | null {
  if (!exitTime) return null;
  const REVIEW_DAYS = 7;
  const MS_IN_DAY = 24 * 60 * 60 * 1000;
  return new Date(exitTime.getTime() + REVIEW_DAYS * MS_IN_DAY);
}

/**
 * Check if a trade's post-exit review is due.
 */
export function isReviewDue(trade: TradeRecord): boolean {
  const exitTime = deriveExitTime(trade);
  if (!exitTime) return false;

  const dueDate = getReviewDueDate(exitTime);
  if (!dueDate) return false;
  return new Date() >= dueDate;
}

// ============================================
// HOLD REPLAY ANALYSIS
// ============================================

/**
 * Result of replay hold simulation
 */
export type HoldReplayOutcome =
  | { type: 'stopped'; stopLevel: number; beforeReaching: number }
  | { type: 'survived'; favourableExtremeR: number }
  | { type: 'no_sequence' };

/**
 * Replay a hypothetical hold with a given stop level against the post-exit timeline.
 */
export function replayHold(trade: TradeRecord, stopLevel: number): HoldReplayOutcome {
  const postExitEvents = getPostExitEvents(trade);

  if (postExitEvents.length === 0) {
    return { type: 'no_sequence' };
  }

  const stopDistance = calculateStopDistance(trade.entryPrice, trade.stopLoss);
  if (stopDistance === 0) {
    return { type: 'no_sequence' };
  }

  // Favourable for longs = post_exit_high, for shorts = post_exit_low
  const favourableType = trade.direction === 'long' ? 'post_exit_high' : 'post_exit_low';
  const favourableExtreme = postExitEvents.find(e => e.eventType === favourableType);
  if (!favourableExtreme || favourableExtreme.price === null) {
    return { type: 'no_sequence' };
  }

  const breachesStop = (price: number): boolean => {
    if (trade.direction === 'long') {
      return price <= stopLevel;
    } else {
      return price >= stopLevel;
    }
  };

  // Walk the sequence in order
  for (const event of postExitEvents) {
    if (event.id === favourableExtreme.id) {
      // Reached the favourable extreme - survived!
      const priceDiff = favourableExtreme.price! - trade.entryPrice;
      const signedMove = trade.direction === 'long' ? priceDiff : -priceDiff;
      const favourableR = Number((signedMove / stopDistance).toFixed(2));
      return { type: 'survived', favourableExtremeR: favourableR };
    }

    if (event.price !== null && breachesStop(event.price)) {
      // Stopped out before reaching the favourable extreme
      const priceDiff = favourableExtreme.price! - trade.entryPrice;
      const signedMove = trade.direction === 'long' ? priceDiff : -priceDiff;
      const favourableR = Number((signedMove / stopDistance).toFixed(2));
      return { type: 'stopped', stopLevel, beforeReaching: favourableR };
    }
  }

  // Default to survived if we get here
  const priceDiff = favourableExtreme.price! - trade.entryPrice;
  const signedMove = trade.direction === 'long' ? priceDiff : -priceDiff;
  const favourableR = Number((signedMove / stopDistance).toFixed(2));
  return { type: 'survived', favourableExtremeR: favourableR };
}

/**
 * Full replay analysis for a trade
 */
export interface HoldReplayAnalysis {
  hasSequence: boolean;
  originalStopOutcome: HoldReplayOutcome;
  stopMovedOutcomes: Array<{ stopLevel: number; outcome: HoldReplayOutcome }>;
  replayMissedR: number | null;
  replayExitEfficiency: number | null;
  holdSurvived: boolean;
}

/**
 * Perform full replay analysis for a trade
 */
export function getHoldReplayAnalysis(trade: TradeRecord): HoldReplayAnalysis {
  const postExitEvents = getPostExitEvents(trade);
  // Requires both post_exit_high AND post_exit_low for a valid sequence
  const hasSequence = postExitEvents.length >= 2 &&
    postExitEvents.some(e => e.eventType === 'post_exit_high') &&
    postExitEvents.some(e => e.eventType === 'post_exit_low');

  const originalStopOutcome = replayHold(trade, trade.stopLoss);

  // Replay with each stop_moved level
  const preExitEvents = getPreExitEvents(trade);
  const stopMoves = preExitEvents.filter(e => e.eventType === 'stop_moved' && e.price !== null);
  const stopMovedOutcomes = stopMoves.map(sm => ({
    stopLevel: sm.price!,
    outcome: replayHold(trade, sm.price!),
  }));

  const metrics = getTradeRMetrics(trade);

  let replayMissedR: number | null = null;
  let replayExitEfficiency: number | null = null;
  let holdSurvived = false;

  if (originalStopOutcome.type === 'survived') {
    holdSurvived = true;
    if (metrics.rMultiple !== null) {
      replayMissedR = Math.max(0, originalStopOutcome.favourableExtremeR - metrics.rMultiple);
      if (originalStopOutcome.favourableExtremeR > 0) {
        replayExitEfficiency = (metrics.rMultiple / originalStopOutcome.favourableExtremeR) * 100;
      }
    }
  } else if (originalStopOutcome.type === 'stopped') {
    holdSurvived = false;
    replayMissedR = 0;
    replayExitEfficiency = null;
  }

  return {
    hasSequence,
    originalStopOutcome,
    stopMovedOutcomes,
    replayMissedR,
    replayExitEfficiency,
    holdSurvived,
  };
}

// ============================================
// DERIVED REACHED TARGET POST-EXIT
// ============================================

/**
 * Derive whether price reached target post-exit from milestones.
 * For long trades: check if post_exit_high >= targetPrice
 * For short trades: check if post_exit_low <= targetPrice
 * Returns null if target or relevant milestone is missing.
 */
export function deriveReachedTargetPostExit(trade: TradeRecord): boolean | null {
  // Need a target price to determine if reached
  if (!trade.targetPrice) {
    return null;
  }

  const postExitEvents = getPostExitEvents(trade);

  // For longs, we need post_exit_high; for shorts, we need post_exit_low
  const relevantType = trade.direction === 'long' ? 'post_exit_high' : 'post_exit_low';
  const relevantMilestone = postExitEvents.find(e => e.eventType === relevantType);

  if (!relevantMilestone || relevantMilestone.price === null) {
    return null; // Can't determine without milestone
  }

  if (trade.direction === 'long') {
    return relevantMilestone.price >= trade.targetPrice;
  } else {
    return relevantMilestone.price <= trade.targetPrice;
  }
}

/**
 * Get the effective reachedTargetPostExit value.
 * For taken trades with milestones: derive from milestones
 * For not-taken trades or trades without milestones: use stored manual value
 */
export function getEffectiveReachedTarget(trade: TradeRecord): {
  value: boolean | null;
  source: 'derived' | 'manual' | 'legacy';
} {
  // For not-taken trades, always use manual value (they have no exits to anchor replay)
  if (trade.tradeTaken === false) {
    return {
      value: trade.reachedTargetPostExit ?? null,
      source: 'manual',
    };
  }

  // Try to derive from milestones
  const derived = deriveReachedTargetPostExit(trade);

  if (derived !== null) {
    return {
      value: derived,
      source: 'derived',
    };
  }

  // Fall back to stored value (legacy or manual)
  return {
    value: trade.reachedTargetPostExit ?? null,
    source: trade.reachedTargetPostExit !== null && trade.reachedTargetPostExit !== undefined
      ? 'legacy'
      : 'manual',
  };
}

// ============================================
// REPLAY VERDICT
// ============================================

export type ReplayVerdict =
  | { type: 'target_touched_stopped_first'; missedR: number }
  | { type: 'target_reached_hold_survives'; missedR: number }
  | { type: 'target_not_reached' }
  | { type: 'no_data' };

/**
 * Get the combined replay verdict for a trade.
 * Combines reachedTargetPostExit with hold replay analysis.
 */
export function getReplayVerdict(trade: TradeRecord): ReplayVerdict {
  const { value: reachedTarget } = getEffectiveReachedTarget(trade);

  if (reachedTarget === null) {
    return { type: 'no_data' };
  }

  if (!reachedTarget) {
    return { type: 'target_not_reached' };
  }

  // Target was reached - check if hold would have survived
  const replayAnalysis = getHoldReplayAnalysis(trade);

  if (!replayAnalysis.hasSequence) {
    // No sequence to replay, but target was reached
    // Assume hold survived since we can't prove otherwise
    return {
      type: 'target_reached_hold_survives',
      missedR: replayAnalysis.replayMissedR ?? 0,
    };
  }

  if (replayAnalysis.holdSurvived) {
    return {
      type: 'target_reached_hold_survives',
      missedR: replayAnalysis.replayMissedR ?? 0,
    };
  } else {
    // Hold would have been stopped before reaching favourable extreme
    const stopped = replayAnalysis.originalStopOutcome;
    const missedR = stopped.type === 'stopped' ? stopped.beforeReaching : 0;
    return {
      type: 'target_touched_stopped_first',
      missedR,
    };
  }
}

/**
 * Get a human-readable verdict string for display
 */
export function getReplayVerdictText(verdict: ReplayVerdict): string {
  switch (verdict.type) {
    case 'target_touched_stopped_first':
      return 'Target touched post-exit — but hold would have been stopped first (exit validated)';
    case 'target_reached_hold_survives':
      if (verdict.missedR > 0) {
        return `Target reached — hold survives (+${verdict.missedR.toFixed(1)}R missed)`;
      }
      return 'Target reached — hold survives';
    case 'target_not_reached':
      return 'Target not reached post-exit';
    case 'no_data':
      return 'Insufficient data for verdict';
  }
}
