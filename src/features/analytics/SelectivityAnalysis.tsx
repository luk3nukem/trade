import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { TradeRecord } from '../../types';
import {
  getSelectivityAnalysis,
  getSelectivityValue,
  getNotTakenReasonBreakdown,
  getMissedTradesByTag,
  getSelectivityInsights,
} from '../../utils';

interface Props {
  trades: TradeRecord[];
}

export function SelectivityAnalysis({ trades }: Props) {
  // Get missed trades
  const missedTrades = useMemo(() => trades.filter((t) => t.tradeTaken === false), [trades]);

  // Comparison stats
  const comparison = useMemo(() => getSelectivityAnalysis(trades), [trades]);

  // Selectivity value (only from missed trades with outcomes)
  const selectivityValue = useMemo(() => getSelectivityValue(missedTrades), [missedTrades]);

  // Reason breakdown
  const reasonBreakdown = useMemo(() => getNotTakenReasonBreakdown(missedTrades), [missedTrades]);

  // Missed trades by setup tag
  const missedByTag = useMemo(() => getMissedTradesByTag(missedTrades), [missedTrades]);

  // Insights
  const insights = useMemo(() => getSelectivityInsights(trades), [trades]);

  // Chart data for reason breakdown
  const reasonChartData = useMemo(() => {
    return reasonBreakdown.map((r) => ({
      reason: r.reason || 'No reason',
      count: r.count,
      winRate: r.winRate,
      totalR: r.totalR,
    }));
  }, [reasonBreakdown]);

  if (missedTrades.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <svg
          className="w-16 h-16 text-gray-600 mx-auto mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
        <h3 className="text-lg font-medium text-white mb-2">No Missed Trades Logged</h3>
        <p className="text-gray-400">
          Start logging missed trades to analyze your selectivity.
          <br />
          Toggle "Trade Taken" off when logging a trade you didn't take.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Selectivity Value Card */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-medium text-white mb-4">Selectivity Value</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="text-sm text-gray-400 mb-1">Missed Profit</p>
            <p className="text-2xl font-bold text-red-400">
              {selectivityValue.missedProfit.toFixed(2)}R
            </p>
            <p className="text-xs text-gray-500">
              From {selectivityValue.missedWinners} would-have-won trades
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-400 mb-1">Saved Losses</p>
            <p className="text-2xl font-bold text-green-400">
              {selectivityValue.savedLosses.toFixed(2)}R
            </p>
            <p className="text-xs text-gray-500">
              From {selectivityValue.avoidedLosers} avoided losses
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-400 mb-1">Net Selectivity</p>
            <p
              className={`text-2xl font-bold ${
                selectivityValue.netValue >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {selectivityValue.netValue >= 0 ? '+' : ''}
              {selectivityValue.netValue.toFixed(2)}R
            </p>
            <p className="text-xs text-gray-500">
              {selectivityValue.netValue >= 0 ? 'Filtering adds value' : 'Too cautious'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-400 mb-1">Missed Trades</p>
            <p className="text-2xl font-bold text-orange-400">{missedTrades.length}</p>
            <p className="text-xs text-gray-500">
              {selectivityValue.missedWithOutcome} with outcomes
            </p>
          </div>
        </div>
      </div>

      {/* Taken vs Missed Comparison */}
      {comparison && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Taken vs Missed Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Metric</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-green-400">
                    Taken
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-orange-400">
                    Missed
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-700">
                  <td className="px-4 py-3 text-sm text-gray-300">Trade Count</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-200">
                    {comparison.taken.count}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-200">
                    {comparison.missed.count}
                  </td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="px-4 py-3 text-sm text-gray-300">Win Rate</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-200">
                    {comparison.taken.winRate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-200">
                    {comparison.missed.winRate.toFixed(1)}%
                  </td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="px-4 py-3 text-sm text-gray-300">Avg R</td>
                  <td
                    className={`px-4 py-3 text-sm text-right ${
                      comparison.taken.avgR >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {comparison.taken.avgR >= 0 ? '+' : ''}
                    {comparison.taken.avgR.toFixed(2)}R
                  </td>
                  <td
                    className={`px-4 py-3 text-sm text-right ${
                      comparison.missed.avgR >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {comparison.missed.avgR >= 0 ? '+' : ''}
                    {comparison.missed.avgR.toFixed(2)}R
                  </td>
                </tr>
                <tr className="border-b border-gray-700">
                  <td className="px-4 py-3 text-sm text-gray-300">Profit Factor</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-200">
                    {comparison.taken.profitFactor === Infinity
                      ? '-'
                      : comparison.taken.profitFactor.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-200">
                    {comparison.missed.profitFactor === Infinity
                      ? '-'
                      : comparison.missed.profitFactor.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-300">Total R</td>
                  <td
                    className={`px-4 py-3 text-sm text-right font-medium ${
                      comparison.taken.totalR >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {comparison.taken.totalR >= 0 ? '+' : ''}
                    {comparison.taken.totalR.toFixed(2)}R
                  </td>
                  <td
                    className={`px-4 py-3 text-sm text-right font-medium ${
                      comparison.missed.totalR >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {comparison.missed.totalR >= 0 ? '+' : ''}
                    {comparison.missed.totalR.toFixed(2)}R
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reason Breakdown */}
      {reasonBreakdown.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Reason Breakdown</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bar Chart */}
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reasonChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis type="number" stroke="#9CA3AF" fontSize={12} />
                  <YAxis
                    type="category"
                    dataKey="reason"
                    stroke="#9CA3AF"
                    fontSize={12}
                    width={100}
                    tickFormatter={(value) =>
                      value.length > 12 ? value.slice(0, 12) + '...' : value
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1F2937',
                      border: 'none',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: '#F3F4F6' }}
                    formatter={(value: number, name: string) => {
                      if (name === 'count') return [value, 'Count'];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="count" fill="#F97316">
                    {reasonChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill="#F97316" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                      Reason
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">
                      Count
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">
                      Win Rate
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">
                      Total R
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reasonBreakdown.map((r) => (
                    <tr key={r.reason || 'none'} className="border-b border-gray-700">
                      <td className="px-3 py-2 text-sm text-gray-200">{r.reason || 'No reason'}</td>
                      <td className="px-3 py-2 text-sm text-right text-gray-200">{r.count}</td>
                      <td className="px-3 py-2 text-sm text-right text-gray-200">
                        {r.winRate.toFixed(1)}%
                      </td>
                      <td
                        className={`px-3 py-2 text-sm text-right font-medium ${
                          r.totalR >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {r.totalR >= 0 ? '+' : ''}
                        {r.totalR.toFixed(2)}R
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Missed Trades by Setup Tag */}
      {missedByTag.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Missed Trades by Setup Tag</h3>
          <p className="text-sm text-gray-400 mb-4">
            Tags with high win rates and positive R indicate setups you should be taking more
            often.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">
                    Setup Tag
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">
                    Missed
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">
                    Win Rate
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">
                    Avg R
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">
                    Total R
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-400">
                    Verdict
                  </th>
                </tr>
              </thead>
              <tbody>
                {missedByTag.map((tag) => (
                  <tr
                    key={tag.tag}
                    className={`border-b border-gray-700 ${
                      tag.winRate > 50 && tag.avgR > 0 ? 'bg-green-500/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-sm">
                        {tag.tag}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-200">{tag.count}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-200">
                      {tag.winRate.toFixed(1)}%
                    </td>
                    <td
                      className={`px-4 py-3 text-sm text-right ${
                        tag.avgR >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {tag.avgR >= 0 ? '+' : ''}
                      {tag.avgR.toFixed(2)}R
                    </td>
                    <td
                      className={`px-4 py-3 text-sm text-right font-medium ${
                        tag.totalR >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {tag.totalR >= 0 ? '+' : ''}
                      {tag.totalR.toFixed(2)}R
                    </td>
                    <td className="px-4 py-3 text-center">
                      {tag.winRate > 50 && tag.avgR > 0 ? (
                        <span className="inline-flex px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">
                          Take More
                        </span>
                      ) : tag.winRate < 40 || tag.avgR < 0 ? (
                        <span className="inline-flex px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">
                          Good Skip
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 bg-gray-500/20 text-gray-400 rounded text-xs">
                          Neutral
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-6">
          <h3 className="text-lg font-medium text-blue-400 mb-4">Selectivity Insights</h3>
          <ul className="space-y-3">
            {insights.map((insight, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-gray-200">{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
