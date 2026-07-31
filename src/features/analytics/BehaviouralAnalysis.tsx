import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis,
  Cell,
  ReferenceLine,
} from 'recharts';
import type { TradeRecord } from '../../types';
import {
  getStreakAnalysis,
  getTradesPerDayAnalysis,
  getBehaviouralInsights,
  getEntryConfirmationAnalysis,
  getConfirmationTFAnalysis,
  getConfirmationTFVsEntryTFMatrix,
  getConfirmationTFInsights,
  getCounterfactualAnalysis,
  CHART_TOOLTIP_STYLES,
} from '../../utils';
import { deriveStatus, getTradeRMetrics } from '../../utils/tradeCalculations';

interface Props {
  trades: TradeRecord[];
}

/**
 * Timing-based revenge trade detection.
 * Identifies trades entered within 30 minutes of a losing trade.
 */
interface RevengeTradeStats {
  normalTrades: {
    count: number;
    winRate: number;
    avgR: number;
    totalPnl: number;
  };
  revengeTrades: {
    count: number;
    winRate: number;
    avgR: number;
    totalPnl: number;
    trades: TradeRecord[];
  };
}

function getTimingBasedRevengeAnalysis(trades: TradeRecord[]): RevengeTradeStats {
  // Filter to closed trades only
  const closedTrades = trades.filter(t => deriveStatus(t) === 'closed');

  // Sort trades by entry time
  const sortedTrades = [...closedTrades].sort(
    (a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
  );

  const revengeTrades: TradeRecord[] = [];
  const normalTrades: TradeRecord[] = [];

  const REVENGE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes in milliseconds

  for (let i = 0; i < sortedTrades.length; i++) {
    const trade = sortedTrades[i];
    const tradeEntryTime = new Date(trade.entryTime).getTime();

    // Look for any losing trade that closed within 30 minutes before this trade's entry
    let isRevengeTrade = false;

    for (let j = 0; j < i; j++) {
      const previousTrade = sortedTrades[j];
      const prevMetrics = getTradeRMetrics(previousTrade);

      // Skip if previous trade doesn't have exit info
      if (!prevMetrics.exitTime) continue;

      const prevExitTime = prevMetrics.exitTime.getTime();
      const timeSinceExit = tradeEntryTime - prevExitTime;

      // Check if previous trade was a loss and exited within 30 minutes of current entry
      if (timeSinceExit > 0 && timeSinceExit <= REVENGE_WINDOW_MS) {
        const prevRMultiple = prevMetrics.rMultiple;
        if (prevRMultiple !== null && prevRMultiple < 0) {
          isRevengeTrade = true;
          break;
        }
      }
    }

    if (isRevengeTrade) {
      revengeTrades.push(trade);
    } else {
      normalTrades.push(trade);
    }
  }

  // Calculate stats for revenge trades
  const revengeMetrics = revengeTrades.map(t => getTradeRMetrics(t));
  const revengeWins = revengeMetrics.filter(m => m.rMultiple !== null && m.rMultiple > 0).length;
  const revengeRValues = revengeMetrics
    .map(m => m.rMultiple)
    .filter((r): r is number => r !== null);
  const revengePnlValues = revengeMetrics
    .map(m => m.pnl)
    .filter((p): p is number => p !== null);

  // Calculate stats for normal trades
  const normalMetrics = normalTrades.map(t => getTradeRMetrics(t));
  const normalWins = normalMetrics.filter(m => m.rMultiple !== null && m.rMultiple > 0).length;
  const normalRValues = normalMetrics
    .map(m => m.rMultiple)
    .filter((r): r is number => r !== null);
  const normalPnlValues = normalMetrics
    .map(m => m.pnl)
    .filter((p): p is number => p !== null);

  return {
    normalTrades: {
      count: normalTrades.length,
      winRate: normalTrades.length > 0 ? (normalWins / normalTrades.length) * 100 : 0,
      avgR: normalRValues.length > 0
        ? normalRValues.reduce((a, b) => a + b, 0) / normalRValues.length
        : 0,
      totalPnl: normalPnlValues.reduce((a, b) => a + b, 0),
    },
    revengeTrades: {
      count: revengeTrades.length,
      winRate: revengeTrades.length > 0 ? (revengeWins / revengeTrades.length) * 100 : 0,
      avgR: revengeRValues.length > 0
        ? revengeRValues.reduce((a, b) => a + b, 0) / revengeRValues.length
        : 0,
      totalPnl: revengePnlValues.reduce((a, b) => a + b, 0),
      trades: revengeTrades,
    },
  };
}

export function BehaviouralAnalysis({ trades }: Props) {
  const streakAnalysis = useMemo(() => getStreakAnalysis(trades), [trades]);
  const tradesPerDay = useMemo(() => getTradesPerDayAnalysis(trades), [trades]);
  const entryConfirmationStats = useMemo(() => getEntryConfirmationAnalysis(trades), [trades]);
  const confirmationTFStats = useMemo(() => getConfirmationTFAnalysis(trades), [trades]);
  const confirmationTFMatrix = useMemo(() => getConfirmationTFVsEntryTFMatrix(trades), [trades]);
  const confirmationTFInsights = useMemo(
    () => getConfirmationTFInsights(confirmationTFStats, confirmationTFMatrix),
    [confirmationTFStats, confirmationTFMatrix]
  );
  const revengeStats = useMemo(() => getTimingBasedRevengeAnalysis(trades), [trades]);
  const counterfactualAnalysis = useMemo(() => getCounterfactualAnalysis(trades), [trades]);
  const insights = useMemo(
    () => [
      ...getBehaviouralInsights(streakAnalysis, tradesPerDay, entryConfirmationStats),
      ...confirmationTFInsights,
    ],
    [streakAnalysis, tradesPerDay, entryConfirmationStats, confirmationTFInsights]
  );

  const closedTrades = trades.filter(t => deriveStatus(t) === 'closed');

  if (closedTrades.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No closed trades to analyze.</p>
      </div>
    );
  }

  // Prepare streak analysis data
  const streakData = [
    { name: 'After Win', avgR: streakAnalysis.afterWin.avgR, count: streakAnalysis.afterWin.count },
    { name: 'After Loss', avgR: streakAnalysis.afterLoss.avgR, count: streakAnalysis.afterLoss.count },
    { name: 'After 2+ Wins', avgR: streakAnalysis.afterWinStreak.avgR, count: streakAnalysis.afterWinStreak.count },
    { name: 'After 2+ Losses', avgR: streakAnalysis.afterLossStreak.avgR, count: streakAnalysis.afterLossStreak.count },
  ];

  return (
    <div className="space-y-6">
      {/* Entry Confirmation Analysis */}
      {entryConfirmationStats.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Entry Confirmation Analysis</h3>
            <p className="text-sm text-gray-400">Performance by entry confirmation type</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 px-3 text-gray-400 font-medium">Type</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Count</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Win Rate</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Avg R</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">PF</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Avg MAE</th>
                </tr>
              </thead>
              <tbody>
                {entryConfirmationStats.map((stat) => (
                  <tr key={stat.type} className="border-b border-gray-700/50 last:border-0">
                    <td className="py-2 px-3 text-gray-300">{stat.label}</td>
                    <td className="py-2 px-3 text-right text-white">{stat.count}</td>
                    <td className="py-2 px-3 text-right text-white">{stat.winRate.toFixed(1)}%</td>
                    <td className={`py-2 px-3 text-right font-medium ${stat.avgR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {stat.avgR.toFixed(2)}R
                    </td>
                    <td className="py-2 px-3 text-right text-white">
                      {stat.profitFactor > 10 ? '>10' : stat.profitFactor.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-300">
                      {stat.avgMae !== null ? stat.avgMae.toFixed(2) + 'R' : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Blind vs Confirmation Summary */}
          {(() => {
            const blindTypes = entryConfirmationStats.filter(s =>
              s.type === 'blind_limit' || s.type === 'blind_market'
            );
            const confirmTypes = entryConfirmationStats.filter(s =>
              s.type === 'structural' || s.type === 'partial_confirmation'
            );

            if (blindTypes.length > 0 && confirmTypes.length > 0) {
              const blindCount = blindTypes.reduce((sum, s) => sum + s.count, 0);
              const confirmCount = confirmTypes.reduce((sum, s) => sum + s.count, 0);
              const blindAvgR = blindTypes.reduce((sum, s) => sum + s.avgR * s.count, 0) / blindCount;
              const confirmAvgR = confirmTypes.reduce((sum, s) => sum + s.avgR * s.count, 0) / confirmCount;
              const blindWinRate = blindTypes.reduce((sum, s) => sum + s.winRate * s.count, 0) / blindCount;
              const confirmWinRate = confirmTypes.reduce((sum, s) => sum + s.winRate * s.count, 0) / confirmCount;

              return (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="bg-gray-750 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-400 mb-3">Blind Entries</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Count</span>
                        <span className="text-white font-medium">{blindCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Win Rate</span>
                        <span className="text-white font-medium">{blindWinRate.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Avg R</span>
                        <span className={`font-medium ${blindAvgR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {blindAvgR.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-gray-750 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-400 mb-3">Confirmation Entries</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Count</span>
                        <span className="text-white font-medium">{confirmCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Win Rate</span>
                        <span className="text-white font-medium">{confirmWinRate.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Avg R</span>
                        <span className={`font-medium ${confirmAvgR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {confirmAvgR.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {/* Confirmation Timeframe Breakdown - sub-table within Entry Confirmation */}
          {confirmationTFStats.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-700">
              <h4 className="text-md font-medium text-white mb-2">Confirmation Timeframe Breakdown</h4>
              <p className="text-sm text-gray-400 mb-4">Performance breakdown by the timeframe used for structural/partial confirmation</p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">TF</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Count</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Win Rate</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Avg R</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmationTFStats.map((stat) => (
                      <tr
                        key={stat.timeframe}
                        className={`border-b border-gray-700/50 last:border-0 ${stat.count < 5 ? 'opacity-50' : ''}`}
                      >
                        <td className="py-2 px-3 text-gray-300">{stat.timeframe}</td>
                        <td className="py-2 px-3 text-right text-white">
                          {stat.count}
                          {stat.count < 5 && <span className="text-gray-500 ml-1">(n&lt;5)</span>}
                        </td>
                        <td className="py-2 px-3 text-right text-white">{stat.winRate.toFixed(1)}%</td>
                        <td className={`py-2 px-3 text-right font-medium ${stat.avgR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {stat.avgR.toFixed(2)}R
                        </td>
                        <td className="py-2 px-3 text-right text-white">
                          {stat.profitFactor > 10 ? '>10' : stat.profitFactor.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* TF Matrix Grid */}
              {confirmationTFMatrix.length > 0 && (
                <div className="mt-4">
                  <h5 className="text-sm font-medium text-gray-400 mb-2">Confirmation TF vs Entry TF Matrix</h5>
                  <div className="overflow-x-auto">
                    {(() => {
                      // Build matrix structure
                      const entryTFs = [...new Set(confirmationTFMatrix.map(c => c.entryTF))].sort();
                      const confirmTFs = [...new Set(confirmationTFMatrix.map(c => c.confirmationTF))].sort();
                      const cellMap = new Map(confirmationTFMatrix.map(c => [`${c.confirmationTF}|${c.entryTF}`, c]));

                      return (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-700">
                              <th className="text-left py-2 px-2 text-gray-400 font-medium">Conf \ Entry</th>
                              {entryTFs.map(tf => (
                                <th key={tf} className="text-center py-2 px-2 text-gray-400 font-medium">{tf}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {confirmTFs.map(confTF => (
                              <tr key={confTF} className="border-b border-gray-700/50 last:border-0">
                                <td className="py-2 px-2 text-gray-300">{confTF}</td>
                                {entryTFs.map(entryTF => {
                                  const cell = cellMap.get(`${confTF}|${entryTF}`);
                                  if (!cell) {
                                    return (
                                      <td key={entryTF} className="py-2 px-2 text-center text-gray-600">-</td>
                                    );
                                  }
                                  const isLowSample = cell.count < 5;
                                  return (
                                    <td
                                      key={entryTF}
                                      className={`py-2 px-2 text-center ${isLowSample ? 'opacity-50' : ''}`}
                                    >
                                      <div className={`font-medium ${cell.avgR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {cell.avgR > 0 ? '+' : ''}{cell.avgR.toFixed(1)}R
                                      </div>
                                      <div className="text-xs text-gray-500">n={cell.count}</div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Counterfactual Analysis */}
      {(counterfactualAnalysis.blindTrades.total > 0 || counterfactualAnalysis.confirmedTrades.total > 0) && (
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Confirmation Counterfactual Analysis</h3>
            <p className="text-sm text-gray-400">What if you had waited for confirmation vs entered blind?</p>
          </div>

          {/* Blind Trades Analysis */}
          {counterfactualAnalysis.blindTrades.total > 0 && (
            <div className="mb-6">
              <h4 className="text-md font-medium text-white mb-3">Blind Entries ({counterfactualAnalysis.blindTrades.total})</h4>

              {/* Outcome breakdown */}
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Counterfactual Outcome</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Count</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Actual Avg R</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">If Waited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counterfactualAnalysis.blindTrades.appearedWorked.length > 0 && (
                      <tr className="border-b border-gray-700/50">
                        <td className="py-2 px-3 text-green-400">Confirmation appeared & worked</td>
                        <td className="py-2 px-3 text-right text-white">{counterfactualAnalysis.blindTrades.appearedWorked.length}</td>
                        <td className={`py-2 px-3 text-right font-medium ${
                          counterfactualAnalysis.blindTrades.appearedWorked.reduce((s, t) => s + t.actualR, 0) / counterfactualAnalysis.blindTrades.appearedWorked.length >= 0
                            ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {(counterfactualAnalysis.blindTrades.appearedWorked.reduce((s, t) => s + t.actualR, 0) / counterfactualAnalysis.blindTrades.appearedWorked.length).toFixed(2)}R
                        </td>
                        <td className={`py-2 px-3 text-right font-medium ${
                          (counterfactualAnalysis.blindTrades.appearedWorked.filter(t => t.counterfactualR !== null).reduce((s, t) => s + (t.counterfactualR ?? 0), 0) /
                          (counterfactualAnalysis.blindTrades.appearedWorked.filter(t => t.counterfactualR !== null).length || 1)) >= 0
                            ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {counterfactualAnalysis.blindTrades.appearedWorked.filter(t => t.counterfactualR !== null).length > 0
                            ? (counterfactualAnalysis.blindTrades.appearedWorked.filter(t => t.counterfactualR !== null).reduce((s, t) => s + (t.counterfactualR ?? 0), 0) /
                               counterfactualAnalysis.blindTrades.appearedWorked.filter(t => t.counterfactualR !== null).length).toFixed(2) + 'R'
                            : '-'}
                        </td>
                      </tr>
                    )}
                    {counterfactualAnalysis.blindTrades.appearedFailed.length > 0 && (
                      <tr className="border-b border-gray-700/50">
                        <td className="py-2 px-3 text-red-400">Confirmation appeared & failed</td>
                        <td className="py-2 px-3 text-right text-white">{counterfactualAnalysis.blindTrades.appearedFailed.length}</td>
                        <td className={`py-2 px-3 text-right font-medium ${
                          counterfactualAnalysis.blindTrades.appearedFailed.reduce((s, t) => s + t.actualR, 0) / counterfactualAnalysis.blindTrades.appearedFailed.length >= 0
                            ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {(counterfactualAnalysis.blindTrades.appearedFailed.reduce((s, t) => s + t.actualR, 0) / counterfactualAnalysis.blindTrades.appearedFailed.length).toFixed(2)}R
                        </td>
                        <td className="py-2 px-3 text-right text-gray-400">
                          {counterfactualAnalysis.blindTrades.appearedFailed.filter(t => t.counterfactualR !== null).length > 0
                            ? 'Avoided' : '-'}
                        </td>
                      </tr>
                    )}
                    {counterfactualAnalysis.blindTrades.neverAppeared.length > 0 && (
                      <tr className="border-b border-gray-700/50 last:border-0">
                        <td className="py-2 px-3 text-yellow-400">Confirmation never appeared</td>
                        <td className="py-2 px-3 text-right text-white">{counterfactualAnalysis.blindTrades.neverAppeared.length}</td>
                        <td className={`py-2 px-3 text-right font-medium ${
                          counterfactualAnalysis.blindTrades.neverAppeared.reduce((s, t) => s + t.actualR, 0) / counterfactualAnalysis.blindTrades.neverAppeared.length >= 0
                            ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {(counterfactualAnalysis.blindTrades.neverAppeared.reduce((s, t) => s + t.actualR, 0) / counterfactualAnalysis.blindTrades.neverAppeared.length).toFixed(2)}R
                        </td>
                        <td className="py-2 px-3 text-right text-gray-400">Missed</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-750 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400">Avg R (Blind)</p>
                  <p className={`text-xl font-bold ${counterfactualAnalysis.blindTrades.avgActualR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {counterfactualAnalysis.blindTrades.avgActualR.toFixed(2)}
                  </p>
                </div>
                <div className="bg-gray-750 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400">Avg R (If Waited)</p>
                  <p className={`text-xl font-bold ${
                    counterfactualAnalysis.blindTrades.avgCounterfactualR !== null
                      ? counterfactualAnalysis.blindTrades.avgCounterfactualR >= 0 ? 'text-green-400' : 'text-red-400'
                      : 'text-gray-500'
                  }`}>
                    {counterfactualAnalysis.blindTrades.avgCounterfactualR !== null
                      ? counterfactualAnalysis.blindTrades.avgCounterfactualR.toFixed(2)
                      : '-'}
                  </p>
                </div>
                <div className="bg-gray-750 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400">Miss Rate</p>
                  <p className="text-xl font-bold text-yellow-400">
                    {counterfactualAnalysis.blindTrades.total > 0
                      ? ((counterfactualAnalysis.blindTrades.missedTradesCount / counterfactualAnalysis.blindTrades.total) * 100).toFixed(0)
                      : 0}%
                  </p>
                  <p className="text-xs text-gray-500">({counterfactualAnalysis.blindTrades.missedTradesR.toFixed(1)}R forfeited)</p>
                </div>
              </div>

              {/* Planned R:R Comparison */}
              {(counterfactualAnalysis.blindTrades.avgBlindPlannedRR !== null || counterfactualAnalysis.blindTrades.avgCounterfactualPlannedRR !== null) && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="bg-gray-750 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400">Blind Planned R:R</p>
                    <p className="text-xl font-bold text-white">
                      {counterfactualAnalysis.blindTrades.avgBlindPlannedRR !== null
                        ? `${counterfactualAnalysis.blindTrades.avgBlindPlannedRR.toFixed(1)}:1`
                        : '-'}
                    </p>
                  </div>
                  <div className="bg-gray-750 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400">Confirmed Planned R:R</p>
                    <p className="text-xl font-bold text-white">
                      {counterfactualAnalysis.blindTrades.avgCounterfactualPlannedRR !== null
                        ? `${counterfactualAnalysis.blindTrades.avgCounterfactualPlannedRR.toFixed(1)}:1`
                        : '-'}
                    </p>
                    <p className="text-xs text-gray-500">(tighter stops)</p>
                  </div>
                </div>
              )}

              {/* Indeterminate warning */}
              {counterfactualAnalysis.blindTrades.indeterminateCount > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  {counterfactualAnalysis.blindTrades.indeterminateCount} trade{counterfactualAnalysis.blindTrades.indeterminateCount !== 1 ? 's' : ''} indeterminate (both stop and target breached, order unknown)
                </p>
              )}
            </div>
          )}

          {/* Confirmed Trades Analysis */}
          {counterfactualAnalysis.confirmedTrades.total > 0 && counterfactualAnalysis.confirmedTrades.withBlindCounterfactual > 0 && (
            <div className="pt-4 border-t border-gray-700">
              <h4 className="text-md font-medium text-white mb-3">Confirmed Entries ({counterfactualAnalysis.confirmedTrades.total})</h4>
              <p className="text-sm text-gray-400 mb-4">What if you had entered blind instead of waiting for confirmation?</p>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-750 rounded-lg p-4">
                  <h5 className="text-sm font-medium text-gray-400 mb-3">Actual (Waited)</h5>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Count</span>
                      <span className="text-white font-medium">{counterfactualAnalysis.confirmedTrades.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Avg R</span>
                      <span className={`font-medium ${counterfactualAnalysis.confirmedTrades.avgActualR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {counterfactualAnalysis.confirmedTrades.avgActualR.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-750 rounded-lg p-4">
                  <h5 className="text-sm font-medium text-gray-400 mb-3">If Entered Blind</h5>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-500">With data</span>
                      <span className="text-white font-medium">{counterfactualAnalysis.confirmedTrades.withBlindCounterfactual}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Avg R</span>
                      <span className={`font-medium ${
                        counterfactualAnalysis.confirmedTrades.avgBlindCounterfactualR !== null
                          ? counterfactualAnalysis.confirmedTrades.avgBlindCounterfactualR >= 0 ? 'text-green-400' : 'text-red-400'
                          : 'text-gray-500'
                      }`}>
                        {counterfactualAnalysis.confirmedTrades.avgBlindCounterfactualR !== null
                          ? counterfactualAnalysis.confirmedTrades.avgBlindCounterfactualR.toFixed(2)
                          : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Verdict Insight */}
          {counterfactualAnalysis.verdict && (
            <div className="mt-4 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <h4 className="text-sm font-medium text-blue-400 mb-2">Verdict</h4>
              <p className="text-sm text-gray-300">{counterfactualAnalysis.verdict.insight}</p>
              <div className="flex gap-4 mt-3 text-xs">
                <span className={`${counterfactualAnalysis.verdict.blindAhead ? 'text-green-400' : 'text-yellow-400'}`}>
                  {counterfactualAnalysis.verdict.blindAhead ? 'Blind ahead' : 'Waiting ahead'}
                </span>
                <span className="text-gray-500">|</span>
                <span className="text-gray-400">
                  R diff: {counterfactualAnalysis.verdict.rDifferencePerTrade > 0 ? '+' : ''}{counterfactualAnalysis.verdict.rDifferencePerTrade}/trade
                </span>
                <span className="text-gray-500">|</span>
                <span className="text-gray-400">
                  Miss rate: {counterfactualAnalysis.verdict.missRate}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Timing-Based Revenge Trade Analysis */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-white">Revenge Trade Analysis</h3>
          <p className="text-sm text-gray-400">Trades entered within 30 minutes of a loss</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-750 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-400 mb-3">Normal Trades</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Count</span>
                <span className="text-white font-medium">{revengeStats.normalTrades.count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Win Rate</span>
                <span className="text-white font-medium">{revengeStats.normalTrades.winRate.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Avg R</span>
                <span className={`font-medium ${revengeStats.normalTrades.avgR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {revengeStats.normalTrades.avgR.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total P&L</span>
                <span className={`font-medium ${revengeStats.normalTrades.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${revengeStats.normalTrades.totalPnl.toFixed(0)}
                </span>
              </div>
            </div>
          </div>
          <div className={`rounded-lg p-4 ${revengeStats.revengeTrades.count > 0 ? 'bg-red-500/10 border border-red-500/30' : 'bg-gray-750'}`}>
            <h4 className="text-sm font-medium text-red-400 mb-3">Revenge Trades</h4>
            {revengeStats.revengeTrades.count > 0 ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Count</span>
                  <span className="text-white font-medium">{revengeStats.revengeTrades.count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Win Rate</span>
                  <span className="text-white font-medium">{revengeStats.revengeTrades.winRate.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Avg R</span>
                  <span className={`font-medium ${revengeStats.revengeTrades.avgR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {revengeStats.revengeTrades.avgR.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Total P&L</span>
                  <span className={`font-medium ${revengeStats.revengeTrades.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${revengeStats.revengeTrades.totalPnl.toFixed(0)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No revenge trades detected</p>
            )}
          </div>
        </div>
      </div>

      {/* Performance After Wins vs Losses (Streak Analysis) */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-white">Performance After Wins vs Losses</h3>
          <p className="text-sm text-gray-400">How previous trade outcomes affect your next trade</p>
        </div>

        {streakData.some(d => d.count > 0) ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={streakData} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
              <YAxis
                stroke="#6b7280"
                fontSize={12}
                tickFormatter={(v) => v.toFixed(1) + 'R'}
              />
              <Tooltip
                {...CHART_TOOLTIP_STYLES}
                formatter={(value: number, name: string) => {
                  if (name === 'avgR') return [value.toFixed(2) + 'R', 'Avg R'];
                  return [value, name];
                }}
              />
              <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
              <Bar dataKey="avgR" name="avgR">
                {streakData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.avgR >= 0 ? '#22c55e' : '#ef4444'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[250px] flex items-center justify-center text-gray-500">
            Not enough trades for streak analysis
          </div>
        )}

        {streakData.some(d => d.count > 0) && (
          <div className="flex justify-center gap-6 mt-2 text-xs">
            {streakData.map(d => (
              <span key={d.name} className="text-gray-400">
                {d.name}: {d.count} trades
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Trades Per Day Analysis */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-white">Trades Per Day Analysis</h3>
          <p className="text-sm text-gray-400">Find your optimal daily trade count</p>
        </div>

        {tradesPerDay.points.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ left: 10, right: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  type="number"
                  dataKey="tradeCount"
                  name="Trades"
                  stroke="#6b7280"
                  fontSize={12}
                  label={{ value: 'Trades per Day', position: 'bottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="avgR"
                  name="Avg R"
                  stroke="#6b7280"
                  fontSize={12}
                  tickFormatter={(v) => v.toFixed(1) + 'R'}
                />
                <ZAxis range={[50, 200]} dataKey="totalPnl" />
                <Tooltip
                  {...CHART_TOOLTIP_STYLES}
                  formatter={(value: number, name: string) => {
                    if (name === 'Avg R') return [value.toFixed(2) + 'R', name];
                    if (name === 'Trades') return [value, name];
                    return ['$' + value.toFixed(0), 'P&L'];
                  }}
                  labelFormatter={(_label, payload) => {
                    const data = payload as Array<{ payload?: { date?: string } }>;
                    return data[0]?.payload?.date || '';
                  }}
                />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <ReferenceLine
                  x={tradesPerDay.optimalTradeCount}
                  stroke="#22c55e"
                  strokeDasharray="5 5"
                  label={{ value: 'Optimal', fill: '#22c55e', fontSize: 10 }}
                />
                {tradesPerDay.overtradeThreshold < 10 && (
                  <ReferenceLine
                    x={tradesPerDay.overtradeThreshold}
                    stroke="#ef4444"
                    strokeDasharray="5 5"
                    label={{ value: 'Overtrade', fill: '#ef4444', fontSize: 10 }}
                  />
                )}
                <Scatter
                  data={tradesPerDay.points}
                  fill="#3b82f6"
                >
                  {tradesPerDay.points.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.avgR >= 0 ? '#22c55e' : '#ef4444'}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-400">Optimal Trade Count</p>
                <p className="text-2xl font-bold text-green-400">{tradesPerDay.optimalTradeCount}</p>
                <p className="text-xs text-gray-500">trades/day</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-400">Overtrade Threshold</p>
                <p className="text-2xl font-bold text-red-400">{tradesPerDay.overtradeThreshold}+</p>
                <p className="text-xs text-gray-500">trades/day</p>
              </div>
            </div>
          </>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-gray-500">
            Not enough data for trades per day analysis
          </div>
        )}
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-400 mb-2">Behavioural Insights</h4>
          <ul className="space-y-2">
            {insights.map((insight, i) => (
              <li key={i} className="text-sm text-gray-300">{insight}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
