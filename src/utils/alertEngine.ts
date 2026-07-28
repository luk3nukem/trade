import type { TradeRecord, Alert, AlertSettings, AlertType } from '../types';
import { getTradeRMetrics } from './tradeCalculations';

// Helper to filter out undefined IDs
function filterIds(ids: (string | undefined)[]): string[] {
  return ids.filter((id): id is string => id !== undefined);
}

// Cache for trade metrics to avoid recalculating
const metricsCache = new WeakMap<TradeRecord, ReturnType<typeof getTradeRMetrics>>();
function getCachedMetrics(trade: TradeRecord) {
  let metrics = metricsCache.get(trade);
  if (!metrics) {
    metrics = getTradeRMetrics(trade);
    metricsCache.set(trade, metrics);
  }
  return metrics;
}

// Generate a unique hash for an alert to track dismissals
export function generateAlertHash(type: AlertType, tradeIds: (string | undefined)[]): string {
  return `${type}:${filterIds(tradeIds).sort().join(',')}`;
}

// Check for revenge trades (trade entered within X minutes of a losing trade)
function checkRevengeTrades(
  trades: TradeRecord[],
  windowMinutes: number
): Alert[] {
  const alerts: Alert[] = [];

  // Get trades with derived status
  const tradesWithMetrics = trades.map(t => ({ trade: t, metrics: getCachedMetrics(t) }));
  const activeTrades = tradesWithMetrics
    .filter(({ metrics }) => metrics.status === 'closed' || metrics.status === 'open')
    .sort((a, b) => new Date(a.trade.entryTime).getTime() - new Date(b.trade.entryTime).getTime());

  for (let i = 1; i < activeTrades.length; i++) {
    const { trade: currentTrade } = activeTrades[i];
    const { trade: prevTrade, metrics: prevMetrics } = activeTrades[i - 1];

    // Skip if previous trade is still open or wasn't a loss
    if (prevMetrics.status !== 'closed' || !prevMetrics.exitTime) continue;
    if ((prevMetrics.rMultiple ?? 0) >= 0) continue;

    const prevExitTime = prevMetrics.exitTime.getTime();
    const currentEntryTime = new Date(currentTrade.entryTime).getTime();
    const timeDiffMinutes = (currentEntryTime - prevExitTime) / (1000 * 60);

    if (timeDiffMinutes >= 0 && timeDiffMinutes <= windowMinutes) {
      alerts.push({
        id: generateAlertHash('revenge_trade', [currentTrade.id]),
        type: 'revenge_trade',
        severity: 'warning',
        title: 'Potential Revenge Trade',
        message: `${currentTrade.pair} was entered ${Math.round(timeDiffMinutes)} minutes after a loss on ${prevTrade.pair}. Take a moment to ensure this is a quality setup.`,
        relatedTradeIds: filterIds([currentTrade.id, prevTrade.id]),
        timestamp: new Date(),
      });
    }
  }

  return alerts;
}

// Check for overtrading (too many trades today)
function checkOvertrade(
  trades: TradeRecord[],
  dailyLimit: number
): Alert[] {
  const today = new Date().toISOString().split('T')[0];
  const todaysTrades = trades.filter(t => {
    const tradeDate = new Date(t.entryTime).toISOString().split('T')[0];
    return tradeDate === today;
  });

  if (todaysTrades.length > dailyLimit) {
    return [{
      id: generateAlertHash('overtrade', todaysTrades.map(t => t.id)),
      type: 'overtrade',
      severity: 'warning',
      title: 'Daily Trade Limit Exceeded',
      message: `You've taken ${todaysTrades.length} trades today (limit: ${dailyLimit}). Consider stepping away from the screen.`,
      relatedTradeIds: filterIds(todaysTrades.map(t => t.id)),
      timestamp: new Date(),
    }];
  }

  return [];
}

// Check for sizing spike (risk > 1.5x rolling average)
function checkSizingSpike(trades: TradeRecord[]): Alert[] {
  const alerts: Alert[] = [];
  const tradesWithRisk = trades
    .filter(t => t.riskPercent !== undefined && t.riskPercent > 0)
    .sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

  if (tradesWithRisk.length < 5) return [];

  // Calculate rolling average of last 20 trades (or all if less)
  const lookback = Math.min(20, tradesWithRisk.length - 1);
  const recentTrades = tradesWithRisk.slice(-lookback - 1, -1);
  const avgRisk = recentTrades.reduce((sum, t) => sum + (t.riskPercent ?? 0), 0) / recentTrades.length;

  const latestTrade = tradesWithRisk[tradesWithRisk.length - 1];
  const latestRisk = latestTrade.riskPercent ?? 0;

  if (latestRisk > avgRisk * 1.5 && avgRisk > 0) {
    alerts.push({
      id: generateAlertHash('sizing_spike', [latestTrade.id]),
      type: 'sizing_spike',
      severity: 'warning',
      title: 'Position Size Spike',
      message: `${latestTrade.pair} risk (${latestRisk.toFixed(2)}%) is ${(latestRisk / avgRisk).toFixed(1)}x your average (${avgRisk.toFixed(2)}%). Review your position sizing.`,
      relatedTradeIds: filterIds([latestTrade.id]),
      timestamp: new Date(),
    });
  }

  return alerts;
}

// Check for edge decay (rolling 20-trade expectancy below 0)
function checkEdgeDecay(trades: TradeRecord[]): Alert[] {
  // Get closed trades with derived metrics
  const tradesWithMetrics = trades
    .map(t => ({ trade: t, metrics: getCachedMetrics(t) }))
    .filter(({ metrics }) => metrics.status === 'closed' && metrics.rMultiple !== null)
    .sort((a, b) => a.metrics.exitTime!.getTime() - b.metrics.exitTime!.getTime());

  if (tradesWithMetrics.length < 20) return [];

  const last20 = tradesWithMetrics.slice(-20);
  const avgR = last20.reduce((sum, { metrics }) => sum + (metrics.rMultiple ?? 0), 0) / 20;

  if (avgR < 0) {
    return [{
      id: generateAlertHash('edge_decay', last20.map(({ trade }) => trade.id)),
      type: 'edge_decay',
      severity: 'danger',
      title: 'Edge Decay Detected',
      message: `Your last 20 trades have negative expectancy (${avgR.toFixed(2)}R). Consider pausing to review your strategy.`,
      relatedTradeIds: filterIds(last20.map(({ trade }) => trade.id)),
      timestamp: new Date(),
    }];
  }

  return [];
}

// Check for drawdown warning
function checkDrawdown(
  trades: TradeRecord[],
  thresholdPercent: number
): Alert[] {
  // Get closed trades with derived metrics
  const tradesWithMetrics = trades
    .map(t => ({ trade: t, metrics: getCachedMetrics(t) }))
    .filter(({ metrics }) => metrics.status === 'closed')
    .sort((a, b) => a.metrics.exitTime!.getTime() - b.metrics.exitTime!.getTime());

  if (tradesWithMetrics.length === 0) return [];

  // Calculate equity curve using derived pnl
  let cumulative = 0;
  let peak = 0;
  let maxDrawdownPct = 0;
  let drawdownTrades: (string | undefined)[] = [];
  let inDrawdown = false;

  for (const { trade, metrics } of tradesWithMetrics) {
    cumulative += (metrics.pnl ?? 0);

    if (cumulative > peak) {
      peak = cumulative;
      inDrawdown = false;
      drawdownTrades = [];
    } else if (peak > 0) {
      const currentDrawdownPct = ((peak - cumulative) / peak) * 100;
      if (currentDrawdownPct > maxDrawdownPct) {
        maxDrawdownPct = currentDrawdownPct;
      }
      if (!inDrawdown) {
        inDrawdown = true;
      }
      drawdownTrades.push(trade.id);
    }
  }

  // Check current drawdown
  if (peak > 0 && cumulative < peak) {
    const currentDrawdownPct = ((peak - cumulative) / peak) * 100;
    if (currentDrawdownPct >= thresholdPercent) {
      return [{
        id: generateAlertHash('drawdown', drawdownTrades.slice(-5)),
        type: 'drawdown',
        severity: 'danger',
        title: 'Drawdown Warning',
        message: `Current drawdown is ${currentDrawdownPct.toFixed(1)}% from peak equity ($${peak.toFixed(0)} to $${cumulative.toFixed(0)}). Consider reducing size or taking a break.`,
        relatedTradeIds: filterIds(drawdownTrades.slice(-5)),
        timestamp: new Date(),
      }];
    }
  }

  return [];
}

// Check for losing streak
function checkLosingStreak(trades: TradeRecord[]): Alert[] {
  // Get closed trades with derived metrics
  const tradesWithMetrics = trades
    .map(t => ({ trade: t, metrics: getCachedMetrics(t) }))
    .filter(({ metrics }) => metrics.status === 'closed' && metrics.rMultiple !== null)
    .sort((a, b) => a.metrics.exitTime!.getTime() - b.metrics.exitTime!.getTime());

  if (tradesWithMetrics.length < 3) return [];

  // Count consecutive losses from the end
  let streakCount = 0;
  const streakTrades: (string | undefined)[] = [];

  for (let i = tradesWithMetrics.length - 1; i >= 0; i--) {
    if ((tradesWithMetrics[i].metrics.rMultiple ?? 0) < 0) {
      streakCount++;
      streakTrades.unshift(tradesWithMetrics[i].trade.id);
    } else {
      break;
    }
  }

  if (streakCount >= 5) {
    return [{
      id: generateAlertHash('losing_streak', streakTrades),
      type: 'losing_streak',
      severity: 'danger',
      title: 'Extended Losing Streak',
      message: `You have ${streakCount} consecutive losses. Stop trading immediately and review your approach.`,
      relatedTradeIds: filterIds(streakTrades),
      timestamp: new Date(),
    }];
  } else if (streakCount >= 3) {
    return [{
      id: generateAlertHash('losing_streak', streakTrades),
      type: 'losing_streak',
      severity: 'warning',
      title: 'Losing Streak',
      message: `You have ${streakCount} consecutive losses. Consider taking a break before your next trade.`,
      relatedTradeIds: filterIds(streakTrades),
      timestamp: new Date(),
    }];
  }

  return [];
}

// Main function to generate all alerts
export function generateAlerts(
  trades: TradeRecord[],
  settings: AlertSettings
): Alert[] {
  const allAlerts: Alert[] = [];

  if (settings.enabledAlerts.revenge_trade) {
    allAlerts.push(...checkRevengeTrades(trades, settings.revengeTradeWindowMinutes));
  }

  if (settings.enabledAlerts.overtrade) {
    allAlerts.push(...checkOvertrade(trades, settings.dailyTradeLimit));
  }

  if (settings.enabledAlerts.sizing_spike) {
    allAlerts.push(...checkSizingSpike(trades));
  }

  if (settings.enabledAlerts.edge_decay) {
    allAlerts.push(...checkEdgeDecay(trades));
  }

  if (settings.enabledAlerts.drawdown) {
    allAlerts.push(...checkDrawdown(trades, settings.drawdownWarningThreshold));
  }

  if (settings.enabledAlerts.losing_streak) {
    allAlerts.push(...checkLosingStreak(trades));
  }

  return allAlerts;
}

// Filter out dismissed alerts
export function filterDismissedAlerts(
  alerts: Alert[],
  dismissedHashes: Set<string>
): Alert[] {
  return alerts.filter(alert => !dismissedHashes.has(alert.id));
}
