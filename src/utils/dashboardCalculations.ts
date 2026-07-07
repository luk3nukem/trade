import type { TradeRecord } from '../types';

// Types for dashboard data
export interface DashboardStats {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  avgWinnerR: number;
  avgLoserR: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  currentStreak: { type: 'W' | 'L' | 'BE' | null; count: number };
  bestTrade: { pair: string; rMultiple: number } | null;
  worstTrade: { pair: string; rMultiple: number } | null;
  totalPnl: number;
  totalNetPnl: number;
}

export interface EquityCurvePoint {
  date: Date;
  exitTime: Date;
  pair: string;
  pnl: number;
  rMultiple: number;
  cumulativePnl: number;
  cumulativeR: number;
  isDrawdown: boolean;
  drawdownAmount: number;
}

export interface RollingPerformancePoint {
  date: Date;
  tradeIndex: number;
  rollingExpectancy: number;
  rollingProfitFactor: number;
}

export interface CalendarDay {
  date: Date;
  dateStr: string;
  trades: number;
  netPnl: number;
  intensity: number; // -1 to 1 scale for coloring
}

export interface CalendarMonth {
  year: number;
  month: number;
  days: CalendarDay[];
}

/**
 * Filter trades by date range, account, strategy, and setup tags
 */
export function filterTrades(
  trades: TradeRecord[],
  filters: {
    dateFrom?: Date;
    dateTo?: Date;
    accountId?: string;
    strategyId?: string;
    setupTags?: string[];
  }
): TradeRecord[] {
  return trades.filter((trade) => {
    if (filters.dateFrom && new Date(trade.entryTime) < filters.dateFrom) {
      return false;
    }
    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23, 59, 59, 999);
      if (new Date(trade.entryTime) > toDate) {
        return false;
      }
    }
    if (filters.accountId && trade.accountId !== filters.accountId) {
      return false;
    }
    if (filters.strategyId && trade.strategyId !== filters.strategyId) {
      return false;
    }
    // Setup tags filter: match ANY selected tag
    if (filters.setupTags && filters.setupTags.length > 0) {
      const tradeTags = trade.setupTags || [];
      const hasMatchingTag = filters.setupTags.some((tag) => tradeTags.includes(tag));
      if (!hasMatchingTag) return false;
    }
    return true;
  });
}

/**
 * Get closed trades sorted by exit time
 */
export function getClosedTradesSorted(trades: TradeRecord[]): TradeRecord[] {
  return trades
    .filter((t) => t.status === 'closed' && t.exitTime)
    .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime());
}

/**
 * Calculate all dashboard statistics
 */
export function calculateDashboardStats(trades: TradeRecord[]): DashboardStats {
  const closedTrades = trades.filter((t) => t.status === 'closed');
  const openTrades = trades.filter((t) => t.status === 'open');

  // Win/Loss categorization
  const wins = closedTrades.filter((t) => (t.rMultiple ?? 0) > 0);
  const losses = closedTrades.filter((t) => (t.rMultiple ?? 0) < 0);
  const breakevens = closedTrades.filter((t) => (t.rMultiple ?? 0) === 0);

  // Win rate
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

  // Gross wins and losses
  const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
  const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));

  // Profit factor
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  // Expectancy (average R-multiple)
  const totalR = closedTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);
  const expectancy = closedTrades.length > 0 ? totalR / closedTrades.length : 0;

  // Average winner and loser R
  const avgWinnerR = wins.length > 0
    ? wins.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / wins.length
    : 0;
  const avgLoserR = losses.length > 0
    ? losses.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / losses.length
    : 0;

  // Max drawdown calculation
  const sortedClosed = getClosedTradesSorted(trades);
  const { maxDrawdown, maxDrawdownPercent } = calculateMaxDrawdown(sortedClosed);

  // Current streak
  const currentStreak = calculateCurrentStreak(sortedClosed);

  // Best and worst trades
  const bestTrade = findBestTrade(closedTrades);
  const worstTrade = findWorstTrade(closedTrades);

  // Total P&L
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const totalNetPnl = closedTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

  return {
    totalTrades: trades.length,
    closedTrades: closedTrades.length,
    openTrades: openTrades.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
    expectancy,
    avgWinnerR,
    avgLoserR,
    maxDrawdown,
    maxDrawdownPercent,
    currentStreak,
    bestTrade,
    worstTrade,
    totalPnl,
    totalNetPnl,
  };
}

/**
 * Calculate max drawdown from sorted closed trades
 */
export function calculateMaxDrawdown(sortedTrades: TradeRecord[]): {
  maxDrawdown: number;
  maxDrawdownPercent: number;
} {
  if (sortedTrades.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPercent: 0 };
  }

  let peak = 0;
  let cumulative = 0;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;

  for (const trade of sortedTrades) {
    const pnl = trade.netPnl ?? trade.pnl ?? 0;
    cumulative += pnl;

    if (cumulative > peak) {
      peak = cumulative;
    }

    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;
    }
  }

  return { maxDrawdown, maxDrawdownPercent };
}

/**
 * Calculate current win/loss streak
 */
export function calculateCurrentStreak(sortedTrades: TradeRecord[]): {
  type: 'W' | 'L' | 'BE' | null;
  count: number;
} {
  if (sortedTrades.length === 0) {
    return { type: null, count: 0 };
  }

  // Start from the most recent trade
  const reversed = [...sortedTrades].reverse();
  const firstR = reversed[0].rMultiple ?? 0;

  let type: 'W' | 'L' | 'BE';
  if (firstR > 0) type = 'W';
  else if (firstR < 0) type = 'L';
  else type = 'BE';

  let count = 0;
  for (const trade of reversed) {
    const r = trade.rMultiple ?? 0;
    const tradeType = r > 0 ? 'W' : r < 0 ? 'L' : 'BE';
    if (tradeType === type) {
      count++;
    } else {
      break;
    }
  }

  return { type, count };
}

/**
 * Find best trade by R-multiple
 */
export function findBestTrade(trades: TradeRecord[]): { pair: string; rMultiple: number } | null {
  const withR = trades.filter((t) => t.rMultiple !== undefined);
  if (withR.length === 0) return null;

  const best = withR.reduce((max, t) =>
    (t.rMultiple ?? 0) > (max.rMultiple ?? 0) ? t : max
  );
  return { pair: best.pair, rMultiple: best.rMultiple ?? 0 };
}

/**
 * Find worst trade by R-multiple
 */
export function findWorstTrade(trades: TradeRecord[]): { pair: string; rMultiple: number } | null {
  const withR = trades.filter((t) => t.rMultiple !== undefined);
  if (withR.length === 0) return null;

  const worst = withR.reduce((min, t) =>
    (t.rMultiple ?? 0) < (min.rMultiple ?? 0) ? t : min
  );
  return { pair: worst.pair, rMultiple: worst.rMultiple ?? 0 };
}

/**
 * Generate equity curve data points
 */
export function generateEquityCurve(trades: TradeRecord[]): EquityCurvePoint[] {
  const sortedTrades = getClosedTradesSorted(trades);

  let cumulativePnl = 0;
  let cumulativeR = 0;
  let peak = 0;

  const points: EquityCurvePoint[] = [];

  for (const trade of sortedTrades) {
    const pnl = trade.netPnl ?? trade.pnl ?? 0;
    const rMultiple = trade.rMultiple ?? 0;

    cumulativePnl += pnl;
    cumulativeR += rMultiple;

    if (cumulativePnl > peak) {
      peak = cumulativePnl;
    }

    const isDrawdown = cumulativePnl < peak;
    const drawdownAmount = peak - cumulativePnl;

    points.push({
      date: new Date(trade.exitTime!),
      exitTime: new Date(trade.exitTime!),
      pair: trade.pair,
      pnl,
      rMultiple,
      cumulativePnl,
      cumulativeR,
      isDrawdown,
      drawdownAmount,
    });
  }

  return points;
}

/**
 * Generate rolling performance data (expectancy and profit factor over last N trades)
 */
export function generateRollingPerformance(
  trades: TradeRecord[],
  windowSize: number = 20
): RollingPerformancePoint[] {
  const sortedTrades = getClosedTradesSorted(trades);
  const points: RollingPerformancePoint[] = [];

  for (let i = windowSize - 1; i < sortedTrades.length; i++) {
    const windowTrades = sortedTrades.slice(i - windowSize + 1, i + 1);

    // Rolling expectancy
    const totalR = windowTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);
    const rollingExpectancy = totalR / windowSize;

    // Rolling profit factor
    const wins = windowTrades.filter((t) => (t.rMultiple ?? 0) > 0);
    const losses = windowTrades.filter((t) => (t.rMultiple ?? 0) < 0);
    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));
    const rollingProfitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 3 : 1;

    points.push({
      date: new Date(sortedTrades[i].exitTime!),
      tradeIndex: i + 1,
      rollingExpectancy,
      rollingProfitFactor: Math.min(rollingProfitFactor, 5), // Cap at 5 for visualization
    });
  }

  return points;
}

/**
 * Generate calendar heatmap data for a specific month
 */
export function generateCalendarMonth(
  trades: TradeRecord[],
  year: number,
  month: number // 0-indexed
): CalendarMonth {
  const closedTrades = trades.filter((t) => t.status === 'closed' && t.exitTime);

  // Group trades by date
  const tradesByDate = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const exitDate = new Date(trade.exitTime!);
    if (exitDate.getFullYear() === year && exitDate.getMonth() === month) {
      const dateStr = exitDate.toISOString().split('T')[0];
      const existing = tradesByDate.get(dateStr) || [];
      existing.push(trade);
      tradesByDate.set(dateStr, existing);
    }
  }

  // Generate all days in the month
  const lastDay = new Date(year, month + 1, 0);
  const days: CalendarDay[] = [];

  // Find max P&L for intensity scaling
  let maxAbsPnl = 0;
  for (const [, dayTrades] of tradesByDate) {
    const dayPnl = dayTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    maxAbsPnl = Math.max(maxAbsPnl, Math.abs(dayPnl));
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d);
    const dateStr = date.toISOString().split('T')[0];
    const dayTrades = tradesByDate.get(dateStr) || [];
    const netPnl = dayTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

    // Calculate intensity (-1 to 1)
    let intensity = 0;
    if (dayTrades.length > 0 && maxAbsPnl > 0) {
      intensity = netPnl / maxAbsPnl;
    }

    days.push({
      date,
      dateStr,
      trades: dayTrades.length,
      netPnl,
      intensity,
    });
  }

  return { year, month, days };
}

/**
 * Get trades for a specific date
 */
export function getTradesForDate(trades: TradeRecord[], dateStr: string): TradeRecord[] {
  return trades.filter((trade) => {
    if (!trade.exitTime) return false;
    const exitDateStr = new Date(trade.exitTime).toISOString().split('T')[0];
    return exitDateStr === dateStr;
  });
}

/**
 * Get open trades sorted by entry time (newest first)
 */
export function getOpenTrades(trades: TradeRecord[]): TradeRecord[] {
  return trades
    .filter((t) => t.status === 'open')
    .sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());
}

/**
 * Calculate time held for an open trade
 */
export function calculateTimeHeld(entryTime: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(entryTime).getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ${diffHours % 24}h`;
  }
  if (diffHours > 0) {
    return `${diffHours}h ${diffMins % 60}m`;
  }
  return `${diffMins}m`;
}

/**
 * Get recent closed trades (last N)
 */
export function getRecentClosedTrades(trades: TradeRecord[], count: number = 10): TradeRecord[] {
  return getClosedTradesSorted(trades).reverse().slice(0, count);
}
