import type { TradingSession, TradeDirection, TradeStatus, ExitType, TradeRecord, TradeEvent, LevelEntry } from '../types';

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
export function getEffectiveStopAt(trade: TradeRecord, time: Date): number {
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
 * Requires: both post_exit_high AND post_exit_low in timeline,
 * reachedTargetPostExit set, postExitNotes non-empty
 */
export function isPostExitReviewComplete(trade: TradeRecord): boolean {
  const postExitEvents = getPostExitEvents(trade);

  const hasPostExitHigh = postExitEvents.some(e => e.eventType === 'post_exit_high');
  const hasPostExitLow = postExitEvents.some(e => e.eventType === 'post_exit_low');

  if (!hasPostExitHigh || !hasPostExitLow) {
    return false;
  }

  if (trade.reachedTargetPostExit === null || trade.reachedTargetPostExit === undefined) {
    return false;
  }

  if (!trade.postExitNotes || trade.postExitNotes.trim() === '') {
    return false;
  }

  return true;
}

/**
 * Check if a post-exit review is partially complete
 */
export function isPostExitReviewPartial(trade: TradeRecord): boolean {
  const postExitEvents = getPostExitEvents(trade);

  const hasPostExitHigh = postExitEvents.some(e => e.eventType === 'post_exit_high');
  const hasPostExitLow = postExitEvents.some(e => e.eventType === 'post_exit_low');
  const hasReachedTarget = trade.reachedTargetPostExit !== null && trade.reachedTargetPostExit !== undefined;
  const hasNotes = trade.postExitNotes !== undefined && trade.postExitNotes.trim() !== '';

  const filledCount = [hasPostExitHigh, hasPostExitLow, hasReachedTarget, hasNotes].filter(Boolean).length;

  return filledCount > 0 && filledCount < 4;
}

// ============================================
// REVIEW DUE DATE CALCULATION
// ============================================

/**
 * Calculate when a post-exit review is due.
 * Due at exit + 7 flat calendar days (no weekend logic).
 */
export function getReviewDueDate(exitTime: Date): Date {
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
