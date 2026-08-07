import type { TradeRecord } from '../types';
import { ZONE_LEVEL_TYPES } from '../types';
import {
  deriveExitTime,
  deriveStatus,
  calculateStopDistance,
  calculateRMultiple,
  getReviewDueDate,
  getStopMoves,
} from './tradeCalculations';

/**
 * Audit finding severity levels
 */
export type AuditSeverity = 'error' | 'warning' | 'incomplete';

/**
 * Audit finding result
 */
export interface AuditFinding {
  severity: AuditSeverity;
  field: string;
  message: string;
}

/**
 * Summary of audit findings for display
 */
export interface AuditSummary {
  trade: TradeRecord;
  tradeId: string;
  pair: string;
  findings: AuditFinding[];
  errorCount: number;
  warningCount: number;
  incompleteCount: number;
  topFinding: string | null;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a level type is a zone (has two edges) vs a line (single price)
 */
function isZoneLevel(levelType: string): boolean {
  return ZONE_LEVEL_TYPES.includes(levelType as typeof ZONE_LEVEL_TYPES[number]);
}

/**
 * Get a timestamp from a Date or string
 */
function getTimestamp(time: Date | string | null | undefined): number | null {
  if (!time) return null;
  const ts = time instanceof Date ? time.getTime() : new Date(time).getTime();
  return isNaN(ts) ? null : ts;
}

/**
 * Normalize timeframe pattern: ^(M\d+|H\d+|D\d+|W\d+|MN|MTF)$
 */
const VALID_TIMEFRAME_PATTERN = /^(M\d+|H\d+|D\d+|W\d+|MN|MTF)$/;

/**
 * Check if a timeframe matches the normalized pattern
 */
function isValidTimeframe(tf: string): boolean {
  if (!tf || tf.trim() === '') return true; // Empty is allowed
  return VALID_TIMEFRAME_PATTERN.test(tf.trim());
}

/**
 * Get the final exit time from a trade
 */
function getFinalExitTime(trade: TradeRecord): number | null {
  if (trade.exits.length === 0) return null;
  const times = trade.exits
    .map(e => getTimestamp(e.time))
    .filter((t): t is number => t !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

// ============================================
// MAIN AUDIT FUNCTION
// ============================================

/**
 * Audit a single trade and return all findings.
 * Pure function - no side effects, no UI.
 */
export function auditTrade(trade: TradeRecord): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const entryTimestamp = getTimestamp(trade.entryTime);
  const finalExitTime = getFinalExitTime(trade);
  const status = deriveStatus(trade);
  const isClosed = status === 'closed';
  const stopDistance = calculateStopDistance(trade.entryPrice, trade.stopLoss);

  // ============================================
  // TEMPORAL CHECKS (severity: error) - Checks 1-5
  // ============================================

  // Check 1: Any exit time < entryTime
  if (entryTimestamp) {
    for (let i = 0; i < trade.exits.length; i++) {
      const exit = trade.exits[i];
      const exitTs = getTimestamp(exit.time);
      if (exitTs !== null && exitTs < entryTimestamp) {
        findings.push({
          severity: 'error',
          field: `exits[${i}].time`,
          message: `Exit ${i + 1} time is before entry time`,
        });
      }
    }
  }

  // Check 2: Exits not in chronological order
  if (trade.exits.length > 1) {
    const exitTimes = trade.exits.map(e => getTimestamp(e.time));
    for (let i = 1; i < exitTimes.length; i++) {
      const prev = exitTimes[i - 1];
      const curr = exitTimes[i];
      if (prev !== null && curr !== null && curr < prev) {
        findings.push({
          severity: 'error',
          field: `exits[${i}].time`,
          message: `Exit ${i + 1} is out of chronological order (before exit ${i})`,
        });
      }
    }
  }

  // ============================================
  // TEMPORAL PHASE CHECKS (B3/B4/B5)
  // ============================================
  // Phase-locked event types:
  //   Pre-exit-only (flag if after final exit): trade_high, trade_low, stop_moved
  //   Post-exit-only (flag if before final exit): post_exit_high, post_exit_low
  // Phase-neutral (valid any time >= entryTime, never flagged by phase):
  //   leg, and ALL contextual types (spike_up/down, dump, pump, stall_consolidation,
  //   reversal, news_reaction, session_open_move, retest, liquidity_sweep, plus any custom type)
  // The ">30 days after final exit" outlier check applies to ALL types (date-typo catch).

  const preExitOnlyTypes = ['trade_high', 'trade_low', 'stop_moved'];
  const postExitOnlyTypes = ['post_exit_high', 'post_exit_low'];
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < trade.timeline.length; i++) {
    const event = trade.timeline[i];
    const eventTs = getTimestamp(event.time);
    if (eventTs === null) continue;

    const isPreExitOnly = preExitOnlyTypes.includes(event.eventType);
    const isPostExitOnly = postExitOnlyTypes.includes(event.eventType);

    // Check 3: All timed events must be >= entryTime
    if (entryTimestamp && eventTs < entryTimestamp) {
      findings.push({
        severity: 'error',
        field: `timeline[${i}].time`,
        message: `Timeline event "${event.eventType}" is timed before entry`,
      });
    }

    // Check 4: Pre-exit-only events flagged if after final exit
    if (isPreExitOnly && finalExitTime !== null && eventTs > finalExitTime) {
      findings.push({
        severity: 'error',
        field: `timeline[${i}].time`,
        message: `Pre-exit event "${event.eventType}" is timed after final exit`,
      });
    }

    // Check 5: Post-exit-only events flagged if before final exit
    if (isPostExitOnly && finalExitTime !== null && eventTs < finalExitTime) {
      findings.push({
        severity: 'error',
        field: `timeline[${i}].time`,
        message: `Post-exit event "${event.eventType}" is timed before final exit`,
      });
    }

    // Check 6: Date outlier check - any event >30 days after final exit is likely a typo
    if (finalExitTime !== null && eventTs > finalExitTime + THIRTY_DAYS_MS) {
      findings.push({
        severity: 'error',
        field: `timeline[${i}].time`,
        message: `Timeline event "${event.eventType}" is more than 30 days after exit (possible typo)`,
      });
    }
  }

  // ============================================
  // PRICE PLAUSIBILITY CHECKS (severity: error) - Checks 6-9
  // ============================================

  // Check 6: Any price ≤ 0 anywhere
  // Check timeline prices
  for (let i = 0; i < trade.timeline.length; i++) {
    const event = trade.timeline[i];
    if (event.price !== null && event.price <= 0) {
      findings.push({
        severity: 'error',
        field: `timeline[${i}].price`,
        message: `Timeline event "${event.eventType}" has non-positive price: ${event.price}`,
      });
    }
  }

  // Check level prices
  for (let i = 0; i < trade.levelSequence.length; i++) {
    const level = trade.levelSequence[i];
    if (level.price <= 0) {
      findings.push({
        severity: 'error',
        field: `levelSequence[${i}].price`,
        message: `Level ${i + 1} has non-positive price: ${level.price}`,
      });
    }
    if (level.priceFar !== null && level.priceFar <= 0) {
      findings.push({
        severity: 'error',
        field: `levelSequence[${i}].priceFar`,
        message: `Level ${i + 1} has non-positive far edge price: ${level.priceFar}`,
      });
    }
    if (level.deepestPrice !== null && level.deepestPrice !== undefined && level.deepestPrice <= 0) {
      findings.push({
        severity: 'error',
        field: `levelSequence[${i}].deepestPrice`,
        message: `Level ${i + 1} has non-positive deepest price: ${level.deepestPrice}`,
      });
    }
    if (level.turnPrice !== null && level.turnPrice !== undefined && level.turnPrice <= 0) {
      findings.push({
        severity: 'error',
        field: `levelSequence[${i}].turnPrice`,
        message: `Level ${i + 1} has non-positive turn price: ${level.turnPrice}`,
      });
    }
  }

  // Check counterfactual prices
  if (trade.counterfactualEntryPrice !== null && trade.counterfactualEntryPrice !== undefined && trade.counterfactualEntryPrice <= 0) {
    findings.push({
      severity: 'error',
      field: 'counterfactualEntryPrice',
      message: `Counterfactual entry price is non-positive: ${trade.counterfactualEntryPrice}`,
    });
  }
  if (trade.counterfactualStopPrice !== null && trade.counterfactualStopPrice !== undefined && trade.counterfactualStopPrice <= 0) {
    findings.push({
      severity: 'error',
      field: 'counterfactualStopPrice',
      message: `Counterfactual stop price is non-positive: ${trade.counterfactualStopPrice}`,
    });
  }

  // Check 7: Magnitude check - nested prices vs entryPrice, same >50% rule
  const entryPrice = trade.entryPrice;
  const checkMagnitude = (price: number, fieldPath: string, description: string) => {
    if (price > 0 && entryPrice > 0) {
      const deviation = Math.abs(price - entryPrice) / entryPrice;
      if (deviation > 0.5) {
        findings.push({
          severity: 'error',
          field: fieldPath,
          message: `${description} (${price}) differs from entry (${entryPrice}) by ${(deviation * 100).toFixed(0)}% — possible magnitude typo`,
        });
      }
    }
  };

  // Check level prices for magnitude
  for (let i = 0; i < trade.levelSequence.length; i++) {
    const level = trade.levelSequence[i];
    checkMagnitude(level.price, `levelSequence[${i}].price`, `Level ${i + 1} price`);
    if (level.priceFar !== null) {
      checkMagnitude(level.priceFar, `levelSequence[${i}].priceFar`, `Level ${i + 1} far edge`);
    }
    if (level.deepestPrice !== null && level.deepestPrice !== undefined) {
      checkMagnitude(level.deepestPrice, `levelSequence[${i}].deepestPrice`, `Level ${i + 1} deepest`);
    }
    if (level.turnPrice !== null && level.turnPrice !== undefined) {
      checkMagnitude(level.turnPrice, `levelSequence[${i}].turnPrice`, `Level ${i + 1} turn price`);
    }
  }

  // Check timeline event prices for magnitude
  for (let i = 0; i < trade.timeline.length; i++) {
    const event = trade.timeline[i];
    if (event.price !== null) {
      checkMagnitude(event.price, `timeline[${i}].price`, `Timeline "${event.eventType}"`);
    }
  }

  // Check 8: targetPrice == stopLoss, or target on wrong side of entry
  if (trade.targetPrice !== undefined && trade.targetPrice !== null) {
    if (trade.targetPrice === trade.stopLoss) {
      findings.push({
        severity: 'error',
        field: 'targetPrice',
        message: `Target price equals stop loss (${trade.targetPrice})`,
      });
    }

    // Target on wrong side of entry
    if (trade.direction === 'long') {
      if (trade.targetPrice < entryPrice) {
        findings.push({
          severity: 'error',
          field: 'targetPrice',
          message: `Target (${trade.targetPrice}) is below entry (${entryPrice}) for a long trade`,
        });
      }
    } else {
      if (trade.targetPrice > entryPrice) {
        findings.push({
          severity: 'error',
          field: 'targetPrice',
          message: `Target (${trade.targetPrice}) is above entry (${entryPrice}) for a short trade`,
        });
      }
    }
  }

  // Check 9: Exit prices implying |R| > 20
  for (let i = 0; i < trade.exits.length; i++) {
    const exit = trade.exits[i];
    if (exit.price > 0 && stopDistance > 0) {
      const rMultiple = calculateRMultiple(entryPrice, trade.stopLoss, exit.price, trade.direction);
      if (rMultiple !== undefined && Math.abs(rMultiple) > 20) {
        findings.push({
          severity: 'error',
          field: `exits[${i}].price`,
          message: `Exit ${i + 1} price implies ${rMultiple.toFixed(1)}R — possible typo`,
        });
      }
    }
  }

  // ============================================
  // CONVENTION VIOLATIONS (severity: warning) - Checks 10-16
  // ============================================

  // Check 10: Zone reaction swept_then_bounced but deepest doesn't reach/pass far edge
  // Check 11: Zone reaction bounced but deepest at/beyond far edge
  for (let i = 0; i < trade.levelSequence.length; i++) {
    const level = trade.levelSequence[i];
    if (isZoneLevel(level.levelType) && level.priceFar !== null) {
      const farEdge = level.priceFar;
      const deepest = level.deepestPrice;

      if (level.reaction === 'swept_then_bounced' && deepest !== null && deepest !== undefined) {
        // For swept_then_bounced, deepest should reach or pass the far edge
        const reachedFar = trade.direction === 'long'
          ? deepest <= farEdge
          : deepest >= farEdge;
        if (!reachedFar) {
          findings.push({
            severity: 'warning',
            field: `levelSequence[${i}].reaction`,
            message: `Zone marked "swept_then_bounced" but deepest (${deepest}) didn't reach far edge (${farEdge}) — should be "bounced"?`,
          });
        }
      }

      if (level.reaction === 'bounced' && deepest !== null && deepest !== undefined) {
        // For bounced, deepest should NOT reach the far edge
        const atOrBeyondFar = trade.direction === 'long'
          ? deepest <= farEdge
          : deepest >= farEdge;
        if (atOrBeyondFar) {
          findings.push({
            severity: 'warning',
            field: `levelSequence[${i}].reaction`,
            message: `Zone marked "bounced" but deepest (${deepest}) reached/passed far edge (${farEdge}) — should be "swept_then_bounced"?`,
          });
        }
      }
    }
  }

  // Check 12: Line level reaction swept_then_bounced or front_run with no turnPrice
  for (let i = 0; i < trade.levelSequence.length; i++) {
    const level = trade.levelSequence[i];
    if (!isZoneLevel(level.levelType) && level.priceFar === null) {
      // This is a line level
      if ((level.reaction === 'swept_then_bounced' || level.reaction === 'front_run') &&
          (level.turnPrice === null || level.turnPrice === undefined)) {
        findings.push({
          severity: 'warning',
          field: `levelSequence[${i}].turnPrice`,
          message: `Line level has reaction "${level.reaction}" but no turnPrice — where did price turn?`,
        });
      }
    }
  }

  // Check 13: Timeframe fields not matching normalized pattern
  for (let i = 0; i < trade.levelSequence.length; i++) {
    const level = trade.levelSequence[i];
    if (level.timeframe && !isValidTimeframe(level.timeframe)) {
      findings.push({
        severity: 'warning',
        field: `levelSequence[${i}].timeframe`,
        message: `Invalid timeframe format "${level.timeframe}" — expected pattern like M15, H1, D1, W1, MN, MTF`,
      });
    }
  }

  if (trade.entryTF && !isValidTimeframe(trade.entryTF)) {
    findings.push({
      severity: 'warning',
      field: 'entryTF',
      message: `Invalid entry timeframe format "${trade.entryTF}"`,
    });
  }

  if (trade.confirmationTF && !isValidTimeframe(trade.confirmationTF)) {
    findings.push({
      severity: 'warning',
      field: 'confirmationTF',
      message: `Invalid confirmation timeframe format "${trade.confirmationTF}"`,
    });
  }

  // Check 14: Exit typed trail_stop_hit or be_stop_hit with no stop_moved event
  const stopMoves = getStopMoves(trade);
  for (let i = 0; i < trade.exits.length; i++) {
    const exit = trade.exits[i];
    if ((exit.type === 'trail_stop_hit' || exit.type === 'be_stop_hit') && stopMoves.length === 0) {
      findings.push({
        severity: 'warning',
        field: `exits[${i}].type`,
        message: `Exit typed "${exit.type}" but no stop_moved events in timeline`,
      });
    }
  }

  // Check 15: Exit reason mentions TP/target but price far (>0.3R) from targetPrice
  if (trade.targetPrice !== undefined && trade.targetPrice !== null && stopDistance > 0) {
    for (let i = 0; i < trade.exits.length; i++) {
      const exit = trade.exits[i];
      const reason = (exit.reason || '').toLowerCase();
      if (reason.includes('tp') || reason.includes('target')) {
        const distanceFromTarget = Math.abs(exit.price - trade.targetPrice);
        const distanceInR = distanceFromTarget / stopDistance;
        if (distanceInR > 0.3) {
          findings.push({
            severity: 'warning',
            field: `exits[${i}].price`,
            message: `Exit reason mentions target but price (${exit.price}) is ${distanceInR.toFixed(2)}R from target (${trade.targetPrice}) — possible typo`,
          });
        }
      }
    }
  }

  // Check 16: stop_moved price that widens the stop (behavioural warning)
  const originalStop = trade.stopLoss;
  for (let i = 0; i < stopMoves.length; i++) {
    const move = stopMoves[i];
    if (move.price !== null) {
      // Widening = moving stop further from entry in the adverse direction
      if (trade.direction === 'long') {
        // For long, widening = moving stop lower (further below entry)
        if (move.price < originalStop) {
          findings.push({
            severity: 'warning',
            field: `timeline (stop_moved)`,
            message: `Stop widened from ${originalStop} to ${move.price} — intentional?`,
          });
        }
      } else {
        // For short, widening = moving stop higher (further above entry)
        if (move.price > originalStop) {
          findings.push({
            severity: 'warning',
            field: `timeline (stop_moved)`,
            message: `Stop widened from ${originalStop} to ${move.price} — intentional?`,
          });
        }
      }
    }
  }

  // ============================================
  // COMPLETENESS CHECKS (severity: incomplete) - Checks 17-22
  // Only for closed trades
  // ============================================

  if (isClosed) {
    // Check 17: No trade_high or trade_low event (MAE/MFE underivable)
    const hasTradeHigh = trade.timeline.some(e => e.eventType === 'trade_high' && e.price !== null);
    const hasTradeLow = trade.timeline.some(e => e.eventType === 'trade_low' && e.price !== null);
    if (!hasTradeHigh && !hasTradeLow) {
      findings.push({
        severity: 'incomplete',
        field: 'timeline',
        message: 'No trade_high or trade_low event — MAE/MFE cannot be derived',
      });
    } else if (!hasTradeHigh) {
      findings.push({
        severity: 'incomplete',
        field: 'timeline',
        message: 'No trade_high event — MFE incomplete for shorts',
      });
    } else if (!hasTradeLow) {
      findings.push({
        severity: 'incomplete',
        field: 'timeline',
        message: 'No trade_low event — MFE incomplete for longs',
      });
    }

    // Check 18: Level rows with reaction unset
    for (let i = 0; i < trade.levelSequence.length; i++) {
      const level = trade.levelSequence[i];
      if (level.reaction === null || level.reaction === undefined) {
        findings.push({
          severity: 'incomplete',
          field: `levelSequence[${i}].reaction`,
          message: `Level ${i + 1} (${level.levelType}) has no reaction set`,
        });
      }
    }

    // Check 19: Zone levels bounced/swept with no deepest
    for (let i = 0; i < trade.levelSequence.length; i++) {
      const level = trade.levelSequence[i];
      if (isZoneLevel(level.levelType) && level.priceFar !== null) {
        if ((level.reaction === 'bounced' || level.reaction === 'swept_then_bounced') &&
            (level.deepestPrice === null || level.deepestPrice === undefined)) {
          findings.push({
            severity: 'incomplete',
            field: `levelSequence[${i}].deepestPrice`,
            message: `Zone level ${i + 1} has reaction "${level.reaction}" but no deepest price`,
          });
        }
      }
    }

    // Check 20: Non-final exits missing drawdownAfter
    if (trade.exits.length > 1) {
      for (let i = 0; i < trade.exits.length - 1; i++) {
        const exit = trade.exits[i];
        if (exit.drawdownAfter === null || exit.drawdownAfter === undefined) {
          findings.push({
            severity: 'incomplete',
            field: `exits[${i}].drawdownAfter`,
            message: `Exit ${i + 1} (non-final) is missing drawdownAfter`,
          });
        }
      }
    }

    // Check 21 & 22: Post-exit review status
    const exitTime = deriveExitTime(trade);
    const reviewDueDate = exitTime ? getReviewDueDate(exitTime) : null;
    const isReviewOverdue = reviewDueDate !== null && new Date() >= reviewDueDate;

    if (isReviewOverdue) {
      // Check 21: No post_exit_high/low when review is due
      const hasPostExitHigh = trade.timeline.some(e => e.eventType === 'post_exit_high' && e.price !== null);
      const hasPostExitLow = trade.timeline.some(e => e.eventType === 'post_exit_low' && e.price !== null);
      if (!hasPostExitHigh || !hasPostExitLow) {
        findings.push({
          severity: 'incomplete',
          field: 'timeline',
          message: 'Review is due but missing post_exit_high and/or post_exit_low',
        });
      }

      // Check 22: Review overdue (due date passed, reviewedAt null)
      if (!trade.reviewedAt) {
        findings.push({
          severity: 'incomplete',
          field: 'reviewedAt',
          message: `Post-exit review is overdue (due ${reviewDueDate.toLocaleDateString()})`,
        });
      }
    }
  }

  return findings;
}

// ============================================
// CROSS-TRADE AUDIT FUNCTION
// ============================================

/**
 * Check 23: Duplicate detection across all trades
 */
export interface DuplicateFinding {
  trade1Id: string;
  trade2Id: string;
  trade1Pair: string;
  message: string;
}

/**
 * Audit all trades for cross-trade issues (duplicates, etc.)
 */
export function auditAllTrades(trades: TradeRecord[]): {
  individualFindings: Map<string, AuditFinding[]>;
  duplicates: DuplicateFinding[];
} {
  const individualFindings = new Map<string, AuditFinding[]>();
  const duplicates: DuplicateFinding[] = [];

  // Run individual audits
  for (const trade of trades) {
    if (trade.id) {
      individualFindings.set(trade.id, auditTrade(trade));
    }
  }

  // Check for duplicates: same pair + direction + entryPrice + stopLoss + matching exit prices
  for (let i = 0; i < trades.length; i++) {
    for (let j = i + 1; j < trades.length; j++) {
      const t1 = trades[i];
      const t2 = trades[j];

      if (!t1.id || !t2.id) continue;

      // Basic match
      if (t1.pair !== t2.pair) continue;
      if (t1.direction !== t2.direction) continue;
      if (t1.entryPrice !== t2.entryPrice) continue;
      if (t1.stopLoss !== t2.stopLoss) continue;

      // Check exit prices match
      const t1ExitPrices = t1.exits.map(e => e.price).sort();
      const t2ExitPrices = t2.exits.map(e => e.price).sort();

      if (t1ExitPrices.length === t2ExitPrices.length) {
        let allMatch = true;
        for (let k = 0; k < t1ExitPrices.length; k++) {
          if (t1ExitPrices[k] !== t2ExitPrices[k]) {
            allMatch = false;
            break;
          }
        }

        if (allMatch) {
          duplicates.push({
            trade1Id: t1.id,
            trade2Id: t2.id,
            trade1Pair: t1.pair,
            message: `Possible duplicate: same pair (${t1.pair}), direction, entry, stop, and exit prices`,
          });
        }
      }
    }
  }

  return { individualFindings, duplicates };
}

/**
 * Generate a summary for displaying audit results
 */
export function getAuditSummaries(trades: TradeRecord[]): AuditSummary[] {
  const { individualFindings, duplicates } = auditAllTrades(trades);
  const summaries: AuditSummary[] = [];

  for (const trade of trades) {
    if (!trade.id) continue;

    const findings = individualFindings.get(trade.id) || [];

    // Add duplicate findings
    for (const dup of duplicates) {
      if (dup.trade1Id === trade.id || dup.trade2Id === trade.id) {
        const otherTradeId = dup.trade1Id === trade.id ? dup.trade2Id : dup.trade1Id;
        findings.push({
          severity: 'warning',
          field: 'duplicate',
          message: `Possible duplicate of trade ${otherTradeId.slice(0, 8)}...`,
        });
      }
    }

    const errorCount = findings.filter(f => f.severity === 'error').length;
    const warningCount = findings.filter(f => f.severity === 'warning').length;
    const incompleteCount = findings.filter(f => f.severity === 'incomplete').length;

    // Get top finding (first error, or first warning, or first incomplete)
    let topFinding: string | null = null;
    const firstError = findings.find(f => f.severity === 'error');
    if (firstError) {
      topFinding = firstError.message;
    } else {
      const firstWarning = findings.find(f => f.severity === 'warning');
      if (firstWarning) {
        topFinding = firstWarning.message;
      } else {
        const firstIncomplete = findings.find(f => f.severity === 'incomplete');
        if (firstIncomplete) {
          topFinding = firstIncomplete.message;
        }
      }
    }

    summaries.push({
      trade,
      tradeId: trade.id,
      pair: trade.pair,
      findings,
      errorCount,
      warningCount,
      incompleteCount,
      topFinding,
    });
  }

  return summaries;
}

/**
 * Quick check if a trade has any errors (for badge display)
 */
export function hasAuditErrors(trade: TradeRecord): boolean {
  const findings = auditTrade(trade);
  return findings.some(f => f.severity === 'error');
}

/**
 * Get counts by severity for a trade
 */
export function getAuditCounts(trade: TradeRecord): { errors: number; warnings: number; incomplete: number } {
  const findings = auditTrade(trade);
  return {
    errors: findings.filter(f => f.severity === 'error').length,
    warnings: findings.filter(f => f.severity === 'warning').length,
    incomplete: findings.filter(f => f.severity === 'incomplete').length,
  };
}

// ============================================
// ACKNOWLEDGEMENT SYSTEM
// ============================================

import type { AcknowledgedFinding } from '../types';
import { db } from '../db';

/**
 * Generate a stable hash of the values relevant to a finding.
 * Uses the field path to extract the corresponding value(s) from the trade.
 * If the underlying data changes, the hash changes and the finding resurfaces.
 */
export function generateFindingValueHash(trade: TradeRecord, finding: AuditFinding): string {
  // Extract the relevant value based on the field path
  let valueToHash: unknown;

  const field = finding.field;

  // Parse array-style field paths like "exits[0].time" or "timeline[3].price"
  const arrayMatch = field.match(/^(\w+)\[(\d+)\]\.?(.*)$/);
  if (arrayMatch) {
    const [, arrayName, indexStr, subField] = arrayMatch;
    const index = parseInt(indexStr, 10);
    const array = (trade as unknown as Record<string, unknown[]>)[arrayName];
    if (Array.isArray(array) && array[index] !== undefined) {
      if (subField) {
        valueToHash = (array[index] as Record<string, unknown>)[subField];
      } else {
        valueToHash = array[index];
      }
    }
  } else if (field.includes('(')) {
    // Special fields like "timeline (stop_moved)" - hash all stop_moved events
    if (field.includes('stop_moved')) {
      valueToHash = trade.timeline
        .filter(e => e.eventType === 'stop_moved')
        .map(e => ({ price: e.price, time: e.time }));
    } else {
      // Generic timeline field
      valueToHash = trade.timeline;
    }
  } else if (field === 'duplicate') {
    // Duplicate findings - hash core identifying fields
    valueToHash = {
      pair: trade.pair,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      stopLoss: trade.stopLoss,
      exitPrices: trade.exits.map(e => e.price).sort(),
    };
  } else if (field === 'timeline') {
    // General timeline issues - hash all timeline events
    valueToHash = trade.timeline;
  } else if (field === 'reviewedAt') {
    // Review status - hash the reviewedAt field and exit time
    valueToHash = { reviewedAt: trade.reviewedAt, exits: trade.exits.map(e => e.time) };
  } else {
    // Simple field path - direct property access
    valueToHash = (trade as unknown as Record<string, unknown>)[field];
  }

  // Create a simple hash from the JSON representation
  const jsonStr = JSON.stringify(valueToHash ?? null);
  return simpleHash(jsonStr);
}

/**
 * Simple string hash function (djb2 algorithm)
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to hex string, handle negative numbers
  return (hash >>> 0).toString(16);
}

/**
 * Generate the composite key for an acknowledged finding
 */
export function generateAcknowledgementKey(tradeId: string, field: string, valueHash: string): string {
  return `${tradeId}:${field}:${valueHash}`;
}

/**
 * Acknowledge a finding - stores it in the database
 */
export async function acknowledgeFinding(
  trade: TradeRecord,
  finding: AuditFinding
): Promise<AcknowledgedFinding> {
  if (!trade.id) {
    throw new Error('Cannot acknowledge finding: trade has no ID');
  }

  const valueHash = generateFindingValueHash(trade, finding);
  const id = generateAcknowledgementKey(trade.id, finding.field, valueHash);

  const acknowledgement: AcknowledgedFinding = {
    id,
    tradeId: trade.id,
    field: finding.field,
    valueHash,
    severity: finding.severity,
    message: finding.message,
    acknowledgedAt: new Date(),
  };

  try {
    await db.acknowledgedFindings.put(acknowledgement);
  } catch (error) {
    console.error('Failed to acknowledge finding:', error);
    throw error;
  }

  return acknowledgement;
}

/**
 * Remove acknowledgement for a finding
 */
export async function unacknowledgeFinding(
  trade: TradeRecord,
  finding: AuditFinding
): Promise<void> {
  const valueHash = generateFindingValueHash(trade, finding);
  const id = generateAcknowledgementKey(trade.id!, finding.field, valueHash);
  await db.acknowledgedFindings.delete(id);
}

/**
 * Get all acknowledged findings for a trade
 */
export async function getAcknowledgedFindings(tradeId: string): Promise<AcknowledgedFinding[]> {
  return db.acknowledgedFindings.where('tradeId').equals(tradeId).toArray();
}

/**
 * Check if a specific finding is currently acknowledged
 * (Returns false if the underlying data has changed - hash mismatch)
 */
export async function isFindingAcknowledged(
  trade: TradeRecord,
  finding: AuditFinding
): Promise<boolean> {
  const valueHash = generateFindingValueHash(trade, finding);
  const id = generateAcknowledgementKey(trade.id!, finding.field, valueHash);
  const existing = await db.acknowledgedFindings.get(id);
  return existing !== undefined;
}

/**
 * Extended finding type that includes acknowledgement status
 */
export interface AuditFindingWithAck extends AuditFinding {
  isAcknowledged: boolean;
  acknowledgementId?: string;
}

/**
 * Get audit findings for a trade with acknowledgement status
 */
export async function auditTradeWithAcknowledgements(
  trade: TradeRecord
): Promise<{ findings: AuditFindingWithAck[]; acknowledgedCount: number }> {
  const findings = auditTrade(trade);
  const acknowledged = await getAcknowledgedFindings(trade.id!);

  // Build a set of currently valid acknowledgement keys
  const ackKeySet = new Set(acknowledged.map(a => a.id));

  let acknowledgedCount = 0;
  const findingsWithAck: AuditFindingWithAck[] = findings.map(finding => {
    const valueHash = generateFindingValueHash(trade, finding);
    const key = generateAcknowledgementKey(trade.id!, finding.field, valueHash);
    const isAcknowledged = ackKeySet.has(key);

    if (isAcknowledged) {
      acknowledgedCount++;
    }

    return {
      ...finding,
      isAcknowledged,
      acknowledgementId: isAcknowledged ? key : undefined,
    };
  });

  return { findings: findingsWithAck, acknowledgedCount };
}

/**
 * Get unacknowledged findings only (for badge counts)
 */
export async function getUnacknowledgedFindings(trade: TradeRecord): Promise<AuditFinding[]> {
  const { findings } = await auditTradeWithAcknowledgements(trade);
  return findings.filter(f => !f.isAcknowledged);
}

/**
 * Check if a trade has any unacknowledged errors (for badge display)
 */
export async function hasUnacknowledgedErrors(trade: TradeRecord): Promise<boolean> {
  const unacknowledged = await getUnacknowledgedFindings(trade);
  return unacknowledged.some(f => f.severity === 'error');
}

/**
 * Get counts by severity for unacknowledged findings only
 */
export async function getUnacknowledgedCounts(trade: TradeRecord): Promise<{
  errors: number;
  warnings: number;
  incomplete: number;
  acknowledged: number;
}> {
  const { findings, acknowledgedCount } = await auditTradeWithAcknowledgements(trade);
  const unacknowledged = findings.filter(f => !f.isAcknowledged);

  return {
    errors: unacknowledged.filter(f => f.severity === 'error').length,
    warnings: unacknowledged.filter(f => f.severity === 'warning').length,
    incomplete: unacknowledged.filter(f => f.severity === 'incomplete').length,
    acknowledged: acknowledgedCount,
  };
}

/**
 * Clean up stale acknowledgements for a trade
 * (Removes acknowledgements whose hashes no longer match any current finding)
 */
export async function cleanupStaleAcknowledgements(trade: TradeRecord): Promise<number> {
  const findings = auditTrade(trade);
  const acknowledged = await getAcknowledgedFindings(trade.id!);

  // Build set of current valid keys
  const currentKeys = new Set(
    findings.map(f => {
      const valueHash = generateFindingValueHash(trade, f);
      return generateAcknowledgementKey(trade.id!, f.field, valueHash);
    })
  );

  // Find stale acknowledgements
  const staleIds = acknowledged
    .filter(a => !currentKeys.has(a.id))
    .map(a => a.id);

  if (staleIds.length > 0) {
    await db.acknowledgedFindings.bulkDelete(staleIds);
  }

  return staleIds.length;
}

/**
 * Extended audit summary that includes acknowledged count
 */
export interface AuditSummaryWithAck extends AuditSummary {
  acknowledgedCount: number;
  // These are the unacknowledged counts
  unacknowledgedErrorCount: number;
  unacknowledgedWarningCount: number;
  unacknowledgedIncompleteCount: number;
  unacknowledgedTopFinding: string | null;
}

/**
 * Get audit summaries with acknowledgement awareness
 * Counts reflect only unacknowledged findings
 */
export async function getAuditSummariesWithAcknowledgements(
  trades: TradeRecord[]
): Promise<AuditSummaryWithAck[]> {
  const { individualFindings, duplicates } = auditAllTrades(trades);
  const summaries: AuditSummaryWithAck[] = [];

  for (const trade of trades) {
    if (!trade.id) continue;

    const findings = individualFindings.get(trade.id) || [];

    // Add duplicate findings
    for (const dup of duplicates) {
      if (dup.trade1Id === trade.id || dup.trade2Id === trade.id) {
        const otherTradeId = dup.trade1Id === trade.id ? dup.trade2Id : dup.trade1Id;
        findings.push({
          severity: 'warning',
          field: 'duplicate',
          message: `Possible duplicate of trade ${otherTradeId.slice(0, 8)}...`,
        });
      }
    }

    // Get acknowledged findings for this trade
    const acknowledged = await getAcknowledgedFindings(trade.id);
    const ackKeySet = new Set(acknowledged.map(a => a.id));

    // Separate acknowledged and unacknowledged
    let acknowledgedCount = 0;
    const unacknowledged: AuditFinding[] = [];

    for (const finding of findings) {
      const valueHash = generateFindingValueHash(trade, finding);
      const key = generateAcknowledgementKey(trade.id, finding.field, valueHash);
      if (ackKeySet.has(key)) {
        acknowledgedCount++;
      } else {
        unacknowledged.push(finding);
      }
    }

    // Calculate unacknowledged counts
    const unacknowledgedErrorCount = unacknowledged.filter(f => f.severity === 'error').length;
    const unacknowledgedWarningCount = unacknowledged.filter(f => f.severity === 'warning').length;
    const unacknowledgedIncompleteCount = unacknowledged.filter(f => f.severity === 'incomplete').length;

    // Get top unacknowledged finding
    let unacknowledgedTopFinding: string | null = null;
    const firstError = unacknowledged.find(f => f.severity === 'error');
    if (firstError) {
      unacknowledgedTopFinding = firstError.message;
    } else {
      const firstWarning = unacknowledged.find(f => f.severity === 'warning');
      if (firstWarning) {
        unacknowledgedTopFinding = firstWarning.message;
      } else {
        const firstIncomplete = unacknowledged.find(f => f.severity === 'incomplete');
        if (firstIncomplete) {
          unacknowledgedTopFinding = firstIncomplete.message;
        }
      }
    }

    // Total counts (for reference)
    const errorCount = findings.filter(f => f.severity === 'error').length;
    const warningCount = findings.filter(f => f.severity === 'warning').length;
    const incompleteCount = findings.filter(f => f.severity === 'incomplete').length;

    // Top finding from all (for compatibility)
    let topFinding: string | null = null;
    const allFirstError = findings.find(f => f.severity === 'error');
    if (allFirstError) {
      topFinding = allFirstError.message;
    } else {
      const allFirstWarning = findings.find(f => f.severity === 'warning');
      if (allFirstWarning) {
        topFinding = allFirstWarning.message;
      } else {
        const allFirstIncomplete = findings.find(f => f.severity === 'incomplete');
        if (allFirstIncomplete) {
          topFinding = allFirstIncomplete.message;
        }
      }
    }

    summaries.push({
      trade,
      tradeId: trade.id,
      pair: trade.pair,
      findings,
      errorCount,
      warningCount,
      incompleteCount,
      topFinding,
      acknowledgedCount,
      unacknowledgedErrorCount,
      unacknowledgedWarningCount,
      unacknowledgedIncompleteCount,
      unacknowledgedTopFinding,
    });
  }

  return summaries;
}
