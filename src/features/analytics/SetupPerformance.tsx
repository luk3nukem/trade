import { useMemo, useState, useEffect } from 'react';
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
  LabelList,
} from 'recharts';
import type { TradeRecord } from '../../types';
import { db } from '../../db';
import {
  groupPerformanceByTag,
  getConfluenceCountAnalysis,
  getTagCombinationAnalysis,
  getSetupTagInsights,
} from '../../utils';

interface Props {
  trades: TradeRecord[];
}

type SortField = 'tag' | 'count' | 'winRate' | 'avgR' | 'profitFactor' | 'totalPnl';
type SortDirection = 'asc' | 'desc';

export function SetupPerformance({ trades }: Props) {
  const [sortField, setSortField] = useState<SortField>('totalPnl');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [tagDescriptions, setTagDescriptions] = useState<Record<string, string>>({});

  // Load tag descriptions for tooltips
  useEffect(() => {
    const loadDescriptions = async () => {
      const glossaryTerms = await db.glossary.toArray();
      const descMap: Record<string, string> = {};
      for (const term of glossaryTerms) {
        descMap[term.term] = term.definition;
      }
      setTagDescriptions(descMap);
    };
    loadDescriptions();
  }, []);

  const tagStats = useMemo(() => groupPerformanceByTag(trades), [trades]);
  const confluenceStats = useMemo(() => getConfluenceCountAnalysis(trades), [trades]);
  const combinationStats = useMemo(() => getTagCombinationAnalysis(trades, 3), [trades]);
  const insights = useMemo(
    () => getSetupTagInsights(tagStats, confluenceStats, combinationStats),
    [tagStats, confluenceStats, combinationStats]
  );

  const sortedTagStats = useMemo(() => {
    return [...tagStats].sort((a, b) => {
      let aVal: string | number = a[sortField as keyof typeof a] as string | number;
      let bVal: string | number = b[sortField as keyof typeof b] as string | number;

      if (sortField === 'tag') {
        aVal = a.tag;
        bVal = b.tag;
      }

      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal);
      }

      return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [tagStats, sortField, sortDirection]);

  const pnlChartData = useMemo(() => {
    return [...tagStats]
      .sort((a, b) => b.totalPnl - a.totalPnl)
      .slice(0, 10)
      .map((s) => ({
        tag: s.tag,
        pnl: s.totalPnl,
        count: s.count,
      }));
  }, [tagStats]);

  const confluenceChartData = useMemo(() => {
    return confluenceStats.map((c) => ({
      label: c.tagCount >= 4 ? '4+' : String(c.tagCount),
      avgR: c.avgR,
      count: c.tradeCount,
    }));
  }, [confluenceStats]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-gray-600 ml-1">↕</span>;
    return <span className="text-blue-400 ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const bestPnl = tagStats.length > 0 ? Math.max(...tagStats.map((s) => s.totalPnl)) : 0;
  const worstPnl = tagStats.length > 0 ? Math.min(...tagStats.map((s) => s.totalPnl)) : 0;

  // Find best combination for highlighting
  const bestCombination = combinationStats.length > 0 ? combinationStats[0] : null;

  if (tagStats.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No closed trades with setup tags to analyze.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section 1: Individual Tag Performance */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-700">
          <h3 className="text-lg font-medium text-white">Individual Tag Performance</h3>
          <p className="text-sm text-gray-400 mt-1">
            Which individual factors appear in your best trades?
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-750">
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-400 cursor-pointer hover:text-white"
                  onClick={() => handleSort('tag')}
                >
                  Tag <SortIcon field="tag" />
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-medium text-gray-400 cursor-pointer hover:text-white"
                  onClick={() => handleSort('count')}
                >
                  Trades <SortIcon field="count" />
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-medium text-gray-400 cursor-pointer hover:text-white"
                  onClick={() => handleSort('winRate')}
                >
                  Win Rate <SortIcon field="winRate" />
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-medium text-gray-400 cursor-pointer hover:text-white"
                  onClick={() => handleSort('avgR')}
                >
                  Avg R <SortIcon field="avgR" />
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-medium text-gray-400 cursor-pointer hover:text-white"
                  onClick={() => handleSort('profitFactor')}
                >
                  Profit Factor <SortIcon field="profitFactor" />
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-medium text-gray-400 cursor-pointer hover:text-white"
                  onClick={() => handleSort('totalPnl')}
                >
                  Total P&L <SortIcon field="totalPnl" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTagStats.map((stat) => {
                const isBest = stat.totalPnl === bestPnl && bestPnl > 0;
                const isWorst = stat.totalPnl === worstPnl && worstPnl < 0;
                const rowClass = isBest ? 'bg-green-500/10' : isWorst ? 'bg-red-500/10' : '';

                return (
                  <tr
                    key={stat.tag}
                    className={`border-b border-gray-700 hover:bg-gray-750 ${rowClass}`}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-white">
                      <span
                        className="inline-flex px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs cursor-help"
                        title={tagDescriptions[stat.tag] || undefined}
                      >
                        {stat.tag}
                      </span>
                      {isBest && <span className="ml-2 text-xs text-green-400">★ Best</span>}
                      {isWorst && <span className="ml-2 text-xs text-red-400">✗ Worst</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300 text-right">{stat.count}</td>
                    <td
                      className={`px-4 py-3 text-sm text-right ${stat.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {stat.winRate.toFixed(1)}%
                    </td>
                    <td
                      className={`px-4 py-3 text-sm text-right ${stat.avgR >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {stat.avgR >= 0 ? '+' : ''}
                      {stat.avgR.toFixed(2)}R
                    </td>
                    <td
                      className={`px-4 py-3 text-sm text-right ${stat.profitFactor >= 1 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {stat.profitFactor.toFixed(2)}
                    </td>
                    <td
                      className={`px-4 py-3 text-sm font-medium text-right ${stat.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {stat.totalPnl >= 0 ? '+' : ''}${stat.totalPnl.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* P&L by Tag */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-1">P&L by Tag</h3>
          <p className="text-sm text-gray-400 mb-4">Top 10 tags by total P&L</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={pnlChartData} layout="vertical" margin={{ left: 100, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={true} vertical={false} />
              <XAxis type="number" stroke="#6b7280" fontSize={12} tickFormatter={(v) => '$' + v} />
              <YAxis type="category" dataKey="tag" stroke="#6b7280" fontSize={11} width={95} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => ['$' + value.toFixed(2), 'Net P&L']}
              />
              <ReferenceLine x={0} stroke="#6b7280" />
              <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                {pnlChartData.map((entry, index) => (
                  <Cell key={index} fill={entry.pnl >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Confluence Count Analysis */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-1">Confluence Count Analysis</h3>
          <p className="text-sm text-gray-400 mb-4">Do more confluences improve your results?</p>
          {confluenceChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={confluenceChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#6b7280"
                  fontSize={12}
                  tickFormatter={(v) => v + ' tag' + (v === '1' ? '' : 's')}
                />
                <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => v + 'R'} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number, name: string) => [
                    name === 'avgR' ? value.toFixed(2) + 'R' : value,
                    name === 'avgR' ? 'Avg R' : 'Trades',
                  ]}
                />
                <ReferenceLine y={0} stroke="#6b7280" />
                <Bar dataKey="avgR" radius={[4, 4, 0, 0]}>
                  {confluenceChartData.map((entry, index) => (
                    <Cell key={index} fill={entry.avgR >= 0 ? '#22c55e' : '#ef4444'} />
                  ))}
                  <LabelList
                    dataKey="count"
                    position="top"
                    fill="#9ca3af"
                    fontSize={11}
                    formatter={(v: number) => v + ' trades'}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500">
              No trades with setup tags to analyze
            </div>
          )}
        </div>
      </div>

      {/* Section 3: Tag Combination Analysis */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-700">
          <h3 className="text-lg font-medium text-white">Tag Combination Analysis</h3>
          <p className="text-sm text-gray-400 mt-1">
            Which specific combinations have the highest edge? (Minimum 3 occurrences, 2+ tags)
          </p>
        </div>
        {combinationStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-750">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                    Combination
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Trades</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Win Rate</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Avg R</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">
                    Profit Factor
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Total P&L</th>
                </tr>
              </thead>
              <tbody>
                {combinationStats.map((stat) => {
                  const isBest = bestCombination && stat.combination === bestCombination.combination;

                  return (
                    <tr
                      key={stat.combination}
                      className={`border-b border-gray-700 hover:bg-gray-750 ${isBest ? 'bg-green-500/10' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {stat.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs cursor-help"
                              title={tagDescriptions[tag] || undefined}
                            >
                              {tag}
                            </span>
                          ))}
                          {isBest && <span className="ml-2 text-xs text-green-400">★ Best</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300 text-right">{stat.count}</td>
                      <td
                        className={`px-4 py-3 text-sm text-right ${stat.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {stat.winRate.toFixed(1)}%
                      </td>
                      <td
                        className={`px-4 py-3 text-sm text-right ${stat.avgR >= 0 ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {stat.avgR >= 0 ? '+' : ''}
                        {stat.avgR.toFixed(2)}R
                      </td>
                      <td
                        className={`px-4 py-3 text-sm text-right ${stat.profitFactor >= 1 ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {stat.profitFactor.toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-3 text-sm font-medium text-right ${stat.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {stat.totalPnl >= 0 ? '+' : ''}${stat.totalPnl.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            Need more trades with 2+ tags (at least 3 occurrences of a combination) for combination analysis.
          </div>
        )}
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-400 mb-2">Insights</h4>
          <ul className="space-y-1">
            {insights.map((insight, i) => (
              <li key={i} className="text-sm text-gray-300">
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
