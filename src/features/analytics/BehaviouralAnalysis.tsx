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
  getEmotionalStateAnalysis,
  getPlanAdherenceAnalysis,
  getRevengeTradeAnalysis,
  getStreakAnalysis,
  getTradesPerDayAnalysis,
  getBehaviouralInsights,
  getEntryConfirmationAnalysis,
  CHART_TOOLTIP_STYLES,
} from '../../utils';

interface Props {
  trades: TradeRecord[];
}

// Gradient colors from green (calm) to red (anxious)
const EMOTIONAL_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'];

export function BehaviouralAnalysis({ trades }: Props) {
  const emotionalStats = useMemo(() => getEmotionalStateAnalysis(trades), [trades]);
  const planAdherence = useMemo(() => getPlanAdherenceAnalysis(trades), [trades]);
  const revengeStats = useMemo(() => getRevengeTradeAnalysis(trades), [trades]);
  const streakAnalysis = useMemo(() => getStreakAnalysis(trades), [trades]);
  const tradesPerDay = useMemo(() => getTradesPerDayAnalysis(trades), [trades]);
  const entryConfirmationStats = useMemo(() => getEntryConfirmationAnalysis(trades), [trades]);
  const insights = useMemo(
    () => getBehaviouralInsights(emotionalStats, planAdherence, revengeStats, streakAnalysis, tradesPerDay, entryConfirmationStats),
    [emotionalStats, planAdherence, revengeStats, streakAnalysis, tradesPerDay, entryConfirmationStats]
  );

  const closedTrades = trades.filter(t => t.status === 'closed');

  if (closedTrades.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No closed trades to analyze.</p>
      </div>
    );
  }

  // Prepare plan adherence comparison data
  const planComparisonData = [
    {
      name: 'Win Rate',
      followed: planAdherence.followed.winRate,
      deviated: planAdherence.deviated.winRate,
    },
    {
      name: 'Avg R',
      followed: planAdherence.followed.avgR,
      deviated: planAdherence.deviated.avgR,
    },
    {
      name: 'Profit Factor',
      followed: Math.min(planAdherence.followed.profitFactor, 5),
      deviated: Math.min(planAdherence.deviated.profitFactor, 5),
    },
  ];

  // Prepare streak analysis data
  const streakData = [
    { name: 'After Win', avgR: streakAnalysis.afterWin.avgR, count: streakAnalysis.afterWin.count },
    { name: 'After Loss', avgR: streakAnalysis.afterLoss.avgR, count: streakAnalysis.afterLoss.count },
    { name: 'After 2+ Wins', avgR: streakAnalysis.afterWinStreak.avgR, count: streakAnalysis.afterWinStreak.count },
    { name: 'After 2+ Losses', avgR: streakAnalysis.afterLossStreak.avgR, count: streakAnalysis.afterLossStreak.count },
  ];

  return (
    <div className="space-y-6">
      {/* Emotional State Performance */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-white">Emotional State Performance</h3>
          <p className="text-sm text-gray-400">How your emotional state affects trading results</p>
        </div>
        {emotionalStats.some(s => s.count > 0) ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={emotionalStats} margin={{ left: 10, right: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#6b7280"
                fontSize={12}
                angle={-20}
                textAnchor="end"
                height={60}
              />
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
                labelFormatter={(label) => label}
              />
              <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
              <Bar dataKey="avgR" name="avgR">
                {emotionalStats.map((_entry, index) => (
                  <Cell key={`cell-${index}`} fill={EMOTIONAL_COLORS[index]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-gray-500">
            No emotional state data recorded
          </div>
        )}
        {emotionalStats.some(s => s.count > 0) && (
          <div className="flex justify-center gap-4 mt-4 flex-wrap">
            {emotionalStats.map((stat, i) => (
              <div key={stat.label} className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: EMOTIONAL_COLORS[i] }} />
                <span className="text-gray-400">{stat.label}: {stat.count} trades</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Plan Adherence */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-white">Plan Adherence</h3>
          <p className="text-sm text-gray-400">Impact of following vs deviating from your trading plan</p>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <h4 className="text-sm font-medium text-green-400 mb-3">Followed Plan</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-500">Trades</p>
                <p className="text-lg font-bold text-white">{planAdherence.followed.count}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Win Rate</p>
                <p className="text-lg font-bold text-white">{planAdherence.followed.winRate.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Avg R</p>
                <p className="text-lg font-bold text-white">{planAdherence.followed.avgR.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">P&L</p>
                <p className={`text-lg font-bold ${planAdherence.followed.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${planAdherence.followed.totalPnl.toFixed(0)}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <h4 className="text-sm font-medium text-red-400 mb-3">Deviated</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-500">Trades</p>
                <p className="text-lg font-bold text-white">{planAdherence.deviated.count}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Win Rate</p>
                <p className="text-lg font-bold text-white">{planAdherence.deviated.winRate.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Avg R</p>
                <p className="text-lg font-bold text-white">{planAdherence.deviated.avgR.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">P&L</p>
                <p className={`text-lg font-bold ${planAdherence.deviated.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${planAdherence.deviated.totalPnl.toFixed(0)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Comparison Chart */}
        {(planAdherence.followed.count > 0 || planAdherence.deviated.count > 0) && (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={planComparisonData} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip
                {...CHART_TOOLTIP_STYLES}
              />
              <Bar dataKey="followed" fill="#22c55e" name="Followed Plan" />
              <Bar dataKey="deviated" fill="#ef4444" name="Deviated" />
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* Deviation Reasons */}
        {planAdherence.deviationReasons.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-400 mb-2">Common Deviation Reasons</h4>
            <div className="bg-gray-750 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-2 px-3 text-gray-400 font-medium">Reason</th>
                    <th className="text-right py-2 px-3 text-gray-400 font-medium">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {planAdherence.deviationReasons.slice(0, 5).map((item, i) => (
                    <tr key={i} className="border-b border-gray-700/50 last:border-0">
                      <td className="py-2 px-3 text-gray-300">{item.reason}</td>
                      <td className="py-2 px-3 text-right text-white">{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Revenge Trade Analysis */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-white">Revenge Trade Analysis</h3>
          <p className="text-sm text-gray-400">Impact of revenge trading on your results</p>
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
              <p className="text-gray-500 text-sm">No revenge trades recorded</p>
            )}
          </div>
        </div>
      </div>

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
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Avg 1st Touch</th>
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
                      {stat.avgFirstTouchAdverse !== null
                        ? stat.avgFirstTouchAdverse.toFixed(2) + 'R'
                        : '-'}
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
        </div>
      )}

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
