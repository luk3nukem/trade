import type { TradeRecord, TradingSession, LevelEntry, TradeEvent } from '../types';
import { DETAIL_LEVEL_TYPES } from '../types';
import {
  getTradeRMetrics,
  getHoldReplayAnalysis,
  deriveAnalysisTFs,
  deriveExitType,
  getStopMoves,
  replayHold,
  getPostExitMilestones,
  getFavourableExtreme,
  calculateStopDistance,
  type TradeRMetrics,
} from './tradeCalculations';

// Helper function to calculate MAE distance
function calculateMaeDistance(entryPrice: number, maePrice: number | null | undefined): number | null {
  if (maePrice === null || maePrice === undefined) return null;
  return Math.abs(entryPrice - maePrice);
}

// Helper function to calculate MFE distance
function calculateMfeDistance(entryPrice: number, mfePrice: number | null | undefined): number | null {
  if (mfePrice === null || mfePrice === undefined) return null;
  return Math.abs(mfePrice - entryPrice);
}

// Metrics cache
const metricsCache = new WeakMap<TradeRecord, TradeRMetrics>();
function getCachedMetrics(trade: TradeRecord): TradeRMetrics {
  let metrics = metricsCache.get(trade);
  if (!metrics) {
    metrics = getTradeRMetrics(trade);
    metricsCache.set(trade, metrics);
  }
  return metrics;
}

// Level types that show a detail field
const DETAIL_TYPES = DETAIL_LEVEL_TYPES as readonly string[];

// Helper to check if a level type should show detail
const isDetailLevelType = (levelType: string): boolean => {
  return DETAIL_TYPES.includes(levelType.toLowerCase());
};

// Helper to create a grouping key for level type + detail
// Returns "fib · GP" for fib with detail, or just "fib" for fib without detail
const getLevelTypeKey = (level: LevelEntry): string => {
  const type = level.levelType || 'Unknown';
  const detail = (level as { levelDetail?: string }).levelDetail;
  if (detail && isDetailLevelType(type)) {
    return `${type} · ${detail}`;
  }
  return type;
};

// Generic group performance stats
export interface GroupStats {
  group: string;
  count: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  avgR: number;
  totalPnl: number;
  profitFactor: number;
  avgWinR: number;
  avgLossR: number;
  rStdDev: number;
}

// Time analysis types
export interface SessionStats extends GroupStats {
  session: TradingSession;
}

export interface DayOfWeekStats extends GroupStats {
  dayIndex: number;
  dayName: string;
}

export interface HourStats {
  hour: number;
  count: number;
  avgPnl: number;
  avgR: number;
  intensity: number;
}

export interface HoldTimePoint {
  tradeId?: string;
  holdMinutes: number;
  rMultiple: number;
  isWinner: boolean;
  pair: string;
}

export interface RDistributionBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  isPositive: boolean;
}

export interface PlannedVsActualPoint {
  tradeId?: string;
  plannedRR: number;
  actualRR: number;
  pair: string;
  isWinner: boolean;
}

export interface PositionSizePoint {
  tradeIndex: number;
  tradeId?: string;
  riskPercent: number;
  isWinner: boolean;
  pair: string;
  isOutlier: boolean;
}

export interface RadarDataPoint {
  axis: string;
  fullMark: number;
  [key: string]: string | number;
}

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquareDiff);
}

export function groupPerformanceBy(
  trades: TradeRecord[],
  field: keyof TradeRecord
): GroupStats[] {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed');
  const groups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const key = String(trade[field] ?? 'Unknown');
    const existing = groups.get(key) || [];
    existing.push(trade);
    groups.set(key, existing);
  }

  const results: GroupStats[] = [];

  for (const [group, groupTrades] of groups) {
    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);
    const breakevens = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) === 0);

    const rMultiples = groupTrades.map(t => getCachedMetrics(t).rMultiple ?? 0);
    const avgR = rMultiples.length > 0
      ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
      : 0;

    const totalPnl = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);

    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    const avgWinR = wins.length > 0
      ? wins.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / wins.length
      : 0;
    const avgLossR = losses.length > 0
      ? losses.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / losses.length
      : 0;

    const rStdDev = calculateStdDev(rMultiples);

    results.push({
      group,
      count: groupTrades.length,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: groupTrades.length > 0 ? (wins.length / groupTrades.length) * 100 : 0,
      avgR,
      totalPnl,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      avgWinR,
      avgLossR,
      rStdDev,
    });
  }

  return results.sort((a, b) => b.totalPnl - a.totalPnl);
}

export function getTimeAnalysis(trades: TradeRecord[]): {
  sessions: SessionStats[];
  daysOfWeek: DayOfWeekStats[];
  hourlyStats: HourStats[];
  holdTimeData: HoldTimePoint[];
} {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed' && getCachedMetrics(t).exitTime);

  // Group by session (derived from entry time)
  const sessionMap = new Map<TradingSession, TradeRecord[]>();
  for (const trade of closedTrades) {
    const session = getCachedMetrics(trade).session;
    const existing = sessionMap.get(session) || [];
    existing.push(trade);
    sessionMap.set(session, existing);
  }

  const sessions: SessionStats[] = [];
  for (const [session, groupTrades] of sessionMap) {
    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);
    const breakevens = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) === 0);
    const rMultiples = groupTrades.map(t => getCachedMetrics(t).rMultiple ?? 0);
    const avgR = rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length;
    const totalPnl = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
    const avgWinR = wins.length > 0 ? wins.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / wins.length : 0;
    const avgLossR = losses.length > 0 ? losses.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / losses.length : 0;
    const rStdDev = calculateStdDev(rMultiples);

    sessions.push({
      group: session,
      session,
      count: groupTrades.length,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: groupTrades.length > 0 ? (wins.length / groupTrades.length) * 100 : 0,
      avgR,
      totalPnl,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      avgWinR,
      avgLossR,
      rStdDev,
    });
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayGroups = new Map<number, TradeRecord[]>();

  for (const trade of closedTrades) {
    const dayIndex = new Date(trade.entryTime).getDay();
    const existing = dayGroups.get(dayIndex) || [];
    existing.push(trade);
    dayGroups.set(dayIndex, existing);
  }

  const daysOfWeek: DayOfWeekStats[] = [];
  for (let i = 0; i < 7; i++) {
    const dayTrades = dayGroups.get(i) || [];
    if (dayTrades.length === 0) {
      daysOfWeek.push({
        group: dayNames[i],
        dayIndex: i,
        dayName: dayNames[i],
        count: 0, wins: 0, losses: 0, breakevens: 0,
        winRate: 0, avgR: 0, totalPnl: 0, profitFactor: 0,
        avgWinR: 0, avgLossR: 0, rStdDev: 0,
      });
      continue;
    }

    const wins = dayTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = dayTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);
    const breakevens = dayTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) === 0);
    const rMultiples = dayTrades.map(t => getCachedMetrics(t).rMultiple ?? 0);
    const avgR = rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length;
    const totalPnl = dayTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);

    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    daysOfWeek.push({
      group: dayNames[i],
      dayIndex: i,
      dayName: dayNames[i],
      count: dayTrades.length,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: (wins.length / dayTrades.length) * 100,
      avgR,
      totalPnl,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      avgWinR: wins.length > 0 ? wins.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / wins.length : 0,
      avgLossR: losses.length > 0 ? losses.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / losses.length : 0,
      rStdDev: calculateStdDev(rMultiples),
    });
  }

  const hourGroups = new Map<number, TradeRecord[]>();
  for (const trade of closedTrades) {
    const hour = new Date(trade.entryTime).getHours();
    const existing = hourGroups.get(hour) || [];
    existing.push(trade);
    hourGroups.set(hour, existing);
  }

  let maxAbsPnl = 0;
  for (const [, hourTrades] of hourGroups) {
    const avgPnl = hourTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0) / hourTrades.length;
    maxAbsPnl = Math.max(maxAbsPnl, Math.abs(avgPnl));
  }

  const hourlyStats: HourStats[] = [];
  for (let h = 0; h < 24; h++) {
    const hourTrades = hourGroups.get(h) || [];
    if (hourTrades.length === 0) {
      hourlyStats.push({ hour: h, count: 0, avgPnl: 0, avgR: 0, intensity: 0 });
      continue;
    }
    const avgPnl = hourTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0) / hourTrades.length;
    const avgR = hourTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / hourTrades.length;
    const intensity = maxAbsPnl > 0 ? avgPnl / maxAbsPnl : 0;
    hourlyStats.push({ hour: h, count: hourTrades.length, avgPnl, avgR, intensity });
  }

  const holdTimeData: HoldTimePoint[] = closedTrades
    .filter(t => getCachedMetrics(t).holdDuration !== undefined)
    .map(t => ({
      tradeId: t.id,
      holdMinutes: getCachedMetrics(t).holdDuration!,
      rMultiple: getCachedMetrics(t).rMultiple ?? 0,
      isWinner: (getCachedMetrics(t).rMultiple ?? 0) > 0,
      pair: t.pair,
    }));

  return { sessions, daysOfWeek, hourlyStats, holdTimeData };
}

// Timeframe analysis
export interface TimeframeStats extends GroupStats {
  timeframe: string;
}

export function getTimeframeAnalysis(trades: TradeRecord[]): {
  analysisTF: TimeframeStats[];
  entryTF: TimeframeStats[];
  analysisTFCount: TimeframeStats[]; // TF count analysis - does analyzing more TFs correlate with better results?
} {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed');

  // Group by analysis timeframe (trades can appear in multiple groups)
  const analysisTFGroups = new Map<string, TradeRecord[]>();
  for (const trade of closedTrades) {
    const derivedTFs = deriveAnalysisTFs(trade);
    const tfs = derivedTFs.length > 0 ? derivedTFs : ['Not set'];
    for (const tf of tfs) {
      const existing = analysisTFGroups.get(tf) || [];
      existing.push(trade);
      analysisTFGroups.set(tf, existing);
    }
  }

  const analysisTF: TimeframeStats[] = [];
  for (const [tf, tfTrades] of analysisTFGroups) {
    const wins = tfTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = tfTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);
    const breakevens = tfTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) === 0);
    const rMultiples = tfTrades.map(t => getCachedMetrics(t).rMultiple ?? 0);
    const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
    const totalPnl = tfTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    analysisTF.push({
      group: tf,
      timeframe: tf,
      count: tfTrades.length,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: (wins.length / tfTrades.length) * 100,
      avgR,
      totalPnl,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      avgWinR: wins.length > 0 ? wins.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / wins.length : 0,
      avgLossR: losses.length > 0 ? losses.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / losses.length : 0,
      rStdDev: calculateStdDev(rMultiples),
    });
  }

  // Group by analysis TF count (how many timeframes were analyzed)
  const tfCountGroups = new Map<string, TradeRecord[]>();
  for (const trade of closedTrades) {
    const tfCount = deriveAnalysisTFs(trade).length;
    const label = tfCount === 0 ? 'None' : tfCount === 1 ? '1 TF' : `${tfCount} TFs`;
    const existing = tfCountGroups.get(label) || [];
    existing.push(trade);
    tfCountGroups.set(label, existing);
  }

  const analysisTFCount: TimeframeStats[] = [];
  for (const [label, countTrades] of tfCountGroups) {
    const wins = countTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = countTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);
    const breakevens = countTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) === 0);
    const rMultiples = countTrades.map(t => getCachedMetrics(t).rMultiple ?? 0);
    const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
    const totalPnl = countTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    analysisTFCount.push({
      group: label,
      timeframe: label,
      count: countTrades.length,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: (wins.length / countTrades.length) * 100,
      avgR,
      totalPnl,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      avgWinR: wins.length > 0 ? wins.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / wins.length : 0,
      avgLossR: losses.length > 0 ? losses.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / losses.length : 0,
      rStdDev: calculateStdDev(rMultiples),
    });
  }

  // Group by entry timeframe
  const entryTFGroups = new Map<string, TradeRecord[]>();
  for (const trade of closedTrades) {
    const tf = trade.entryTF || 'Not set';
    const existing = entryTFGroups.get(tf) || [];
    existing.push(trade);
    entryTFGroups.set(tf, existing);
  }

  const entryTF: TimeframeStats[] = [];
  for (const [tf, tfTrades] of entryTFGroups) {
    const wins = tfTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = tfTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);
    const breakevens = tfTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) === 0);
    const rMultiples = tfTrades.map(t => getCachedMetrics(t).rMultiple ?? 0);
    const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
    const totalPnl = tfTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    entryTF.push({
      group: tf,
      timeframe: tf,
      count: tfTrades.length,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: (wins.length / tfTrades.length) * 100,
      avgR,
      totalPnl,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      avgWinR: wins.length > 0 ? wins.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / wins.length : 0,
      avgLossR: losses.length > 0 ? losses.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / losses.length : 0,
      rStdDev: calculateStdDev(rMultiples),
    });
  }

  // Sort by count descending
  analysisTF.sort((a, b) => b.count - a.count);
  entryTF.sort((a, b) => b.count - a.count);
  // Sort TF count by label (None, 1 TF, 2 TFs, etc.)
  analysisTFCount.sort((a, b) => {
    const aNum = a.group === 'None' ? 0 : parseInt(a.group);
    const bNum = b.group === 'None' ? 0 : parseInt(b.group);
    return aNum - bNum;
  });

  return { analysisTF, entryTF, analysisTFCount };
}

export function getRMultipleDistribution(trades: TradeRecord[]): RDistributionBucket[] {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed' && getCachedMetrics(t).rMultiple !== undefined);

  const buckets: RDistributionBucket[] = [
    { label: '< -2R', min: -Infinity, max: -2, count: 0, isPositive: false },
    { label: '-2R to -1R', min: -2, max: -1, count: 0, isPositive: false },
    { label: '-1R to -0.5R', min: -1, max: -0.5, count: 0, isPositive: false },
    { label: '-0.5R to 0', min: -0.5, max: 0, count: 0, isPositive: false },
    { label: '0 to 0.5R', min: 0, max: 0.5, count: 0, isPositive: true },
    { label: '0.5R to 1R', min: 0.5, max: 1, count: 0, isPositive: true },
    { label: '1R to 2R', min: 1, max: 2, count: 0, isPositive: true },
    { label: '2R to 3R', min: 2, max: 3, count: 0, isPositive: true },
    { label: '3R+', min: 3, max: Infinity, count: 0, isPositive: true },
  ];

  for (const trade of closedTrades) {
    const r = getCachedMetrics(trade).rMultiple!;
    for (const bucket of buckets) {
      if (r > bucket.min && r <= bucket.max) {
        bucket.count++;
        break;
      }
      if (r === 0 && bucket.min === -0.5 && bucket.max === 0) {
        bucket.count++;
        break;
      }
    }
  }

  return buckets;
}

export function getPlannedVsActual(trades: TradeRecord[]): PlannedVsActualPoint[] {
  return trades
    .filter(t => {
      const metrics = getCachedMetrics(t);
      return metrics.status === 'closed' &&
        metrics.plannedRR !== null &&
        metrics.actualRR !== null;
    })
    .map(t => {
      const metrics = getCachedMetrics(t);
      return {
        tradeId: t.id,
        plannedRR: metrics.plannedRR!,
        actualRR: metrics.actualRR!,
        pair: t.pair,
        isWinner: (metrics.rMultiple ?? 0) > 0,
      };
    });
}

export function getPositionSizingData(trades: TradeRecord[]): {
  points: PositionSizePoint[];
  avgRiskPercent: number;
  stdDev: number;
} {
  const closedTrades = trades
    .filter(t => getCachedMetrics(t).status === 'closed' && t.riskPercent !== undefined)
    .sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

  if (closedTrades.length === 0) {
    return { points: [], avgRiskPercent: 0, stdDev: 0 };
  }

  const riskPercents = closedTrades.map(t => t.riskPercent!);
  const avgRiskPercent = riskPercents.reduce((a, b) => a + b, 0) / riskPercents.length;
  const stdDev = calculateStdDev(riskPercents);
  const outlierThreshold = 2 * stdDev;

  const points: PositionSizePoint[] = closedTrades.map((t, i) => ({
    tradeIndex: i + 1,
    tradeId: t.id,
    riskPercent: t.riskPercent!,
    isWinner: (getCachedMetrics(t).rMultiple ?? 0) > 0,
    pair: t.pair,
    isOutlier: Math.abs(t.riskPercent! - avgRiskPercent) > outlierThreshold,
  }));

  return { points, avgRiskPercent, stdDev };
}

export function getSetupRadarData(
  setupStats: GroupStats[],
  topN: number = 3,
  minTrades: number = 5
): RadarDataPoint[] {
  const qualifiedSetups = setupStats
    .filter(s => s.count >= minTrades)
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  if (qualifiedSetups.length === 0) return [];

  const maxWinRate = Math.max(...qualifiedSetups.map(s => s.winRate));
  const maxAvgR = Math.max(...qualifiedSetups.map(s => Math.max(0, s.avgR)));
  const maxPF = Math.max(...qualifiedSetups.map(s => Math.min(s.profitFactor, 5)));
  const maxCount = Math.max(...qualifiedSetups.map(s => s.count));
  const maxConsistency = Math.max(...qualifiedSetups.map(s => s.rStdDev > 0 ? 1 / s.rStdDev : 1));

  const axes = ['Win Rate', 'Avg R', 'Profit Factor', 'Trade Count', 'Consistency'];

  return axes.map(axis => {
    const point: RadarDataPoint = { axis, fullMark: 100 };

    for (const setup of qualifiedSetups) {
      let value: number;
      switch (axis) {
        case 'Win Rate':
          value = maxWinRate > 0 ? (setup.winRate / maxWinRate) * 100 : 0;
          break;
        case 'Avg R':
          value = maxAvgR > 0 ? (Math.max(0, setup.avgR) / maxAvgR) * 100 : 0;
          break;
        case 'Profit Factor':
          value = maxPF > 0 ? (Math.min(setup.profitFactor, 5) / maxPF) * 100 : 0;
          break;
        case 'Trade Count':
          value = maxCount > 0 ? (setup.count / maxCount) * 100 : 0;
          break;
        case 'Consistency':
          const consistency = setup.rStdDev > 0 ? 1 / setup.rStdDev : 1;
          value = maxConsistency > 0 ? (consistency / maxConsistency) * 100 : 0;
          break;
        default:
          value = 0;
      }
      point[setup.group] = Math.round(value);
    }

    return point;
  });
}

export function getPairInsights(pairStats: GroupStats[]): string[] {
  const insights: string[] = [];
  const qualified = pairStats.filter(p => p.count >= 5);

  if (qualified.length === 0) {
    return ['Not enough data for pair insights (need at least 5 trades per pair).'];
  }

  const bestByPF = [...qualified].sort((a, b) => b.profitFactor - a.profitFactor)[0];
  if (bestByPF && bestByPF.profitFactor > 1) {
    insights.push(
      'Your best pair is ' + bestByPF.group + ' (profit factor ' + bestByPF.profitFactor.toFixed(2) + ' over ' + bestByPF.count + ' trades).'
    );
  }

  const worstPairs = qualified.filter(p => p.avgR < 0);
  if (worstPairs.length > 0) {
    const worst = worstPairs.sort((a, b) => a.avgR - b.avgR)[0];
    insights.push(
      'Consider dropping ' + worst.group + ' — negative expectancy (' + worst.avgR.toFixed(2) + 'R) over ' + worst.count + ' trades.'
    );
  }

  return insights;
}

export function getSetupInsights(setupStats: GroupStats[]): string[] {
  const insights: string[] = [];
  const qualified = setupStats.filter(s => s.count >= 5);

  if (qualified.length < 2) {
    return ['Not enough data for setup insights (need at least 5 trades per setup, 2+ setups).'];
  }

  const bestByR = [...qualified].sort((a, b) => b.avgR - a.avgR)[0];
  insights.push('Your highest-edge setup is ' + bestByR.group + ' (' + bestByR.avgR.toFixed(2) + 'R avg).');

  const mostTraded = [...qualified].sort((a, b) => b.count - a.count)[0];
  const bestExpectancy = [...qualified].sort((a, b) => b.avgR - a.avgR)[0];

  if (mostTraded.group !== bestExpectancy.group && bestExpectancy.avgR > mostTraded.avgR) {
    insights.push(
      'You trade ' + mostTraded.group + ' the most (' + mostTraded.count + ') but ' + bestExpectancy.group + ' has better expectancy — consider shifting focus.'
    );
  }

  return insights;
}

export function getTimeInsights(
  sessions: SessionStats[],
  daysOfWeek: DayOfWeekStats[]
): string[] {
  const insights: string[] = [];

  const qualifiedSessions = sessions.filter(s => s.count >= 3);
  if (qualifiedSessions.length >= 2) {
    const bestSession = [...qualifiedSessions].sort((a, b) => b.avgR - a.avgR)[0];
    const worstSession = [...qualifiedSessions].sort((a, b) => a.avgR - b.avgR)[0];

    if (bestSession.avgR > 0) {
      const sessionName = bestSession.session.charAt(0).toUpperCase() + bestSession.session.slice(1);
      insights.push(
        sessionName + ' is your strongest session (avg ' + bestSession.avgR.toFixed(2) + 'R over ' + bestSession.count + ' trades).'
      );
    }

    if (worstSession.avgR < 0 && worstSession.session !== bestSession.session) {
      insights.push(
        'You underperform during ' + worstSession.session + ' (' + worstSession.avgR.toFixed(2) + 'R) — consider sitting out or reducing size.'
      );
    }
  }

  const qualifiedDays = daysOfWeek.filter(d => d.count >= 3);
  if (qualifiedDays.length >= 2) {
    const worstDay = [...qualifiedDays].sort((a, b) => a.avgR - b.avgR)[0];

    if (worstDay.avgR < 0) {
      insights.push(
        'You underperform on ' + worstDay.dayName + 's (' + worstDay.avgR.toFixed(2) + 'R) — consider reducing activity.'
      );
    }
  }

  return insights;
}


// ============================================
// STOP PLACEMENT ANALYTICS
// ============================================

export interface MAEBucket {
  label: string;
  min: number;
  max: number;
  winners: number;
  losers: number;
  total: number;
}

export interface StopEfficiencyPoint {
  tradeId?: string;
  stopDistance: number;
  stopDistancePercent: number; // Stop distance as % of entry price
  rMultiple: number;
  isWinner: boolean;
  pair: string;
}

export interface MAEOutcomePoint {
  tradeId?: string;
  mae: number;
  maeR: number;
  rMultiple: number;
  isWinner: boolean;
  pair: string;
  stopDistance: number;
}

export interface StopPlacementSummary {
  avgStopDistance: number;
  avgMAEWinners: number;
  avgMAELosers: number;
  winnersMAEUnderHalfStop: number;
  winnersMAEUnderHalfStopPercent: number;
  losersMAEOverEightyStop: number;
  losersMAEOverEightyStopPercent: number;
  suggestedOptimalStop: number;
  tradesWithMAE: number;
  totalTrades: number;
}

export function getMAEDistribution(trades: TradeRecord[], bucketCount: number = 6): MAEBucket[] {
  const tradesWithMAE = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    getCachedMetrics(t).maeR !== undefined &&
    getCachedMetrics(t).stopDistance !== undefined
  );

  if (tradesWithMAE.length === 0) return [];

  // Calculate MAE as percentage of stop for bucketing
  const maePercents = tradesWithMAE.map(t => (getCachedMetrics(t).maeR! / 1) * 100); // maeR is already in R terms
  const maxMAE = Math.max(...maePercents);
  const bucketSize = Math.ceil(maxMAE / bucketCount);

  const buckets: MAEBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const min = i * bucketSize;
    const max = (i + 1) * bucketSize;
    const label = i === bucketCount - 1 ? min + '%+' : min + '-' + max + '%';

    const inBucket = tradesWithMAE.filter(t => {
      const maePercent = (getCachedMetrics(t).maeR! / 1) * 100;
      if (i === bucketCount - 1) return maePercent >= min;
      return maePercent >= min && maePercent < max;
    });

    buckets.push({
      label,
      min,
      max: i === bucketCount - 1 ? Infinity : max,
      winners: inBucket.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0).length,
      losers: inBucket.filter(t => (getCachedMetrics(t).rMultiple ?? 0) <= 0).length,
      total: inBucket.length,
    });
  }

  return buckets;
}

export function getStopEfficiencyData(trades: TradeRecord[]): StopEfficiencyPoint[] {
  return trades
    .filter(t => {
      const metrics = getCachedMetrics(t);
      return metrics.status === 'closed' && metrics.stopDistance !== undefined && t.entryPrice !== undefined;
    })
    .map(t => {
      const metrics = getCachedMetrics(t);
      return {
        tradeId: t.id,
        stopDistance: metrics.stopDistance!,
        stopDistancePercent: (metrics.stopDistance! / t.entryPrice) * 100,
        rMultiple: metrics.rMultiple ?? 0,
        isWinner: (metrics.rMultiple ?? 0) > 0,
        pair: t.pair,
      };
    });
}

export function getMAEOutcomeData(trades: TradeRecord[]): MAEOutcomePoint[] {
  return trades
    .filter(t => {
      const metrics = getCachedMetrics(t);
      return metrics.status === 'closed' &&
        metrics.maePrice !== null &&
        metrics.maeR !== undefined &&
        metrics.stopDistance !== undefined;
    })
    .map(t => {
      const metrics = getCachedMetrics(t);
      const maeDistance = calculateMaeDistance(t.entryPrice, metrics.maePrice);
      return {
        tradeId: t.id,
        mae: maeDistance ?? 0,
        maeR: metrics.maeR!,
        rMultiple: metrics.rMultiple ?? 0,
        isWinner: (metrics.rMultiple ?? 0) > 0,
        pair: t.pair,
        stopDistance: metrics.stopDistance!,
      };
    });
}

export function getStopPlacementSummary(trades: TradeRecord[]): StopPlacementSummary {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed');
  const tradesWithMAE = closedTrades.filter(t => {
    const metrics = getCachedMetrics(t);
    return metrics.maeR !== undefined && metrics.stopDistance !== undefined;
  });

  const winners = tradesWithMAE.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
  const losers = tradesWithMAE.filter(t => (getCachedMetrics(t).rMultiple ?? 0) <= 0);

  const tradesWithStopDistance = closedTrades.filter(t => getCachedMetrics(t).stopDistance);
  const avgStopDistance = tradesWithStopDistance.length > 0
    ? tradesWithStopDistance.reduce((sum, t) => sum + getCachedMetrics(t).stopDistance!, 0) /
      tradesWithStopDistance.length
    : 0;

  const avgMAEWinners = winners.length > 0
    ? winners.reduce((sum, t) => sum + getCachedMetrics(t).maeR!, 0) / winners.length
    : 0;

  const avgMAELosers = losers.length > 0
    ? losers.reduce((sum, t) => sum + getCachedMetrics(t).maeR!, 0) / losers.length
    : 0;

  // Winners where MAE < 50% of stop (maeR < 0.5)
  const winnersMAEUnderHalfStop = winners.filter(t => getCachedMetrics(t).maeR! < 0.5).length;
  const winnersMAEUnderHalfStopPercent = winners.length > 0
    ? (winnersMAEUnderHalfStop / winners.length) * 100
    : 0;

  // Losers where MAE > 80% of stop (maeR > 0.8)
  const losersMAEOverEightyStop = losers.filter(t => getCachedMetrics(t).maeR! > 0.8).length;
  const losersMAEOverEightyStopPercent = losers.length > 0
    ? (losersMAEOverEightyStop / losers.length) * 100
    : 0;

  // Suggested optimal stop: MAE value where 90% of winners are covered
  let suggestedOptimalStop = 0;
  if (winners.length > 0) {
    const sortedMAEs = winners.map(t => getCachedMetrics(t).maeR!).sort((a, b) => a - b);
    const index90 = Math.floor(sortedMAEs.length * 0.9);
    suggestedOptimalStop = sortedMAEs[index90] ?? sortedMAEs[sortedMAEs.length - 1];
  }

  return {
    avgStopDistance,
    avgMAEWinners,
    avgMAELosers,
    winnersMAEUnderHalfStop,
    winnersMAEUnderHalfStopPercent,
    losersMAEOverEightyStop,
    losersMAEOverEightyStopPercent,
    suggestedOptimalStop,
    tradesWithMAE: tradesWithMAE.length,
    totalTrades: closedTrades.length,
  };
}

export function getStopPlacementInsights(summary: StopPlacementSummary): string[] {
  const insights: string[] = [];

  if (summary.tradesWithMAE < 10) {
    return ['Need more trades with MAE data for meaningful insights (have ' + summary.tradesWithMAE + ', recommend 10+).'];
  }

  if (summary.winnersMAEUnderHalfStopPercent > 60) {
    insights.push(
      Math.round(summary.winnersMAEUnderHalfStopPercent) + '% of your winners never drew down past half your stop. ' +
      'You could potentially tighten stops to ' + (summary.suggestedOptimalStop * 100).toFixed(0) + '% of current size.'
    );
  }

  if (summary.losersMAEOverEightyStopPercent > 70) {
    insights.push(
      Math.round(summary.losersMAEOverEightyStopPercent) + '% of losers hit >80% of stop before stopping out — your stops are in appropriate zones.'
    );
  }

  if (summary.avgMAEWinners < summary.avgMAELosers * 0.5) {
    insights.push(
      'Winners have significantly lower MAE (' + summary.avgMAEWinners.toFixed(2) + 'R) vs losers (' + 
      summary.avgMAELosers.toFixed(2) + 'R). Good entries tend to work quickly.'
    );
  }

  return insights;
}

// ============================================
// EXIT MANAGEMENT ANALYTICS
// ============================================

export interface MFECapturePoint {
  tradeId?: string;
  mfe: number;
  mfeR: number;
  exitDistance: number;
  exitR: number;
  capturePercent: number;
  isWinner: boolean;
  pair: string;
  exitType: string;
}

export interface ProfitGivebackBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface ExitTypeStats {
  exitType: string;
  count: number;
  wins: number;
  winRate: number;
  avgR: number;
  avgMFECapture: number;
  profitFactor: number;
  totalPnl: number;
}

export interface PartialsComparison {
  withPartials: {
    count: number;
    avgR: number;
    winRate: number;
    profitFactor: number;
    avgMFECapture: number;
  };
  withoutPartials: {
    count: number;
    avgR: number;
    winRate: number;
    profitFactor: number;
    avgMFECapture: number;
  };
}

export interface SimulationResult {
  strategyName: string;
  equityCurve: { tradeIndex: number; cumulative: number }[];
  totalPnl: number;
  profitFactor: number;
  avgR: number;
  maxDrawdown: number;
  winRate: number;
  tradesExcludedImplausible?: number; // Trades excluded due to R values > 50 (data corruption)
}

export function getMFECaptureData(trades: TradeRecord[]): MFECapturePoint[] {
  return trades
    .filter(t =>
      getCachedMetrics(t).status === 'closed' &&
      getCachedMetrics(t).mfeR !== undefined &&
      getCachedMetrics(t).mfeR! > 0 &&
      getCachedMetrics(t).rMultiple !== undefined
    )
    .map(t => {
      const metrics = getCachedMetrics(t);
      const exitR = Math.abs(metrics.rMultiple!);
      const capturePercent = metrics.mfeR! > 0 ? (exitR / metrics.mfeR!) * 100 : 0;
      const mfeDistance = calculateMfeDistance(t.entryPrice, metrics.mfePrice);

      return {
        tradeId: t.id,
        mfe: mfeDistance ?? 0,
        mfeR: metrics.mfeR!,
        exitDistance: metrics.actualRR ?? 0,
        exitR,
        capturePercent: Math.min(capturePercent, 100), // Cap at 100%
        isWinner: (metrics.rMultiple ?? 0) > 0,
        pair: t.pair,
        exitType: deriveExitType(t) ?? 'unknown',
      };
    });
}

export function getProfitGivebackData(trades: TradeRecord[]): {
  buckets: ProfitGivebackBucket[];
  avgGiveback: number;
  tradesOverOneR: number;
} {
  // Only winners where MFE > actual exit (gave back profit)
  const givebackTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    (getCachedMetrics(t).rMultiple ?? 0) > 0 &&
    getCachedMetrics(t).mfeR !== undefined &&
    getCachedMetrics(t).mfeR! > Math.abs(getCachedMetrics(t).rMultiple ?? 0)
  );

  const givebacks = givebackTrades.map(t => getCachedMetrics(t).mfeR! - Math.abs(getCachedMetrics(t).rMultiple!));
  
  const buckets: ProfitGivebackBucket[] = [
    { label: '0-0.5R', min: 0, max: 0.5, count: 0 },
    { label: '0.5-1R', min: 0.5, max: 1, count: 0 },
    { label: '1-1.5R', min: 1, max: 1.5, count: 0 },
    { label: '1.5-2R', min: 1.5, max: 2, count: 0 },
    { label: '2R+', min: 2, max: Infinity, count: 0 },
  ];

  for (const g of givebacks) {
    for (const bucket of buckets) {
      if (g >= bucket.min && g < bucket.max) {
        bucket.count++;
        break;
      }
    }
  }

  const avgGiveback = givebacks.length > 0
    ? givebacks.reduce((a, b) => a + b, 0) / givebacks.length
    : 0;

  const tradesOverOneR = givebacks.filter(g => g >= 1).length;

  return { buckets, avgGiveback, tradesOverOneR };
}

export function getExitTypeComparison(trades: TradeRecord[]): ExitTypeStats[] {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed' && deriveExitType(t));
  const groups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const key = deriveExitType(trade)!;
    const existing = groups.get(key) || [];
    existing.push(trade);
    groups.set(key, existing);
  }

  const results: ExitTypeStats[] = [];

  for (const [exitType, groupTrades] of groups) {
    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) <= 0);

    const avgR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / groupTrades.length;

    // MFE capture for trades with MFE data
    const withMFE = groupTrades.filter(t => getCachedMetrics(t).mfeR !== undefined && getCachedMetrics(t).mfeR! > 0);
    const avgMFECapture = withMFE.length > 0
      ? withMFE.reduce((sum, t) => {
          const exitR = Math.abs(getCachedMetrics(t).rMultiple ?? 0);
          return sum + (exitR / getCachedMetrics(t).mfeR!) * 100;
        }, 0) / withMFE.length
      : 0;

    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    const totalPnl = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);

    results.push({
      exitType,
      count: groupTrades.length,
      wins: wins.length,
      winRate: (wins.length / groupTrades.length) * 100,
      avgR,
      avgMFECapture: Math.min(avgMFECapture, 100),
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      totalPnl,
    });
  }

  return results.sort((a, b) => b.totalPnl - a.totalPnl);
}

export function getPartialsComparison(trades: TradeRecord[]): PartialsComparison | null {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed');
  // "Partials" = trades with multiple exits (scaled out)
  const withPartials = closedTrades.filter(t => t.exits && t.exits.length > 1);
  const withoutPartials = closedTrades.filter(t => !t.exits || t.exits.length <= 1);

  if (withPartials.length < 3 || withoutPartials.length < 3) return null;

  const calcStats = (arr: TradeRecord[]) => {
    const wins = arr.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = arr.filter(t => (getCachedMetrics(t).rMultiple ?? 0) <= 0);
    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));

    const withMFE = arr.filter(t => getCachedMetrics(t).mfeR !== undefined && getCachedMetrics(t).mfeR! > 0);
    const avgMFECapture = withMFE.length > 0
      ? withMFE.reduce((sum, t) => {
          const exitR = Math.abs(getCachedMetrics(t).rMultiple ?? 0);
          return sum + (exitR / getCachedMetrics(t).mfeR!) * 100;
        }, 0) / withMFE.length
      : 0;

    return {
      count: arr.length,
      avgR: arr.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / arr.length,
      winRate: (wins.length / arr.length) * 100,
      profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
      avgMFECapture: Math.min(avgMFECapture, 100),
    };
  };

  return {
    withPartials: calcStats(withPartials),
    withoutPartials: calcStats(withoutPartials),
  };
}

export type SimulationStrategy = 'actual' | 'full_tp1' | 'half_tp1_trail' | 'three_quarter_runner' | 'trailing_only';

export function simulateExitStrategy(
  trades: TradeRecord[],
  strategy: SimulationStrategy,
  trailR: number = 0.5
): SimulationResult & { tradesExcludedImplausible: number } {
  // Filter to closed trades with MFE price data
  const closedTrades = trades
    .filter(t => {
      const metrics = getCachedMetrics(t);
      return metrics.status === 'closed' && (metrics.mfePrice !== null || metrics.mfeR !== undefined);
    })
    .sort((a, b) => new Date(getCachedMetrics(a).exitTime!).getTime() - new Date(getCachedMetrics(b).exitTime!).getTime());

  const equityCurve: { tradeIndex: number; cumulative: number }[] = [];
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const rMultiples: number[] = [];
  let excludedImplausible = 0;
  let tradeIndex = 0;

  for (const trade of closedTrades) {
    // Use centralized R-metrics calculation to ensure original stop is used
    const metrics = getCachedMetrics(trade);

    // Skip trades with implausible R values (data corruption from stop adjustments)
    if (metrics?.isImplausible) {
      excludedImplausible++;
      continue;
    }

    // Get properly calculated R metrics
    const mfeR = metrics?.mfeR ?? 0;
    const maeR = metrics?.maeR ?? 1; // Assume full stop if no MAE
    const actualR = metrics.rMultiple ?? 0;
    const plannedRR = metrics.plannedRR ?? 2;

    let simulatedR: number;

    switch (strategy) {
      case 'actual':
        simulatedR = actualR;
        break;

      case 'full_tp1':
        // Exit 100% at TP1 if MFE reached it
        if (mfeR >= plannedRR) {
          simulatedR = plannedRR;
        } else if (maeR >= 1) {
          simulatedR = -1; // Stopped out
        } else {
          simulatedR = actualR; // Didn't reach either
        }
        break;

      case 'half_tp1_trail':
        // 50% at TP1, trail rest
        if (mfeR >= plannedRR) {
          const firstHalf = plannedRR * 0.5;
          // Second half: either got to MFE minus trail, or stopped at entry
          const secondHalf = maeR >= 1 ? 0 : Math.max(0, mfeR - trailR) * 0.5;
          simulatedR = firstHalf + secondHalf;
        } else if (maeR >= 1) {
          simulatedR = -1;
        } else {
          simulatedR = actualR;
        }
        break;

      case 'three_quarter_runner':
        // 75% at TP1, 25% runner
        if (mfeR >= plannedRR) {
          const firstPart = plannedRR * 0.75;
          const runner = maeR >= 1 ? 0 : Math.max(0, mfeR - trailR) * 0.25;
          simulatedR = firstPart + runner;
        } else if (maeR >= 1) {
          simulatedR = -1;
        } else {
          simulatedR = actualR;
        }
        break;

      case 'trailing_only':
        // Pure trailing stop from entry
        if (maeR >= 1) {
          simulatedR = -1;
        } else {
          simulatedR = Math.max(0, mfeR - trailR);
        }
        break;

      default:
        simulatedR = actualR;
    }

    tradeIndex++;
    rMultiples.push(simulatedR);
    cumulative += simulatedR;

    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    equityCurve.push({ tradeIndex, cumulative });
  }

  const wins = rMultiples.filter(r => r > 0);
  const losses = rMultiples.filter(r => r <= 0);
  const grossWins = wins.reduce((a, b) => a + b, 0);
  const grossLosses = Math.abs(losses.reduce((a, b) => a + b, 0));

  const strategyNames: Record<SimulationStrategy, string> = {
    actual: 'Actual Results',
    full_tp1: 'Full Exit at TP1',
    half_tp1_trail: '50% TP1, Trail Rest',
    three_quarter_runner: '75% TP1, 25% Runner',
    trailing_only: 'Trailing Stop Only',
  };

  return {
    strategyName: strategyNames[strategy],
    equityCurve,
    totalPnl: cumulative,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    avgR: rMultiples.length > 0 ? cumulative / rMultiples.length : 0,
    maxDrawdown,
    winRate: rMultiples.length > 0 ? (wins.length / rMultiples.length) * 100 : 0,
    tradesExcludedImplausible: excludedImplausible,
  };
}

// Fixed R Target Simulation Types
export interface FixedRTargetResult extends SimulationResult {
  targetR: number;
  tradesSimulated: number;
  tradesExcluded: number;
  tradesExcludedImplausible: number;
}

/**
 * Simulate exiting at a fixed R target regardless of the trade's actual target.
 *
 * Logic for each trade:
 * - If mfeR >= targetR: trade reached the fixed target, result = +targetR
 * - If mfeR < targetR AND maeR >= 1: trade never reached target and hit stop, result = -1R
 * - Otherwise (rare): exclude from simulation (e.g., manually closed before either)
 *
 * Uses centralized R-metrics calculation to ensure original stop distance is used.
 * Trades with implausible R values (>50R) are excluded.
 */
export function simulateFixedRTarget(
  trades: TradeRecord[],
  targetR: number
): FixedRTargetResult {
  // Filter to closed trades with MFE price data
  const closedTrades = trades
    .filter(t => {
      const metrics = getCachedMetrics(t);
      return metrics.status === 'closed' && (metrics.mfePrice !== null || metrics.mfeR !== undefined);
    })
    .sort((a, b) => new Date(getCachedMetrics(a).exitTime!).getTime() - new Date(getCachedMetrics(b).exitTime!).getTime());

  const equityCurve: { tradeIndex: number; cumulative: number }[] = [];
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const rMultiples: number[] = [];
  let excluded = 0;
  let excludedImplausible = 0;

  for (const trade of closedTrades) {
    // Use centralized R-metrics calculation to ensure original stop is used
    const metrics = getCachedMetrics(trade);

    // Skip trades with implausible R values (data corruption from stop adjustments)
    if (metrics?.isImplausible) {
      excludedImplausible++;
      continue;
    }

    // Get properly calculated R metrics
    const mfeR = metrics?.mfeR ?? 0;
    const maeR = metrics?.maeR ?? 0;

    let simulatedR: number | null = null;

    if (mfeR >= targetR) {
      // Trade reached the fixed target - full exit at targetR
      simulatedR = targetR;
    } else if (maeR >= 1) {
      // Trade never reached target and hit the stop - loss
      simulatedR = -1;
    } else {
      // Trade never reached target OR stop (rare: manual close, time exit, etc.)
      // Exclude from simulation
      excluded++;
      continue;
    }

    rMultiples.push(simulatedR);
    cumulative += simulatedR;

    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    equityCurve.push({ tradeIndex: rMultiples.length, cumulative });
  }

  const wins = rMultiples.filter(r => r > 0);
  const losses = rMultiples.filter(r => r <= 0);
  const grossWins = wins.reduce((a, b) => a + b, 0);
  const grossLosses = Math.abs(losses.reduce((a, b) => a + b, 0));

  return {
    strategyName: `Fixed ${targetR.toFixed(2)}R Target`,
    equityCurve,
    totalPnl: cumulative,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    avgR: rMultiples.length > 0 ? cumulative / rMultiples.length : 0,
    maxDrawdown,
    winRate: rMultiples.length > 0 ? (wins.length / rMultiples.length) * 100 : 0,
    targetR,
    tradesSimulated: rMultiples.length,
    tradesExcluded: excluded,
    tradesExcludedImplausible: excludedImplausible,
  };
}

/**
 * Find the optimal fixed R target by sweeping from 0.5R to 5R in 0.25R increments.
 * Returns the targetR that maximizes total R.
 */
export function findOptimalFixedRTarget(trades: TradeRecord[]): {
  optimalR: number;
  optimalTotalR: number;
  results: FixedRTargetResult[];
} {
  const results: FixedRTargetResult[] = [];
  let optimalR = 1.0;
  let optimalTotalR = -Infinity;

  // Sweep from 0.5R to 5R in 0.25R increments
  for (let r = 0.5; r <= 5; r += 0.25) {
    const result = simulateFixedRTarget(trades, r);
    results.push(result);

    if (result.totalPnl > optimalTotalR) {
      optimalTotalR = result.totalPnl;
      optimalR = r;
    }
  }

  return { optimalR, optimalTotalR, results };
}

export function getExitManagementInsights(
  mfeCaptureData: MFECapturePoint[],
  givebackData: { avgGiveback: number; tradesOverOneR: number },
  partialsComparison: PartialsComparison | null
): string[] {
  const insights: string[] = [];

  if (mfeCaptureData.length < 5) {
    return ['Need more trades with MFE data for meaningful exit insights.'];
  }

  const avgCapture = mfeCaptureData.reduce((sum, d) => sum + d.capturePercent, 0) / mfeCaptureData.length;
  insights.push('On average you capture ' + avgCapture.toFixed(0) + '% of available moves.');

  if (givebackData.avgGiveback > 0.5) {
    insights.push(
      'You gave back an average of ' + givebackData.avgGiveback.toFixed(2) + 'R per winning trade. ' +
      givebackData.tradesOverOneR + ' trades gave back more than 1R — these are exit management opportunities.'
    );
  }

  if (partialsComparison) {
    const { withPartials, withoutPartials } = partialsComparison;
    if (withPartials.avgR > withoutPartials.avgR) {
      insights.push(
        'Partial exits produce avg ' + withPartials.avgR.toFixed(2) + 'R vs ' +
        withoutPartials.avgR.toFixed(2) + 'R for full exits. Partials are improving your expectancy.'
      );
    } else {
      insights.push(
        'Full exits produce avg ' + withoutPartials.avgR.toFixed(2) + 'R vs ' +
        withPartials.avgR.toFixed(2) + 'R for partials. Consider simplifying your exit strategy.'
      );
    }
  }

  return insights;
}


// ============================================
// BEHAVIOURAL ANALYSIS
// ============================================

export interface StreakAnalysisData {
  afterWin: { count: number; avgR: number; winRate: number };
  afterLoss: { count: number; avgR: number; winRate: number };
  afterWinStreak: { count: number; avgR: number; winRate: number };
  afterLossStreak: { count: number; avgR: number; winRate: number };
}

export interface TradesPerDayPoint {
  date: string;
  tradeCount: number;
  avgR: number;
  totalPnl: number;
}

export function getStreakAnalysis(trades: TradeRecord[]): StreakAnalysisData {
  const closedTrades = trades
    .filter(t => getCachedMetrics(t).status === 'closed')
    .sort((a, b) => new Date(getCachedMetrics(a).exitTime!).getTime() - new Date(getCachedMetrics(b).exitTime!).getTime());

  const afterWin: TradeRecord[] = [];
  const afterLoss: TradeRecord[] = [];
  const afterWinStreak: TradeRecord[] = []; // After 2+ wins
  const afterLossStreak: TradeRecord[] = []; // After 2+ losses

  for (let i = 1; i < closedTrades.length; i++) {
    const prevTrade = closedTrades[i - 1];
    const prevWin = (getCachedMetrics(prevTrade).rMultiple ?? 0) > 0;

    if (prevWin) {
      afterWin.push(closedTrades[i]);
    } else {
      afterLoss.push(closedTrades[i]);
    }

    // Check for streaks (2+ consecutive)
    if (i >= 2) {
      const prev2Trade = closedTrades[i - 2];
      const prev2Win = (getCachedMetrics(prev2Trade).rMultiple ?? 0) > 0;

      if (prevWin && prev2Win) {
        afterWinStreak.push(closedTrades[i]);
      } else if (!prevWin && !prev2Win) {
        afterLossStreak.push(closedTrades[i]);
      }
    }
  }

  const calcStats = (arr: TradeRecord[]) => {
    if (arr.length === 0) {
      return { count: 0, avgR: 0, winRate: 0 };
    }
    const wins = arr.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    return {
      count: arr.length,
      avgR: arr.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / arr.length,
      winRate: (wins.length / arr.length) * 100,
    };
  };

  return {
    afterWin: calcStats(afterWin),
    afterLoss: calcStats(afterLoss),
    afterWinStreak: calcStats(afterWinStreak),
    afterLossStreak: calcStats(afterLossStreak),
  };
}

export function getTradesPerDayAnalysis(trades: TradeRecord[]): {
  points: TradesPerDayPoint[];
  optimalTradeCount: number;
  overtradeThreshold: number;
} {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed' && getCachedMetrics(t).exitTime);

  // Group by date
  const dayGroups = new Map<string, TradeRecord[]>();
  for (const trade of closedTrades) {
    const date = new Date(trade.entryTime).toISOString().split('T')[0];
    const existing = dayGroups.get(date) || [];
    existing.push(trade);
    dayGroups.set(date, existing);
  }

  const points: TradesPerDayPoint[] = [];
  for (const [date, dayTrades] of dayGroups) {
    const avgR = dayTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / dayTrades.length;
    const totalPnl = dayTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    points.push({
      date,
      tradeCount: dayTrades.length,
      avgR,
      totalPnl,
    });
  }

  // Find optimal trade count (highest avg R)
  const countGroups = new Map<number, number[]>();
  for (const point of points) {
    const existing = countGroups.get(point.tradeCount) || [];
    existing.push(point.avgR);
    countGroups.set(point.tradeCount, existing);
  }

  let optimalTradeCount = 1;
  let bestAvgR = -Infinity;
  for (const [count, avgRs] of countGroups) {
    if (avgRs.length >= 2) { // Need at least 2 days with this count
      const avgOfAvgs = avgRs.reduce((a, b) => a + b, 0) / avgRs.length;
      if (avgOfAvgs > bestAvgR) {
        bestAvgR = avgOfAvgs;
        optimalTradeCount = count;
      }
    }
  }

  // Find overtrade threshold (where avg R becomes negative or drops significantly)
  let overtradeThreshold = 10;
  const sortedCounts = Array.from(countGroups.entries())
    .filter(([, avgRs]) => avgRs.length >= 2)
    .sort((a, b) => a[0] - b[0]);

  for (const [count, avgRs] of sortedCounts) {
    const avgOfAvgs = avgRs.reduce((a, b) => a + b, 0) / avgRs.length;
    if (avgOfAvgs < 0 && count > optimalTradeCount) {
      overtradeThreshold = count;
      break;
    }
  }

  return { points, optimalTradeCount, overtradeThreshold };
}

// Entry Confirmation Analysis
export interface EntryConfirmationStats {
  type: string;
  label: string;
  count: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  avgMae: number | null; // Average MAE in R
}

const ENTRY_CONFIRMATION_LABELS: Record<string, string> = {
  blind_limit: 'Blind (Limit)',
  blind_market: 'Blind (Market)',
  structural: 'Structural',
  partial_confirmation: 'Partial Confirmation',
};

export function getEntryConfirmationAnalysis(trades: TradeRecord[]): EntryConfirmationStats[] {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed' && t.entryConfirmation);

  const groups = new Map<string, TradeRecord[]>();
  for (const trade of closedTrades) {
    const type = trade.entryConfirmation!;
    const existing = groups.get(type) || [];
    existing.push(trade);
    groups.set(type, existing);
  }

  const results: EntryConfirmationStats[] = [];
  const typeOrder = ['blind_limit', 'blind_market', 'structural', 'partial_confirmation'];

  for (const type of typeOrder) {
    const groupTrades = groups.get(type);
    if (!groupTrades || groupTrades.length === 0) continue;

    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);

    const avgR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / groupTrades.length;

    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    // Calculate avg MAE in R - use metrics
    const tradesWithMae = groupTrades.filter(t => {
      const metrics = getCachedMetrics(t);
      return metrics.maePrice !== null &&
        metrics.maePrice !== undefined &&
        metrics.stopDistance;
    });
    let avgMae: number | null = null;
    if (tradesWithMae.length > 0) {
      const maeRs = tradesWithMae.map(t => getCachedMetrics(t).maeR ?? 0);
      avgMae = maeRs.reduce((a, b) => a + b, 0) / maeRs.length;
    }

    results.push({
      type,
      label: ENTRY_CONFIRMATION_LABELS[type] || type,
      count: groupTrades.length,
      winRate: (wins.length / groupTrades.length) * 100,
      avgR,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      avgMae,
    });
  }

  // Add any custom types not in the standard list
  for (const [type, groupTrades] of groups) {
    if (typeOrder.includes(type)) continue;
    if (groupTrades.length === 0) continue;

    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);
    const avgR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / groupTrades.length;
    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    results.push({
      type,
      label: type,
      count: groupTrades.length,
      winRate: (wins.length / groupTrades.length) * 100,
      avgR,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      avgMae: null,
    });
  }

  return results;
}

export function getBehaviouralInsights(
  streakAnalysis: StreakAnalysisData,
  tradesPerDay: { optimalTradeCount: number; overtradeThreshold: number },
  entryConfirmationStats?: EntryConfirmationStats[]
): string[] {
  const insights: string[] = [];

  // Streak insights
  if (streakAnalysis.afterWin.count > 0 && streakAnalysis.afterLoss.count > 0) {
    if (Math.abs(streakAnalysis.afterWin.avgR - streakAnalysis.afterLoss.avgR) > 0.2) {
      const better = streakAnalysis.afterWin.avgR > streakAnalysis.afterLoss.avgR ? 'wins' : 'losses';
      insights.push(
        'You perform differently after losses — avg R of ' + streakAnalysis.afterLoss.avgR.toFixed(2) +
        ' vs ' + streakAnalysis.afterWin.avgR.toFixed(2) + ' after wins. ' +
        (better === 'losses' ? '' : 'Consider taking a break or reducing size after consecutive losses.')
      );
    }
  }

  // Trades per day insights
  insights.push(
    'Your best days have ' + tradesPerDay.optimalTradeCount + ' trades. ' +
    'Days with ' + tradesPerDay.overtradeThreshold + '+ trades show declining returns — this is your overtrade threshold.'
  );

  // Entry confirmation insights
  if (entryConfirmationStats && entryConfirmationStats.length > 0) {
    // Compare blind entries vs confirmation-based entries
    const blindEntries = entryConfirmationStats.filter(s =>
      s.type === 'blind_limit' || s.type === 'blind_market'
    );
    const confirmationEntries = entryConfirmationStats.filter(s =>
      s.type === 'structural' || s.type === 'partial_confirmation'
    );

    if (blindEntries.length > 0 && confirmationEntries.length > 0) {
      const blindCount = blindEntries.reduce((sum, s) => sum + s.count, 0);
      const confirmCount = confirmationEntries.reduce((sum, s) => sum + s.count, 0);

      const blindAvgR = blindEntries.reduce((sum, s) => sum + s.avgR * s.count, 0) / blindCount;
      const confirmAvgR = confirmationEntries.reduce((sum, s) => sum + s.avgR * s.count, 0) / confirmCount;

      if (Math.abs(blindAvgR - confirmAvgR) > 0.1) {
        const better = blindAvgR > confirmAvgR ? 'blind' : 'confirmation';
        const betterR = better === 'blind' ? blindAvgR : confirmAvgR;
        const worseR = better === 'blind' ? confirmAvgR : blindAvgR;

        insights.push(
          'Your ' + better + ' entries average ' + betterR.toFixed(2) + 'R vs ' + worseR.toFixed(2) + 'R for ' +
          (better === 'blind' ? 'confirmation' : 'blind') + ' entries. ' +
          (better === 'blind'
            ? 'Your levels may be strong enough to trust without waiting for confirmation.'
            : 'Waiting for confirmation improves your results.')
        );
      }

      // Compare MAE/first touch adverse if available
      const blindWithMae = blindEntries.filter(s => s.avgMae !== null);
      const confirmWithMae = confirmationEntries.filter(s => s.avgMae !== null);

      if (blindWithMae.length > 0 && confirmWithMae.length > 0) {
        const blindMaeCount = blindWithMae.reduce((sum, s) => sum + s.count, 0);
        const confirmMaeCount = confirmWithMae.reduce((sum, s) => sum + s.count, 0);
        const blindMae = blindWithMae.reduce((sum, s) => sum + (s.avgMae ?? 0) * s.count, 0) / blindMaeCount;
        const confirmMae = confirmWithMae.reduce((sum, s) => sum + (s.avgMae ?? 0) * s.count, 0) / confirmMaeCount;

        if (Math.abs(blindMae - confirmMae) > 0.05) {
          const tighter = blindMae < confirmMae ? 'blind' : 'confirmation';
          insights.push(
            (tighter === 'blind' ? 'Blind' : 'Confirmation') + ' entries have tighter MAE (' +
            (tighter === 'blind' ? blindMae : confirmMae).toFixed(2) + 'R vs ' +
            (tighter === 'blind' ? confirmMae : blindMae).toFixed(2) + 'R). ' +
            (tighter === 'confirmation'
              ? 'Waiting for confirmation helps you enter at better prices.'
              : 'Your limit levels are well-placed.')
          );
        }
      }
    }
  }

  return insights;
}


// ============================================
// CONTEXT TAG ANALYTICS (Confluence System)
// ============================================

export interface TagStats extends GroupStats {
  tag: string;
}

export interface ConfluenceCountStats {
  tagCount: number;
  tradeCount: number;
  avgR: number;
  winRate: number;
  totalPnl: number;
}

export interface TagCombinationStats {
  combination: string;
  tags: string[];
  count: number;
  wins: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  totalPnl: number;
}

/**
 * Group performance by individual setup tags (explodes array so each tag gets counted)
 */
export function groupPerformanceByTag(trades: TradeRecord[]): TagStats[] {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed');
  const tagGroups = new Map<string, TradeRecord[]>();

  // Explode tags - each trade can appear in multiple tag groups
  for (const trade of closedTrades) {
    const tags = trade.contextTags || [];
    for (const tag of tags) {
      const existing = tagGroups.get(tag) || [];
      existing.push(trade);
      tagGroups.set(tag, existing);
    }
  }

  const results: TagStats[] = [];

  for (const [tag, groupTrades] of tagGroups) {
    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);
    const breakevens = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) === 0);

    const rMultiples = groupTrades.map(t => getCachedMetrics(t).rMultiple ?? 0);
    const avgR = rMultiples.length > 0
      ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
      : 0;

    const totalPnl = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);

    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    const avgWinR = wins.length > 0
      ? wins.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / wins.length
      : 0;
    const avgLossR = losses.length > 0
      ? losses.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / losses.length
      : 0;

    const rStdDev = calculateStdDev(rMultiples);

    results.push({
      tag,
      group: tag,
      count: groupTrades.length,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: groupTrades.length > 0 ? (wins.length / groupTrades.length) * 100 : 0,
      avgR,
      totalPnl,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      avgWinR,
      avgLossR,
      rStdDev,
    });
  }

  return results.sort((a, b) => b.totalPnl - a.totalPnl);
}

/**
 * Analyze performance by number of confluences (tag count)
 */
export function getConfluenceCountAnalysis(trades: TradeRecord[]): ConfluenceCountStats[] {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed');
  const countGroups = new Map<number, TradeRecord[]>();

  for (const trade of closedTrades) {
    const tagCount = (trade.contextTags || []).length;
    // Group 4+ tags together
    const bucket = tagCount >= 4 ? 4 : tagCount;
    const existing = countGroups.get(bucket) || [];
    existing.push(trade);
    countGroups.set(bucket, existing);
  }

  const results: ConfluenceCountStats[] = [];

  for (const [tagCount, groupTrades] of countGroups) {
    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const avgR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / groupTrades.length;
    const totalPnl = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);

    results.push({
      tagCount,
      tradeCount: groupTrades.length,
      avgR,
      winRate: groupTrades.length > 0 ? (wins.length / groupTrades.length) * 100 : 0,
      totalPnl,
    });
  }

  return results.sort((a, b) => a.tagCount - b.tagCount);
}

/**
 * Analyze performance by tag combination (for trades with 2+ tags)
 */
export function getTagCombinationAnalysis(
  trades: TradeRecord[],
  minOccurrences: number = 3
): TagCombinationStats[] {
  const closedTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    (t.contextTags || []).length >= 2
  );

  const comboGroups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const tags = [...(trade.contextTags || [])].sort();
    const comboKey = tags.join(' + ');
    const existing = comboGroups.get(comboKey) || [];
    existing.push(trade);
    comboGroups.set(comboKey, existing);
  }

  const results: TagCombinationStats[] = [];

  for (const [combination, groupTrades] of comboGroups) {
    if (groupTrades.length < minOccurrences) continue;

    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);

    const avgR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / groupTrades.length;
    const totalPnl = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);

    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    const tags = combination.split(' + ');

    results.push({
      combination,
      tags,
      count: groupTrades.length,
      wins: wins.length,
      winRate: (wins.length / groupTrades.length) * 100,
      avgR,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      totalPnl,
    });
  }

  return results.sort((a, b) => b.avgR - a.avgR);
}

/**
 * Generate setup tag insights
 */
export function getSetupTagInsights(
  tagStats: TagStats[],
  confluenceStats: ConfluenceCountStats[],
  combinationStats: TagCombinationStats[]
): string[] {
  const insights: string[] = [];

  // Confluence count insight
  const singleTag = confluenceStats.find(c => c.tagCount === 1);
  const multiTag = confluenceStats.filter(c => c.tagCount >= 3);

  if (singleTag && multiTag.length > 0) {
    const avgMultiTagR = multiTag.reduce((sum, c) => sum + c.avgR * c.tradeCount, 0) /
      multiTag.reduce((sum, c) => sum + c.tradeCount, 0);

    if (avgMultiTagR > singleTag.avgR) {
      insights.push(
        'Trades with 3+ tags average ' + avgMultiTagR.toFixed(2) + 'R vs ' +
        singleTag.avgR.toFixed(2) + 'R for single-tag trades. More confluences = better results.'
      );
    }
  }

  // Best combination insight
  if (combinationStats.length > 0) {
    const best = combinationStats[0];
    insights.push(
      'Your strongest combination is [' + best.combination + '] with ' +
      best.winRate.toFixed(1) + '% win rate over ' + best.count + ' trades.'
    );
  }

  // Best individual tag insight
  const qualifiedTags = tagStats.filter(t => t.count >= 5);
  if (qualifiedTags.length >= 2) {
    const bestTag = [...qualifiedTags].sort((a, b) => b.avgR - a.avgR)[0];
    insights.push(
      'Your highest-edge individual factor is "' + bestTag.tag + '" (' +
      bestTag.avgR.toFixed(2) + 'R avg over ' + bestTag.count + ' appearances).'
    );

    const worstTag = [...qualifiedTags].sort((a, b) => a.avgR - b.avgR)[0];
    if (worstTag.avgR < 0 && worstTag.tag !== bestTag.tag) {
      insights.push(
        'Consider removing "' + worstTag.tag + '" from your confluence checklist (' +
        worstTag.avgR.toFixed(2) + 'R) — it may be noise rather than edge.'
      );
    }
  }

  return insights;
}


// ============================================
// STOP TIGHTNESS SIMULATOR
// ============================================

export interface SimulatedTrade {
  tradeId?: string;
  originalR: number;
  simulatedR: number;
  wouldBeStoppedOut: boolean;
  originalStopDistance: number;
  adjustedStopDistance: number;
  mae: number;
  maeR: number;
}

export interface StopSimulationResult {
  simulatedTrades: SimulatedTrade[];
  adjustmentPercent: number;
  originalTotalR: number;
  simulatedTotalR: number;
  originalWinRate: number;
  simulatedWinRate: number;
  originalAvgR: number;
  simulatedAvgR: number;
  stoppedOutCount: number;
  improvedCount: number;
  equityCurve: { tradeIndex: number; original: number; simulated: number }[];
}

/**
 * Simulate tighter or looser stops on historical trades
 * adjustmentPercent: -0.2 = 20% tighter stops, +0.2 = 20% wider stops
 */
export function simulateStopAdjustment(
  trades: TradeRecord[],
  adjustmentPercent: number
): StopSimulationResult {
  const eligibleTrades = trades
    .filter(t => {
      const metrics = getCachedMetrics(t);
      return metrics.status === 'closed' &&
        metrics.stopDistance !== undefined &&
        metrics.maeR !== undefined &&
        metrics.rMultiple !== undefined;
    })
    .sort((a, b) => new Date(getCachedMetrics(a).exitTime!).getTime() - new Date(getCachedMetrics(b).exitTime!).getTime());

  const simulatedTrades: SimulatedTrade[] = [];
  const equityCurve: { tradeIndex: number; original: number; simulated: number }[] = [];
  let originalCumulative = 0;
  let simulatedCumulative = 0;

  for (let i = 0; i < eligibleTrades.length; i++) {
    const trade = eligibleTrades[i];
    const metrics = getCachedMetrics(trade);
    const originalStopDistance = metrics.stopDistance!;
    const maeR = metrics.maeR!;
    const originalR = metrics.rMultiple!;

    // Adjusted stop distance as a factor (1 = original size)
    // Negative adjustmentPercent = tighter stop (smaller factor)
    // Positive adjustmentPercent = wider stop (larger factor)
    const adjustedStopFactor = 1 + adjustmentPercent;
    const adjustedStopDistance = originalStopDistance * adjustedStopFactor;

    // MAE in R terms with tighter stop
    // If stop is tighter by X%, then the same price move = larger MAE in R terms
    const adjustedMAER = maeR / adjustedStopFactor;

    // Would this trade be stopped out with tighter stop?
    // If adjusted MAE exceeds 1R (the new stop level), trade is stopped out
    const wouldBeStoppedOut = adjustedMAER >= 1;

    let simulatedR: number;
    if (wouldBeStoppedOut) {
      // Stopped out at -1R
      simulatedR = -1;
    } else {
      // Trade survives. Recalculate R-multiple with tighter stop
      // Same exit distance / tighter stop = higher R if winner
      // The actual price movement stays the same, but R calculation changes
      // If original was a winner: exitDistance / newStopDistance
      // R = actualRR / stopFactor
      if (originalR > 0) {
        // Winner: same absolute profit, smaller risk = higher R
        simulatedR = originalR / adjustedStopFactor;
      } else if (originalR < 0) {
        // Loser that wasn't stopped out early
        // Same loss in price terms, but larger in R terms
        simulatedR = originalR / adjustedStopFactor;
      } else {
        // Breakeven stays breakeven
        simulatedR = 0;
      }
    }

    const maeDistance = calculateMaeDistance(trade.entryPrice, metrics.maePrice);
    simulatedTrades.push({
      tradeId: trade.id!,
      originalR,
      simulatedR,
      wouldBeStoppedOut,
      originalStopDistance,
      adjustedStopDistance,
      mae: maeDistance ?? 0,
      maeR,
    });

    originalCumulative += originalR;
    simulatedCumulative += simulatedR;

    equityCurve.push({
      tradeIndex: i + 1,
      original: originalCumulative,
      simulated: simulatedCumulative,
    });
  }

  // Calculate summary stats
  const originalWins = simulatedTrades.filter(t => t.originalR > 0);
  const simulatedWins = simulatedTrades.filter(t => t.simulatedR > 0);

  // Count only WINNERS that became losers due to tighter stops
  // This is the true "cost" of tighter stops - trades where outcome changed
  const stoppedOutCount = simulatedTrades.filter(
    t => t.wouldBeStoppedOut && t.originalR > 0
  ).length;

  const improvedCount = simulatedTrades.filter(t => t.simulatedR > t.originalR).length;

  // Calculate win rates
  const originalWinRate = simulatedTrades.length > 0
    ? (originalWins.length / simulatedTrades.length) * 100
    : 0;
  const simulatedWinRate = simulatedTrades.length > 0
    ? (simulatedWins.length / simulatedTrades.length) * 100
    : 0;

  // Dev sanity check: win rate must equal winners / total
  if (import.meta.env.DEV) {
    const expectedSimulatedWinRate = simulatedTrades.length > 0
      ? (simulatedWins.length / simulatedTrades.length) * 100
      : 0;
    console.assert(
      Math.abs(simulatedWinRate - expectedSimulatedWinRate) < 0.01,
      `Win rate mismatch: ${simulatedWinRate} vs ${expectedSimulatedWinRate}`
    );
  }

  return {
    simulatedTrades,
    adjustmentPercent,
    originalTotalR: originalCumulative,
    simulatedTotalR: simulatedCumulative,
    originalWinRate,
    simulatedWinRate,
    originalAvgR: simulatedTrades.length > 0
      ? originalCumulative / simulatedTrades.length
      : 0,
    simulatedAvgR: simulatedTrades.length > 0
      ? simulatedCumulative / simulatedTrades.length
      : 0,
    stoppedOutCount,
    improvedCount,
    equityCurve,
  };
}


// ============================================
// BREAK-EVEN & STOP MANAGEMENT ANALYTICS
// ============================================

export interface BEAnalysisStats {
  movedToBE: {
    count: number;
    avgR: number;
    winRate: number;
    totalPnl: number;
  };
  stayedOriginal: {
    count: number;
    avgR: number;
    winRate: number;
    totalPnl: number;
  };
  beOutcomes: {
    heldForWin: number;   // Moved to BE, trade won
    savedByBE: number;     // Moved to BE, exited at BE (would have been loss)
    missedProfit: number;  // Moved to BE too early, stopped at BE but would have won
  };
  // Post-exit validation using minRThreshold
  postExitValidation: {
    tradesWithPostExitData: number;       // BE trades with post-exit tracking
    thesisCostYou: number;                 // BE stopped you AND post-exit move >= minRThreshold
    belowThreshold: number;                // BE stopped you but post-exit move < minRThreshold
    avgPostExitMoveR: number;              // Avg R move after BE stopped you out
  };
}

export interface StopAdjustmentTriggerStats {
  trigger: string;
  count: number;
  avgRAfter: number;
  winRate: number;
}

export interface StopDestinationStats {
  destination: string;
  count: number;
  avgR: number;
  winRate: number;
}

/**
 * Check if a stop move is a "move to BE" based on description or price proximity
 */
function isBEStopMove(trade: TradeRecord, stopMove: TradeEvent): boolean {
  // Check description for "BE" (case-insensitive)
  if (stopMove.description && /\bBE\b/i.test(stopMove.description)) {
    return true;
  }

  // Check if price is within 0.1R of entry
  if (stopMove.price !== null) {
    const stopDistance = calculateStopDistance(trade.entryPrice, trade.stopLoss);
    if (stopDistance > 0) {
      const distanceFromEntry = Math.abs(stopMove.price - trade.entryPrice);
      const rFromEntry = distanceFromEntry / stopDistance;
      if (rFromEntry <= 0.1) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Analyze break-even move effectiveness
 * @param minRThreshold - Minimum R move to consider BE as having "cost you" a valid trade
 *
 * Sources from timeline stop_moved events.
 */
export function getBEAnalysis(trades: TradeRecord[], minRThreshold: number = 1.0): BEAnalysisStats {
  const closedTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' && t.tradeTaken !== false
  );

  const movedToBETrades: TradeRecord[] = [];
  const stayedOriginalTrades: TradeRecord[] = [];

  // Categorize trades
  for (const trade of closedTrades) {
    const stopMoves = getStopMoves(trade);
    const hasBEMove = stopMoves.some(sm => isBEStopMove(trade, sm));

    if (hasBEMove) {
      movedToBETrades.push(trade);
    } else {
      stayedOriginalTrades.push(trade);
    }
  }

  // Calculate stats for each group
  const calcGroupStats = (groupTrades: TradeRecord[]) => {
    if (groupTrades.length === 0) {
      return { count: 0, avgR: 0, winRate: 0, totalPnl: 0 };
    }

    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const totalR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0);
    const totalPnl = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);

    return {
      count: groupTrades.length,
      avgR: totalR / groupTrades.length,
      winRate: (wins.length / groupTrades.length) * 100,
      totalPnl,
    };
  };

  // Calculate BE outcomes
  let heldForWin = 0;
  let savedByBE = 0;
  let missedProfit = 0;

  for (const trade of movedToBETrades) {
    const metrics = getCachedMetrics(trade);
    const rMultiple = metrics.rMultiple ?? 0;

    if (rMultiple > 0) {
      // Won despite moving to BE
      heldForWin++;
    } else if (rMultiple === 0) {
      // BE stop was hit - check if it saved from a loss
      // Replay with original stop to see what would have happened
      const originalReplay = replayHold(trade, trade.stopLoss);
      if (originalReplay.type === 'stopped') {
        savedByBE++;
      } else if (originalReplay.type === 'survived' && originalReplay.favourableExtremeR >= 1) {
        // Would have reached 1R+ if held
        missedProfit++;
      }
    } else {
      // Lost - shouldn't normally happen with BE (stop at entry)
      // But could happen with partial exits
      savedByBE++;
    }
  }

  // Post-exit validation for BE stops
  let tradesWithPostExitData = 0;
  let thesisCostYou = 0;
  let belowThreshold = 0;
  let totalPostExitMoveR = 0;

  for (const trade of movedToBETrades) {
    const favExtreme = getFavourableExtreme(trade);
    if (favExtreme) {
      tradesWithPostExitData++;
      totalPostExitMoveR += favExtreme.r;

      if (favExtreme.r >= minRThreshold) {
        thesisCostYou++;
      } else {
        belowThreshold++;
      }
    }
  }

  return {
    movedToBE: calcGroupStats(movedToBETrades),
    stayedOriginal: calcGroupStats(stayedOriginalTrades),
    beOutcomes: {
      heldForWin,
      savedByBE,
      missedProfit,
    },
    postExitValidation: {
      tradesWithPostExitData,
      thesisCostYou,
      belowThreshold,
      avgPostExitMoveR: tradesWithPostExitData > 0 ? totalPostExitMoveR / tradesWithPostExitData : 0,
    },
  };
}

/**
 * Analyze stop adjustments by trigger (what caused the move)
 * Groups stop_moved events by their description field.
 */
export function getStopAdjustmentTriggerAnalysis(trades: TradeRecord[]): StopAdjustmentTriggerStats[] {
  const closedTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' && t.tradeTaken !== false
  );

  // Group by trigger (description)
  const triggerGroups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const stopMoves = getStopMoves(trade);
    for (const move of stopMoves) {
      const trigger = move.description?.trim() || 'No reason given';
      if (!triggerGroups.has(trigger)) {
        triggerGroups.set(trigger, []);
      }
      // Add trade to this trigger group (only once per trigger type per trade)
      const existing = triggerGroups.get(trigger)!;
      if (!existing.includes(trade)) {
        existing.push(trade);
      }
    }
  }

  const results: StopAdjustmentTriggerStats[] = [];

  for (const [trigger, groupTrades] of triggerGroups) {
    if (groupTrades.length === 0) continue;

    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const totalR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0);

    results.push({
      trigger,
      count: groupTrades.length,
      avgRAfter: totalR / groupTrades.length,
      winRate: (wins.length / groupTrades.length) * 100,
    });
  }

  // Sort by count descending
  return results.sort((a, b) => b.count - a.count);
}

/**
 * Analyze stop adjustments by destination/reason
 * Groups stop_moved events by their description and analyzes subsequent outcomes.
 */
export function getStopDestinationAnalysis(trades: TradeRecord[]): StopDestinationStats[] {
  const closedTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' && t.tradeTaken !== false
  );

  // Group by destination (description)
  const destGroups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const stopMoves = getStopMoves(trade);
    for (const move of stopMoves) {
      // Use description as destination identifier
      let destination = move.description?.trim() || 'Unspecified';

      // Normalize common patterns
      if (/\bBE\b/i.test(destination)) {
        destination = 'Break-even';
      } else if (/trail/i.test(destination)) {
        destination = 'Trail stop';
      }

      if (!destGroups.has(destination)) {
        destGroups.set(destination, []);
      }
      const existing = destGroups.get(destination)!;
      if (!existing.includes(trade)) {
        existing.push(trade);
      }
    }
  }

  const results: StopDestinationStats[] = [];

  for (const [destination, groupTrades] of destGroups) {
    if (groupTrades.length === 0) continue;

    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const totalR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0);

    results.push({
      destination,
      count: groupTrades.length,
      avgR: totalR / groupTrades.length,
      winRate: (wins.length / groupTrades.length) * 100,
    });
  }

  // Sort by count descending
  return results.sort((a, b) => b.count - a.count);
}

/**
 * Generate stop management insights
 * @param minRThreshold - Minimum R threshold for evaluating whether BE "cost you" a valid trade
 */
export function getStopManagementInsights(
  beAnalysis: BEAnalysisStats,
  triggerAnalysis: StopAdjustmentTriggerStats[],
  destinationAnalysis: StopDestinationStats[],
  minRThreshold: number = 1.0
): string[] {
  const insights: string[] = [];

  // BE effectiveness insight
  if (beAnalysis.movedToBE.count >= 5 && beAnalysis.stayedOriginal.count >= 5) {
    const beDiff = beAnalysis.movedToBE.avgR - beAnalysis.stayedOriginal.avgR;
    if (beDiff > 0) {
      insights.push(
        'Moving to BE improves your avg R by ' + beDiff.toFixed(2) + ' (' +
        beAnalysis.movedToBE.avgR.toFixed(2) + 'R vs ' + beAnalysis.stayedOriginal.avgR.toFixed(2) + 'R).'
      );
    } else if (beDiff < -0.2) {
      insights.push(
        'Your BE moves may be premature — avg ' + beAnalysis.movedToBE.avgR.toFixed(2) + 'R vs ' +
        beAnalysis.stayedOriginal.avgR.toFixed(2) + 'R without BE. ' +
        beAnalysis.beOutcomes.missedProfit + ' trades hit MFE >1R but stopped at BE.'
      );
    }
  }

  // BE outcome breakdown
  if (beAnalysis.movedToBE.count >= 3) {
    const { heldForWin, savedByBE, missedProfit } = beAnalysis.beOutcomes;
    const total = heldForWin + savedByBE + missedProfit;
    if (total > 0) {
      insights.push(
        'BE outcomes: ' + heldForWin + ' held to win, ' + savedByBE + ' saved from loss, ' +
        missedProfit + ' stopped at BE but had 1R+ MFE.'
      );
    }
  }

  // Post-exit validation insight (uses minRThreshold)
  const { postExitValidation } = beAnalysis;
  if (postExitValidation.tradesWithPostExitData >= 3) {
    const percentCostYou = postExitValidation.tradesWithPostExitData > 0
      ? (postExitValidation.thesisCostYou / postExitValidation.tradesWithPostExitData) * 100
      : 0;

    if (postExitValidation.thesisCostYou > 0) {
      insights.push(
        `Of ${postExitValidation.tradesWithPostExitData} BE stops with post-exit data, ` +
        `${percentCostYou.toFixed(0)}% (${postExitValidation.thesisCostYou}) saw price exceed your ` +
        `${minRThreshold}R threshold afterwards — BE cost you on valid trades.`
      );
    } else if (postExitValidation.tradesWithPostExitData > 0) {
      insights.push(
        `None of your ${postExitValidation.tradesWithPostExitData} BE stops saw price exceed ` +
        `${minRThreshold}R afterwards — your BE moves are not costing you on validated setups.`
      );
    }
  }

  // Best trigger insight
  const qualifiedTriggers = triggerAnalysis.filter(t => t.count >= 3);
  if (qualifiedTriggers.length >= 2) {
    const bestTrigger = [...qualifiedTriggers].sort((a, b) => b.avgRAfter - a.avgRAfter)[0];
    if (bestTrigger.avgRAfter > 0) {
      insights.push(
        'Best stop adjustment trigger: "' + bestTrigger.trigger + '" (' +
        bestTrigger.avgRAfter.toFixed(2) + 'R avg, ' + bestTrigger.winRate.toFixed(1) + '% win rate).'
      );
    }
  }

  // Best destination insight
  const qualifiedDestinations = destinationAnalysis.filter(d => d.count >= 3);
  if (qualifiedDestinations.length >= 2) {
    const bestDest = [...qualifiedDestinations].sort((a, b) => b.avgR - a.avgR)[0];
    if (bestDest.avgR > 0) {
      insights.push(
        'Most effective stop destination: "' + bestDest.destination + '" (' +
        bestDest.avgR.toFixed(2) + 'R avg over ' + bestDest.count + ' trades).'
      );
    }
  }

  if (insights.length === 0) {
    insights.push('Track more stop adjustments to generate stop management insights.');
  }

  return insights;
}

// ===== SELECTIVITY ANALYSIS =====

interface SelectivityComparison {
  taken: {
    count: number;
    winRate: number;
    avgR: number;
    profitFactor: number;
    totalR: number;
  };
  missed: {
    count: number;
    winRate: number;
    avgR: number;
    profitFactor: number;
    totalR: number;
  };
}

interface SelectivityValue {
  missedProfit: number; // Total R from missed trades that would have won
  savedLosses: number; // Total R saved from missed trades that would have lost
  netValue: number; // savedLosses - missedProfit (positive = filtering helps)
  missedWinners: number;
  avoidedLosers: number;
  missedWithOutcome: number;
}

interface ReasonBreakdown {
  reason: string;
  count: number;
  winRate: number;
  avgR: number;
  totalR: number;
}

interface TagBreakdown {
  tag: string;
  count: number;
  winRate: number;
  avgR: number;
  totalR: number;
}

export function getSelectivityAnalysis(allTrades: TradeRecord[]): SelectivityComparison | null {
  const taken = allTrades.filter(t => t.tradeTaken !== false);
  const missed = allTrades.filter(t => t.tradeTaken === false);

  // Only include closed trades with R-multiple for stats
  const takenClosed = taken.filter(t => getCachedMetrics(t).status === 'closed' && getCachedMetrics(t).rMultiple !== undefined);
  const missedClosed = missed.filter(t => getCachedMetrics(t).status === 'closed' && getCachedMetrics(t).rMultiple !== undefined);

  if (takenClosed.length < 1 && missedClosed.length < 1) return null;

  const calcStats = (trades: TradeRecord[]) => {
    if (trades.length === 0) {
      return { count: 0, winRate: 0, avgR: 0, profitFactor: 0, totalR: 0 };
    }
    const wins = trades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = trades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) <= 0);
    const totalR = trades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0);
    const avgR = totalR / trades.length;
    const winRate = (wins.length / trades.length) * 100;
    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    return { count: trades.length, winRate, avgR, profitFactor, totalR };
  };

  return {
    taken: calcStats(takenClosed),
    missed: calcStats(missedClosed),
  };
}

export function getSelectivityValue(missedTrades: TradeRecord[]): SelectivityValue {
  // Only include closed trades with outcome data
  const withOutcome = missedTrades.filter(t => getCachedMetrics(t).status === 'closed' && getCachedMetrics(t).rMultiple !== undefined);

  const winners = withOutcome.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
  const losers = withOutcome.filter(t => (getCachedMetrics(t).rMultiple ?? 0) <= 0);

  const missedProfit = winners.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0);
  const savedLosses = Math.abs(losers.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0));
  const netValue = savedLosses - missedProfit;

  return {
    missedProfit,
    savedLosses,
    netValue,
    missedWinners: winners.length,
    avoidedLosers: losers.length,
    missedWithOutcome: withOutcome.length,
  };
}

export function getNotTakenReasonBreakdown(missedTrades: TradeRecord[]): ReasonBreakdown[] {
  const withOutcome = missedTrades.filter(t => getCachedMetrics(t).status === 'closed' && getCachedMetrics(t).rMultiple !== undefined);

  // Group by reason
  const reasonMap = new Map<string, TradeRecord[]>();
  for (const trade of withOutcome) {
    const reason = trade.notTakenReason || '';
    if (!reasonMap.has(reason)) {
      reasonMap.set(reason, []);
    }
    reasonMap.get(reason)!.push(trade);
  }

  const breakdown: ReasonBreakdown[] = [];
  for (const [reason, trades] of reasonMap) {
    const wins = trades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const totalR = trades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0);
    const avgR = trades.length > 0 ? totalR / trades.length : 0;
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

    breakdown.push({
      reason,
      count: trades.length,
      winRate,
      avgR,
      totalR,
    });
  }

  // Sort by count descending
  return breakdown.sort((a, b) => b.count - a.count);
}

export function getMissedTradesByTag(missedTrades: TradeRecord[]): TagBreakdown[] {
  const withOutcome = missedTrades.filter(t => getCachedMetrics(t).status === 'closed' && getCachedMetrics(t).rMultiple !== undefined);

  // Group by setup tag
  const tagMap = new Map<string, TradeRecord[]>();
  for (const trade of withOutcome) {
    const tags = trade.contextTags || [];
    for (const tag of tags) {
      if (!tagMap.has(tag)) {
        tagMap.set(tag, []);
      }
      tagMap.get(tag)!.push(trade);
    }
  }

  const breakdown: TagBreakdown[] = [];
  for (const [tag, trades] of tagMap) {
    const wins = trades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const totalR = trades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0);
    const avgR = trades.length > 0 ? totalR / trades.length : 0;
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

    breakdown.push({
      tag,
      count: trades.length,
      winRate,
      avgR,
      totalR,
    });
  }

  // Sort by total R descending (most profitable missed setups first)
  return breakdown.sort((a, b) => b.totalR - a.totalR);
}

export function getSelectivityInsights(allTrades: TradeRecord[]): string[] {
  const insights: string[] = [];
  const missed = allTrades.filter(t => t.tradeTaken === false);

  if (missed.length < 3) {
    return insights;
  }

  const missedClosed = missed.filter(t => getCachedMetrics(t).status === 'closed' && getCachedMetrics(t).rMultiple !== undefined);
  const selectivityValue = getSelectivityValue(missed);

  // Overall selectivity insight
  if (missedClosed.length >= 3) {
    const totalMissedR = selectivityValue.missedProfit - selectivityValue.savedLosses;
    if (selectivityValue.netValue > 0) {
      insights.push(
        `Your selectivity saved you ${selectivityValue.savedLosses.toFixed(1)}R in avoided losses. ` +
        `Net: your filtering is saving you ${selectivityValue.netValue.toFixed(1)}R.`
      );
    } else if (selectivityValue.netValue < -1) {
      insights.push(
        `You skipped ${missedClosed.length} trades that would have netted ${Math.abs(totalMissedR).toFixed(1)}R. ` +
        `Your selectivity is costing you ${Math.abs(selectivityValue.netValue).toFixed(1)}R.`
      );
    }
  }

  // Most costly reason
  const reasonBreakdown = getNotTakenReasonBreakdown(missed);
  const costlyReasons = reasonBreakdown.filter(r => r.winRate > 50 && r.avgR > 0 && r.count >= 2);
  if (costlyReasons.length > 0) {
    const mostCostly = costlyReasons[0];
    insights.push(
      `Your most costly reason for not trading is "${mostCostly.reason || 'No reason'}" — ` +
      `trades you skipped for this reason won ${mostCostly.winRate.toFixed(0)}% of the time.`
    );
  }

  // Best reasons to skip
  const goodSkips = reasonBreakdown.filter(r => r.winRate < 40 && r.count >= 2);
  if (goodSkips.length > 0) {
    const bestSkip = goodSkips[0];
    insights.push(
      `"${bestSkip.reason || 'No reason'}" is a good reason to skip — ` +
      `those trades only won ${bestSkip.winRate.toFixed(0)}% of the time.`
    );
  }

  // Missed setup tags that perform well
  const tagBreakdown = getMissedTradesByTag(missed);
  const profitableMissedTags = tagBreakdown.filter(t => t.winRate > 55 && t.avgR > 0.5 && t.count >= 2);
  if (profitableMissedTags.length > 0) {
    const tagNames = profitableMissedTags.slice(0, 3).map(t => t.tag);
    insights.push(
      `Consider taking more trades tagged [${tagNames.join(', ')}] — ` +
      `you skip these frequently but they win ${profitableMissedTags[0].winRate.toFixed(0)}% of the time.`
    );
  }

  return insights;
}

// ============================================
// FRONT-RUN MISS ANALYSIS
// ============================================

export interface FrontRunMissAnalysis {
  count: number;
  avgDistanceR: number;
  medianDistanceR: number;
  avgOutcomeIfTaken: number; // hypothetical net R based on reachedTargetPostExit
  winsIfTaken: number;
  lossesIfTaken: number;
  unknownOutcome: number;
  histogram: { bucket: string; count: number }[];
}

/**
 * Analyze front-run misses (trades where price turned before entry was hit)
 */
export function getFrontRunMissAnalysis(trades: TradeRecord[]): FrontRunMissAnalysis | null {
  // Filter for missed trades with front_run reason and frontRunTurnPrice set
  const frontRunMisses = trades.filter(
    t => !t.tradeTaken &&
         t.notTakenReason === 'front_run' &&
         t.frontRunTurnPrice != null &&
         t.entryPrice &&
         t.stopLoss
  );

  if (frontRunMisses.length === 0) {
    return null;
  }

  // Calculate front-run distance in R for each trade
  const distancesR: number[] = [];
  let totalOutcomeR = 0;
  let winsIfTaken = 0;
  let lossesIfTaken = 0;
  let unknownOutcome = 0;

  for (const trade of frontRunMisses) {
    const entryPrice = trade.entryPrice;
    const stopLoss = trade.stopLoss;
    const turnPrice = trade.frontRunTurnPrice!;

    // Risk per R
    const riskPerR = Math.abs(entryPrice - stopLoss);
    if (riskPerR === 0) continue;

    // Distance from entry to turn price in R
    const distanceR = Math.abs(entryPrice - turnPrice) / riskPerR;
    distancesR.push(distanceR);

    // Check hypothetical outcome using reachedTargetPostExit
    if (trade.reachedTargetPostExit === true) {
      winsIfTaken++;
      // Assume ~2R win for simplicity since we don't have exact TP data on missed trades
      const targetPrice = trade.targetPrice;
      if (targetPrice) {
        const plannedR = Math.abs(targetPrice - entryPrice) / riskPerR;
        totalOutcomeR += plannedR;
      } else {
        totalOutcomeR += 2; // Default 2R win
      }
    } else if (trade.reachedTargetPostExit === false) {
      lossesIfTaken++;
      totalOutcomeR -= 1; // -1R loss
    } else {
      unknownOutcome++;
    }
  }

  if (distancesR.length === 0) {
    return null;
  }

  // Calculate stats
  const sortedDistances = [...distancesR].sort((a, b) => a - b);
  const avgDistanceR = distancesR.reduce((sum, d) => sum + d, 0) / distancesR.length;
  const medianDistanceR = sortedDistances.length % 2 === 0
    ? (sortedDistances[sortedDistances.length / 2 - 1] + sortedDistances[sortedDistances.length / 2]) / 2
    : sortedDistances[Math.floor(sortedDistances.length / 2)];

  const knownOutcomes = winsIfTaken + lossesIfTaken;
  const avgOutcomeIfTaken = knownOutcomes > 0 ? totalOutcomeR / knownOutcomes : 0;

  // Create histogram buckets
  const buckets = [
    { min: 0, max: 0.1, label: '0-0.1R' },
    { min: 0.1, max: 0.25, label: '0.1-0.25R' },
    { min: 0.25, max: 0.5, label: '0.25-0.5R' },
    { min: 0.5, max: 1.0, label: '0.5-1R' },
    { min: 1.0, max: Infinity, label: '1R+' },
  ];

  const histogram = buckets.map(bucket => ({
    bucket: bucket.label,
    count: distancesR.filter(d => d >= bucket.min && d < bucket.max).length,
  }));

  return {
    count: frontRunMisses.length,
    avgDistanceR,
    medianDistanceR,
    avgOutcomeIfTaken,
    winsIfTaken,
    lossesIfTaken,
    unknownOutcome,
    histogram,
  };
}

// ============================================
// INTER-EXIT DRAWDOWN / POST-TP BEHAVIOUR
// ============================================

export interface RetracementBucket {
  label: string;
  min: number;  // percentage of TP distance
  max: number;
  count: number;
  percentage: number;
}

export interface DirectionalRetracementStats {
  direction: 'long' | 'short';
  tradesAnalyzed: number;
  avgRetracementPercent: number;
  medianRetracementPercent: number;
  tradesReachedEntry: number;
  tradesReachedEntryPercent: number;
  tradesBeyondEntry: number;
  tradesBeyondEntryPercent: number;
  buckets: RetracementBucket[];
}

export interface PostTPBehaviourAnalysis {
  long: DirectionalRetracementStats | null;
  short: DirectionalRetracementStats | null;
}

export interface BEJustificationStats {
  direction: 'long' | 'short';
  tradesAnalyzed: number;
  beWouldHaveSaved: number;
  beWouldHaveSavedPercent: number;
  beUnnecessary: number;
  beUnnecessaryPercent: number;
  tradesWithBEUsed: number;
  beSavedVsCost: 'worth_it' | 'not_worth_it' | 'neutral' | 'insufficient_data';
}

export interface BEJustificationAnalysis {
  long: BEJustificationStats | null;
  short: BEJustificationStats | null;
}

export interface TagRetracementStats {
  tag: string;
  tradesAnalyzed: number;
  avgRetracementPercent: number;
  tradesReachedEntryPercent: number;
  recommendation: 'be_justified' | 'trailing_better' | 'neutral';
}

export interface RetracementScatterPoint {
  tradeId: string;
  direction: 'long' | 'short';
  tp1DistanceR: number;  // Distance from entry to TP1 in R
  drawdownR: number;     // Drawdown after TP1 in R (from TP1 price)
}

/**
 * Get trades with multiple exits that have drawdownAfter data
 */
function getTradesWithDrawdownData(trades: TradeRecord[]): TradeRecord[] {
  return trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    t.exits &&
    t.exits.length > 1 &&
    t.exits.some(e => e.drawdownAfter != null)
  );
}

/**
 * Calculate retracement percentage: how far did price pull back as % of the leg from entry to exit
 */
function calcRetracementPercent(
  entryPrice: number,
  exitPrice: number,
  drawdownAfter: number,
  _direction: 'long' | 'short'
): number {
  const legDistance = Math.abs(exitPrice - entryPrice);
  if (legDistance === 0) return 0;

  const drawdownDistance = Math.abs(exitPrice - drawdownAfter);
  return (drawdownDistance / legDistance) * 100;
}

/**
 * Check if drawdown reached entry price
 */
function didReachEntry(
  entryPrice: number,
  drawdownAfter: number,
  direction: 'long' | 'short'
): boolean {
  if (direction === 'long') {
    return drawdownAfter <= entryPrice;
  } else {
    return drawdownAfter >= entryPrice;
  }
}

/**
 * Check if drawdown went beyond entry (would have been stopped at BE)
 */
function didGoBeyondEntry(
  entryPrice: number,
  drawdownAfter: number,
  direction: 'long' | 'short'
): boolean {
  if (direction === 'long') {
    return drawdownAfter < entryPrice;
  } else {
    return drawdownAfter > entryPrice;
  }
}

/**
 * Computes retracement stats by direction
 */
export function getPostTPBehaviourAnalysis(trades: TradeRecord[]): PostTPBehaviourAnalysis {
  const withData = getTradesWithDrawdownData(trades);

  const analyzeDirection = (direction: 'long' | 'short'): DirectionalRetracementStats | null => {
    const dirTrades = withData.filter(t => t.direction === direction);
    if (dirTrades.length < 3) return null;

    const retracementData: number[] = [];
    let reachedEntry = 0;
    let beyondEntry = 0;

    for (const trade of dirTrades) {
      // Get the first exit with drawdownAfter (TP1)
      const firstExitWithDrawdown = trade.exits?.find(e => e.drawdownAfter != null);
      if (!firstExitWithDrawdown || firstExitWithDrawdown.drawdownAfter == null) continue;

      const retracementPercent = calcRetracementPercent(
        trade.entryPrice,
        firstExitWithDrawdown.price,
        firstExitWithDrawdown.drawdownAfter,
        direction
      );
      retracementData.push(retracementPercent);

      if (didReachEntry(trade.entryPrice, firstExitWithDrawdown.drawdownAfter, direction)) {
        reachedEntry++;
      }
      if (didGoBeyondEntry(trade.entryPrice, firstExitWithDrawdown.drawdownAfter, direction)) {
        beyondEntry++;
      }
    }

    if (retracementData.length === 0) return null;

    const avg = retracementData.reduce((a, b) => a + b, 0) / retracementData.length;
    const sorted = [...retracementData].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // Create buckets
    const bucketDefs = [
      { label: '0-25%', min: 0, max: 25 },
      { label: '25-50%', min: 25, max: 50 },
      { label: '50-75%', min: 50, max: 75 },
      { label: '75-100%', min: 75, max: 100 },
      { label: '100%+ (beyond entry)', min: 100, max: Infinity },
    ];

    const buckets: RetracementBucket[] = bucketDefs.map(def => {
      const count = retracementData.filter(r => r >= def.min && r < def.max).length;
      return {
        ...def,
        count,
        percentage: (count / retracementData.length) * 100,
      };
    });

    return {
      direction,
      tradesAnalyzed: retracementData.length,
      avgRetracementPercent: avg,
      medianRetracementPercent: median,
      tradesReachedEntry: reachedEntry,
      tradesReachedEntryPercent: (reachedEntry / retracementData.length) * 100,
      tradesBeyondEntry: beyondEntry,
      tradesBeyondEntryPercent: (beyondEntry / retracementData.length) * 100,
      buckets,
    };
  };

  return {
    long: analyzeDirection('long'),
    short: analyzeDirection('short'),
  };
}

/**
 * Calculates whether BE moves are net positive
 */
export function getBEJustificationAnalysis(trades: TradeRecord[]): BEJustificationAnalysis {
  const withData = getTradesWithDrawdownData(trades);

  const analyzeDirection = (direction: 'long' | 'short'): BEJustificationStats | null => {
    const dirTrades = withData.filter(t => t.direction === direction);
    if (dirTrades.length < 3) return null;

    let beWouldSave = 0;
    let beUnnecessary = 0;
    let withBEUsed = 0;
    let analyzed = 0;

    for (const trade of dirTrades) {
      const firstExitWithDrawdown = trade.exits?.find(e => e.drawdownAfter != null);
      if (!firstExitWithDrawdown || firstExitWithDrawdown.drawdownAfter == null) continue;

      analyzed++;

      // Check if any exit was a BE stop hit
      const hadBEStop = trade.exits?.some(e => e.type === 'be_stop_hit');
      if (hadBEStop) withBEUsed++;

      // Did drawdown go beyond entry?
      if (didGoBeyondEntry(trade.entryPrice, firstExitWithDrawdown.drawdownAfter, direction)) {
        beWouldSave++;
      } else {
        // Check if it stayed well above entry (< 50% retracement)
        const retracement = calcRetracementPercent(
          trade.entryPrice,
          firstExitWithDrawdown.price,
          firstExitWithDrawdown.drawdownAfter,
          direction
        );
        if (retracement < 50) {
          beUnnecessary++;
        }
      }
    }

    if (analyzed === 0) return null;

    const savePercent = (beWouldSave / analyzed) * 100;
    const unnecessaryPercent = (beUnnecessary / analyzed) * 100;

    let recommendation: 'worth_it' | 'not_worth_it' | 'neutral' | 'insufficient_data';
    if (analyzed < 5) {
      recommendation = 'insufficient_data';
    } else if (savePercent > unnecessaryPercent + 10) {
      recommendation = 'worth_it';
    } else if (unnecessaryPercent > savePercent + 10) {
      recommendation = 'not_worth_it';
    } else {
      recommendation = 'neutral';
    }

    return {
      direction,
      tradesAnalyzed: analyzed,
      beWouldHaveSaved: beWouldSave,
      beWouldHaveSavedPercent: savePercent,
      beUnnecessary,
      beUnnecessaryPercent: unnecessaryPercent,
      tradesWithBEUsed: withBEUsed,
      beSavedVsCost: recommendation,
    };
  };

  return {
    long: analyzeDirection('long'),
    short: analyzeDirection('short'),
  };
}

/**
 * Groups retracement behaviour by setup tags
 */
export function getPostTPByTagAnalysis(trades: TradeRecord[]): TagRetracementStats[] {
  const withData = getTradesWithDrawdownData(trades);

  // Gather retracement data by tag
  const tagData = new Map<string, { retracements: number[]; reachedEntry: number; total: number }>();

  for (const trade of withData) {
    const firstExitWithDrawdown = trade.exits?.find(e => e.drawdownAfter != null);
    if (!firstExitWithDrawdown || firstExitWithDrawdown.drawdownAfter == null) continue;

    const retracement = calcRetracementPercent(
      trade.entryPrice,
      firstExitWithDrawdown.price,
      firstExitWithDrawdown.drawdownAfter,
      trade.direction
    );

    const reachedEntry = didReachEntry(trade.entryPrice, firstExitWithDrawdown.drawdownAfter, trade.direction);

    for (const tag of (trade.contextTags || [])) {
      if (!tagData.has(tag)) {
        tagData.set(tag, { retracements: [], reachedEntry: 0, total: 0 });
      }
      const data = tagData.get(tag)!;
      data.retracements.push(retracement);
      data.total++;
      if (reachedEntry) data.reachedEntry++;
    }
  }

  const results: TagRetracementStats[] = [];

  for (const [tag, data] of tagData) {
    if (data.total < 2) continue;

    const avgRetracement = data.retracements.reduce((a, b) => a + b, 0) / data.retracements.length;
    const reachedEntryPercent = (data.reachedEntry / data.total) * 100;

    let recommendation: 'be_justified' | 'trailing_better' | 'neutral';
    if (avgRetracement > 60 || reachedEntryPercent > 40) {
      recommendation = 'be_justified';
    } else if (avgRetracement < 30 && reachedEntryPercent < 20) {
      recommendation = 'trailing_better';
    } else {
      recommendation = 'neutral';
    }

    results.push({
      tag,
      tradesAnalyzed: data.total,
      avgRetracementPercent: avgRetracement,
      tradesReachedEntryPercent: reachedEntryPercent,
      recommendation,
    });
  }

  return results.sort((a, b) => b.avgRetracementPercent - a.avgRetracementPercent);
}

/**
 * Get scatter data for retracement visualization
 */
export function getRetracementScatterData(trades: TradeRecord[]): RetracementScatterPoint[] {
  const withData = getTradesWithDrawdownData(trades);
  const points: RetracementScatterPoint[] = [];

  for (const trade of withData) {
    if (!trade.id) continue;

    const firstExitWithDrawdown = trade.exits?.find(e => e.drawdownAfter != null);
    if (!firstExitWithDrawdown || firstExitWithDrawdown.drawdownAfter == null) continue;

    const stopDistance = Math.abs(trade.entryPrice - trade.stopLoss);
    if (stopDistance === 0) continue;

    // TP1 distance in R
    const tp1DistanceR = Math.abs(firstExitWithDrawdown.price - trade.entryPrice) / stopDistance;

    // Drawdown after TP1 in R (measured from TP1 price)
    const drawdownDistance = Math.abs(firstExitWithDrawdown.price - firstExitWithDrawdown.drawdownAfter);
    const drawdownR = drawdownDistance / stopDistance;

    points.push({
      tradeId: trade.id,
      direction: trade.direction,
      tp1DistanceR,
      drawdownR,
    });
  }

  return points;
}

/**
 * Generates directional insights for post-TP behaviour
 */
export function getPostTPInsights(trades: TradeRecord[]): string[] {
  const insights: string[] = [];

  const postTP = getPostTPBehaviourAnalysis(trades);
  const beAnalysis = getBEJustificationAnalysis(trades);
  const byTag = getPostTPByTagAnalysis(trades);

  // Long insights
  if (postTP.long && postTP.long.tradesAnalyzed >= 3) {
    const l = postTP.long;
    insights.push(
      `After TP1 on longs, price retraced to within ${l.avgRetracementPercent.toFixed(0)}% of the TP distance on average. ` +
      `Price went below entry on ${l.tradesBeyondEntryPercent.toFixed(0)}% of trades.`
    );
  }

  // Short insights
  if (postTP.short && postTP.short.tradesAnalyzed >= 3) {
    const s = postTP.short;
    insights.push(
      `After TP1 on shorts, price retraced to within ${s.avgRetracementPercent.toFixed(0)}% of the TP distance on average. ` +
      `Price went above entry on ${s.tradesBeyondEntryPercent.toFixed(0)}% of trades.`
    );
  }

  // BE justification insights
  if (beAnalysis.long && beAnalysis.long.tradesAnalyzed >= 5) {
    const l = beAnalysis.long;
    const verdict = l.beSavedVsCost === 'worth_it' ? 'worth it' :
                   l.beSavedVsCost === 'not_worth_it' ? 'not worth it' : 'neutral';
    insights.push(
      `On longs, moving to BE after TP1 would save you on ${l.beWouldHaveSavedPercent.toFixed(0)}% of trades ` +
      `but cost you on ${l.beUnnecessaryPercent.toFixed(0)}% — ${verdict}.`
    );
  }

  if (beAnalysis.short && beAnalysis.short.tradesAnalyzed >= 5) {
    const s = beAnalysis.short;
    const verdict = s.beSavedVsCost === 'worth_it' ? 'worth it' :
                   s.beSavedVsCost === 'not_worth_it' ? 'not worth it' : 'neutral';
    insights.push(
      `On shorts, moving to BE after TP1 would save you on ${s.beWouldHaveSavedPercent.toFixed(0)}% of trades ` +
      `but cost you on ${s.beUnnecessaryPercent.toFixed(0)}% — ${verdict}.`
    );
  }

  // Tag-based insights
  const deepRetraceTags = byTag.filter(t => t.recommendation === 'be_justified' && t.tradesAnalyzed >= 3);
  if (deepRetraceTags.length > 0) {
    const tagNames = deepRetraceTags.slice(0, 3).map(t => t.tag);
    insights.push(
      `Trades tagged [${tagNames.join(', ')}] retrace deeply after TP1 (avg ${deepRetraceTags[0].avgRetracementPercent.toFixed(0)}% of TP distance) — BE is justified.`
    );
  }

  const shallowRetraceTags = byTag.filter(t => t.recommendation === 'trailing_better' && t.tradesAnalyzed >= 3);
  if (shallowRetraceTags.length > 0) {
    const tagNames = shallowRetraceTags.slice(0, 3).map(t => t.tag);
    insights.push(
      `Trades tagged [${tagNames.join(', ')}] barely pull back after TP1 — consider trailing instead of BE.`
    );
  }

  return insights;
}

// ============================================
// POST-EXIT TRACKING ANALYTICS
// ============================================

export interface PostExitAnalysis {
  tradesWithData: number;
  totalClosedTrades: number;
  avgExitEfficiency: number;
  avgMissedR: number;
  reachedTargetPercent: number;
  tradesReachedTarget: number;
}

// Separate analysis for stopouts vs voluntary exits
export interface StopoutAnalysis {
  totalStopouts: number;
  stopoutsWithPostExitData: number;
  avgPostStopMoveR: number;
  stopoutsAboveThreshold: number; // Number where post-stop move >= minRThreshold
  stopoutsAboveThresholdPercent: number; // % of stopouts where thesis was validated
  avgPostStopMoveAboveThreshold: number; // Avg R of those that exceeded threshold
  avgPostStopMoveBelowThreshold: number; // Avg R of those below threshold
}

export interface VoluntaryExitAnalysis {
  totalVoluntaryExits: number;
  withPostExitData: number;
  avgMissedR: number;
  avgExitEfficiency: number;
  reachedTargetPercent: number;
}

export interface MissedRByStopReason {
  reason: string;
  tradeCount: number;
  avgMissedR: number;
  reachedTargetPercent: number;
}

export interface MissedRByExitType {
  exitType: string;
  tradeCount: number;
  avgMissedR: number;
  avgExitEfficiency: number;
}

export interface PostExitScatterPoint {
  tradeId: string;
  pair: string;
  actualR: number;
  wouldHaveR: number;
  hadBEAdjustment: boolean;
}

/**
 * Get overall post-exit analysis
 * Uses replay analysis and reachedTargetPostExit field.
 */
export function getPostExitAnalysis(trades: TradeRecord[]): PostExitAnalysis {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed' && t.tradeTaken !== false);

  let tradesWithData = 0;
  let totalMissedR = 0;
  let totalEfficiency = 0;
  let efficiencyCount = 0;
  let tradesReachedTarget = 0;

  for (const trade of closedTrades) {
    const replayAnalysis = getHoldReplayAnalysis(trade);

    if (replayAnalysis.hasSequence) {
      tradesWithData++;

      if (replayAnalysis.replayMissedR !== null) {
        totalMissedR += replayAnalysis.replayMissedR;
      }

      if (replayAnalysis.replayExitEfficiency !== null) {
        totalEfficiency += replayAnalysis.replayExitEfficiency;
        efficiencyCount++;
      }
    }

    // Use the direct reachedTargetPostExit field
    if (trade.reachedTargetPostExit === true) {
      tradesReachedTarget++;
    }
  }

  return {
    tradesWithData,
    totalClosedTrades: closedTrades.length,
    avgExitEfficiency: efficiencyCount > 0 ? totalEfficiency / efficiencyCount : 0,
    avgMissedR: tradesWithData > 0 ? totalMissedR / tradesWithData : 0,
    reachedTargetPercent: closedTrades.length > 0 ? (tradesReachedTarget / closedTrades.length) * 100 : 0,
    tradesReachedTarget,
  };
}

/**
 * Get stopout-specific post-exit analysis
 * For stopouts, we measure how far price moved in the trader's favour AFTER being stopped out
 * This helps identify if the thesis was correct but stop placement was wrong
 * Uses getFavourableExtreme from post-exit milestones.
 */
export function getStopoutPostExitAnalysis(trades: TradeRecord[], minRThreshold: number = 1.0): StopoutAnalysis {
  const stopoutTrades = trades.filter(t => {
    const exitType = deriveExitType(t);
    return getCachedMetrics(t).status === 'closed' &&
      t.tradeTaken !== false &&
      exitType === 'sl_hit';
  });

  let stopoutsWithPostExitData = 0;
  let totalPostStopMoveR = 0;
  let stopoutsAboveThreshold = 0;
  let totalAboveThreshold = 0;
  let totalBelowThreshold = 0;
  let countAbove = 0;
  let countBelow = 0;

  for (const trade of stopoutTrades) {
    const favExtreme = getFavourableExtreme(trade);

    if (favExtreme) {
      stopoutsWithPostExitData++;
      totalPostStopMoveR += favExtreme.r;

      if (favExtreme.r >= minRThreshold) {
        stopoutsAboveThreshold++;
        totalAboveThreshold += favExtreme.r;
        countAbove++;
      } else {
        totalBelowThreshold += favExtreme.r;
        countBelow++;
      }
    }
  }

  return {
    totalStopouts: stopoutTrades.length,
    stopoutsWithPostExitData,
    avgPostStopMoveR: stopoutsWithPostExitData > 0 ? totalPostStopMoveR / stopoutsWithPostExitData : 0,
    stopoutsAboveThreshold,
    stopoutsAboveThresholdPercent: stopoutsWithPostExitData > 0 ? (stopoutsAboveThreshold / stopoutsWithPostExitData) * 100 : 0,
    avgPostStopMoveAboveThreshold: countAbove > 0 ? totalAboveThreshold / countAbove : 0,
    avgPostStopMoveBelowThreshold: countBelow > 0 ? totalBelowThreshold / countBelow : 0,
  };
}

/**
 * Get voluntary exit (non-stopout) post-exit analysis
 * For voluntary exits, we use the traditional missedR calculation (how much more could have been captured)
 * Uses replay analysis for sequence-based calculations.
 */
export function getVoluntaryExitPostExitAnalysis(trades: TradeRecord[]): VoluntaryExitAnalysis {
  const voluntaryTrades = trades.filter(t => {
    const exitType = deriveExitType(t);
    return getCachedMetrics(t).status === 'closed' &&
      t.tradeTaken !== false &&
      exitType !== 'sl_hit';
  });

  let withPostExitData = 0;
  let totalMissedR = 0;
  let totalEfficiency = 0;
  let efficiencyCount = 0;
  let reachedTargetCount = 0;

  for (const trade of voluntaryTrades) {
    const replayAnalysis = getHoldReplayAnalysis(trade);

    if (replayAnalysis.hasSequence) {
      withPostExitData++;

      if (replayAnalysis.replayMissedR !== null) {
        totalMissedR += replayAnalysis.replayMissedR;
      }

      if (replayAnalysis.replayExitEfficiency !== null) {
        totalEfficiency += replayAnalysis.replayExitEfficiency;
        efficiencyCount++;
      }
    }

    if (trade.reachedTargetPostExit === true) {
      reachedTargetCount++;
    }
  }

  return {
    totalVoluntaryExits: voluntaryTrades.length,
    withPostExitData,
    avgMissedR: withPostExitData > 0 ? totalMissedR / withPostExitData : 0,
    avgExitEfficiency: efficiencyCount > 0 ? totalEfficiency / efficiencyCount : 0,
    reachedTargetPercent: voluntaryTrades.length > 0 ? (reachedTargetCount / voluntaryTrades.length) * 100 : 0,
  };
}

// ============================================
// HOLD REPLAY ANALYSIS (Sequence-based)
// ============================================

/**
 * Hold replay analysis results
 */
export interface HoldReplayBuckets {
  // Trades where hold would have survived to favourable extreme
  survivedToHigh: {
    count: number;
    avgMissedR: number;
    trades: TradeRecord[];
  };
  // Trades where hold would have been stopped before reaching the high
  stoppedFirst: {
    count: number;
    avgSavedR: number;  // R saved by exiting instead of holding
    trades: TradeRecord[];
  };
  // Trades with no sequence data (legacy calculation applies)
  sequenceUnknown: {
    count: number;
    avgLegacyMissedR: number;
    trades: TradeRecord[];
  };
  // Summary stats
  totalTrades: number;
  holdSurvivedPercent: number;
  headline: string;
}

/**
 * Get hold replay analysis with buckets
 * Replaces the naive favourable-first/adverse-first split with replay-based logic
 */
export function getHoldReplayBuckets(trades: TradeRecord[]): HoldReplayBuckets {
  const closedTrades = trades.filter(t => {
    const exitType = deriveExitType(t);
    return getCachedMetrics(t).status === 'closed' &&
      t.tradeTaken !== false &&
      exitType !== 'sl_hit'; // Only voluntary exits (stopouts are different)
  });

  const survivedTrades: TradeRecord[] = [];
  const stoppedTrades: TradeRecord[] = [];
  const unknownTrades: TradeRecord[] = [];

  let totalSurvivedMissedR = 0;
  let totalStoppedSavedR = 0;
  const totalUnknownMissedR = 0;

  for (const trade of closedTrades) {
    const replayAnalysis = getHoldReplayAnalysis(trade);
    const metrics = getCachedMetrics(trade);

    if (!replayAnalysis.hasSequence) {
      // No sequence data - cannot compute missed R for this trade
      unknownTrades.push(trade);
    } else if (replayAnalysis.holdSurvived) {
      // Would have survived to the high
      survivedTrades.push(trade);
      totalSurvivedMissedR += replayAnalysis.replayMissedR ?? 0;
    } else {
      // Would have been stopped first
      stoppedTrades.push(trade);
      // Calculate what the exit "saved" - if holding would have hit stop, actual result was better
      if (metrics.rMultiple !== undefined && metrics.rMultiple !== null) {
        // Saved R = actual R - (-1R for stop hit) = actual R + 1
        // But if actual R was already negative, the "saved" amount is less
        const savedR = metrics.rMultiple - (-1); // What they got vs what stop would give
        totalStoppedSavedR += Math.max(0, savedR);
      }
    }
  }

  const totalWithReplayData = survivedTrades.length + stoppedTrades.length;
  const holdSurvivedPercent = totalWithReplayData > 0
    ? (survivedTrades.length / totalWithReplayData) * 100
    : 0;

  // Generate headline insight
  let headline = '';
  if (totalWithReplayData < 5) {
    headline = 'Need more trades with post-exit sequences for meaningful replay analysis.';
  } else if (holdSurvivedPercent >= 60) {
    const avgMissed = survivedTrades.length > 0 ? totalSurvivedMissedR / survivedTrades.length : 0;
    headline = `${holdSurvivedPercent.toFixed(0)}% of exits could have been held longer — averaging ${avgMissed.toFixed(1)}R left on the table.`;
  } else if (holdSurvivedPercent <= 40) {
    const avgSaved = stoppedTrades.length > 0 ? totalStoppedSavedR / stoppedTrades.length : 0;
    headline = `${(100 - holdSurvivedPercent).toFixed(0)}% of exits were validated by subsequent stop hits — your exits saved an average of ${avgSaved.toFixed(1)}R.`;
  } else {
    headline = `Mixed results: ${holdSurvivedPercent.toFixed(0)}% would have survived to highs, ${(100 - holdSurvivedPercent).toFixed(0)}% would have been stopped.`;
  }

  return {
    survivedToHigh: {
      count: survivedTrades.length,
      avgMissedR: survivedTrades.length > 0 ? totalSurvivedMissedR / survivedTrades.length : 0,
      trades: survivedTrades,
    },
    stoppedFirst: {
      count: stoppedTrades.length,
      avgSavedR: stoppedTrades.length > 0 ? totalStoppedSavedR / stoppedTrades.length : 0,
      trades: stoppedTrades,
    },
    sequenceUnknown: {
      count: unknownTrades.length,
      avgLegacyMissedR: unknownTrades.length > 0 ? totalUnknownMissedR / unknownTrades.length : 0,
      trades: unknownTrades,
    },
    totalTrades: closedTrades.length,
    holdSurvivedPercent,
    headline,
  };
}

/**
 * Get per-stop-variant replay analysis
 * Compares outcomes with original stop vs final adjusted stop
 */
export interface StopVariantComparison {
  originalStopSurvived: number;
  originalStopStopped: number;
  finalStopSurvived: number;
  finalStopStopped: number;
  tradesWithAdjustments: number;
  originalBetterCount: number;  // Cases where original stop would have been better
  finalBetterCount: number;     // Cases where final stop was better
  insight: string;
}

/**
 * Per-variant hold replay: compares outcomes with original stop vs final adjusted stop.
 * For trades with stop moves + post-exit data, reports both replays.
 */
export function getStopVariantComparison(trades: TradeRecord[]): StopVariantComparison | null {
  const closedTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' && t.tradeTaken !== false
  );

  // Only consider trades with both stop moves AND post-exit milestones
  const tradesWithBoth = closedTrades.filter(t => {
    const stopMoves = getStopMoves(t);
    const postExit = getPostExitMilestones(t);
    return stopMoves.length > 0 && postExit.length >= 2;
  });

  if (tradesWithBoth.length < 3) {
    return null;
  }

  let originalStopSurvived = 0;
  let originalStopStopped = 0;
  let finalStopSurvived = 0;
  let finalStopStopped = 0;
  let originalBetterCount = 0;
  let finalBetterCount = 0;

  for (const trade of tradesWithBoth) {
    const stopMoves = getStopMoves(trade).filter(sm => sm.price !== null);
    const finalStopLevel = stopMoves.length > 0
      ? stopMoves[stopMoves.length - 1].price!
      : trade.stopLoss;

    // Replay with original stop
    const originalReplay = replayHold(trade, trade.stopLoss);
    // Replay with final adjusted stop
    const finalReplay = replayHold(trade, finalStopLevel);

    if (originalReplay.type === 'survived') {
      originalStopSurvived++;
    } else if (originalReplay.type === 'stopped') {
      originalStopStopped++;
    }

    if (finalReplay.type === 'survived') {
      finalStopSurvived++;
    } else if (finalReplay.type === 'stopped') {
      finalStopStopped++;
    }

    // Compare which was better
    if (originalReplay.type === 'survived' && finalReplay.type === 'stopped') {
      originalBetterCount++;
    } else if (finalReplay.type === 'survived' && originalReplay.type === 'stopped') {
      finalBetterCount++;
    } else if (originalReplay.type === 'survived' && finalReplay.type === 'survived') {
      // Both survived - compare R achieved
      if (originalReplay.favourableExtremeR > (finalReplay as { favourableExtremeR: number }).favourableExtremeR) {
        // Original would have achieved more (tighter final stop might have limited gains)
        // This comparison is a bit nuanced - for now, count as equal
      }
    }
  }

  // Generate insight
  let insight = '';
  if (originalBetterCount > finalBetterCount) {
    insight = `Original stops would have been better in ${originalBetterCount} of ${tradesWithBoth.length} trades — your adjustments may be premature.`;
  } else if (finalBetterCount > originalBetterCount) {
    insight = `Adjusted stops were better in ${finalBetterCount} of ${tradesWithBoth.length} trades — your stop management is adding value.`;
  } else {
    insight = `Stop adjustments had mixed results across ${tradesWithBoth.length} trades.`;
  }

  return {
    originalStopSurvived,
    originalStopStopped,
    finalStopSurvived,
    finalStopStopped,
    tradesWithAdjustments: tradesWithBoth.length,
    originalBetterCount,
    finalBetterCount,
    insight,
  };
}

/**
 * Cross-reference stop adjustments with post-exit data
 * Groups by the stop adjustment reason (especially "moved to BE")
 * Uses replayHold to determine missed R based on sequence data.
 */
export function getMissedRByStopReason(trades: TradeRecord[]): MissedRByStopReason[] {
  const closedTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' && t.tradeTaken !== false
  );

  // Group trades by stop reason
  const reasonGroups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const stopMoves = getStopMoves(trade);
    if (stopMoves.length === 0) continue;

    // Use the first (or primary) stop move reason
    const primaryMove = stopMoves[0];
    let reason = primaryMove.description?.trim() || 'No reason given';

    // Normalize BE moves
    if (isBEStopMove(trade, primaryMove)) {
      reason = 'Moved to BE';
    }

    if (!reasonGroups.has(reason)) {
      reasonGroups.set(reason, []);
    }
    reasonGroups.get(reason)!.push(trade);
  }

  const results: MissedRByStopReason[] = [];

  for (const [reason, groupTrades] of reasonGroups) {
    if (groupTrades.length === 0) continue;

    let totalMissedR = 0;
    let tradesWithData = 0;
    let reachedTargetCount = 0;

    for (const trade of groupTrades) {
      const replayAnalysis = getHoldReplayAnalysis(trade);

      if (replayAnalysis.hasSequence && replayAnalysis.replayMissedR !== null) {
        totalMissedR += replayAnalysis.replayMissedR;
        tradesWithData++;
      }

      if (trade.reachedTargetPostExit === true) {
        reachedTargetCount++;
      }
    }

    results.push({
      reason,
      tradeCount: groupTrades.length,
      avgMissedR: tradesWithData > 0 ? totalMissedR / tradesWithData : 0,
      reachedTargetPercent: groupTrades.length > 0 ? (reachedTargetCount / groupTrades.length) * 100 : 0,
    });
  }

  // Sort by count descending
  return results.sort((a, b) => b.tradeCount - a.tradeCount);
}

/**
 * Groups missed R by exit type from the exits array
 * Uses replay analysis to determine missed R.
 */
export function getMissedRByExitType(trades: TradeRecord[]): MissedRByExitType[] {
  const closedTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' && t.tradeTaken !== false
  );

  // Group by exit type
  const exitTypeGroups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const exitType = deriveExitType(trade);
    const exitTypeLabel = exitType
      ? exitType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      : 'Unknown';

    if (!exitTypeGroups.has(exitTypeLabel)) {
      exitTypeGroups.set(exitTypeLabel, []);
    }
    exitTypeGroups.get(exitTypeLabel)!.push(trade);
  }

  const results: MissedRByExitType[] = [];

  for (const [exitType, groupTrades] of exitTypeGroups) {
    if (groupTrades.length === 0) continue;

    let totalMissedR = 0;
    let totalEfficiency = 0;
    let tradesWithData = 0;

    for (const trade of groupTrades) {
      const replayAnalysis = getHoldReplayAnalysis(trade);

      if (replayAnalysis.hasSequence) {
        if (replayAnalysis.replayMissedR !== null) {
          totalMissedR += replayAnalysis.replayMissedR;
        }
        if (replayAnalysis.replayExitEfficiency !== null) {
          totalEfficiency += replayAnalysis.replayExitEfficiency;
        }
        tradesWithData++;
      }
    }

    results.push({
      exitType,
      tradeCount: groupTrades.length,
      avgMissedR: tradesWithData > 0 ? totalMissedR / tradesWithData : 0,
      avgExitEfficiency: tradesWithData > 0 ? totalEfficiency / tradesWithData : 0,
    });
  }

  // Sort by count descending
  return results.sort((a, b) => b.tradeCount - a.tradeCount);
}

/**
 * Get scatter data for "should-have-held" visualization
 * X: actual R achieved, Y: would-have R (if held to post-exit best price)
 * Uses replay analysis for would-have R calculation.
 */
export function getPostExitScatterData(trades: TradeRecord[]): PostExitScatterPoint[] {
  const closedTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' && t.tradeTaken !== false
  );

  const results: PostExitScatterPoint[] = [];

  for (const trade of closedTrades) {
    const metrics = getCachedMetrics(trade);
    const replayAnalysis = getHoldReplayAnalysis(trade);

    if (metrics.rMultiple === null) continue;

    // Determine would-have R from replay
    let wouldHaveR = metrics.rMultiple; // Default to actual if no sequence
    if (replayAnalysis.originalStopOutcome.type === 'survived') {
      wouldHaveR = replayAnalysis.originalStopOutcome.favourableExtremeR;
    } else if (replayAnalysis.originalStopOutcome.type === 'stopped') {
      // Would have been stopped at -1R
      wouldHaveR = -1;
    }

    // Check if trade had BE adjustment
    const stopMoves = getStopMoves(trade);
    const hadBEAdjustment = stopMoves.some(sm => isBEStopMove(trade, sm));

    results.push({
      tradeId: trade.id!,
      pair: trade.pair,
      actualR: metrics.rMultiple,
      wouldHaveR,
      hadBEAdjustment,
    });
  }

  return results;
}

/**
 * Generate insights from post-exit analysis
 * @param minRThreshold - Minimum R move to consider thesis validated (default 1.0)
 */
export function getPostExitInsights(trades: TradeRecord[], minRThreshold: number = 1.0): string[] {
  const insights: string[] = [];

  const analysis = getPostExitAnalysis(trades);
  const stopoutAnalysis = getStopoutPostExitAnalysis(trades, minRThreshold);
  const voluntaryAnalysis = getVoluntaryExitPostExitAnalysis(trades);
  const byStopReason = getMissedRByStopReason(trades);
  const byExitType = getMissedRByExitType(trades);

  if (analysis.tradesWithData < 5) {
    insights.push(
      `Only ${analysis.tradesWithData} of ${analysis.totalClosedTrades} closed trades have post-exit data. ` +
      `Review more trades to unlock exit optimization insights.`
    );
    return insights;
  }

  // Stopout-specific insight (separate from voluntary exits)
  if (stopoutAnalysis.stopoutsWithPostExitData >= 3) {
    const percentAbove = stopoutAnalysis.stopoutsAboveThresholdPercent;
    insights.push(
      `Of ${stopoutAnalysis.stopoutsWithPostExitData} stopouts with post-exit data, ` +
      `${percentAbove.toFixed(0)}% saw price reach your ${minRThreshold}R threshold afterwards` +
      (percentAbove > 30
        ? ` — suggesting stop placement, not thesis, was the issue on those trades.`
        : `.`)
    );
  }

  // Voluntary exit efficiency insight
  if (voluntaryAnalysis.withPostExitData >= 3 && voluntaryAnalysis.avgExitEfficiency > 0) {
    const efficiencyDesc = voluntaryAnalysis.avgExitEfficiency >= 80 ? 'excellent' :
                          voluntaryAnalysis.avgExitEfficiency >= 60 ? 'good' :
                          voluntaryAnalysis.avgExitEfficiency >= 40 ? 'moderate' : 'low';
    insights.push(
      `Your voluntary exit efficiency is ${voluntaryAnalysis.avgExitEfficiency.toFixed(0)}% (${efficiencyDesc}). ` +
      `On average, you're leaving ${voluntaryAnalysis.avgMissedR.toFixed(2)}R on the table.`
    );
  }

  // Reached target insight (for voluntary exits only)
  if (voluntaryAnalysis.reachedTargetPercent > 30) {
    insights.push(
      `${voluntaryAnalysis.reachedTargetPercent.toFixed(0)}% of your voluntary exits reached target afterwards. ` +
      `Consider holding longer or using trailing stops.`
    );
  } else if (voluntaryAnalysis.reachedTargetPercent < 10 && voluntaryAnalysis.withPostExitData >= 10) {
    insights.push(
      `Only ${voluntaryAnalysis.reachedTargetPercent.toFixed(0)}% of voluntary exits reached target after — solid timing.`
    );
  }

  // BE stop adjustment insight
  const beGroup = byStopReason.find(g => g.reason === 'Moved to BE');
  if (beGroup && beGroup.tradeCount >= 3) {
    insights.push(
      `Trades where you moved to BE missed an average of ${beGroup.avgMissedR.toFixed(2)}R. ` +
      `${beGroup.reachedTargetPercent.toFixed(0)}% went on to hit your target after stopping you out.`
    );
  }

  // Exit type insights (excluding stopouts since they're handled separately)
  const voluntaryExitTypes = byExitType.filter(e => e.exitType.toLowerCase() !== 'sl hit');
  if (voluntaryExitTypes.length > 0) {
    const worstExitType = voluntaryExitTypes.reduce((worst, current) =>
      current.avgMissedR > worst.avgMissedR ? current : worst
    , voluntaryExitTypes[0]);

    if (worstExitType && worstExitType.tradeCount >= 3 && worstExitType.avgMissedR > 0.5) {
      insights.push(
        `"${worstExitType.exitType}" exits leave the most on the table (${worstExitType.avgMissedR.toFixed(2)}R avg missed).`
      );
    }
  }

  return insights;
}

// ============================================
// LEVEL SEQUENCE ANALYSIS
// ============================================

/**
 * Level type + timeframe reaction statistics
 */
export interface LevelTypeReactionStats {
  levelType: string;
  timeframe: string;
  key: string; // Combined levelType + timeframe for display
  count: number;
  bouncedCount: number;
  frontRunCount: number;
  sweptCount: number;
  brokenCount: number;
  bouncedPercent: number;
  frontRunPercent: number;
  sweptPercent: number;
  brokenPercent: number;
  // Front-run distance stats (when reaction === 'front_run' and turnPrice is set)
  avgFrontRunDistanceR: number | null;
  frontRunsWithDistance: number;
}

/**
 * Front-run distance bucket for histogram
 */
export interface FrontRunDistanceBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  percent: number;
}

/**
 * Front-run distance analysis results
 */
export interface FrontRunDistanceAnalysis {
  totalFrontRuns: number;
  frontRunsWithData: number;
  avgDistanceR: number;
  medianDistanceR: number;
  minDistanceR: number;
  maxDistanceR: number;
  distribution: FrontRunDistanceBucket[];
  // All individual distances for scatter/histogram
  distances: Array<{
    distanceR: number;
    distancePercent: number | null; // % of distance from prior level
    levelType: string;
    timeframe: string;
  }>;
}

/**
 * Turn offset analysis for entry placement optimization
 */
export interface TurnOffsetAnalysis {
  minTurnOffsetR: number;
  maxTurnOffsetR: number;
  medianTurnOffsetR: number;
  suggestedEntryOffsetR: number;
  tradesAnalyzed: number;
}

/**
 * Pairwise order analysis for front/behind level patterns
 */
export interface PairwiseOrderStats {
  frontLevel: string;
  behindLevel: string;
  count: number;
  frontHoldsCount: number;
  behindHoldsCount: number;
  bothBrokenCount: number;
  frontHoldsPercent: number;
  behindHoldsPercent: number;
  bothBrokenPercent: number;
}

/**
 * Entry depth analysis stats
 */
export interface EntryDepthStats {
  position: number;
  turnCount: number;
  turnPercent: number;
  entryCount: number;
  entryPercent: number;
}

/**
 * Entry vs turn depth analysis
 */
export interface EntryVsTurnAnalysis {
  avgTurnPosition: number;
  avgEntryPosition: number;
  positionGap: number;
  tradesWithData: number;
  totalTrades: number;
  depthDistribution: EntryDepthStats[];
  couldImprovePercent: number;
  avgAdverseReduction: number | null;
}

/**
 * Get level type × timeframe reaction statistics
 * For fib types, sub-groups by levelDetail (e.g., "fib · GP", "fib · 0.5")
 */
export function getLevelTypeReactionStats(trades: TradeRecord[]): LevelTypeReactionStats[] {
  const relevantTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    t.tradeTaken !== false &&
    t.levelSequence &&
    t.levelSequence.length > 0
  );

  // Group by levelType (+ detail for fib types) + timeframe
  const statsMap = new Map<string, {
    levelType: string;
    timeframe: string;
    total: number;
    bounced: number;
    frontRun: number;
    swept: number;
    broken: number;
    frontRunDistancesR: number[];
  }>();

  for (const trade of relevantTrades) {
    const metrics = getCachedMetrics(trade);
    const stopDistance = metrics.stopDistance || 0;

    for (const level of trade.levelSequence) {
      if (!level.reaction) continue;

      // For fib types with detail, use "fib · GP" format; otherwise just levelType
      const levelTypeKey = getLevelTypeKey(level);
      const key = `${level.timeframe || '—'} ${levelTypeKey}`;
      if (!statsMap.has(key)) {
        statsMap.set(key, {
          levelType: levelTypeKey,
          timeframe: level.timeframe || '—',
          total: 0,
          bounced: 0,
          frontRun: 0,
          swept: 0,
          broken: 0,
          frontRunDistancesR: [],
        });
      }

      const stats = statsMap.get(key)!;
      stats.total++;

      switch (level.reaction) {
        case 'bounced': stats.bounced++; break;
        case 'front_run':
          stats.frontRun++;
          // Calculate front-run distance in R
          if (level.turnPrice !== null && level.turnPrice !== undefined && stopDistance > 0) {
            const distanceR = Math.abs(level.price - level.turnPrice) / stopDistance;
            stats.frontRunDistancesR.push(distanceR);
          }
          break;
        case 'swept_then_bounced': stats.swept++; break;
        case 'broken': stats.broken++; break;
      }
    }
  }

  const results: LevelTypeReactionStats[] = [];
  for (const [key, stats] of statsMap.entries()) {
    const avgFrontRunDistanceR = stats.frontRunDistancesR.length > 0
      ? stats.frontRunDistancesR.reduce((a, b) => a + b, 0) / stats.frontRunDistancesR.length
      : null;

    results.push({
      levelType: stats.levelType,
      timeframe: stats.timeframe,
      key,
      count: stats.total,
      bouncedCount: stats.bounced,
      frontRunCount: stats.frontRun,
      sweptCount: stats.swept,
      brokenCount: stats.broken,
      bouncedPercent: (stats.bounced / stats.total) * 100,
      frontRunPercent: (stats.frontRun / stats.total) * 100,
      sweptPercent: (stats.swept / stats.total) * 100,
      brokenPercent: (stats.broken / stats.total) * 100,
      avgFrontRunDistanceR,
      frontRunsWithDistance: stats.frontRunDistancesR.length,
    });
  }

  return results.sort((a, b) => b.count - a.count);
}

/**
 * Get pairwise order analysis - when level A is in front of level B
 */
export function getPairwiseOrderAnalysis(trades: TradeRecord[]): PairwiseOrderStats[] {
  const relevantTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    t.tradeTaken !== false &&
    t.levelSequence &&
    t.levelSequence.length >= 2
  );

  // Track pairwise stats
  const pairMap = new Map<string, {
    frontLevel: string;
    behindLevel: string;
    count: number;
    frontHolds: number;
    behindHolds: number;
    bothBroken: number;
  }>();

  for (const trade of relevantTrades) {
    const seq = trade.levelSequence;

    // For each pair of adjacent levels
    for (let i = 0; i < seq.length - 1; i++) {
      const front = seq[i];
      const behind = seq[i + 1];

      // Use getLevelTypeKey to include detail for fib types (e.g., "fib · GP")
      const frontTypeKey = getLevelTypeKey(front);
      const behindTypeKey = getLevelTypeKey(behind);
      const frontKey = `${front.timeframe || ''} ${frontTypeKey}`.trim();
      const behindKey = `${behind.timeframe || ''} ${behindTypeKey}`.trim();
      const pairKey = `${frontKey} → ${behindKey}`;

      if (!pairMap.has(pairKey)) {
        pairMap.set(pairKey, {
          frontLevel: frontKey,
          behindLevel: behindKey,
          count: 0,
          frontHolds: 0,
          behindHolds: 0,
          bothBroken: 0,
        });
      }

      const stats = pairMap.get(pairKey)!;
      stats.count++;

      // Determine outcome
      const frontHeld = front.reaction === 'bounced' || front.reaction === 'front_run';
      const behindHeld = behind.reaction === 'bounced' || behind.reaction === 'swept_then_bounced';
      const frontBroken = front.reaction === 'broken' || front.reaction === 'swept_then_bounced';
      const behindBroken = behind.reaction === 'broken';

      if (frontHeld) {
        stats.frontHolds++;
      } else if (frontBroken && behindHeld) {
        stats.behindHolds++;
      } else if (frontBroken && behindBroken) {
        stats.bothBroken++;
      }
    }
  }

  const results: PairwiseOrderStats[] = [];
  for (const [, stats] of pairMap.entries()) {
    if (stats.count >= 2) { // Minimum sample size
      results.push({
        frontLevel: stats.frontLevel,
        behindLevel: stats.behindLevel,
        count: stats.count,
        frontHoldsCount: stats.frontHolds,
        behindHoldsCount: stats.behindHolds,
        bothBrokenCount: stats.bothBroken,
        frontHoldsPercent: (stats.frontHolds / stats.count) * 100,
        behindHoldsPercent: (stats.behindHolds / stats.count) * 100,
        bothBrokenPercent: (stats.bothBroken / stats.count) * 100,
      });
    }
  }

  return results.sort((a, b) => b.count - a.count);
}

/**
 * Get entry depth analysis - where price turns vs where trader enters
 */
export function getEntryDepthAnalysis(trades: TradeRecord[]): EntryVsTurnAnalysis {
  const relevantTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    t.tradeTaken !== false &&
    t.levelSequence &&
    t.levelSequence.length > 0
  );

  const totalTrades = trades.filter(t => getCachedMetrics(t).status === 'closed' && t.tradeTaken !== false).length;

  if (relevantTrades.length === 0) {
    return {
      avgTurnPosition: 0,
      avgEntryPosition: 0,
      positionGap: 0,
      tradesWithData: 0,
      totalTrades,
      depthDistribution: [],
      couldImprovePercent: 0,
      avgAdverseReduction: null,
    };
  }

  // Track turn positions and entry positions
  const turnPositions: number[] = [];
  const entryPositions: number[] = [];
  const depthCounts: { [pos: number]: { turns: number; entries: number } } = {};
  let couldImproveCount = 0;
  let totalAdverseReduction = 0;
  let adverseReductionCount = 0;

  for (const trade of relevantTrades) {
    const seq = trade.levelSequence;

    // Find turn position (first level that bounced or swept_then_bounced)
    let turnPos = -1;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i].reaction === 'bounced' || seq[i].reaction === 'swept_then_bounced') {
        turnPos = i + 1; // 1-indexed
        break;
      }
    }

    if (turnPos > 0) {
      turnPositions.push(turnPos);
      if (!depthCounts[turnPos]) depthCounts[turnPos] = { turns: 0, entries: 0 };
      depthCounts[turnPos].turns++;
    }

    // Find entry position (closest level to entry price)
    let entryPos = 1;
    let minDistance = Infinity;
    for (let i = 0; i < seq.length; i++) {
      const distance = Math.abs(trade.entryPrice - seq[i].price);
      if (distance < minDistance) {
        minDistance = distance;
        entryPos = i + 1;
      }
    }

    entryPositions.push(entryPos);
    if (!depthCounts[entryPos]) depthCounts[entryPos] = { turns: 0, entries: 0 };
    depthCounts[entryPos].entries++;

    // Check if entering deeper would have helped
    if (turnPos > entryPos) {
      couldImproveCount++;

      // Calculate potential adverse reduction using MAE from metrics
      const metrics = getCachedMetrics(trade);
      if (metrics.maeR !== undefined && metrics.maeR !== null && metrics.stopDistance) {
        const currentAdverse = metrics.maeR;
        // Estimate reduced adverse (assume entering at turn level reduces adverse proportionally)
        const estimatedReduction = currentAdverse * ((turnPos - entryPos) / turnPos);
        totalAdverseReduction += estimatedReduction;
        adverseReductionCount++;
      }
    }
  }

  // Calculate averages
  const avgTurnPosition = turnPositions.length > 0
    ? turnPositions.reduce((a, b) => a + b, 0) / turnPositions.length
    : 0;
  const avgEntryPosition = entryPositions.length > 0
    ? entryPositions.reduce((a, b) => a + b, 0) / entryPositions.length
    : 0;

  // Build depth distribution
  const maxPos = Math.max(...Object.keys(depthCounts).map(Number), 5);
  const depthDistribution: EntryDepthStats[] = [];
  for (let pos = 1; pos <= maxPos; pos++) {
    const data = depthCounts[pos] || { turns: 0, entries: 0 };
    depthDistribution.push({
      position: pos,
      turnCount: data.turns,
      turnPercent: turnPositions.length > 0 ? (data.turns / turnPositions.length) * 100 : 0,
      entryCount: data.entries,
      entryPercent: entryPositions.length > 0 ? (data.entries / entryPositions.length) * 100 : 0,
    });
  }

  return {
    avgTurnPosition: Number(avgTurnPosition.toFixed(1)),
    avgEntryPosition: Number(avgEntryPosition.toFixed(1)),
    positionGap: Number((avgTurnPosition - avgEntryPosition).toFixed(1)),
    tradesWithData: relevantTrades.length,
    totalTrades,
    depthDistribution,
    couldImprovePercent: relevantTrades.length > 0 ? (couldImproveCount / relevantTrades.length) * 100 : 0,
    avgAdverseReduction: adverseReductionCount > 0 ? totalAdverseReduction / adverseReductionCount : null,
  };
}

/**
 * Generate insights from level sequence analysis
 */
export function getLevelSequenceInsights(
  levelTypeStats: LevelTypeReactionStats[],
  pairwiseStats: PairwiseOrderStats[],
  entryDepthAnalysis: EntryVsTurnAnalysis,
  _frontRunAnalysis?: FrontRunDistanceAnalysis,
  turnOffsetAnalysis?: TurnOffsetAnalysis | null
): string[] {
  const insights: string[] = [];

  // Level type insight - find best performing level type
  const goodLevels = levelTypeStats.filter(l => l.count >= 5 && (l.bouncedPercent + l.sweptPercent) >= 60);
  if (goodLevels.length > 0) {
    const best = goodLevels.sort((a, b) =>
      (b.bouncedPercent + b.sweptPercent) - (a.bouncedPercent + a.sweptPercent)
    )[0];
    const holdRate = (best.bouncedPercent + best.sweptPercent).toFixed(0);
    insights.push(
      `Your ${best.key} levels hold ${holdRate}% of the time (${best.bouncedCount} bounced, ${best.sweptCount} swept then bounced).`
    );
  }

  // Front-run distance insights per level type
  const levelsWithFrontRunData = levelTypeStats.filter(l =>
    l.frontRunCount >= 3 && l.avgFrontRunDistanceR !== null
  );
  if (levelsWithFrontRunData.length > 0) {
    for (const level of levelsWithFrontRunData.slice(0, 2)) {
      insights.push(
        `${level.key} levels get front-run ${level.frontRunPercent.toFixed(0)}% of the time, ` +
        `by an avg ${level.avgFrontRunDistanceR!.toFixed(2)}R.`
      );
    }
  }

  // Fib level detail insight - compare different fib ratios
  const fibLevels = levelTypeStats.filter(l =>
    l.levelType.toLowerCase().startsWith('fib') &&
    l.levelType.includes('·') &&
    l.count >= 3
  );
  if (fibLevels.length >= 2) {
    // Sort by hold rate (bounced + swept)
    const sortedFibs = fibLevels.sort((a, b) =>
      (b.bouncedPercent + b.sweptPercent) - (a.bouncedPercent + a.sweptPercent)
    );
    const best = sortedFibs[0];
    const worst = sortedFibs[sortedFibs.length - 1];
    const bestHoldRate = (best.bouncedPercent + best.sweptPercent).toFixed(0);
    const worstHoldRate = (worst.bouncedPercent + worst.sweptPercent).toFixed(0);
    // Extract just the ratio part (e.g., "GP" from "fib · GP")
    const bestRatio = best.levelType.split('·')[1]?.trim() || best.levelType;
    const worstRatio = worst.levelType.split('·')[1]?.trim() || worst.levelType;

    if (parseInt(bestHoldRate) - parseInt(worstHoldRate) >= 15) {
      insights.push(
        `Your ${bestRatio} taps bounce ${bestHoldRate}% (n=${best.count}) vs ${worstHoldRate}% for ${worstRatio} retraces — ` +
        `${bestRatio} is your strongest fib level.`
      );
    }
  }

  // Pairwise insight
  const significantPairs = pairwiseStats.filter(p => p.count >= 5);
  if (significantPairs.length > 0) {
    const bestPair = significantPairs.sort((a, b) => b.behindHoldsPercent - a.behindHoldsPercent)[0];
    if (bestPair.behindHoldsPercent > 40 && bestPair.frontHoldsPercent < 40) {
      insights.push(
        `When ${bestPair.frontLevel} sits in front of ${bestPair.behindLevel} (n=${bestPair.count}): ` +
        `the front holds ${bestPair.frontHoldsPercent.toFixed(0)}%, price sweeps and bounces from behind ` +
        `${bestPair.behindHoldsPercent.toFixed(0)}%, both break ${bestPair.bothBrokenPercent.toFixed(0)}%. ` +
        `Consider entering at the ${bestPair.behindLevel}, not the ${bestPair.frontLevel}.`
      );
    }
  }

  // Entry depth insight
  if (entryDepthAnalysis.tradesWithData >= 10 && entryDepthAnalysis.positionGap > 0.3) {
    const mostCommonTurn = entryDepthAnalysis.depthDistribution
      .filter(d => d.turnCount > 0)
      .sort((a, b) => b.turnPercent - a.turnPercent)[0];

    if (mostCommonTurn) {
      insights.push(
        `Your zones most often resolve at the ${getOrdinal(mostCommonTurn.position)} level ` +
        `(${mostCommonTurn.turnPercent.toFixed(0)}% of trades), but you typically enter at the ` +
        `${getOrdinal(Math.round(entryDepthAnalysis.avgEntryPosition))} — you're entering too shallow. ` +
        `Entering one level deeper would have improved entry price on ${entryDepthAnalysis.couldImprovePercent.toFixed(0)}% of trades.`
      );

      if (entryDepthAnalysis.avgAdverseReduction !== null) {
        insights.push(
          `Entering at the typical turn depth would reduce your first-touch adverse move by approximately ` +
          `${(entryDepthAnalysis.avgAdverseReduction * 100).toFixed(0)}%.`
        );
      }
    }
  }

  // Entry placement insight - combine front-run and penetration data
  if (turnOffsetAnalysis && turnOffsetAnalysis.tradesAnalyzed >= 10) {
    const minR = turnOffsetAnalysis.minTurnOffsetR;
    const maxR = turnOffsetAnalysis.maxTurnOffsetR;
    const medianR = turnOffsetAnalysis.medianTurnOffsetR;

    // Format offsets nicely (negative = short of level, positive = beyond)
    const formatOffset = (r: number): string => {
      if (Math.abs(r) < 0.01) return 'at the level';
      if (r < 0) return `${Math.abs(r).toFixed(2)}R short`;
      return `${r.toFixed(2)}R beyond`;
    };

    insights.push(
      `Across your levels, price turns between ${formatOffset(minR)} and ${formatOffset(maxR)} ` +
      `(median: ${formatOffset(medianR)}). Consider placing entries ${formatOffset(medianR)} rather than at the level.`
    );
  }

  return insights;
}

/**
 * Helper to get ordinal suffix
 */
function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Get comprehensive front-run distance analysis
 * Includes distribution histogram and per-level stats
 */
export function getFrontRunDistanceAnalysis(trades: TradeRecord[]): FrontRunDistanceAnalysis {
  const relevantTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    t.tradeTaken !== false &&
    t.levelSequence &&
    t.levelSequence.length > 0
  );

  const distances: FrontRunDistanceAnalysis['distances'] = [];
  let totalFrontRuns = 0;

  for (const trade of relevantTrades) {
    const metrics = getCachedMetrics(trade);
    const stopDistance = metrics.stopDistance || 0;

    for (let i = 0; i < trade.levelSequence.length; i++) {
      const level = trade.levelSequence[i];
      if (level.reaction !== 'front_run') continue;

      totalFrontRuns++;

      if (level.turnPrice !== null && level.turnPrice !== undefined && stopDistance > 0) {
        const distanceR = Math.abs(level.price - level.turnPrice) / stopDistance;

        // Calculate % of distance from prior level (if one exists)
        let distancePercent: number | null = null;
        if (i > 0) {
          const priorLevel = trade.levelSequence[i - 1];
          const distanceFromPrior = Math.abs(level.price - priorLevel.price);
          if (distanceFromPrior > 0) {
            distancePercent = (Math.abs(level.price - level.turnPrice) / distanceFromPrior) * 100;
          }
        }

        distances.push({
          distanceR,
          distancePercent,
          levelType: getLevelTypeKey(level),
          timeframe: level.timeframe || '—',
        });
      }
    }
  }

  if (distances.length === 0) {
    return {
      totalFrontRuns,
      frontRunsWithData: 0,
      avgDistanceR: 0,
      medianDistanceR: 0,
      minDistanceR: 0,
      maxDistanceR: 0,
      distribution: [],
      distances: [],
    };
  }

  // Sort distances for median calculation
  const sortedDistances = distances.map(d => d.distanceR).sort((a, b) => a - b);
  const medianDistanceR = sortedDistances[Math.floor(sortedDistances.length / 2)];
  const avgDistanceR = sortedDistances.reduce((a, b) => a + b, 0) / sortedDistances.length;
  const minDistanceR = sortedDistances[0];
  const maxDistanceR = sortedDistances[sortedDistances.length - 1];

  // Create distribution buckets (0-0.1R, 0.1-0.2R, 0.2-0.3R, 0.3-0.5R, 0.5R+)
  const buckets: FrontRunDistanceBucket[] = [
    { label: '0-0.1R', min: 0, max: 0.1, count: 0, percent: 0 },
    { label: '0.1-0.2R', min: 0.1, max: 0.2, count: 0, percent: 0 },
    { label: '0.2-0.3R', min: 0.2, max: 0.3, count: 0, percent: 0 },
    { label: '0.3-0.5R', min: 0.3, max: 0.5, count: 0, percent: 0 },
    { label: '0.5R+', min: 0.5, max: Infinity, count: 0, percent: 0 },
  ];

  for (const d of sortedDistances) {
    for (const bucket of buckets) {
      if (d >= bucket.min && d < bucket.max) {
        bucket.count++;
        break;
      }
    }
  }

  // Calculate percentages
  for (const bucket of buckets) {
    bucket.percent = (bucket.count / sortedDistances.length) * 100;
  }

  return {
    totalFrontRuns,
    frontRunsWithData: distances.length,
    avgDistanceR,
    medianDistanceR,
    minDistanceR,
    maxDistanceR,
    distribution: buckets,
    distances,
  };
}

/**
 * Get turn offset analysis combining front-run and penetration data
 * Analyzes where price actually turns relative to marked levels
 */
export function getTurnOffsetAnalysis(trades: TradeRecord[]): TurnOffsetAnalysis | null {
  const relevantTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    t.tradeTaken !== false &&
    t.levelSequence &&
    t.levelSequence.length > 0
  );

  // Collect all turn offsets in R (negative = front-run, positive = penetration/sweep)
  const turnOffsetsR: number[] = [];

  for (const trade of relevantTrades) {
    const metrics = getCachedMetrics(trade);
    const stopDistance = metrics.stopDistance || 0;
    if (stopDistance === 0) continue;

    for (const level of trade.levelSequence) {
      // Front-run: turn was short of level (negative offset)
      if (level.reaction === 'front_run' && level.turnPrice !== null && level.turnPrice !== undefined) {
        const offsetR = -Math.abs(level.price - level.turnPrice) / stopDistance;
        turnOffsetsR.push(offsetR);
      }
      // Swept then bounced: turn was beyond level (positive offset)
      else if (level.reaction === 'swept_then_bounced') {
        // For zones, use deepestPrice if available
        const isZone = level.priceFar !== null;
        if (isZone && level.deepestPrice !== null && level.deepestPrice !== undefined) {
          const offsetR = Math.abs(level.deepestPrice - level.price) / stopDistance;
          turnOffsetsR.push(offsetR);
        } else if (!isZone && level.turnPrice !== null && level.turnPrice !== undefined) {
          const offsetR = Math.abs(level.turnPrice - level.price) / stopDistance;
          turnOffsetsR.push(offsetR);
        }
      }
      // Bounced: turn was at level (zero offset)
      else if (level.reaction === 'bounced') {
        turnOffsetsR.push(0);
      }
    }
  }

  if (turnOffsetsR.length < 5) {
    return null;
  }

  // Sort for stats
  const sorted = turnOffsetsR.sort((a, b) => a - b);
  const minTurnOffsetR = sorted[0];
  const maxTurnOffsetR = sorted[sorted.length - 1];
  const medianTurnOffsetR = sorted[Math.floor(sorted.length / 2)];

  // Suggested entry = median offset (where price typically turns)
  const suggestedEntryOffsetR = medianTurnOffsetR;

  return {
    minTurnOffsetR,
    maxTurnOffsetR,
    medianTurnOffsetR,
    suggestedEntryOffsetR,
    tradesAnalyzed: turnOffsetsR.length,
  };
}

// ============================================================================
// Zone Penetration Analytics
// ============================================================================

// Zone level types constant
const ZONE_LEVEL_TYPES = ['HOB', 'LOB', 'DHOB', 'DLOB', 'OB', 'FVG', 'BB', 'IMB'] as const;

export interface ZonePenetrationBucket {
  bucket: string;
  bucketMin: number;
  bucketMax: number;
  count: number;
  percent: number;
}

export interface ZonePenetrationByType {
  zoneType: string;
  count: number;
  avgPenetration: number;
  heldCount: number;
  brokenCount: number;
  distribution: ZonePenetrationBucket[];
}

export interface ZonePenetrationStats {
  totalZones: number;
  zonesWithPenetration: number;
  byType: ZonePenetrationByType[];
  overall: ZonePenetrationBucket[];
}

/**
 * Analyze zone penetration distribution
 */
export function getZonePenetrationStats(trades: TradeRecord[]): ZonePenetrationStats {
  const buckets = [
    { label: '0-25%', min: 0, max: 25 },
    { label: '25-50%', min: 25, max: 50 },
    { label: '50-75%', min: 50, max: 75 },
    { label: '75-100%', min: 75, max: 100 },
  ];

  // Collect all zone levels with penetration data
  const allZones: Array<{
    zoneType: string;
    penetration: number;
    reaction: string | null;
    rMultiple: number | undefined;
  }> = [];

  for (const trade of trades) {
    if (!trade.levelSequence) continue;
    for (const level of trade.levelSequence) {
      if (
        ZONE_LEVEL_TYPES.includes(level.levelType as typeof ZONE_LEVEL_TYPES[number]) &&
        level.priceFar !== null &&
        level.penetrationPercent !== null &&
        level.penetrationPercent !== undefined
      ) {
        allZones.push({
          zoneType: level.levelType,
          penetration: level.penetrationPercent,
          reaction: level.reaction,
          rMultiple: getCachedMetrics(trade).rMultiple ?? undefined,
        });
      }
    }
  }

  // Build overall distribution
  const overallDistribution: ZonePenetrationBucket[] = buckets.map(b => ({
    bucket: b.label,
    bucketMin: b.min,
    bucketMax: b.max,
    count: allZones.filter(z =>
      z.penetration >= b.min && z.penetration < (b.max === 100 ? 101 : b.max)
    ).length,
    percent: 0,
  }));

  const total = allZones.length;
  for (const bucket of overallDistribution) {
    bucket.percent = total > 0 ? (bucket.count / total) * 100 : 0;
  }

  // Build by-type breakdown
  const typeMap = new Map<string, typeof allZones>();
  for (const zone of allZones) {
    if (!typeMap.has(zone.zoneType)) {
      typeMap.set(zone.zoneType, []);
    }
    typeMap.get(zone.zoneType)!.push(zone);
  }

  const byType: ZonePenetrationByType[] = [];
  for (const [zoneType, zones] of typeMap.entries()) {
    const avgPen = zones.reduce((sum, z) => sum + z.penetration, 0) / zones.length;
    const held = zones.filter(z => z.reaction === 'bounced' || z.reaction === 'swept_then_bounced' || z.reaction === 'front_run');
    const broken = zones.filter(z => z.reaction === 'broken');

    const typeDist: ZonePenetrationBucket[] = buckets.map(b => ({
      bucket: b.label,
      bucketMin: b.min,
      bucketMax: b.max,
      count: zones.filter(z =>
        z.penetration >= b.min && z.penetration < (b.max === 100 ? 101 : b.max)
      ).length,
      percent: zones.length > 0
        ? (zones.filter(z =>
            z.penetration >= b.min && z.penetration < (b.max === 100 ? 101 : b.max)
          ).length / zones.length) * 100
        : 0,
    }));

    byType.push({
      zoneType,
      count: zones.length,
      avgPenetration: Number(avgPen.toFixed(1)),
      heldCount: held.length,
      brokenCount: broken.length,
      distribution: typeDist,
    });
  }

  // Sort by count descending
  byType.sort((a, b) => b.count - a.count);

  return {
    totalZones: allZones.filter(z => ZONE_LEVEL_TYPES.includes(z.zoneType as typeof ZONE_LEVEL_TYPES[number])).length,
    zonesWithPenetration: allZones.length,
    byType,
    overall: overallDistribution,
  };
}

export interface PenetrationVsOutcome {
  penetration: number;
  rMultiple: number;
  zoneType: string;
  reaction: string | null;
}

/**
 * Get penetration vs outcome data for scatter plot
 */
export function getPenetrationVsOutcome(trades: TradeRecord[]): PenetrationVsOutcome[] {
  const results: PenetrationVsOutcome[] = [];

  for (const trade of trades) {
    const metrics = getCachedMetrics(trade);
    if (!trade.levelSequence || metrics.rMultiple === undefined) continue;
    for (const level of trade.levelSequence) {
      if (
        ZONE_LEVEL_TYPES.includes(level.levelType as typeof ZONE_LEVEL_TYPES[number]) &&
        level.priceFar !== null &&
        level.penetrationPercent !== null &&
        level.penetrationPercent !== undefined
      ) {
        results.push({
          penetration: level.penetrationPercent,
          rMultiple: metrics.rMultiple ?? 0,
          zoneType: level.levelType,
          reaction: level.reaction,
        });
      }
    }
  }

  return results;
}

export interface EntryPlacementInsight {
  zoneType: string;
  avgEntryDepthPercent: number;
  avgTurnDepthPercent: number;
  count: number;
  shouldEnterDeeper: boolean;
  potentialImprovement: number;
}

/**
 * Analyze where trader enters vs where price typically turns in zones
 */
export function getZoneEntryPlacementInsights(trades: TradeRecord[]): EntryPlacementInsight[] {
  const typeData = new Map<string, {
    entryDepths: number[];
    turnDepths: number[];
  }>();

  for (const trade of trades) {
    if (!trade.levelSequence) continue;

    for (const level of trade.levelSequence) {
      if (
        !ZONE_LEVEL_TYPES.includes(level.levelType as typeof ZONE_LEVEL_TYPES[number]) ||
        level.priceFar === null ||
        level.price === 0 ||
        level.priceFar === 0
      ) continue;

      const zoneWidth = Math.abs(level.priceFar - level.price);
      if (zoneWidth === 0) continue;

      // Calculate entry position within zone
      const entryInZone = Math.abs(trade.entryPrice - level.price);
      const entryDepthPercent = Math.min(100, Math.max(0, (entryInZone / zoneWidth) * 100));

      // Calculate turn depth (if we have penetration data)
      const turnDepthPercent = level.penetrationPercent ?? entryDepthPercent;

      if (!typeData.has(level.levelType)) {
        typeData.set(level.levelType, { entryDepths: [], turnDepths: [] });
      }
      const data = typeData.get(level.levelType)!;
      data.entryDepths.push(entryDepthPercent);
      if (level.penetrationPercent !== null && level.penetrationPercent !== undefined) {
        data.turnDepths.push(turnDepthPercent);
      }
    }
  }

  const insights: EntryPlacementInsight[] = [];
  for (const [zoneType, data] of typeData.entries()) {
    if (data.entryDepths.length < 3) continue;

    const avgEntry = data.entryDepths.reduce((a, b) => a + b, 0) / data.entryDepths.length;
    const avgTurn = data.turnDepths.length > 0
      ? data.turnDepths.reduce((a, b) => a + b, 0) / data.turnDepths.length
      : avgEntry;

    const shouldDeeper = avgTurn > avgEntry + 5;
    const improvement = Math.max(0, avgTurn - avgEntry);

    insights.push({
      zoneType,
      avgEntryDepthPercent: Number(avgEntry.toFixed(1)),
      avgTurnDepthPercent: Number(avgTurn.toFixed(1)),
      count: data.entryDepths.length,
      shouldEnterDeeper: shouldDeeper,
      potentialImprovement: Number(improvement.toFixed(1)),
    });
  }

  return insights.sort((a, b) => b.count - a.count);
}

export interface LevelsInsideZoneStats {
  zoneType: string;
  innerLevelType: string;
  count: number;
  turnAtInnerPercent: number;
  turnAtZoneEdgePercent: number;
  turnElsewherePercent: number;
}

/**
 * Analyze when line levels sit inside zones
 */
export function getLevelsInsideZonesAnalysis(trades: TradeRecord[]): LevelsInsideZoneStats[] {
  const results = new Map<string, {
    count: number;
    turnAtInner: number;
    turnAtEdge: number;
    turnElsewhere: number;
  }>();

  const LINE_TYPES = ['LCPB', 'fib', 'S/R', 'EQ'];

  for (const trade of trades) {
    if (!trade.levelSequence || trade.levelSequence.length < 2) continue;

    // Find zones and lines in this trade
    const zones = trade.levelSequence.filter(l =>
      ZONE_LEVEL_TYPES.includes(l.levelType as typeof ZONE_LEVEL_TYPES[number]) &&
      l.priceFar !== null
    );
    const lines = trade.levelSequence.filter(l =>
      LINE_TYPES.includes(l.levelType)
    );

    // Check which lines sit inside which zones
    for (const zone of zones) {
      const zoneMin = Math.min(zone.price, zone.priceFar!);
      const zoneMax = Math.max(zone.price, zone.priceFar!);

      for (const line of lines) {
        if (line.price >= zoneMin && line.price <= zoneMax) {
          // Line is inside zone
          const key = `${zone.levelType}|${line.levelType}`;
          if (!results.has(key)) {
            results.set(key, { count: 0, turnAtInner: 0, turnAtEdge: 0, turnElsewhere: 0 });
          }
          const data = results.get(key)!;
          data.count++;

          // Determine where price turned
          if (line.reaction === 'bounced' || line.reaction === 'front_run' || line.reaction === 'swept_then_bounced') {
            data.turnAtInner++;
          } else if (zone.reaction === 'bounced' || zone.reaction === 'front_run' || zone.reaction === 'swept_then_bounced') {
            data.turnAtEdge++;
          } else {
            data.turnElsewhere++;
          }
        }
      }
    }
  }

  const stats: LevelsInsideZoneStats[] = [];
  for (const [key, data] of results.entries()) {
    const [zoneType, innerLevelType] = key.split('|');
    const total = data.count;
    stats.push({
      zoneType,
      innerLevelType,
      count: total,
      turnAtInnerPercent: total > 0 ? (data.turnAtInner / total) * 100 : 0,
      turnAtZoneEdgePercent: total > 0 ? (data.turnAtEdge / total) * 100 : 0,
      turnElsewherePercent: total > 0 ? (data.turnElsewhere / total) * 100 : 0,
    });
  }

  return stats.filter(s => s.count >= 3).sort((a, b) => b.count - a.count);
}

/**
 * Generate zone penetration insights
 */
export function getZonePenetrationInsights(
  penetrationStats: ZonePenetrationStats,
  entryPlacement: EntryPlacementInsight[],
  levelsInside: LevelsInsideZoneStats[]
): string[] {
  const insights: string[] = [];

  // Zone type penetration insight
  for (const zt of penetrationStats.byType) {
    if (zt.count >= 5 && zt.heldCount > 0) {
      const holdRate = ((zt.heldCount / zt.count) * 100).toFixed(0);
      insights.push(
        `Your ${zt.zoneType}s that hold get penetrated an average of ${zt.avgPenetration}% before the turn (n=${zt.count}, hold rate: ${holdRate}%).`
      );
    }
  }

  // Entry placement insight
  for (const ep of entryPlacement) {
    if (ep.count >= 5 && ep.shouldEnterDeeper && ep.potentialImprovement > 10) {
      insights.push(
        `You typically enter at ${ep.avgEntryDepthPercent.toFixed(0)}% into your ${ep.zoneType}s, but price penetrates to ${ep.avgTurnDepthPercent.toFixed(0)}% on average before turning — entering deeper would improve your average entry.`
      );
    }
  }

  // Levels inside zones insight
  for (const li of levelsInside) {
    if (li.count >= 5 && li.turnAtInnerPercent > 50) {
      insights.push(
        `When a ${li.innerLevelType} sits inside a ${li.zoneType} (n=${li.count}), the turn happens at the ${li.innerLevelType} ${li.turnAtInnerPercent.toFixed(0)}% of the time — the ${li.innerLevelType}, not the block edge, is your real level.`
      );
    }
  }

  return insights;
}

// ==========================================
// CONFIRMATION TIMEFRAME ANALYSIS
// ==========================================

export interface ConfirmationTFStats {
  timeframe: string;
  count: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
}

export interface TFMatrixCell {
  confirmationTF: string;
  entryTF: string;
  count: number;
  avgR: number;
}

/**
 * Analyze performance by confirmation timeframe
 * Only considers trades with structural or partial_confirmation entry types
 */
export function getConfirmationTFAnalysis(trades: TradeRecord[]): ConfirmationTFStats[] {
  const relevantTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    (t.entryConfirmation === 'structural' || t.entryConfirmation === 'partial_confirmation') &&
    t.confirmationTF
  );

  const groups = new Map<string, TradeRecord[]>();
  for (const trade of relevantTrades) {
    const tf = trade.confirmationTF!;
    const existing = groups.get(tf) || [];
    existing.push(trade);
    groups.set(tf, existing);
  }

  const results: ConfirmationTFStats[] = [];

  for (const [timeframe, groupTrades] of groups) {
    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) < 0);

    const avgR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / groupTrades.length;

    const grossWins = wins.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    results.push({
      timeframe,
      count: groupTrades.length,
      winRate: groupTrades.length > 0 ? (wins.length / groupTrades.length) * 100 : 0,
      avgR: Number(avgR.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
    });
  }

  // Sort by count descending
  return results.sort((a, b) => b.count - a.count);
}

/**
 * Generate confirmation TF vs entry TF matrix
 * Shows how different confirmation/entry TF combinations perform
 */
export function getConfirmationTFVsEntryTFMatrix(trades: TradeRecord[]): TFMatrixCell[] {
  const relevantTrades = trades.filter(t =>
    getCachedMetrics(t).status === 'closed' &&
    (t.entryConfirmation === 'structural' || t.entryConfirmation === 'partial_confirmation') &&
    t.confirmationTF &&
    t.entryTF
  );

  const groups = new Map<string, TradeRecord[]>();
  for (const trade of relevantTrades) {
    const key = `${trade.confirmationTF}|${trade.entryTF}`;
    const existing = groups.get(key) || [];
    existing.push(trade);
    groups.set(key, existing);
  }

  const results: TFMatrixCell[] = [];

  for (const [key, groupTrades] of groups) {
    const [confirmationTF, entryTF] = key.split('|');
    const avgR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / groupTrades.length;

    results.push({
      confirmationTF,
      entryTF,
      count: groupTrades.length,
      avgR: Number(avgR.toFixed(2)),
    });
  }

  return results;
}

// ==========================================
// IN-TRADE EVENT ANALYSIS
// ==========================================

export interface EventHeatmapCell {
  hour: number;
  eventType: string;
  count: number;
}

export interface EventOutcomeCorrelation {
  eventType: string;
  count: number;
  winRate: number;
  avgR: number;
}

export interface RecurringEventPattern {
  eventType: string;
  pair: string;
  hour: number;
  occurrences: number;
  totalForPair: number;
}

/**
 * Generate event heatmap data - X=hour, Y=eventType, cell=count
 */
export function getEventHeatmap(trades: TradeRecord[], assetFilter?: string): EventHeatmapCell[] {
  let filteredTrades = trades;
  if (assetFilter) {
    filteredTrades = trades.filter(t => t.pair === assetFilter);
  }

  const countMap = new Map<string, number>();

  for (const trade of filteredTrades) {
    if (!trade.timeline || trade.timeline.length === 0) continue;

    for (const event of trade.timeline as TradeEvent[]) {
      if (!event.time) continue;
      const eventTime = typeof event.time === 'string' ? new Date(event.time) : event.time;
      const hour = eventTime.getHours();
      const key = `${hour}|${event.eventType}`;
      countMap.set(key, (countMap.get(key) || 0) + 1);
    }
  }

  const results: EventHeatmapCell[] = [];
  for (const [key, count] of countMap) {
    const [hourStr, eventType] = key.split('|');
    results.push({
      hour: parseInt(hourStr, 10),
      eventType,
      count,
    });
  }

  return results;
}

/**
 * Correlate events with trade outcomes
 * For each event type, calculate the win rate and avgR of trades containing that event
 */
export function getEventOutcomeCorrelation(trades: TradeRecord[]): EventOutcomeCorrelation[] {
  const closedTrades = trades.filter(t => getCachedMetrics(t).status === 'closed');

  // Group trades by event types they contain
  const eventTypeToTrades = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    if (!trade.timeline || trade.timeline.length === 0) continue;

    // Get unique event types in this trade
    const eventTypes = [...new Set(trade.timeline.map((e: TradeEvent) => e.eventType))];

    for (const eventType of eventTypes) {
      const existing = eventTypeToTrades.get(eventType) || [];
      existing.push(trade);
      eventTypeToTrades.set(eventType, existing);
    }
  }

  const results: EventOutcomeCorrelation[] = [];

  for (const [eventType, groupTrades] of eventTypeToTrades) {
    const wins = groupTrades.filter(t => (getCachedMetrics(t).rMultiple ?? 0) > 0);
    const avgR = groupTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / groupTrades.length;

    results.push({
      eventType,
      count: groupTrades.length,
      winRate: groupTrades.length > 0 ? (wins.length / groupTrades.length) * 100 : 0,
      avgR: Number(avgR.toFixed(2)),
    });
  }

  // Sort by count descending
  return results.sort((a, b) => b.count - a.count);
}

/**
 * Find recurring event patterns - events that cluster at specific hours for specific pairs
 * Only considers patterns with 3+ occurrences
 */
export function getRecurringEventPatterns(trades: TradeRecord[]): RecurringEventPattern[] {
  // Count events by eventType + pair + hour
  const countMap = new Map<string, { occurrences: number; pair: string; eventType: string; hour: number }>();
  const pairTotalEvents = new Map<string, number>();

  for (const trade of trades) {
    if (!trade.timeline || trade.timeline.length === 0) continue;

    for (const event of trade.timeline as TradeEvent[]) {
      if (!event.time) continue;
      const eventTime = typeof event.time === 'string' ? new Date(event.time) : event.time;
      const hour = eventTime.getHours();
      const key = `${event.eventType}|${trade.pair}|${hour}`;

      const existing = countMap.get(key);
      if (existing) {
        existing.occurrences++;
      } else {
        countMap.set(key, {
          occurrences: 1,
          pair: trade.pair,
          eventType: event.eventType,
          hour,
        });
      }

      // Track total events per pair
      const pairKey = `${event.eventType}|${trade.pair}`;
      pairTotalEvents.set(pairKey, (pairTotalEvents.get(pairKey) || 0) + 1);
    }
  }

  const results: RecurringEventPattern[] = [];

  for (const [, data] of countMap) {
    if (data.occurrences < 3) continue;

    const pairKey = `${data.eventType}|${data.pair}`;
    const totalForPair = pairTotalEvents.get(pairKey) || data.occurrences;

    results.push({
      eventType: data.eventType,
      pair: data.pair,
      hour: data.hour,
      occurrences: data.occurrences,
      totalForPair,
    });
  }

  // Sort by occurrences descending
  return results.sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Generate insights about confirmation timeframes
 */
export function getConfirmationTFInsights(
  confirmationStats: ConfirmationTFStats[],
  matrixData: TFMatrixCell[]
): string[] {
  const insights: string[] = [];

  // Find best performing confirmation TF (min 5 trades)
  const significantStats = confirmationStats.filter(s => s.count >= 5);
  if (significantStats.length >= 2) {
    const sorted = [...significantStats].sort((a, b) => b.avgR - a.avgR);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    if (best.avgR > worst.avgR && best.avgR > 0) {
      insights.push(
        `Your structural confirmations on ${best.timeframe} produce avg ${best.avgR > 0 ? '+' : ''}${best.avgR}R vs ${worst.avgR > 0 ? '+' : ''}${worst.avgR}R on ${worst.timeframe}`
      );
    }
  }

  // Find best TF combination from matrix (min 5 trades)
  const significantCells = matrixData.filter(c => c.count >= 5);
  if (significantCells.length > 0) {
    const best = [...significantCells].sort((a, b) => b.avgR - a.avgR)[0];
    if (best.avgR > 0) {
      insights.push(
        `Best TF combination: ${best.confirmationTF} confirmation + ${best.entryTF} entry (${best.avgR > 0 ? '+' : ''}${best.avgR}R avg, n=${best.count})`
      );
    }
  }

  return insights;
}

/**
 * Generate insights about in-trade events
 */
export function getEventInsights(
  eventCorrelation: EventOutcomeCorrelation[],
  recurringPatterns: RecurringEventPattern[]
): string[] {
  const insights: string[] = [];

  // Find events that correlate with better outcomes (min 5 trades)
  const significantEvents = eventCorrelation.filter(e => e.count >= 5);
  if (significantEvents.length > 0) {
    const bestEvent = [...significantEvents].sort((a, b) => b.avgR - a.avgR)[0];
    const worstEvent = [...significantEvents].sort((a, b) => a.avgR - b.avgR)[0];

    if (bestEvent.avgR > 0) {
      insights.push(
        `Trades with "${bestEvent.eventType.replace(/_/g, ' ')}" events average ${bestEvent.avgR > 0 ? '+' : ''}${bestEvent.avgR}R (${bestEvent.winRate.toFixed(0)}% WR, n=${bestEvent.count})`
      );
    }

    if (worstEvent.avgR < 0 && worstEvent.eventType !== bestEvent.eventType) {
      insights.push(
        `Trades with "${worstEvent.eventType.replace(/_/g, ' ')}" events average ${worstEvent.avgR}R — consider as warning signal`
      );
    }
  }

  // Report recurring patterns
  if (recurringPatterns.length > 0) {
    const topPattern = recurringPatterns[0];
    const percentage = ((topPattern.occurrences / topPattern.totalForPair) * 100).toFixed(0);
    const hourStr = `${topPattern.hour.toString().padStart(2, '0')}:00`;
    const nextHour = `${((topPattern.hour + 1) % 24).toString().padStart(2, '0')}:00`;

    insights.push(
      `"${topPattern.eventType.replace(/_/g, ' ')}" on ${topPattern.pair}: ${topPattern.occurrences} of ${topPattern.totalForPair} (${percentage}%) occur between ${hourStr}–${nextHour}`
    );
  }

  return insights;
}
