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
  getLevelTypeReactionStats,
  getPairwiseOrderAnalysis,
  getEntryDepthAnalysis,
  getLevelSequenceInsights,
  getZonePenetrationStats,
  getZoneEntryPlacementInsights,
  getLevelsInsideZonesAnalysis,
  getZonePenetrationInsights,
  CHART_TOOLTIP_STYLES,
} from '../../utils';
import { TradeListModal } from '../../components';

interface Props {
  trades: TradeRecord[];
}

type SortField = 'tag' | 'count' | 'winRate' | 'avgR' | 'profitFactor' | 'totalPnl';
type SortDirection = 'asc' | 'desc';

export function SetupPerformance({ trades }: Props) {
  const [sortField, setSortField] = useState<SortField>('totalPnl');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [tagDescriptions, setTagDescriptions] = useState<Record<string, string>>({});

  // Modal state for drill-down
  const [modalTrades, setModalTrades] = useState<TradeRecord[]>([]);
  const [modalTitle, setModalTitle] = useState('');

  // Load tag descriptions for tooltips
  useEffect(() => {
    const loadDescriptions = async () => {
      const glossaryTerms = await db.glossaryTerms.toArray();
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

  // Level Sequence Analytics
  const levelTypeStats = useMemo(() => getLevelTypeReactionStats(trades), [trades]);
  const pairwiseStats = useMemo(() => getPairwiseOrderAnalysis(trades), [trades]);
  const entryDepthAnalysis = useMemo(() => getEntryDepthAnalysis(trades), [trades]);
  const levelSequenceInsights = useMemo(
    () => getLevelSequenceInsights(levelTypeStats, pairwiseStats, entryDepthAnalysis),
    [levelTypeStats, pairwiseStats, entryDepthAnalysis]
  );

  // Zone Penetration Analytics
  const zonePenetrationStats = useMemo(() => getZonePenetrationStats(trades), [trades]);
  // Note: getPenetrationVsOutcome is available for scatter plot visualization
  const zoneEntryPlacement = useMemo(() => getZoneEntryPlacementInsights(trades), [trades]);
  const levelsInsideZones = useMemo(() => getLevelsInsideZonesAnalysis(trades), [trades]);
  const zonePenetrationInsights = useMemo(
    () => getZonePenetrationInsights(zonePenetrationStats, zoneEntryPlacement, levelsInsideZones),
    [zonePenetrationStats, zoneEntryPlacement, levelsInsideZones]
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
                {...CHART_TOOLTIP_STYLES}
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
          <p className="text-sm text-gray-400 mb-4">Do more confluences improve your results? Click a bar to see trades.</p>
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
                  {...CHART_TOOLTIP_STYLES}
                  formatter={(value: number, name: string) => [
                    name === 'avgR' ? value.toFixed(2) + 'R' : value,
                    name === 'avgR' ? 'Avg R' : 'Trades',
                  ]}
                />
                <ReferenceLine y={0} stroke="#6b7280" />
                <Bar
                  dataKey="avgR"
                  radius={[4, 4, 0, 0]}
                  className="cursor-pointer"
                  onClick={(data) => {
                    if (!data) return;
                    const bucket = data as { label: string };
                    const targetCount = bucket.label === '4+' ? 4 : parseInt(bucket.label);
                    const bucketTrades = trades.filter(t => {
                      if (t.status !== 'closed') return false;
                      const tagCount = (t.setupTags || []).length;
                      if (bucket.label === '4+') return tagCount >= 4;
                      return tagCount === targetCount;
                    });
                    setModalTitle(`${bucket.label} Tag${bucket.label === '1' ? '' : 's'} Confluence`);
                    setModalTrades(bucketTrades);
                  }}
                >
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

      {/* Section 4: Level Sequences Analysis */}
      {entryDepthAnalysis.tradesWithData > 0 && (
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Level Sequences</h3>
            <p className="text-sm text-gray-400">
              How price interacts with levels in your zones
            </p>
          </div>

          {/* Data count note */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-6">
            <p className="text-sm text-amber-400">
              Showing {entryDepthAnalysis.tradesWithData} of {entryDepthAnalysis.totalTrades} trades with level sequence data.
              {entryDepthAnalysis.tradesWithData < entryDepthAnalysis.totalTrades &&
                ' Log level sequences on more trades for better analysis.'}
            </p>
          </div>

          {/* Level Type × Timeframe Reaction Table */}
          {levelTypeStats.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Level Type × Timeframe Reactions</h4>
              <p className="text-xs text-gray-500 mb-3">Which of your level types actually hold?</p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-750">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Level</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Count</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">
                        <span className="text-green-400">Bounced</span>
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">
                        <span className="text-blue-400">Front-run</span>
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">
                        <span className="text-amber-400">Swept</span>
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">
                        <span className="text-red-400">Broken</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {levelTypeStats.slice(0, 10).map((stat) => (
                      <tr
                        key={stat.key}
                        className={`border-b border-gray-700 hover:bg-gray-750 ${stat.count < 5 ? 'opacity-50' : ''}`}
                      >
                        <td className="px-4 py-2 text-sm font-medium text-white">{stat.key}</td>
                        <td className="px-4 py-2 text-sm text-gray-300 text-right">
                          {stat.count}
                          {stat.count < 5 && <span className="text-gray-500 ml-1">*</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-green-400 text-right">
                          {stat.bouncedPercent.toFixed(0)}%
                        </td>
                        <td className="px-4 py-2 text-sm text-blue-400 text-right">
                          {stat.frontRunPercent.toFixed(0)}%
                        </td>
                        <td className="px-4 py-2 text-sm text-amber-400 text-right">
                          {stat.sweptPercent.toFixed(0)}%
                        </td>
                        <td className="px-4 py-2 text-sm text-red-400 text-right">
                          {stat.brokenPercent.toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {levelTypeStats.some(s => s.count < 5) && (
                <p className="text-xs text-gray-500 mt-2">* Low sample size - stats may not be reliable</p>
              )}
            </div>
          )}

          {/* Pairwise Order Analysis */}
          {pairwiseStats.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Pairwise Order Analysis</h4>
              <p className="text-xs text-gray-500 mb-3">
                When level A sits in front of level B, what happens?
              </p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-750">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Front Level</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Behind Level</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">n</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Front Holds</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Behind Holds</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Both Broken</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairwiseStats.slice(0, 8).map((stat, idx) => (
                      <tr
                        key={idx}
                        className={`border-b border-gray-700 hover:bg-gray-750 ${stat.count < 5 ? 'opacity-50' : ''}`}
                      >
                        <td className="px-4 py-2 text-sm text-gray-300">{stat.frontLevel}</td>
                        <td className="px-4 py-2 text-sm text-gray-300">{stat.behindLevel}</td>
                        <td className="px-4 py-2 text-sm text-gray-400 text-right">
                          {stat.count}
                          {stat.count < 5 && <span className="text-gray-500 ml-1">*</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-green-400 text-right">
                          {stat.frontHoldsPercent.toFixed(0)}%
                        </td>
                        <td className="px-4 py-2 text-sm text-blue-400 text-right">
                          {stat.behindHoldsPercent.toFixed(0)}%
                        </td>
                        <td className="px-4 py-2 text-sm text-red-400 text-right">
                          {stat.bothBrokenPercent.toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pairwiseStats.some(s => s.count < 5) && (
                <p className="text-xs text-gray-500 mt-2">* Low sample size (n &lt; 5) - stats may not be reliable</p>
              )}
            </div>
          )}

          {/* Entry Depth Analysis */}
          {entryDepthAnalysis.depthDistribution.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Entry Depth Analysis</h4>
              <p className="text-xs text-gray-500 mb-4">
                Where does price actually turn vs. where do you enter?
              </p>

              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-gray-750 rounded-lg p-4">
                  <p className="text-xs text-gray-400">Avg Turn Position</p>
                  <p className="text-xl font-bold text-blue-400">
                    {entryDepthAnalysis.avgTurnPosition.toFixed(1)}
                  </p>
                  <p className="text-xs text-gray-500">level in sequence</p>
                </div>
                <div className="bg-gray-750 rounded-lg p-4">
                  <p className="text-xs text-gray-400">Avg Entry Position</p>
                  <p className="text-xl font-bold text-amber-400">
                    {entryDepthAnalysis.avgEntryPosition.toFixed(1)}
                  </p>
                  <p className="text-xs text-gray-500">level in sequence</p>
                </div>
                <div className="bg-gray-750 rounded-lg p-4">
                  <p className="text-xs text-gray-400">Position Gap</p>
                  <p className={`text-xl font-bold ${entryDepthAnalysis.positionGap > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {entryDepthAnalysis.positionGap > 0 ? '+' : ''}{entryDepthAnalysis.positionGap.toFixed(1)}
                  </p>
                  <p className="text-xs text-gray-500">{entryDepthAnalysis.positionGap > 0 ? 'entering too shallow' : 'well-timed'}</p>
                </div>
                <div className="bg-gray-750 rounded-lg p-4">
                  <p className="text-xs text-gray-400">Could Improve</p>
                  <p className="text-xl font-bold text-purple-400">
                    {entryDepthAnalysis.couldImprovePercent.toFixed(0)}%
                  </p>
                  <p className="text-xs text-gray-500">of trades</p>
                </div>
              </div>

              {/* Turn Depth Distribution */}
              <div className="mb-4">
                <p className="text-xs text-gray-400 mb-2">Turn Depth Distribution</p>
                <div className="flex gap-2">
                  {entryDepthAnalysis.depthDistribution.filter(d => d.turnCount > 0 || d.entryCount > 0).slice(0, 5).map((d) => (
                    <div key={d.position} className="flex-1 text-center">
                      <div className="text-xs text-gray-500 mb-1">{d.position === 1 ? '1st' : d.position === 2 ? '2nd' : d.position === 3 ? '3rd' : `${d.position}th`}</div>
                      <div className="relative h-24 bg-gray-700 rounded overflow-hidden">
                        {/* Turn bar */}
                        <div
                          className="absolute bottom-0 left-0 w-1/2 bg-blue-500"
                          style={{ height: `${d.turnPercent}%` }}
                        />
                        {/* Entry bar */}
                        <div
                          className="absolute bottom-0 right-0 w-1/2 bg-amber-500"
                          style={{ height: `${d.entryPercent}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        <span className="text-blue-400">{d.turnPercent.toFixed(0)}%</span>
                        {' / '}
                        <span className="text-amber-400">{d.entryPercent.toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center gap-4 mt-2 text-xs">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-blue-500 rounded" />
                    <span className="text-gray-400">Turns here</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-amber-500 rounded" />
                    <span className="text-gray-400">You enter here</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Level Sequence Insights */}
          {levelSequenceInsights.length > 0 && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
              <h4 className="text-sm font-medium text-cyan-400 mb-2">Level Sequence Insights</h4>
              <ul className="space-y-1">
                {levelSequenceInsights.map((insight, i) => (
                  <li key={i} className="text-sm text-gray-300">{insight}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Section 5: Zone Penetration Analysis */}
      {zonePenetrationStats.zonesWithPenetration > 0 && (
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Zone Penetration</h3>
            <p className="text-sm text-gray-400">
              How deep does price penetrate into your zones before turning?
            </p>
          </div>

          {/* Zone Penetration Distribution */}
          {zonePenetrationStats.overall.some(b => b.count > 0) && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Penetration Distribution</h4>
              <p className="text-xs text-gray-500 mb-3">
                Based on {zonePenetrationStats.zonesWithPenetration} zones with penetration data. Click a bar to see trades.
              </p>
              <div className="flex gap-2 h-24">
                {zonePenetrationStats.overall.map((bucket) => (
                  <div
                    key={bucket.bucket}
                    className="flex-1 flex flex-col items-center cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => {
                      const bucketTrades = trades.filter(t => {
                        if (t.status !== 'closed' || !t.levelSequence) return false;
                        return t.levelSequence.some(level =>
                          level.penetrationPercent !== null &&
                          level.penetrationPercent !== undefined &&
                          level.penetrationPercent >= bucket.bucketMin &&
                          level.penetrationPercent < bucket.bucketMax
                        );
                      });
                      setModalTitle(`Zone Penetration: ${bucket.bucket}`);
                      setModalTrades(bucketTrades);
                    }}
                  >
                    <div className="flex-1 w-full flex items-end justify-center">
                      <div
                        className={`w-full max-w-12 rounded-t ${
                          bucket.bucketMax <= 25 ? 'bg-green-500' :
                          bucket.bucketMax <= 50 ? 'bg-yellow-500' :
                          bucket.bucketMax <= 75 ? 'bg-orange-500' :
                          'bg-red-500'
                        }`}
                        style={{ height: `${Math.max(4, bucket.percent)}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{bucket.bucket}</div>
                    <div className="text-xs text-gray-500">{bucket.count}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Zone Type Breakdown */}
          {zonePenetrationStats.byType.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">By Zone Type</h4>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-750">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Zone Type</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Count</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Avg Penetration</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Held</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Broken</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zonePenetrationStats.byType.slice(0, 8).map((zt) => (
                      <tr
                        key={zt.zoneType}
                        className={`border-b border-gray-700 hover:bg-gray-750 ${zt.count < 5 ? 'opacity-50' : ''}`}
                      >
                        <td className="px-4 py-2 text-sm font-medium text-white">{zt.zoneType}</td>
                        <td className="px-4 py-2 text-sm text-gray-300 text-right">
                          {zt.count}
                          {zt.count < 5 && <span className="text-gray-500 ml-1">*</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-right">
                          <span className={`${
                            zt.avgPenetration >= 75 ? 'text-red-400' :
                            zt.avgPenetration >= 50 ? 'text-orange-400' :
                            zt.avgPenetration >= 25 ? 'text-yellow-400' :
                            'text-green-400'
                          }`}>
                            {zt.avgPenetration}%
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-green-400 text-right">{zt.heldCount}</td>
                        <td className="px-4 py-2 text-sm text-red-400 text-right">{zt.brokenCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {zonePenetrationStats.byType.some(zt => zt.count < 5) && (
                <p className="text-xs text-gray-500 mt-2">* Low sample size (n &lt; 5) - stats may not be reliable</p>
              )}
            </div>
          )}

          {/* Entry Placement in Zones */}
          {zoneEntryPlacement.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Entry vs Turn Depth</h4>
              <p className="text-xs text-gray-500 mb-3">
                Where you enter vs where price typically turns in each zone type
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {zoneEntryPlacement.slice(0, 6).map((ep) => (
                  <div
                    key={ep.zoneType}
                    className={`bg-gray-750 rounded-lg p-3 ${ep.count < 5 ? 'opacity-50' : ''}`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-white">{ep.zoneType}</span>
                      <span className="text-xs text-gray-500">n={ep.count}</span>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <div>
                        <span className="text-xs text-gray-400">Entry:</span>
                        <span className="ml-1 text-amber-400">{ep.avgEntryDepthPercent}%</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400">Turn:</span>
                        <span className="ml-1 text-blue-400">{ep.avgTurnDepthPercent}%</span>
                      </div>
                      {ep.shouldEnterDeeper && ep.count >= 5 && (
                        <div className="text-xs text-yellow-400">
                          ↓ Enter {ep.potentialImprovement}% deeper
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Levels Inside Zones */}
          {levelsInsideZones.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Levels Inside Zones</h4>
              <p className="text-xs text-gray-500 mb-3">
                When a line level sits inside a zone, where does the turn happen?
              </p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-750">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Zone</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Inner Level</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">n</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Turn @ Inner</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Turn @ Edge</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Elsewhere</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levelsInsideZones.slice(0, 6).map((li, idx) => (
                      <tr
                        key={idx}
                        className={`border-b border-gray-700 hover:bg-gray-750 ${li.count < 5 ? 'opacity-50' : ''}`}
                      >
                        <td className="px-4 py-2 text-sm text-gray-300">{li.zoneType}</td>
                        <td className="px-4 py-2 text-sm text-gray-300">{li.innerLevelType}</td>
                        <td className="px-4 py-2 text-sm text-gray-400 text-right">
                          {li.count}
                          {li.count < 5 && <span className="text-gray-500 ml-1">*</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-green-400 text-right">
                          {li.turnAtInnerPercent.toFixed(0)}%
                        </td>
                        <td className="px-4 py-2 text-sm text-blue-400 text-right">
                          {li.turnAtZoneEdgePercent.toFixed(0)}%
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-400 text-right">
                          {li.turnElsewherePercent.toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {levelsInsideZones.some(li => li.count < 5) && (
                <p className="text-xs text-gray-500 mt-2">* Low sample size (n &lt; 5) - stats may not be reliable</p>
              )}
            </div>
          )}

          {/* Zone Penetration Insights */}
          {zonePenetrationInsights.length > 0 && (
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
              <h4 className="text-sm font-medium text-purple-400 mb-2">Zone Penetration Insights</h4>
              <ul className="space-y-1">
                {zonePenetrationInsights.map((insight, i) => (
                  <li key={i} className="text-sm text-gray-300">{insight}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-400 mb-2">Setup Tag Insights</h4>
          <ul className="space-y-1">
            {insights.map((insight, i) => (
              <li key={i} className="text-sm text-gray-300">
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Trade List Modal */}
      {modalTrades.length > 0 && (
        <TradeListModal
          title={modalTitle}
          trades={modalTrades}
          onClose={() => setModalTrades([])}
        />
      )}
    </div>
  );
}
