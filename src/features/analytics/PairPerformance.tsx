import { useMemo, useState } from 'react';
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
import { groupPerformanceBy, getPairInsights, CHART_TOOLTIP_STYLES } from '../../utils';

interface Props {
  trades: TradeRecord[];
}

type SortField = 'group' | 'count' | 'winRate' | 'avgR' | 'profitFactor' | 'totalPnl';
type SortDirection = 'asc' | 'desc';

export function PairPerformance({ trades }: Props) {
  const [sortField, setSortField] = useState<SortField>('totalPnl');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const pairStats = useMemo(() => groupPerformanceBy(trades, 'pair'), [trades]);
  const insights = useMemo(() => getPairInsights(pairStats), [pairStats]);

  const sortedStats = useMemo(() => {
    return [...pairStats].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal);
      }

      return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [pairStats, sortField, sortDirection]);

  const chartData = useMemo(() => {
    return [...pairStats]
      .sort((a, b) => b.totalPnl - a.totalPnl)
      .map(s => ({
        pair: s.group,
        pnl: s.totalPnl,
        count: s.count,
      }));
  }, [pairStats]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-gray-600 ml-1">↕</span>;
    return <span className="text-blue-400 ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const bestPnl = Math.max(...pairStats.map(s => s.totalPnl));
  const worstPnl = Math.min(...pairStats.map(s => s.totalPnl));

  if (pairStats.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No closed trades to analyze.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Table */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-700">
          <h3 className="text-lg font-medium text-white">Performance by Pair</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-750">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('group')}>
                  Pair <SortIcon field="group" />
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('count')}>
                  Trades <SortIcon field="count" />
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('winRate')}>
                  Win Rate <SortIcon field="winRate" />
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('avgR')}>
                  Avg R <SortIcon field="avgR" />
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('profitFactor')}>
                  Profit Factor <SortIcon field="profitFactor" />
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('totalPnl')}>
                  Total P&L <SortIcon field="totalPnl" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedStats.map((stat) => {
                const isBest = stat.totalPnl === bestPnl && bestPnl > 0;
                const isWorst = stat.totalPnl === worstPnl && worstPnl < 0;
                const rowClass = isBest ? 'bg-green-500/10' : isWorst ? 'bg-red-500/10' : '';

                return (
                  <tr key={stat.group} className={`border-b border-gray-700 hover:bg-gray-750 ${rowClass}`}>
                    <td className="px-4 py-3 text-sm font-medium text-white">
                      {stat.group}
                      {isBest && <span className="ml-2 text-xs text-green-400">★ Best</span>}
                      {isWorst && <span className="ml-2 text-xs text-red-400">✗ Worst</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300 text-right">{stat.count}</td>
                    <td className={`px-4 py-3 text-sm text-right ${stat.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                      {stat.winRate.toFixed(1)}%
                    </td>
                    <td className={`px-4 py-3 text-sm text-right ${stat.avgR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {stat.avgR >= 0 ? '+' : ''}{stat.avgR.toFixed(2)}R
                    </td>
                    <td className={`px-4 py-3 text-sm text-right ${stat.profitFactor >= 1 ? 'text-green-400' : 'text-red-400'}`}>
                      {stat.profitFactor.toFixed(2)}
                    </td>
                    <td className={`px-4 py-3 text-sm font-medium text-right ${stat.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {stat.totalPnl >= 0 ? '+' : ''}${stat.totalPnl.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-medium text-white mb-4">Net P&L by Pair</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 60, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={true} vertical={false} />
            <XAxis type="number" stroke="#6b7280" fontSize={12} tickFormatter={(v) => '$' + v} />
            <YAxis type="category" dataKey="pair" stroke="#6b7280" fontSize={12} width={55} />
            <Tooltip
              {...CHART_TOOLTIP_STYLES}
              formatter={(value: number) => ['$' + value.toFixed(2), 'Net P&L']}
              labelFormatter={(label) => label}
            />
            <ReferenceLine x={0} stroke="#6b7280" />
            <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.pnl >= 0 ? '#22c55e' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-400 mb-2">Insights</h4>
          <ul className="space-y-1">
            {insights.map((insight, i) => (
              <li key={i} className="text-sm text-gray-300">{insight}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
