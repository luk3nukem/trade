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
  ReferenceLine,
} from 'recharts';
import type { TradeRecord } from '../../types';
import {
  getMarketConditionAnalysis,
  getHTFBiasAnalysis,
  getContextHeatmapData,
  getMarketContextInsights,
} from '../../utils';

interface Props {
  trades: TradeRecord[];
}

// Color scale for heatmap (red to green)
function getHeatmapColor(avgR: number): string {
  if (avgR >= 1) return '#22c55e';
  if (avgR >= 0.5) return '#4ade80';
  if (avgR >= 0) return '#86efac';
  if (avgR >= -0.5) return '#fca5a5';
  if (avgR >= -1) return '#f87171';
  return '#ef4444';
}

const ALIGNMENT_LABELS: Record<string, string> = {
  with: 'With HTF',
  against: 'Against HTF',
  neutral: 'Neutral/None',
};

export function MarketContext({ trades }: Props) {
  const conditionStats = useMemo(() => getMarketConditionAnalysis(trades), [trades]);
  const biasStats = useMemo(() => getHTFBiasAnalysis(trades), [trades]);
  const heatmapData = useMemo(() => getContextHeatmapData(trades), [trades]);
  const insights = useMemo(
    () => getMarketContextInsights(conditionStats, biasStats),
    [conditionStats, biasStats]
  );

  const closedTrades = trades.filter(t => t.status === 'closed');

  if (closedTrades.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No closed trades to analyze.</p>
      </div>
    );
  }

  // Prepare bias data for chart
  const biasChartData = biasStats.map(b => ({
    name: ALIGNMENT_LABELS[b.alignment],
    avgR: b.avgR,
    winRate: b.winRate,
    count: b.count,
  }));

  // Get unique conditions and alignments for heatmap
  const conditions = [...new Set(heatmapData.map(d => d.condition))];
  const alignments = ['with', 'against', 'neutral'];

  // Build heatmap grid
  const heatmapGrid: Record<string, Record<string, { avgR: number; count: number } | null>> = {};
  for (const condition of conditions) {
    heatmapGrid[condition] = {};
    for (const alignment of alignments) {
      const cell = heatmapData.find(d => d.condition === condition && d.alignment === alignment);
      heatmapGrid[condition][alignment] = cell ? { avgR: cell.avgR, count: cell.count } : null;
    }
  }

  return (
    <div className="space-y-6">
      {/* HTF Market Condition Performance */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-white">HTF Market Condition Performance</h3>
          <p className="text-sm text-gray-400">How you perform in different higher timeframe market conditions</p>
        </div>

        {conditionStats.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={conditionStats} margin={{ left: 10, right: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis
                dataKey="condition"
                stroke="#6b7280"
                fontSize={12}
                angle={-20}
                textAnchor="end"
                height={60}
                tickFormatter={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
              />
              <YAxis
                stroke="#6b7280"
                fontSize={12}
                tickFormatter={(v) => v.toFixed(1) + 'R'}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                formatter={(value: number, name: string) => {
                  if (name === 'avgR') return [value.toFixed(2) + 'R', 'Avg R'];
                  if (name === 'winRate') return [value.toFixed(1) + '%', 'Win Rate'];
                  return [value, name];
                }}
                labelFormatter={(label) => label.charAt(0).toUpperCase() + label.slice(1)}
              />
              <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
              <Bar dataKey="avgR" name="avgR">
                {conditionStats.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.avgR >= 0 ? '#22c55e' : '#ef4444'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-gray-500">
            No market condition data recorded
          </div>
        )}

        {conditionStats.length > 0 && (
          <div className="flex justify-center gap-4 mt-2 flex-wrap text-xs">
            {conditionStats.map(stat => (
              <span key={stat.condition} className="text-gray-400">
                {stat.condition.charAt(0).toUpperCase() + stat.condition.slice(1)}: {stat.count} trades ({stat.winRate.toFixed(0)}% WR)
              </span>
            ))}
          </div>
        )}
      </div>

      {/* HTF Bias Alignment */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-white">HTF Bias Alignment</h3>
          <p className="text-sm text-gray-400">Performance when trading with vs against higher timeframe bias</p>
        </div>

        {biasStats.some(b => b.count > 0) ? (
          <>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={biasChartData} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
                <YAxis
                  stroke="#6b7280"
                  fontSize={12}
                  tickFormatter={(v) => v.toFixed(1) + 'R'}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'avgR') return [value.toFixed(2) + 'R', 'Avg R'];
                    if (name === 'winRate') return [value.toFixed(1) + '%', 'Win Rate'];
                    return [value, name];
                  }}
                />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Bar dataKey="avgR" name="avgR">
                  {biasChartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.avgR >= 0 ? '#22c55e' : '#ef4444'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Stat cards for bias */}
            <div className="grid grid-cols-3 gap-4 mt-4">
              {biasStats.map(stat => (
                <div
                  key={stat.alignment}
                  className={`rounded-lg p-3 ${
                    stat.alignment === 'with'
                      ? 'bg-green-500/10 border border-green-500/30'
                      : stat.alignment === 'against'
                      ? 'bg-red-500/10 border border-red-500/30'
                      : 'bg-gray-750'
                  }`}
                >
                  <h4 className="text-xs font-medium text-gray-400 mb-2">
                    {ALIGNMENT_LABELS[stat.alignment]}
                  </h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Trades</span>
                      <span className="text-white">{stat.count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Win Rate</span>
                      <span className="text-white">{stat.winRate.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Avg R</span>
                      <span className={stat.avgR >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {stat.avgR.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="h-[250px] flex items-center justify-center text-gray-500">
            No HTF bias data recorded
          </div>
        )}
      </div>

      {/* Combined Context Heatmap */}
      {conditions.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Combined Context Heatmap</h3>
            <p className="text-sm text-gray-400">
              Best and worst combinations of market condition and HTF alignment
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Condition</th>
                  {alignments.map(alignment => (
                    <th key={alignment} className="text-center py-3 px-4 text-gray-400 font-medium">
                      {ALIGNMENT_LABELS[alignment]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conditions.map(condition => (
                  <tr key={condition} className="border-b border-gray-700/50 last:border-0">
                    <td className="py-3 px-4 text-white font-medium">
                      {condition.charAt(0).toUpperCase() + condition.slice(1)}
                    </td>
                    {alignments.map(alignment => {
                      const cell = heatmapGrid[condition][alignment];
                      if (!cell) {
                        return (
                          <td key={alignment} className="py-3 px-4 text-center text-gray-600">
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={alignment} className="py-3 px-4 text-center">
                          <div
                            className="inline-flex flex-col items-center px-3 py-2 rounded"
                            style={{ backgroundColor: getHeatmapColor(cell.avgR) + '30' }}
                          >
                            <span
                              className="font-bold"
                              style={{ color: getHeatmapColor(cell.avgR) }}
                            >
                              {cell.avgR.toFixed(2)}R
                            </span>
                            <span className="text-xs text-gray-400">{cell.count} trades</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Heatmap legend */}
          <div className="flex justify-center items-center gap-2 mt-4 text-xs">
            <span className="text-gray-400">Worst</span>
            <div className="flex gap-1">
              <div className="w-6 h-4 rounded" style={{ backgroundColor: '#ef4444' }} />
              <div className="w-6 h-4 rounded" style={{ backgroundColor: '#f87171' }} />
              <div className="w-6 h-4 rounded" style={{ backgroundColor: '#fca5a5' }} />
              <div className="w-6 h-4 rounded" style={{ backgroundColor: '#86efac' }} />
              <div className="w-6 h-4 rounded" style={{ backgroundColor: '#4ade80' }} />
              <div className="w-6 h-4 rounded" style={{ backgroundColor: '#22c55e' }} />
            </div>
            <span className="text-gray-400">Best</span>
          </div>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-400 mb-2">Market Context Insights</h4>
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
