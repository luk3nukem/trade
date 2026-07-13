import type { TradeRecord, TradingSession } from '../types';
import { calculateMaeDistance, calculateMfeDistance, calculatePostStopMoveR, calculateMissedR } from './tradeCalculations';

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
  const closedTrades = trades.filter(t => t.status === 'closed');
  const groups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const key = String(trade[field] ?? 'Unknown');
    const existing = groups.get(key) || [];
    existing.push(trade);
    groups.set(key, existing);
  }

  const results: GroupStats[] = [];

  for (const [group, groupTrades] of groups) {
    const wins = groupTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (t.rMultiple ?? 0) < 0);
    const breakevens = groupTrades.filter(t => (t.rMultiple ?? 0) === 0);

    const rMultiples = groupTrades.map(t => t.rMultiple ?? 0);
    const avgR = rMultiples.length > 0
      ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
      : 0;

    const totalPnl = groupTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    const avgWinR = wins.length > 0
      ? wins.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / wins.length
      : 0;
    const avgLossR = losses.length > 0
      ? losses.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / losses.length
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
  const closedTrades = trades.filter(t => t.status === 'closed' && t.exitTime);

  const sessionGroups = groupPerformanceBy(trades, 'session');
  const sessions: SessionStats[] = sessionGroups.map(g => ({
    ...g,
    session: g.group as TradingSession,
  }));

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

    const wins = dayTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = dayTrades.filter(t => (t.rMultiple ?? 0) < 0);
    const breakevens = dayTrades.filter(t => (t.rMultiple ?? 0) === 0);
    const rMultiples = dayTrades.map(t => t.rMultiple ?? 0);
    const avgR = rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length;
    const totalPnl = dayTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));
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
      avgWinR: wins.length > 0 ? wins.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / wins.length : 0,
      avgLossR: losses.length > 0 ? losses.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / losses.length : 0,
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
    const avgPnl = hourTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0) / hourTrades.length;
    maxAbsPnl = Math.max(maxAbsPnl, Math.abs(avgPnl));
  }

  const hourlyStats: HourStats[] = [];
  for (let h = 0; h < 24; h++) {
    const hourTrades = hourGroups.get(h) || [];
    if (hourTrades.length === 0) {
      hourlyStats.push({ hour: h, count: 0, avgPnl: 0, avgR: 0, intensity: 0 });
      continue;
    }
    const avgPnl = hourTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0) / hourTrades.length;
    const avgR = hourTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / hourTrades.length;
    const intensity = maxAbsPnl > 0 ? avgPnl / maxAbsPnl : 0;
    hourlyStats.push({ hour: h, count: hourTrades.length, avgPnl, avgR, intensity });
  }

  const holdTimeData: HoldTimePoint[] = closedTrades
    .filter(t => t.holdDuration !== undefined)
    .map(t => ({
      tradeId: t.id,
      holdMinutes: t.holdDuration!,
      rMultiple: t.rMultiple ?? 0,
      isWinner: (t.rMultiple ?? 0) > 0,
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
  const closedTrades = trades.filter(t => t.status === 'closed');

  // Group by analysis timeframe (trades can appear in multiple groups)
  const analysisTFGroups = new Map<string, TradeRecord[]>();
  for (const trade of closedTrades) {
    const tfs = trade.analysisTFs && trade.analysisTFs.length > 0 ? trade.analysisTFs : ['Not set'];
    for (const tf of tfs) {
      const existing = analysisTFGroups.get(tf) || [];
      existing.push(trade);
      analysisTFGroups.set(tf, existing);
    }
  }

  const analysisTF: TimeframeStats[] = [];
  for (const [tf, tfTrades] of analysisTFGroups) {
    const wins = tfTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = tfTrades.filter(t => (t.rMultiple ?? 0) < 0);
    const breakevens = tfTrades.filter(t => (t.rMultiple ?? 0) === 0);
    const rMultiples = tfTrades.map(t => t.rMultiple ?? 0);
    const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
    const totalPnl = tfTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));
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
      avgWinR: wins.length > 0 ? wins.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / wins.length : 0,
      avgLossR: losses.length > 0 ? losses.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / losses.length : 0,
      rStdDev: calculateStdDev(rMultiples),
    });
  }

  // Group by analysis TF count (how many timeframes were analyzed)
  const tfCountGroups = new Map<string, TradeRecord[]>();
  for (const trade of closedTrades) {
    const tfCount = trade.analysisTFs?.length ?? 0;
    const label = tfCount === 0 ? 'None' : tfCount === 1 ? '1 TF' : `${tfCount} TFs`;
    const existing = tfCountGroups.get(label) || [];
    existing.push(trade);
    tfCountGroups.set(label, existing);
  }

  const analysisTFCount: TimeframeStats[] = [];
  for (const [label, countTrades] of tfCountGroups) {
    const wins = countTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = countTrades.filter(t => (t.rMultiple ?? 0) < 0);
    const breakevens = countTrades.filter(t => (t.rMultiple ?? 0) === 0);
    const rMultiples = countTrades.map(t => t.rMultiple ?? 0);
    const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
    const totalPnl = countTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));
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
      avgWinR: wins.length > 0 ? wins.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / wins.length : 0,
      avgLossR: losses.length > 0 ? losses.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / losses.length : 0,
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
    const wins = tfTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = tfTrades.filter(t => (t.rMultiple ?? 0) < 0);
    const breakevens = tfTrades.filter(t => (t.rMultiple ?? 0) === 0);
    const rMultiples = tfTrades.map(t => t.rMultiple ?? 0);
    const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
    const totalPnl = tfTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));
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
      avgWinR: wins.length > 0 ? wins.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / wins.length : 0,
      avgLossR: losses.length > 0 ? losses.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / losses.length : 0,
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
  const closedTrades = trades.filter(t => t.status === 'closed' && t.rMultiple !== undefined);

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
    const r = trade.rMultiple!;
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
    .filter(t => 
      t.status === 'closed' && 
      t.plannedRR !== undefined && 
      t.actualRR !== undefined
    )
    .map(t => ({
      tradeId: t.id,
      plannedRR: t.plannedRR!,
      actualRR: t.actualRR!,
      pair: t.pair,
      isWinner: (t.rMultiple ?? 0) > 0,
    }));
}

export function getPositionSizingData(trades: TradeRecord[]): {
  points: PositionSizePoint[];
  avgRiskPercent: number;
  stdDev: number;
} {
  const closedTrades = trades
    .filter(t => t.status === 'closed' && t.riskPercent !== undefined)
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
    isWinner: (t.rMultiple ?? 0) > 0,
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
    t.status === 'closed' && 
    t.maeR !== undefined && 
    t.stopDistance !== undefined
  );

  if (tradesWithMAE.length === 0) return [];

  // Calculate MAE as percentage of stop for bucketing
  const maePercents = tradesWithMAE.map(t => (t.maeR! / 1) * 100); // maeR is already in R terms
  const maxMAE = Math.max(...maePercents);
  const bucketSize = Math.ceil(maxMAE / bucketCount);

  const buckets: MAEBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const min = i * bucketSize;
    const max = (i + 1) * bucketSize;
    const label = i === bucketCount - 1 ? min + '%+' : min + '-' + max + '%';
    
    const inBucket = tradesWithMAE.filter(t => {
      const maePercent = (t.maeR! / 1) * 100;
      if (i === bucketCount - 1) return maePercent >= min;
      return maePercent >= min && maePercent < max;
    });

    buckets.push({
      label,
      min,
      max: i === bucketCount - 1 ? Infinity : max,
      winners: inBucket.filter(t => (t.rMultiple ?? 0) > 0).length,
      losers: inBucket.filter(t => (t.rMultiple ?? 0) <= 0).length,
      total: inBucket.length,
    });
  }

  return buckets;
}

export function getStopEfficiencyData(trades: TradeRecord[]): StopEfficiencyPoint[] {
  return trades
    .filter(t => t.status === 'closed' && t.stopDistance !== undefined)
    .map(t => ({
      tradeId: t.id,
      stopDistance: t.stopDistance!,
      rMultiple: t.rMultiple ?? 0,
      isWinner: (t.rMultiple ?? 0) > 0,
      pair: t.pair,
    }));
}

export function getMAEOutcomeData(trades: TradeRecord[]): MAEOutcomePoint[] {
  return trades
    .filter(t =>
      t.status === 'closed' &&
      t.maePrice !== null &&
      t.maeR !== undefined &&
      t.stopDistance !== undefined
    )
    .map(t => {
      const maeDistance = calculateMaeDistance(t.entryPrice, t.maePrice);
      return {
        tradeId: t.id,
        mae: maeDistance ?? 0,
        maeR: t.maeR!,
        rMultiple: t.rMultiple ?? 0,
        isWinner: (t.rMultiple ?? 0) > 0,
        pair: t.pair,
        stopDistance: t.stopDistance!,
      };
    });
}

export function getStopPlacementSummary(trades: TradeRecord[]): StopPlacementSummary {
  const closedTrades = trades.filter(t => t.status === 'closed');
  const tradesWithMAE = closedTrades.filter(t => t.maeR !== undefined && t.stopDistance !== undefined);
  
  const winners = tradesWithMAE.filter(t => (t.rMultiple ?? 0) > 0);
  const losers = tradesWithMAE.filter(t => (t.rMultiple ?? 0) <= 0);

  const avgStopDistance = closedTrades.length > 0
    ? closedTrades.filter(t => t.stopDistance).reduce((sum, t) => sum + t.stopDistance!, 0) / 
      closedTrades.filter(t => t.stopDistance).length
    : 0;

  const avgMAEWinners = winners.length > 0
    ? winners.reduce((sum, t) => sum + t.maeR!, 0) / winners.length
    : 0;

  const avgMAELosers = losers.length > 0
    ? losers.reduce((sum, t) => sum + t.maeR!, 0) / losers.length
    : 0;

  // Winners where MAE < 50% of stop (maeR < 0.5)
  const winnersMAEUnderHalfStop = winners.filter(t => t.maeR! < 0.5).length;
  const winnersMAEUnderHalfStopPercent = winners.length > 0
    ? (winnersMAEUnderHalfStop / winners.length) * 100
    : 0;

  // Losers where MAE > 80% of stop (maeR > 0.8)
  const losersMAEOverEightyStop = losers.filter(t => t.maeR! > 0.8).length;
  const losersMAEOverEightyStopPercent = losers.length > 0
    ? (losersMAEOverEightyStop / losers.length) * 100
    : 0;

  // Suggested optimal stop: MAE value where 90% of winners are covered
  let suggestedOptimalStop = 0;
  if (winners.length > 0) {
    const sortedMAEs = winners.map(t => t.maeR!).sort((a, b) => a - b);
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
}

export function getMFECaptureData(trades: TradeRecord[]): MFECapturePoint[] {
  return trades
    .filter(t =>
      t.status === 'closed' &&
      t.mfeR !== undefined &&
      t.mfeR > 0 &&
      t.rMultiple !== undefined
    )
    .map(t => {
      const exitR = Math.abs(t.rMultiple!);
      const capturePercent = t.mfeR! > 0 ? (exitR / t.mfeR!) * 100 : 0;
      const mfeDistance = calculateMfeDistance(t.entryPrice, t.mfePrice);

      return {
        tradeId: t.id,
        mfe: mfeDistance ?? 0,
        mfeR: t.mfeR!,
        exitDistance: t.actualRR ?? 0,
        exitR,
        capturePercent: Math.min(capturePercent, 100), // Cap at 100%
        isWinner: (t.rMultiple ?? 0) > 0,
        pair: t.pair,
        exitType: t.exitType ?? 'unknown',
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
    t.status === 'closed' &&
    (t.rMultiple ?? 0) > 0 &&
    t.mfeR !== undefined &&
    t.mfeR > Math.abs(t.rMultiple ?? 0)
  );

  const givebacks = givebackTrades.map(t => t.mfeR! - Math.abs(t.rMultiple!));
  
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
  const closedTrades = trades.filter(t => t.status === 'closed' && t.exitType);
  const groups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const key = trade.exitType!;
    const existing = groups.get(key) || [];
    existing.push(trade);
    groups.set(key, existing);
  }

  const results: ExitTypeStats[] = [];

  for (const [exitType, groupTrades] of groups) {
    const wins = groupTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (t.rMultiple ?? 0) <= 0);
    
    const avgR = groupTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / groupTrades.length;
    
    // MFE capture for trades with MFE data
    const withMFE = groupTrades.filter(t => t.mfeR !== undefined && t.mfeR > 0);
    const avgMFECapture = withMFE.length > 0
      ? withMFE.reduce((sum, t) => {
          const exitR = Math.abs(t.rMultiple ?? 0);
          return sum + (exitR / t.mfeR!) * 100;
        }, 0) / withMFE.length
      : 0;

    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
    
    const totalPnl = groupTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

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
  const closedTrades = trades.filter(t => t.status === 'closed');
  // "Partials" = trades with multiple exits (scaled out)
  const withPartials = closedTrades.filter(t => t.exits && t.exits.length > 1);
  const withoutPartials = closedTrades.filter(t => !t.exits || t.exits.length <= 1);

  if (withPartials.length < 3 || withoutPartials.length < 3) return null;

  const calcStats = (arr: TradeRecord[]) => {
    const wins = arr.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = arr.filter(t => (t.rMultiple ?? 0) <= 0);
    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));
    
    const withMFE = arr.filter(t => t.mfeR !== undefined && t.mfeR > 0);
    const avgMFECapture = withMFE.length > 0
      ? withMFE.reduce((sum, t) => {
          const exitR = Math.abs(t.rMultiple ?? 0);
          return sum + (exitR / t.mfeR!) * 100;
        }, 0) / withMFE.length
      : 0;

    return {
      count: arr.length,
      avgR: arr.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / arr.length,
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
): SimulationResult {
  const closedTrades = trades
    .filter(t => t.status === 'closed' && t.mfeR !== undefined)
    .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime());

  const equityCurve: { tradeIndex: number; cumulative: number }[] = [];
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const rMultiples: number[] = [];

  for (let i = 0; i < closedTrades.length; i++) {
    const trade = closedTrades[i];
    const mfeR = trade.mfeR ?? 0;
    const maeR = trade.maeR ?? 1; // Assume full stop if no MAE
    const actualR = trade.rMultiple ?? 0;
    const plannedRR = trade.plannedRR ?? 2;
    
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

    rMultiples.push(simulatedR);
    cumulative += simulatedR;
    
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    equityCurve.push({ tradeIndex: i + 1, cumulative });
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
  };
}

// Fixed R Target Simulation Types
export interface FixedRTargetResult extends SimulationResult {
  targetR: number;
  tradesSimulated: number;
  tradesExcluded: number;
}

/**
 * Simulate exiting at a fixed R target regardless of the trade's actual target.
 *
 * Logic for each trade:
 * - If mfeR >= targetR: trade reached the fixed target, result = +targetR
 * - If mfeR < targetR AND maeR >= 1: trade never reached target and hit stop, result = -1R
 * - Otherwise (rare): exclude from simulation (e.g., manually closed before either)
 */
export function simulateFixedRTarget(
  trades: TradeRecord[],
  targetR: number
): FixedRTargetResult {
  const closedTrades = trades
    .filter(t => t.status === 'closed' && t.mfeR !== undefined)
    .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime());

  const equityCurve: { tradeIndex: number; cumulative: number }[] = [];
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const rMultiples: number[] = [];
  let excluded = 0;

  for (let i = 0; i < closedTrades.length; i++) {
    const trade = closedTrades[i];
    const mfeR = trade.mfeR ?? 0;
    const maeR = trade.maeR ?? 0;

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

export interface EmotionalStateStats {
  state: number;
  label: string;
  count: number;
  avgR: number;
  winRate: number;
  totalPnl: number;
}

export interface PlanAdherenceStats {
  followed: {
    count: number;
    winRate: number;
    avgR: number;
    profitFactor: number;
    totalPnl: number;
  };
  deviated: {
    count: number;
    winRate: number;
    avgR: number;
    profitFactor: number;
    totalPnl: number;
  };
  deviationReasons: { reason: string; count: number }[];
}

export interface RevengeTradeStats {
  revengeTrades: {
    count: number;
    winRate: number;
    avgR: number;
    totalPnl: number;
  };
  normalTrades: {
    count: number;
    winRate: number;
    avgR: number;
    totalPnl: number;
  };
}

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

export function getEmotionalStateAnalysis(trades: TradeRecord[]): EmotionalStateStats[] {
  const closedTrades = trades.filter(t => t.status === 'closed' && t.emotionalState !== undefined);

  const stateLabels: Record<number, string> = {
    1: 'Very Anxious',
    2: 'Anxious',
    3: 'Neutral',
    4: 'Confident',
    5: 'Very Confident',
  };

  const groups = new Map<number, TradeRecord[]>();
  for (const trade of closedTrades) {
    const state = trade.emotionalState!;
    const existing = groups.get(state) || [];
    existing.push(trade);
    groups.set(state, existing);
  }

  const results: EmotionalStateStats[] = [];
  for (let state = 1; state <= 5; state++) {
    const groupTrades = groups.get(state) || [];
    if (groupTrades.length === 0) {
      results.push({
        state,
        label: stateLabels[state],
        count: 0,
        avgR: 0,
        winRate: 0,
        totalPnl: 0,
      });
      continue;
    }

    const wins = groupTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const avgR = groupTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / groupTrades.length;
    const totalPnl = groupTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

    results.push({
      state,
      label: stateLabels[state],
      count: groupTrades.length,
      avgR,
      winRate: (wins.length / groupTrades.length) * 100,
      totalPnl,
    });
  }

  return results;
}

export function getPlanAdherenceAnalysis(trades: TradeRecord[]): PlanAdherenceStats {
  const closedTrades = trades.filter(t => t.status === 'closed' && t.followedPlan !== undefined);

  const followed = closedTrades.filter(t => t.followedPlan === true);
  const deviated = closedTrades.filter(t => t.followedPlan === false);

  const calcStats = (arr: TradeRecord[]) => {
    if (arr.length === 0) {
      return { count: 0, winRate: 0, avgR: 0, profitFactor: 0, totalPnl: 0 };
    }
    const wins = arr.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = arr.filter(t => (t.rMultiple ?? 0) <= 0);
    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));

    return {
      count: arr.length,
      winRate: (wins.length / arr.length) * 100,
      avgR: arr.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / arr.length,
      profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
      totalPnl: arr.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0),
    };
  };

  // Count deviation reasons
  const reasonCounts = new Map<string, number>();
  for (const trade of deviated) {
    if (trade.planDeviation) {
      const reason = trade.planDeviation.trim();
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
  }
  const deviationReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    followed: calcStats(followed),
    deviated: calcStats(deviated),
    deviationReasons,
  };
}

export function getRevengeTradeAnalysis(trades: TradeRecord[]): RevengeTradeStats {
  const closedTrades = trades.filter(t => t.status === 'closed');

  const revengeTrades = closedTrades.filter(t => t.isRevengeTrade === true);
  const normalTrades = closedTrades.filter(t => t.isRevengeTrade !== true);

  const calcStats = (arr: TradeRecord[]) => {
    if (arr.length === 0) {
      return { count: 0, winRate: 0, avgR: 0, totalPnl: 0 };
    }
    const wins = arr.filter(t => (t.rMultiple ?? 0) > 0);
    return {
      count: arr.length,
      winRate: (wins.length / arr.length) * 100,
      avgR: arr.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / arr.length,
      totalPnl: arr.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0),
    };
  };

  return {
    revengeTrades: calcStats(revengeTrades),
    normalTrades: calcStats(normalTrades),
  };
}

export function getStreakAnalysis(trades: TradeRecord[]): StreakAnalysisData {
  const closedTrades = trades
    .filter(t => t.status === 'closed')
    .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime());

  const afterWin: TradeRecord[] = [];
  const afterLoss: TradeRecord[] = [];
  const afterWinStreak: TradeRecord[] = []; // After 2+ wins
  const afterLossStreak: TradeRecord[] = []; // After 2+ losses

  for (let i = 1; i < closedTrades.length; i++) {
    const prevTrade = closedTrades[i - 1];
    const prevWin = (prevTrade.rMultiple ?? 0) > 0;

    if (prevWin) {
      afterWin.push(closedTrades[i]);
    } else {
      afterLoss.push(closedTrades[i]);
    }

    // Check for streaks (2+ consecutive)
    if (i >= 2) {
      const prev2Trade = closedTrades[i - 2];
      const prev2Win = (prev2Trade.rMultiple ?? 0) > 0;

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
    const wins = arr.filter(t => (t.rMultiple ?? 0) > 0);
    return {
      count: arr.length,
      avgR: arr.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / arr.length,
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
  const closedTrades = trades.filter(t => t.status === 'closed' && t.exitTime);

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
    const avgR = dayTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / dayTrades.length;
    const totalPnl = dayTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
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

export function getBehaviouralInsights(
  emotionalStats: EmotionalStateStats[],
  planAdherence: PlanAdherenceStats,
  revengeStats: RevengeTradeStats,
  streakAnalysis: StreakAnalysisData,
  tradesPerDay: { optimalTradeCount: number; overtradeThreshold: number }
): string[] {
  const insights: string[] = [];

  // Emotional state insights
  const calmStates = emotionalStats.filter(s => s.state >= 3 && s.count > 0);
  const anxiousStates = emotionalStats.filter(s => s.state < 3 && s.count > 0);

  if (calmStates.length > 0 && anxiousStates.length > 0) {
    const avgCalmR = calmStates.reduce((sum, s) => sum + s.avgR * s.count, 0) /
      calmStates.reduce((sum, s) => sum + s.count, 0);
    const avgAnxiousR = anxiousStates.reduce((sum, s) => sum + s.avgR * s.count, 0) /
      anxiousStates.reduce((sum, s) => sum + s.count, 0);

    if (avgCalmR > avgAnxiousR) {
      const pnlDiff = calmStates.reduce((sum, s) => sum + s.totalPnl, 0) -
        anxiousStates.reduce((sum, s) => sum + s.totalPnl, 0);
      insights.push(
        'Your avg R when calm/confident is ' + avgCalmR.toFixed(2) + ' vs ' + avgAnxiousR.toFixed(2) +
        ' when anxious. Emotional trading costs you approximately $' + Math.abs(pnlDiff).toFixed(0) + '.'
      );
    }
  }

  // Plan adherence insights
  if (planAdherence.followed.count > 0 && planAdherence.deviated.count > 0) {
    const savings = planAdherence.followed.totalPnl - planAdherence.deviated.totalPnl;
    insights.push(
      'Following your plan produces ' + planAdherence.followed.profitFactor.toFixed(2) +
      ' profit factor vs ' + planAdherence.deviated.profitFactor.toFixed(2) + ' when deviating. ' +
      (savings > 0 ? 'Plan adherence saved you $' + savings.toFixed(0) + '.' : '')
    );
  }

  // Revenge trade insights
  if (revengeStats.revengeTrades.count > 0) {
    insights.push(
      'Revenge trades have cost you $' + Math.abs(revengeStats.revengeTrades.totalPnl).toFixed(0) + '. ' +
      'Your win rate drops from ' + revengeStats.normalTrades.winRate.toFixed(1) + '% to ' +
      revengeStats.revengeTrades.winRate.toFixed(1) + '% on revenge trades.'
    );
  }

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

  return insights;
}


// ============================================
// MARKET CONTEXT ANALYSIS
// ============================================

export interface MarketConditionStats {
  condition: string;
  count: number;
  avgR: number;
  winRate: number;
  totalPnl: number;
}

export interface HTFBiasStats {
  alignment: 'with' | 'against' | 'neutral';
  count: number;
  avgR: number;
  winRate: number;
  totalPnl: number;
}

export interface ContextHeatmapCell {
  condition: string;
  alignment: string;
  avgR: number;
  count: number;
}

export function getMarketConditionAnalysis(trades: TradeRecord[]): MarketConditionStats[] {
  const closedTrades = trades.filter(t => t.status === 'closed' && t.marketCondition);

  const groups = new Map<string, TradeRecord[]>();
  for (const trade of closedTrades) {
    const condition = trade.marketCondition!;
    const existing = groups.get(condition) || [];
    existing.push(trade);
    groups.set(condition, existing);
  }

  const results: MarketConditionStats[] = [];
  for (const [condition, groupTrades] of groups) {
    const wins = groupTrades.filter(t => (t.rMultiple ?? 0) > 0);
    results.push({
      condition,
      count: groupTrades.length,
      avgR: groupTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / groupTrades.length,
      winRate: (wins.length / groupTrades.length) * 100,
      totalPnl: groupTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0),
    });
  }

  return results.sort((a, b) => b.avgR - a.avgR);
}

export function getHTFBiasAnalysis(trades: TradeRecord[]): HTFBiasStats[] {
  const closedTrades = trades.filter(t => t.status === 'closed');

  const withBias: TradeRecord[] = [];
  const againstBias: TradeRecord[] = [];
  const neutralBias: TradeRecord[] = [];

  for (const trade of closedTrades) {
    if (!trade.htfBias || trade.htfBias === 'neutral' || trade.htfBias === 'ranging') {
      neutralBias.push(trade);
    } else if (
      (trade.direction === 'long' && trade.htfBias === 'bullish') ||
      (trade.direction === 'short' && trade.htfBias === 'bearish')
    ) {
      withBias.push(trade);
    } else {
      againstBias.push(trade);
    }
  }

  const calcStats = (arr: TradeRecord[], alignment: 'with' | 'against' | 'neutral'): HTFBiasStats => {
    if (arr.length === 0) {
      return { alignment, count: 0, avgR: 0, winRate: 0, totalPnl: 0 };
    }
    const wins = arr.filter(t => (t.rMultiple ?? 0) > 0);
    return {
      alignment,
      count: arr.length,
      avgR: arr.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / arr.length,
      winRate: (wins.length / arr.length) * 100,
      totalPnl: arr.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0),
    };
  };

  return [
    calcStats(withBias, 'with'),
    calcStats(againstBias, 'against'),
    calcStats(neutralBias, 'neutral'),
  ];
}

export function getContextHeatmapData(trades: TradeRecord[]): ContextHeatmapCell[] {
  const closedTrades = trades.filter(t => t.status === 'closed' && t.marketCondition);

  // Group by condition + bias alignment
  const groups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const condition = trade.marketCondition!;
    let alignment: string;

    if (!trade.htfBias || trade.htfBias === 'neutral' || trade.htfBias === 'ranging') {
      alignment = 'neutral';
    } else if (
      (trade.direction === 'long' && trade.htfBias === 'bullish') ||
      (trade.direction === 'short' && trade.htfBias === 'bearish')
    ) {
      alignment = 'with';
    } else {
      alignment = 'against';
    }

    const key = condition + '|' + alignment;
    const existing = groups.get(key) || [];
    existing.push(trade);
    groups.set(key, existing);
  }

  const results: ContextHeatmapCell[] = [];
  for (const [key, groupTrades] of groups) {
    const [condition, alignment] = key.split('|');
    results.push({
      condition,
      alignment,
      avgR: groupTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / groupTrades.length,
      count: groupTrades.length,
    });
  }

  return results;
}

export function getMarketContextInsights(
  conditionStats: MarketConditionStats[],
  biasStats: HTFBiasStats[]
): string[] {
  const insights: string[] = [];

  // Market condition insights
  const qualifiedConditions = conditionStats.filter(c => c.count >= 3);
  if (qualifiedConditions.length >= 2) {
    const best = qualifiedConditions[0];
    const worst = [...qualifiedConditions].sort((a, b) => a.avgR - b.avgR)[0];

    if (best.avgR > 0) {
      insights.push(
        'You perform best in ' + best.condition + ' markets (' + best.avgR.toFixed(2) + 'R avg over ' +
        best.count + ' trades).'
      );
    }

    if (worst.avgR < 0 && worst.condition !== best.condition) {
      insights.push(
        'Consider sitting out ' + worst.condition + ' conditions (' + worst.avgR.toFixed(2) +
        'R avg). This pattern has cost you $' + Math.abs(worst.totalPnl).toFixed(0) + '.'
      );
    }
  }

  // HTF bias insights
  const withBias = biasStats.find(b => b.alignment === 'with');
  const againstBias = biasStats.find(b => b.alignment === 'against');

  if (withBias && againstBias && withBias.count >= 3 && againstBias.count >= 3) {
    if (withBias.avgR > againstBias.avgR) {
      const improvement = withBias.avgR - againstBias.avgR;
      insights.push(
        'Trading with the HTF bias gives you ' + withBias.winRate.toFixed(1) + '% win rate vs ' +
        againstBias.winRate.toFixed(1) + '% against. ' +
        'Aligning with HTF would improve expectancy by ' + improvement.toFixed(2) + 'R per trade.'
      );
    } else {
      insights.push(
        'Interestingly, you perform better against HTF bias (' + againstBias.avgR.toFixed(2) + 'R) than with it (' +
        withBias.avgR.toFixed(2) + 'R). This may indicate contrarian edge or HTF bias misidentification.'
      );
    }
  }

  return insights;
}


// ============================================
// SETUP TAG ANALYTICS (Confluence System)
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
  const closedTrades = trades.filter(t => t.status === 'closed');
  const tagGroups = new Map<string, TradeRecord[]>();

  // Explode tags - each trade can appear in multiple tag groups
  for (const trade of closedTrades) {
    const tags = trade.setupTags || [];
    for (const tag of tags) {
      const existing = tagGroups.get(tag) || [];
      existing.push(trade);
      tagGroups.set(tag, existing);
    }
  }

  const results: TagStats[] = [];

  for (const [tag, groupTrades] of tagGroups) {
    const wins = groupTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (t.rMultiple ?? 0) < 0);
    const breakevens = groupTrades.filter(t => (t.rMultiple ?? 0) === 0);

    const rMultiples = groupTrades.map(t => t.rMultiple ?? 0);
    const avgR = rMultiples.length > 0
      ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
      : 0;

    const totalPnl = groupTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    const avgWinR = wins.length > 0
      ? wins.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / wins.length
      : 0;
    const avgLossR = losses.length > 0
      ? losses.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / losses.length
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
  const closedTrades = trades.filter(t => t.status === 'closed');
  const countGroups = new Map<number, TradeRecord[]>();

  for (const trade of closedTrades) {
    const tagCount = (trade.setupTags || []).length;
    // Group 4+ tags together
    const bucket = tagCount >= 4 ? 4 : tagCount;
    const existing = countGroups.get(bucket) || [];
    existing.push(trade);
    countGroups.set(bucket, existing);
  }

  const results: ConfluenceCountStats[] = [];

  for (const [tagCount, groupTrades] of countGroups) {
    const wins = groupTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const avgR = groupTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / groupTrades.length;
    const totalPnl = groupTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

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
    t.status === 'closed' &&
    (t.setupTags || []).length >= 2
  );

  const comboGroups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    const tags = [...(trade.setupTags || [])].sort();
    const comboKey = tags.join(' + ');
    const existing = comboGroups.get(comboKey) || [];
    existing.push(trade);
    comboGroups.set(comboKey, existing);
  }

  const results: TagCombinationStats[] = [];

  for (const [combination, groupTrades] of comboGroups) {
    if (groupTrades.length < minOccurrences) continue;

    const wins = groupTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = groupTrades.filter(t => (t.rMultiple ?? 0) < 0);

    const avgR = groupTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / groupTrades.length;
    const totalPnl = groupTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

    const grossWins = wins.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0));
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
    .filter(t =>
      t.status === 'closed' &&
      t.stopDistance !== undefined &&
      t.maeR !== undefined &&
      t.rMultiple !== undefined
    )
    .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime());

  const simulatedTrades: SimulatedTrade[] = [];
  const equityCurve: { tradeIndex: number; original: number; simulated: number }[] = [];
  let originalCumulative = 0;
  let simulatedCumulative = 0;

  for (let i = 0; i < eligibleTrades.length; i++) {
    const trade = eligibleTrades[i];
    const originalStopDistance = trade.stopDistance!;
    const maeR = trade.maeR!;
    const originalR = trade.rMultiple!;

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

    const maeDistance = calculateMaeDistance(trade.entryPrice, trade.maePrice);
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
  const stoppedOutCount = simulatedTrades.filter(t => t.wouldBeStoppedOut).length;
  const improvedCount = simulatedTrades.filter(t => t.simulatedR > t.originalR).length;

  return {
    simulatedTrades,
    adjustmentPercent,
    originalTotalR: originalCumulative,
    simulatedTotalR: simulatedCumulative,
    originalWinRate: simulatedTrades.length > 0
      ? (originalWins.length / simulatedTrades.length) * 100
      : 0,
    simulatedWinRate: simulatedTrades.length > 0
      ? (simulatedWins.length / simulatedTrades.length) * 100
      : 0,
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
 * Analyze break-even move effectiveness
 * @param minRThreshold - Minimum R move to consider BE as having "cost you" a valid trade
 */
export function getBEAnalysis(trades: TradeRecord[], minRThreshold: number = 1.0): BEAnalysisStats {
  const closedTrades = trades.filter(t => t.status === 'closed');

  // Trades with BE moves (look for "BE" or "break" or "breakeven" in stop adjustment reasons)
  const hasBEMove = (t: TradeRecord) => {
    return (t.stopAdjustments || []).some(adj =>
      adj.reason.toLowerCase().includes('be') ||
      adj.reason.toLowerCase().includes('break') ||
      adj.reason.toLowerCase().includes('breakeven') ||
      adj.reason.toLowerCase().includes('break even')
    );
  };

  const movedToBE = closedTrades.filter(hasBEMove);
  const stayedOriginal = closedTrades.filter(t => !hasBEMove(t));

  const calcStats = (arr: TradeRecord[]) => {
    if (arr.length === 0) {
      return { count: 0, avgR: 0, winRate: 0, totalPnl: 0 };
    }
    const wins = arr.filter(t => (t.rMultiple ?? 0) > 0);
    return {
      count: arr.length,
      avgR: arr.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / arr.length,
      winRate: (wins.length / arr.length) * 100,
      totalPnl: arr.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0),
    };
  };

  // Analyze BE-specific outcomes
  let heldForWin = 0;
  let savedByBE = 0;
  let missedProfit = 0;

  for (const trade of movedToBE) {
    const r = trade.rMultiple ?? 0;
    const mfeR = trade.mfeR ?? 0;

    if (r > 0) {
      // Won after moving to BE
      heldForWin++;
    } else if (r === 0 || (r > -0.1 && r < 0.1)) {
      // Exited near BE - was this a save or missed profit?
      if (mfeR > 1) {
        // Had significant MFE but got stopped at BE
        missedProfit++;
      } else {
        // Never really moved in their favor, BE saved them
        savedByBE++;
      }
    } else {
      // Lost despite BE move (shouldn't really happen if BE was executed correctly)
      // Count as neither saved nor missed
    }
  }

  // Post-exit validation: Only count "BE cost you" if post-exit move exceeded threshold
  // This uses post-exit best price data when available
  const beTradesStoppedAtBE = movedToBE.filter(t => {
    const r = t.rMultiple ?? 0;
    return r === 0 || (r > -0.1 && r < 0.1); // Stopped at BE
  });

  const beTradesWithPostExitData = beTradesStoppedAtBE.filter(t =>
    t.postExitBestPrice !== null && t.stopDistance && t.stopDistance > 0
  );

  let thesisCostYou = 0;
  let belowThreshold = 0;
  let totalPostExitMoveR = 0;

  for (const trade of beTradesWithPostExitData) {
    // Calculate post-exit move from entry (how far price went in trader's favour after BE stop)
    const postExitMoveR = calculatePostStopMoveR(
      trade.entryPrice,
      trade.postExitBestPrice,
      trade.stopDistance,
      trade.direction
    ) ?? 0;

    totalPostExitMoveR += postExitMoveR;

    if (postExitMoveR >= minRThreshold) {
      thesisCostYou++;
    } else {
      belowThreshold++;
    }
  }

  return {
    movedToBE: calcStats(movedToBE),
    stayedOriginal: calcStats(stayedOriginal),
    beOutcomes: {
      heldForWin,
      savedByBE,
      missedProfit,
    },
    postExitValidation: {
      tradesWithPostExitData: beTradesWithPostExitData.length,
      thesisCostYou,
      belowThreshold,
      avgPostExitMoveR: beTradesWithPostExitData.length > 0
        ? totalPostExitMoveR / beTradesWithPostExitData.length
        : 0,
    },
  };
}

/**
 * Analyze stop adjustments by trigger (what caused the move)
 */
export function getStopAdjustmentTriggerAnalysis(trades: TradeRecord[]): StopAdjustmentTriggerStats[] {
  const closedTrades = trades.filter(t =>
    t.status === 'closed' &&
    (t.stopAdjustments || []).length > 0
  );

  // Group by trigger
  const triggerGroups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    for (const adj of trade.stopAdjustments || []) {
      const trigger = adj.trigger?.trim() || 'Manual';
      const existing = triggerGroups.get(trigger) || [];
      if (!existing.includes(trade)) {
        existing.push(trade);
      }
      triggerGroups.set(trigger, existing);
    }
  }

  const results: StopAdjustmentTriggerStats[] = [];

  for (const [trigger, groupTrades] of triggerGroups) {
    const wins = groupTrades.filter(t => (t.rMultiple ?? 0) > 0);
    results.push({
      trigger,
      count: groupTrades.length,
      avgRAfter: groupTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / groupTrades.length,
      winRate: (wins.length / groupTrades.length) * 100,
    });
  }

  return results.sort((a, b) => b.count - a.count);
}

/**
 * Analyze stop adjustments by destination/reason
 */
export function getStopDestinationAnalysis(trades: TradeRecord[]): StopDestinationStats[] {
  const closedTrades = trades.filter(t =>
    t.status === 'closed' &&
    (t.stopAdjustments || []).length > 0
  );

  // Group by reason/destination
  const reasonGroups = new Map<string, TradeRecord[]>();

  for (const trade of closedTrades) {
    for (const adj of trade.stopAdjustments || []) {
      const reason = adj.reason?.trim() || 'Unspecified';
      const existing = reasonGroups.get(reason) || [];
      if (!existing.includes(trade)) {
        existing.push(trade);
      }
      reasonGroups.set(reason, existing);
    }
  }

  const results: StopDestinationStats[] = [];

  for (const [destination, groupTrades] of reasonGroups) {
    const wins = groupTrades.filter(t => (t.rMultiple ?? 0) > 0);
    results.push({
      destination,
      count: groupTrades.length,
      avgR: groupTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / groupTrades.length,
      winRate: (wins.length / groupTrades.length) * 100,
    });
  }

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
  const takenClosed = taken.filter(t => t.status === 'closed' && t.rMultiple !== undefined);
  const missedClosed = missed.filter(t => t.status === 'closed' && t.rMultiple !== undefined);

  if (takenClosed.length < 1 && missedClosed.length < 1) return null;

  const calcStats = (trades: TradeRecord[]) => {
    if (trades.length === 0) {
      return { count: 0, winRate: 0, avgR: 0, profitFactor: 0, totalR: 0 };
    }
    const wins = trades.filter(t => (t.rMultiple ?? 0) > 0);
    const losses = trades.filter(t => (t.rMultiple ?? 0) <= 0);
    const totalR = trades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);
    const avgR = totalR / trades.length;
    const winRate = (wins.length / trades.length) * 100;
    const grossWins = wins.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0));
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
  const withOutcome = missedTrades.filter(t => t.status === 'closed' && t.rMultiple !== undefined);

  const winners = withOutcome.filter(t => (t.rMultiple ?? 0) > 0);
  const losers = withOutcome.filter(t => (t.rMultiple ?? 0) <= 0);

  const missedProfit = winners.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);
  const savedLosses = Math.abs(losers.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0));
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
  const withOutcome = missedTrades.filter(t => t.status === 'closed' && t.rMultiple !== undefined);

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
    const wins = trades.filter(t => (t.rMultiple ?? 0) > 0);
    const totalR = trades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);
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
  const withOutcome = missedTrades.filter(t => t.status === 'closed' && t.rMultiple !== undefined);

  // Group by setup tag
  const tagMap = new Map<string, TradeRecord[]>();
  for (const trade of withOutcome) {
    const tags = trade.setupTags || [];
    for (const tag of tags) {
      if (!tagMap.has(tag)) {
        tagMap.set(tag, []);
      }
      tagMap.get(tag)!.push(trade);
    }
  }

  const breakdown: TagBreakdown[] = [];
  for (const [tag, trades] of tagMap) {
    const wins = trades.filter(t => (t.rMultiple ?? 0) > 0);
    const totalR = trades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);
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

  const missedClosed = missed.filter(t => t.status === 'closed' && t.rMultiple !== undefined);
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
    t.status === 'closed' &&
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

    for (const tag of (trade.setupTags || [])) {
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
 */
export function getPostExitAnalysis(trades: TradeRecord[]): PostExitAnalysis {
  const closedTrades = trades.filter(t => t.status === 'closed' && t.tradeTaken !== false);
  const tradesWithData = closedTrades.filter(t =>
    t.postExitBestPrice !== null || t.postExitWorstPrice !== null || t.reachedTargetPostExit !== null
  );

  if (tradesWithData.length === 0) {
    return {
      tradesWithData: 0,
      totalClosedTrades: closedTrades.length,
      avgExitEfficiency: 0,
      avgMissedR: 0,
      reachedTargetPercent: 0,
      tradesReachedTarget: 0,
    };
  }

  // Calculate exit efficiency and missed R for trades with post-exit best price
  const tradesWithBestPrice = tradesWithData.filter(t =>
    t.postExitBestPrice !== null && t.exitPrice !== undefined && t.stopDistance
  );

  let totalMissedR = 0;
  let totalEfficiency = 0;
  let efficiencyCount = 0;

  for (const trade of tradesWithBestPrice) {
    if (!trade.stopDistance || trade.stopDistance === 0) continue;

    // Calculate missed R
    const priceDiff = trade.postExitBestPrice! - trade.exitPrice!;
    const signedMove = trade.direction === 'long' ? priceDiff : -priceDiff;
    const missedR = signedMove > 0 ? signedMove / trade.stopDistance : 0;
    totalMissedR += missedR;

    // Calculate exit efficiency
    if (trade.rMultiple !== undefined && trade.rMultiple > 0) {
      const wouldHaveR = Math.abs(trade.postExitBestPrice! - trade.entryPrice) / trade.stopDistance;
      if (wouldHaveR > 0) {
        const efficiency = (trade.rMultiple / wouldHaveR) * 100;
        totalEfficiency += efficiency;
        efficiencyCount++;
      }
    }
  }

  const tradesWithTargetInfo = tradesWithData.filter(t => t.reachedTargetPostExit !== null);
  const tradesReachedTarget = tradesWithTargetInfo.filter(t => t.reachedTargetPostExit === true).length;

  return {
    tradesWithData: tradesWithData.length,
    totalClosedTrades: closedTrades.length,
    avgExitEfficiency: efficiencyCount > 0 ? totalEfficiency / efficiencyCount : 0,
    avgMissedR: tradesWithBestPrice.length > 0 ? totalMissedR / tradesWithBestPrice.length : 0,
    reachedTargetPercent: tradesWithTargetInfo.length > 0
      ? (tradesReachedTarget / tradesWithTargetInfo.length) * 100
      : 0,
    tradesReachedTarget,
  };
}

/**
 * Get stopout-specific post-exit analysis
 * For stopouts, we measure how far price moved in the trader's favour AFTER being stopped out
 * This helps identify if the thesis was correct but stop placement was wrong
 */
export function getStopoutPostExitAnalysis(trades: TradeRecord[], minRThreshold: number = 1.0): StopoutAnalysis {
  const closedTrades = trades.filter(t => t.status === 'closed' && t.tradeTaken !== false);
  const stopouts = closedTrades.filter(t => t.exitType === 'sl_hit');
  const stopoutsWithData = stopouts.filter(t =>
    t.postExitBestPrice !== null && t.stopDistance && t.stopDistance > 0
  );

  if (stopoutsWithData.length === 0) {
    return {
      totalStopouts: stopouts.length,
      stopoutsWithPostExitData: 0,
      avgPostStopMoveR: 0,
      stopoutsAboveThreshold: 0,
      stopoutsAboveThresholdPercent: 0,
      avgPostStopMoveAboveThreshold: 0,
      avgPostStopMoveBelowThreshold: 0,
    };
  }

  let totalPostStopMoveR = 0;
  let aboveThresholdCount = 0;
  let aboveThresholdTotalR = 0;
  let belowThresholdCount = 0;
  let belowThresholdTotalR = 0;

  for (const trade of stopoutsWithData) {
    const postStopMoveR = calculatePostStopMoveR(
      trade.entryPrice,
      trade.postExitBestPrice,
      trade.stopDistance,
      trade.direction
    ) ?? 0;

    totalPostStopMoveR += postStopMoveR;

    if (postStopMoveR >= minRThreshold) {
      aboveThresholdCount++;
      aboveThresholdTotalR += postStopMoveR;
    } else {
      belowThresholdCount++;
      belowThresholdTotalR += postStopMoveR;
    }
  }

  return {
    totalStopouts: stopouts.length,
    stopoutsWithPostExitData: stopoutsWithData.length,
    avgPostStopMoveR: totalPostStopMoveR / stopoutsWithData.length,
    stopoutsAboveThreshold: aboveThresholdCount,
    stopoutsAboveThresholdPercent: (aboveThresholdCount / stopoutsWithData.length) * 100,
    avgPostStopMoveAboveThreshold: aboveThresholdCount > 0 ? aboveThresholdTotalR / aboveThresholdCount : 0,
    avgPostStopMoveBelowThreshold: belowThresholdCount > 0 ? belowThresholdTotalR / belowThresholdCount : 0,
  };
}

/**
 * Get voluntary exit (non-stopout) post-exit analysis
 * For voluntary exits, we use the traditional missedR calculation (how much more could have been captured)
 */
export function getVoluntaryExitPostExitAnalysis(trades: TradeRecord[]): VoluntaryExitAnalysis {
  const closedTrades = trades.filter(t => t.status === 'closed' && t.tradeTaken !== false);
  const voluntaryExits = closedTrades.filter(t =>
    t.exitType && t.exitType !== 'sl_hit'
  );
  const withData = voluntaryExits.filter(t =>
    t.postExitBestPrice !== null && t.exitPrice !== undefined && t.stopDistance && t.stopDistance > 0
  );

  if (withData.length === 0) {
    return {
      totalVoluntaryExits: voluntaryExits.length,
      withPostExitData: 0,
      avgMissedR: 0,
      avgExitEfficiency: 0,
      reachedTargetPercent: 0,
    };
  }

  let totalMissedR = 0;
  let totalEfficiency = 0;
  let efficiencyCount = 0;
  let reachedTargetCount = 0;
  let targetInfoCount = 0;

  for (const trade of withData) {
    // Calculate traditional missed R (from exit price to best price)
    const missedR = calculateMissedR(
      trade.exitPrice,
      trade.postExitBestPrice,
      trade.stopDistance,
      trade.direction
    ) ?? 0;
    totalMissedR += missedR;

    // Calculate efficiency
    if (trade.rMultiple !== undefined && trade.rMultiple > 0) {
      const wouldHaveR = Math.abs(trade.postExitBestPrice! - trade.entryPrice) / trade.stopDistance!;
      if (wouldHaveR > 0) {
        const efficiency = (trade.rMultiple / wouldHaveR) * 100;
        totalEfficiency += efficiency;
        efficiencyCount++;
      }
    }

    // Track reached target
    if (trade.reachedTargetPostExit !== null) {
      targetInfoCount++;
      if (trade.reachedTargetPostExit) {
        reachedTargetCount++;
      }
    }
  }

  return {
    totalVoluntaryExits: voluntaryExits.length,
    withPostExitData: withData.length,
    avgMissedR: totalMissedR / withData.length,
    avgExitEfficiency: efficiencyCount > 0 ? totalEfficiency / efficiencyCount : 0,
    reachedTargetPercent: targetInfoCount > 0 ? (reachedTargetCount / targetInfoCount) * 100 : 0,
  };
}

/**
 * Cross-reference stop adjustments with post-exit data
 * Groups by the stop adjustment reason (especially "moved to BE")
 */
export function getMissedRByStopReason(trades: TradeRecord[]): MissedRByStopReason[] {
  // Get trades that have both stop adjustments AND post-exit data
  const relevantTrades = trades.filter(t =>
    t.status === 'closed' &&
    t.tradeTaken !== false &&
    t.postExitBestPrice !== null &&
    t.stopAdjustments &&
    t.stopAdjustments.length > 0 &&
    t.exitPrice !== undefined &&
    t.stopDistance
  );

  // Group by stop adjustment reason
  const byReason = new Map<string, {
    trades: TradeRecord[];
    totalMissedR: number;
    reachedTargetCount: number;
    reachedTargetTotal: number;
  }>();

  for (const trade of relevantTrades) {
    // Use the first stop adjustment reason (most common case)
    const reason = trade.stopAdjustments[0]?.reason || 'Unknown';
    const normalizedReason = reason.toLowerCase().includes('be') ? 'Moved to BE' : reason;

    if (!byReason.has(normalizedReason)) {
      byReason.set(normalizedReason, {
        trades: [],
        totalMissedR: 0,
        reachedTargetCount: 0,
        reachedTargetTotal: 0,
      });
    }

    const group = byReason.get(normalizedReason)!;
    group.trades.push(trade);

    // Calculate missed R
    const priceDiff = trade.postExitBestPrice! - trade.exitPrice!;
    const signedMove = trade.direction === 'long' ? priceDiff : -priceDiff;
    const missedR = signedMove > 0 ? signedMove / trade.stopDistance! : 0;
    group.totalMissedR += missedR;

    // Track reached target
    if (trade.reachedTargetPostExit !== null) {
      group.reachedTargetTotal++;
      if (trade.reachedTargetPostExit) {
        group.reachedTargetCount++;
      }
    }
  }

  const results: MissedRByStopReason[] = [];
  for (const [reason, data] of byReason.entries()) {
    results.push({
      reason,
      tradeCount: data.trades.length,
      avgMissedR: data.totalMissedR / data.trades.length,
      reachedTargetPercent: data.reachedTargetTotal > 0
        ? (data.reachedTargetCount / data.reachedTargetTotal) * 100
        : 0,
    });
  }

  return results.sort((a, b) => b.tradeCount - a.tradeCount);
}

/**
 * Groups missed R by exit type from the exits array
 */
export function getMissedRByExitType(trades: TradeRecord[]): MissedRByExitType[] {
  // Get trades with post-exit data
  const relevantTrades = trades.filter(t =>
    t.status === 'closed' &&
    t.tradeTaken !== false &&
    t.postExitBestPrice !== null &&
    t.exitPrice !== undefined &&
    t.stopDistance &&
    t.exitType
  );

  // Group by exit type
  const byType = new Map<string, {
    trades: TradeRecord[];
    totalMissedR: number;
    totalEfficiency: number;
    efficiencyCount: number;
  }>();

  for (const trade of relevantTrades) {
    const exitType = trade.exitType || 'unknown';
    const label = exitType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    if (!byType.has(label)) {
      byType.set(label, {
        trades: [],
        totalMissedR: 0,
        totalEfficiency: 0,
        efficiencyCount: 0,
      });
    }

    const group = byType.get(label)!;
    group.trades.push(trade);

    // Calculate missed R
    const priceDiff = trade.postExitBestPrice! - trade.exitPrice!;
    const signedMove = trade.direction === 'long' ? priceDiff : -priceDiff;
    const missedR = signedMove > 0 ? signedMove / trade.stopDistance! : 0;
    group.totalMissedR += missedR;

    // Calculate exit efficiency
    if (trade.rMultiple !== undefined && trade.rMultiple > 0) {
      const wouldHaveR = Math.abs(trade.postExitBestPrice! - trade.entryPrice) / trade.stopDistance!;
      if (wouldHaveR > 0) {
        const efficiency = (trade.rMultiple / wouldHaveR) * 100;
        group.totalEfficiency += efficiency;
        group.efficiencyCount++;
      }
    }
  }

  const results: MissedRByExitType[] = [];
  for (const [exitType, data] of byType.entries()) {
    results.push({
      exitType,
      tradeCount: data.trades.length,
      avgMissedR: data.totalMissedR / data.trades.length,
      avgExitEfficiency: data.efficiencyCount > 0 ? data.totalEfficiency / data.efficiencyCount : 0,
    });
  }

  return results.sort((a, b) => b.tradeCount - a.tradeCount);
}

/**
 * Get scatter data for "should-have-held" visualization
 * X: actual R achieved, Y: would-have R (if held to post-exit best price)
 */
export function getPostExitScatterData(trades: TradeRecord[]): PostExitScatterPoint[] {
  const points: PostExitScatterPoint[] = [];

  const relevantTrades = trades.filter(t =>
    t.status === 'closed' &&
    t.tradeTaken !== false &&
    t.postExitBestPrice !== null &&
    t.rMultiple !== undefined &&
    t.stopDistance &&
    t.stopDistance > 0
  );

  for (const trade of relevantTrades) {
    // Calculate would-have R
    const priceDiff = trade.postExitBestPrice! - trade.entryPrice;
    const signedMove = trade.direction === 'long' ? priceDiff : -priceDiff;
    const wouldHaveR = signedMove / trade.stopDistance!;

    // Check if trade had a BE stop adjustment
    const hadBEAdjustment = trade.stopAdjustments?.some(adj =>
      adj.reason.toLowerCase().includes('be')
    ) ?? false;

    points.push({
      tradeId: trade.id!,
      pair: trade.pair,
      actualR: trade.rMultiple!,
      wouldHaveR,
      hadBEAdjustment,
    });
  }

  return points;
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
