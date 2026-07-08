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
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import type { TradeRecord } from '../../types';
import {
  getMFECaptureData,
  getProfitGivebackData,
  getExitTypeComparison,
  getPartialsComparison,
  simulateExitStrategy,
  getExitManagementInsights,
  getPostTPBehaviourAnalysis,
  getBEJustificationAnalysis,
  getPostTPByTagAnalysis,
  getRetracementScatterData,
  getPostTPInsights,
  getPostExitAnalysis,
  getStopoutPostExitAnalysis,
  getVoluntaryExitPostExitAnalysis,
  getMissedRByStopReason,
  getMissedRByExitType,
  getPostExitScatterData,
  getPostExitInsights,
  type SimulationStrategy,
  type SimulationResult,
} from '../../utils';
import { useAppStore } from '../../stores/appStore';

interface Props {
  trades: TradeRecord[];
}

const STRATEGY_COLORS: Record<string, string> = {
  'Actual Results': '#3b82f6',
  'Full Exit at TP1': '#22c55e',
  '50% TP1, Trail Rest': '#f59e0b',
  '75% TP1, 25% Runner': '#8b5cf6',
  'Trailing Stop Only': '#ec4899',
};

export function ExitManagement({ trades }: Props) {
  const [activeStrategies, setActiveStrategies] = useState<SimulationStrategy[]>(['actual', 'full_tp1']);
  const [trailR, setTrailR] = useState(0.5);
  const { alertSettings } = useAppStore();
  const minRThreshold = alertSettings.minRThreshold ?? 1.0;

  const mfeCaptureData = useMemo(() => getMFECaptureData(trades), [trades]);
  const givebackData = useMemo(() => getProfitGivebackData(trades), [trades]);
  const exitTypeStats = useMemo(() => getExitTypeComparison(trades), [trades]);
  const partialsComparison = useMemo(() => getPartialsComparison(trades), [trades]);

  const simulations = useMemo(() => {
    const strategies: SimulationStrategy[] = ['actual', 'full_tp1', 'half_tp1_trail', 'three_quarter_runner', 'trailing_only'];
    const results: Record<SimulationStrategy, SimulationResult> = {} as Record<SimulationStrategy, SimulationResult>;
    for (const s of strategies) {
      results[s] = simulateExitStrategy(trades, s, trailR);
    }
    return results;
  }, [trades, trailR]);

  const insights = useMemo(
    () => getExitManagementInsights(mfeCaptureData, givebackData, partialsComparison),
    [mfeCaptureData, givebackData, partialsComparison]
  );

  // Post-TP Behaviour analysis
  const postTPAnalysis = useMemo(() => getPostTPBehaviourAnalysis(trades), [trades]);
  const beAnalysis = useMemo(() => getBEJustificationAnalysis(trades), [trades]);
  const postTPByTag = useMemo(() => getPostTPByTagAnalysis(trades), [trades]);
  const retracementScatter = useMemo(() => getRetracementScatterData(trades), [trades]);
  const postTPInsights = useMemo(() => getPostTPInsights(trades), [trades]);

  // Post-Exit Tracking analysis
  const postExitAnalysis = useMemo(() => getPostExitAnalysis(trades), [trades]);
  const stopoutAnalysis = useMemo(() => getStopoutPostExitAnalysis(trades, minRThreshold), [trades, minRThreshold]);
  const voluntaryExitAnalysis = useMemo(() => getVoluntaryExitPostExitAnalysis(trades), [trades]);
  const missedRByStopReason = useMemo(() => getMissedRByStopReason(trades), [trades]);
  const missedRByExitType = useMemo(() => getMissedRByExitType(trades), [trades]);
  const postExitScatter = useMemo(() => getPostExitScatterData(trades), [trades]);
  const postExitInsights = useMemo(() => getPostExitInsights(trades, minRThreshold), [trades, minRThreshold]);

  const combinedEquityCurve = useMemo(() => {
    if (!simulations.actual) return [];
    return simulations.actual.equityCurve.map((point, i) => {
      const combined: Record<string, number> = { tradeIndex: point.tradeIndex };
      for (const strategy of activeStrategies) {
        const sim = simulations[strategy];
        if (sim && sim.equityCurve[i]) {
          combined[sim.strategyName] = sim.equityCurve[i].cumulative;
        }
      }
      return combined;
    });
  }, [simulations, activeStrategies]);

  const tradesWithMFE = trades.filter(t => t.status === 'closed' && t.mfeR !== undefined).length;
  const totalClosed = trades.filter(t => t.status === 'closed').length;
  const tradesWithDrawdownData = trades.filter(
    t => t.status === 'closed' && t.exits && t.exits.length > 1 && t.exits.some(e => e.drawdownAfter != null)
  ).length;

  const toggleStrategy = (strategy: SimulationStrategy) => {
    setActiveStrategies(prev => {
      if (prev.includes(strategy)) {
        return prev.filter(s => s !== strategy);
      }
      return [...prev, strategy];
    });
  };

  if (totalClosed === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No closed trades to analyze.</p>
      </div>
    );
  }

  const bestExitType = exitTypeStats.length > 0 ? exitTypeStats[0] : null;

  return (
    <div className="space-y-6">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <p className="text-sm text-amber-400">
          Showing {tradesWithMFE} of {totalClosed} trades (only trades with MFE data).
          {tradesWithMFE < totalClosed && ' Log MFE on more trades to improve analysis.'}
        </p>
      </div>

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-700">
          <h3 className="text-lg font-medium text-white">Exit Strategy Comparison</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-750">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Exit Type</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Trades</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Win Rate</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Avg R</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">MFE Capture</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Profit Factor</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Total P&L</th>
              </tr>
            </thead>
            <tbody>
              {exitTypeStats.map((stat) => {
                const isBest = bestExitType && stat.exitType === bestExitType.exitType && stat.totalPnl > 0;
                const rowBg = isBest ? 'bg-green-500/10' : '';
                const winRateColor = stat.winRate >= 50 ? 'text-green-400' : 'text-red-400';
                const avgRColor = stat.avgR >= 0 ? 'text-green-400' : 'text-red-400';
                const pfColor = stat.profitFactor >= 1 ? 'text-green-400' : 'text-red-400';
                const pnlColor = stat.totalPnl >= 0 ? 'text-green-400' : 'text-red-400';
                
                return (
                  <tr key={stat.exitType} className={`border-b border-gray-700 hover:bg-gray-750 ${rowBg}`}>
                    <td className="px-4 py-3 text-sm font-medium text-white">
                      {stat.exitType}
                      {isBest && <span className="ml-2 text-xs text-green-400">★ Best</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300 text-right">{stat.count}</td>
                    <td className={`px-4 py-3 text-sm text-right ${winRateColor}`}>{stat.winRate.toFixed(1)}%</td>
                    <td className={`px-4 py-3 text-sm text-right ${avgRColor}`}>
                      {stat.avgR >= 0 ? '+' : ''}{stat.avgR.toFixed(2)}R
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-300">{stat.avgMFECapture.toFixed(0)}%</td>
                    <td className={`px-4 py-3 text-sm text-right ${pfColor}`}>{stat.profitFactor.toFixed(2)}</td>
                    <td className={`px-4 py-3 text-sm font-medium text-right ${pnlColor}`}>
                      {stat.totalPnl >= 0 ? '+' : ''}${stat.totalPnl.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">MFE vs Exit</h3>
            <p className="text-sm text-gray-400">Diagonal = perfect exit at the high</p>
          </div>
          {mfeCaptureData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ left: 10, right: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" dataKey="mfeR" name="MFE" stroke="#6b7280" fontSize={12}
                  tickFormatter={(v) => v.toFixed(1) + 'R'}
                  label={{ value: 'MFE (R)', position: 'bottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis type="number" dataKey="exitR" name="Exit" stroke="#6b7280" fontSize={12}
                  tickFormatter={(v) => v.toFixed(1) + 'R'}
                />
                <ZAxis range={[40, 40]} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  formatter={(value: number, name: string) => [value.toFixed(2) + 'R', name]}
                  labelFormatter={(_, payload) => {
                    const p = payload[0]?.payload;
                    return p ? p.pair + ' (' + p.exitType + ')' : '';
                  }}
                />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 4, y: 4 }]} stroke="#6b7280" strokeDasharray="5 5" />
                <Scatter data={mfeCaptureData.filter(d => d.exitType === 'partial')} fill="#f59e0b" name="Partials" />
                <Scatter data={mfeCaptureData.filter(d => d.exitType !== 'partial')} fill="#3b82f6" name="Full Exits" />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500">No MFE capture data available</div>
          )}
          <div className="flex justify-center gap-4 mt-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="text-gray-400">Partials</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-gray-400">Full Exits</span>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Profit Giveback</h3>
            <p className="text-sm text-gray-400">Avg giveback: {givebackData.avgGiveback.toFixed(2)}R per winning trade</p>
          </div>
          {givebackData.buckets.some(b => b.count > 0) ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={givebackData.buckets} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  formatter={(value: number) => [value + ' trades', 'Count']}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {givebackData.buckets.map((_, index) => (
                    <Cell key={index} fill={index < 2 ? '#22c55e' : index < 4 ? '#f59e0b' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500">No profit giveback data</div>
          )}
        </div>
      </div>

      {partialsComparison && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Partials vs Full Exits</h3>
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-gray-750 rounded-lg p-4">
              <h4 className="text-sm font-medium text-amber-400 mb-3">With Partials ({partialsComparison.withPartials.count} trades)</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg R</span>
                  <span className={partialsComparison.withPartials.avgR >= 0 ? 'font-medium text-green-400' : 'font-medium text-red-400'}>
                    {partialsComparison.withPartials.avgR.toFixed(2)}R
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Win Rate</span>
                  <span className="text-white">{partialsComparison.withPartials.winRate.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Profit Factor</span>
                  <span className="text-white">{partialsComparison.withPartials.profitFactor.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">MFE Capture</span>
                  <span className="text-white">{partialsComparison.withPartials.avgMFECapture.toFixed(0)}%</span>
                </div>
              </div>
            </div>
            <div className="bg-gray-750 rounded-lg p-4">
              <h4 className="text-sm font-medium text-blue-400 mb-3">Without Partials ({partialsComparison.withoutPartials.count} trades)</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg R</span>
                  <span className={partialsComparison.withoutPartials.avgR >= 0 ? 'font-medium text-green-400' : 'font-medium text-red-400'}>
                    {partialsComparison.withoutPartials.avgR.toFixed(2)}R
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Win Rate</span>
                  <span className="text-white">{partialsComparison.withoutPartials.winRate.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Profit Factor</span>
                  <span className="text-white">{partialsComparison.withoutPartials.profitFactor.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">MFE Capture</span>
                  <span className="text-white">{partialsComparison.withoutPartials.avgMFECapture.toFixed(0)}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gray-800 rounded-lg p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-white">"What If" Exit Simulator</h3>
          <p className="text-sm text-gray-400">Compare different exit strategies retroactively applied to your trade history</p>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(simulations).map(([key, sim]) => {
            const isActive = activeStrategies.includes(key as SimulationStrategy);
            const color = STRATEGY_COLORS[sim.strategyName];
            return (
              <button
                key={key}
                onClick={() => toggleStrategy(key as SimulationStrategy)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'ring-2 ring-offset-2 ring-offset-gray-800' : 'opacity-50 hover:opacity-75'}`}
                style={{
                  backgroundColor: isActive ? color + '33' : '#374151',
                  color: color,
                }}
              >
                {sim.strategyName}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 mb-4 p-3 bg-gray-750 rounded-lg">
          <label className="text-sm text-gray-400 whitespace-nowrap">Trail Distance:</label>
          <input
            type="range"
            min="0.25"
            max="1.5"
            step="0.25"
            value={trailR}
            onChange={(e) => setTrailR(parseFloat(e.target.value))}
            className="flex-1"
          />
          <span className="text-sm text-white w-12">{trailR}R</span>
        </div>

        {combinedEquityCurve.length > 0 && (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={combinedEquityCurve} margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="tradeIndex" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => v.toFixed(0) + 'R'} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                formatter={(value: number) => [value.toFixed(2) + 'R', '']}
              />
              <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
              {activeStrategies.map(strategy => {
                const sim = simulations[strategy];
                if (!sim) return null;
                return (
                  <Line
                    key={strategy}
                    type="monotone"
                    dataKey={sim.strategyName}
                    stroke={STRATEGY_COLORS[sim.strategyName]}
                    strokeWidth={2}
                    dot={false}
                  />
                );
              })}
              <Legend />
            </LineChart>
          </ResponsiveContainer>
        )}

        <div className="mt-6 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Strategy</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Total R</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Avg R</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Win Rate</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Profit Factor</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Max DD</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(simulations)
                .filter(([key]) => activeStrategies.includes(key as SimulationStrategy))
                .map(([key, sim]) => {
                  const totalColor = sim.totalPnl >= 0 ? 'text-green-400' : 'text-red-400';
                  const avgColor = sim.avgR >= 0 ? 'text-green-400' : 'text-red-400';
                  return (
                    <tr key={key} className="border-b border-gray-700">
                      <td className="px-4 py-2 text-sm font-medium" style={{ color: STRATEGY_COLORS[sim.strategyName] }}>
                        {sim.strategyName}
                      </td>
                      <td className={`px-4 py-2 text-sm text-right ${totalColor}`}>
                        {sim.totalPnl >= 0 ? '+' : ''}{sim.totalPnl.toFixed(2)}R
                      </td>
                      <td className={`px-4 py-2 text-sm text-right ${avgColor}`}>
                        {sim.avgR >= 0 ? '+' : ''}{sim.avgR.toFixed(2)}R
                      </td>
                      <td className="px-4 py-2 text-sm text-right text-gray-300">{sim.winRate.toFixed(1)}%</td>
                      <td className="px-4 py-2 text-sm text-right text-gray-300">{sim.profitFactor.toFixed(2)}</td>
                      <td className="px-4 py-2 text-sm text-right text-red-400">{sim.maxDrawdown.toFixed(2)}R</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-gray-500 italic">
          Simulations are approximate — based on MAE/MFE extremes, not full price action.
        </p>
      </div>

      {/* Post-TP Behaviour Section */}
      {tradesWithDrawdownData >= 3 && (
        <div className="bg-gray-800 rounded-lg p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-white">Post-TP Behaviour</h3>
            <span className="text-sm text-gray-400">
              {tradesWithDrawdownData} trades with inter-exit data
            </span>
          </div>

          {/* Retracement by Direction */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Longs */}
            {postTPAnalysis.long && (
              <div className="bg-gray-750 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-400 mb-3">Longs — Retracement After TP1</h4>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">Trades Analyzed:</span>
                      <span className="ml-2 text-white">{postTPAnalysis.long.tradesAnalyzed}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Avg Retracement:</span>
                      <span className="ml-2 text-white">{postTPAnalysis.long.avgRetracementPercent.toFixed(0)}%</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Reached Entry:</span>
                      <span className={`ml-2 ${postTPAnalysis.long.tradesReachedEntryPercent > 30 ? 'text-amber-400' : 'text-white'}`}>
                        {postTPAnalysis.long.tradesReachedEntryPercent.toFixed(0)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Beyond Entry:</span>
                      <span className={`ml-2 ${postTPAnalysis.long.tradesBeyondEntryPercent > 20 ? 'text-red-400' : 'text-white'}`}>
                        {postTPAnalysis.long.tradesBeyondEntryPercent.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  {/* Bucket Distribution */}
                  <div className="space-y-1">
                    {postTPAnalysis.long.buckets.map(bucket => (
                      <div key={bucket.label} className="flex items-center gap-2 text-xs">
                        <span className="w-28 text-gray-400">{bucket.label}</span>
                        <div className="flex-1 bg-gray-700 rounded h-2">
                          <div
                            className="bg-blue-500 h-2 rounded"
                            style={{ width: `${Math.min(bucket.percentage, 100)}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-gray-300">{bucket.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Shorts */}
            {postTPAnalysis.short && (
              <div className="bg-gray-750 rounded-lg p-4">
                <h4 className="text-sm font-medium text-red-400 mb-3">Shorts — Retracement After TP1</h4>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">Trades Analyzed:</span>
                      <span className="ml-2 text-white">{postTPAnalysis.short.tradesAnalyzed}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Avg Retracement:</span>
                      <span className="ml-2 text-white">{postTPAnalysis.short.avgRetracementPercent.toFixed(0)}%</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Reached Entry:</span>
                      <span className={`ml-2 ${postTPAnalysis.short.tradesReachedEntryPercent > 30 ? 'text-amber-400' : 'text-white'}`}>
                        {postTPAnalysis.short.tradesReachedEntryPercent.toFixed(0)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Beyond Entry:</span>
                      <span className={`ml-2 ${postTPAnalysis.short.tradesBeyondEntryPercent > 20 ? 'text-red-400' : 'text-white'}`}>
                        {postTPAnalysis.short.tradesBeyondEntryPercent.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  {/* Bucket Distribution */}
                  <div className="space-y-1">
                    {postTPAnalysis.short.buckets.map(bucket => (
                      <div key={bucket.label} className="flex items-center gap-2 text-xs">
                        <span className="w-28 text-gray-400">{bucket.label}</span>
                        <div className="flex-1 bg-gray-700 rounded h-2">
                          <div
                            className="bg-red-500 h-2 rounded"
                            style={{ width: `${Math.min(bucket.percentage, 100)}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-gray-300">{bucket.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* BE Justification Analysis */}
          {(beAnalysis.long || beAnalysis.short) && (
            <div className="bg-gray-750 rounded-lg p-4">
              <h4 className="text-sm font-medium text-white mb-3">BE Justification Analysis</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {beAnalysis.long && beAnalysis.long.tradesAnalyzed >= 3 && (
                  <div className="space-y-2">
                    <h5 className="text-sm text-blue-400">Longs</h5>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-400">BE Would Save:</span>
                        <span className="ml-2 text-green-400">{beAnalysis.long.beWouldHaveSavedPercent.toFixed(0)}%</span>
                      </div>
                      <div>
                        <span className="text-gray-400">BE Unnecessary:</span>
                        <span className="ml-2 text-amber-400">{beAnalysis.long.beUnnecessaryPercent.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className={`text-sm font-medium ${
                      beAnalysis.long.beSavedVsCost === 'worth_it' ? 'text-green-400' :
                      beAnalysis.long.beSavedVsCost === 'not_worth_it' ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      {beAnalysis.long.beSavedVsCost === 'worth_it' ? '→ BE is worth it on longs' :
                       beAnalysis.long.beSavedVsCost === 'not_worth_it' ? '→ BE not worth it on longs' :
                       beAnalysis.long.beSavedVsCost === 'neutral' ? '→ Neutral impact' : '→ Insufficient data'}
                    </div>
                  </div>
                )}
                {beAnalysis.short && beAnalysis.short.tradesAnalyzed >= 3 && (
                  <div className="space-y-2">
                    <h5 className="text-sm text-red-400">Shorts</h5>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-400">BE Would Save:</span>
                        <span className="ml-2 text-green-400">{beAnalysis.short.beWouldHaveSavedPercent.toFixed(0)}%</span>
                      </div>
                      <div>
                        <span className="text-gray-400">BE Unnecessary:</span>
                        <span className="ml-2 text-amber-400">{beAnalysis.short.beUnnecessaryPercent.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className={`text-sm font-medium ${
                      beAnalysis.short.beSavedVsCost === 'worth_it' ? 'text-green-400' :
                      beAnalysis.short.beSavedVsCost === 'not_worth_it' ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      {beAnalysis.short.beSavedVsCost === 'worth_it' ? '→ BE is worth it on shorts' :
                       beAnalysis.short.beSavedVsCost === 'not_worth_it' ? '→ BE not worth it on shorts' :
                       beAnalysis.short.beSavedVsCost === 'neutral' ? '→ Neutral impact' : '→ Insufficient data'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* By Setup Tags */}
          {postTPByTag.length > 0 && (
            <div className="bg-gray-750 rounded-lg p-4">
              <h4 className="text-sm font-medium text-white mb-3">Retracement by Setup Tag</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th className="pb-2 font-medium">Tag</th>
                      <th className="pb-2 font-medium text-right">Trades</th>
                      <th className="pb-2 font-medium text-right">Avg Retracement</th>
                      <th className="pb-2 font-medium text-right">Reached Entry</th>
                      <th className="pb-2 font-medium">Recommendation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {postTPByTag.slice(0, 10).map(tag => (
                      <tr key={tag.tag}>
                        <td className="py-2">
                          <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">
                            {tag.tag}
                          </span>
                        </td>
                        <td className="py-2 text-right text-gray-300">{tag.tradesAnalyzed}</td>
                        <td className="py-2 text-right text-gray-300">{tag.avgRetracementPercent.toFixed(0)}%</td>
                        <td className="py-2 text-right text-gray-300">{tag.tradesReachedEntryPercent.toFixed(0)}%</td>
                        <td className={`py-2 text-sm ${
                          tag.recommendation === 'be_justified' ? 'text-green-400' :
                          tag.recommendation === 'trailing_better' ? 'text-purple-400' : 'text-gray-400'
                        }`}>
                          {tag.recommendation === 'be_justified' ? 'BE justified' :
                           tag.recommendation === 'trailing_better' ? 'Trail instead' : 'Neutral'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Retracement Scatter */}
          {retracementScatter.length >= 3 && (
            <div className="bg-gray-750 rounded-lg p-4">
              <h4 className="text-sm font-medium text-white mb-3">TP1 Distance vs Drawdown</h4>
              <p className="text-xs text-gray-400 mb-4">
                Does bigger first target lead to deeper pullback?
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      type="number"
                      dataKey="tp1DistanceR"
                      name="TP1 Distance"
                      unit="R"
                      stroke="#9ca3af"
                      fontSize={12}
                    />
                    <YAxis
                      type="number"
                      dataKey="drawdownR"
                      name="Drawdown"
                      unit="R"
                      stroke="#9ca3af"
                      fontSize={12}
                    />
                    <ZAxis range={[40, 40]} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-gray-800 border border-gray-700 rounded p-2 text-sm">
                            <div className="text-white">
                              {data.direction === 'long' ? '↑ Long' : '↓ Short'}
                            </div>
                            <div className="text-gray-400">
                              TP1: {data.tp1DistanceR.toFixed(2)}R
                            </div>
                            <div className="text-gray-400">
                              Drawdown: {data.drawdownR.toFixed(2)}R
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Scatter
                      data={retracementScatter.filter(p => p.direction === 'long')}
                      fill="#3b82f6"
                      name="Longs"
                    />
                    <Scatter
                      data={retracementScatter.filter(p => p.direction === 'short')}
                      fill="#ef4444"
                      name="Shorts"
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-4 justify-center mt-2 text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                  Longs
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-red-500 rounded-full"></span>
                  Shorts
                </span>
              </div>
            </div>
          )}

          {/* Post-TP Insights */}
          {postTPInsights.length > 0 && (
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
              <h4 className="text-sm font-medium text-purple-400 mb-2">Post-TP Insights</h4>
              <ul className="space-y-1">
                {postTPInsights.map((insight, i) => (
                  <li key={i} className="text-sm text-gray-300">{insight}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Post-Exit Analysis Section */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-white">Post-Exit Analysis</h3>
            <p className="text-sm text-gray-400">
              Based on {postExitAnalysis.tradesWithData} of {postExitAnalysis.totalClosedTrades} closed trades with post-exit data
            </p>
          </div>
        </div>

        {postExitAnalysis.tradesWithData >= 3 ? (
          <div className="space-y-6">
            {/* Stopouts vs Voluntary Exits Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Stopout Analysis */}
              {stopoutAnalysis.stopoutsWithPostExitData >= 1 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-red-400 mb-3">Stopouts (SL Hit)</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">With post-exit data</span>
                      <span className="text-white font-medium">
                        {stopoutAnalysis.stopoutsWithPostExitData} of {stopoutAnalysis.totalStopouts}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">Avg post-stop move</span>
                      <span className="text-amber-400 font-mono font-medium">
                        +{stopoutAnalysis.avgPostStopMoveR.toFixed(2)}R
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">Exceeded {minRThreshold}R threshold</span>
                      <span className={`font-medium ${
                        stopoutAnalysis.stopoutsAboveThresholdPercent > 30 ? 'text-amber-400' : 'text-gray-300'
                      }`}>
                        {stopoutAnalysis.stopoutsAboveThresholdPercent.toFixed(0)}%
                        <span className="text-gray-500 font-normal ml-1">
                          ({stopoutAnalysis.stopoutsAboveThreshold} trades)
                        </span>
                      </span>
                    </div>
                    {stopoutAnalysis.stopoutsAboveThreshold > 0 && (
                      <div className="text-xs text-amber-400/80 mt-2 p-2 bg-amber-500/10 rounded">
                        These stopouts saw price move {stopoutAnalysis.avgPostStopMoveAboveThreshold.toFixed(1)}R avg in your favour — thesis was right, stop placement was the issue.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Voluntary Exit Analysis */}
              {voluntaryExitAnalysis.withPostExitData >= 1 && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-blue-400 mb-3">Voluntary Exits</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">With post-exit data</span>
                      <span className="text-white font-medium">
                        {voluntaryExitAnalysis.withPostExitData} of {voluntaryExitAnalysis.totalVoluntaryExits}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">Avg missed R</span>
                      <span className="text-yellow-400 font-mono font-medium">
                        +{voluntaryExitAnalysis.avgMissedR.toFixed(2)}R
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">Exit efficiency</span>
                      <span className={`font-medium ${
                        voluntaryExitAnalysis.avgExitEfficiency >= 70
                          ? 'text-green-400'
                          : voluntaryExitAnalysis.avgExitEfficiency >= 50
                            ? 'text-yellow-400'
                            : 'text-red-400'
                      }`}>
                        {voluntaryExitAnalysis.avgExitEfficiency.toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">Reached target after</span>
                      <span className={`font-medium ${
                        voluntaryExitAnalysis.reachedTargetPercent > 30 ? 'text-red-400' : 'text-green-400'
                      }`}>
                        {voluntaryExitAnalysis.reachedTargetPercent.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Overall Summary (smaller) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-750 rounded-lg p-4">
                <span className="text-xs text-gray-400">Overall Exit Efficiency</span>
                <p className={`text-2xl font-bold ${
                  postExitAnalysis.avgExitEfficiency >= 70
                    ? 'text-green-400'
                    : postExitAnalysis.avgExitEfficiency >= 50
                      ? 'text-yellow-400'
                      : 'text-red-400'
                }`}>
                  {postExitAnalysis.avgExitEfficiency.toFixed(0)}%
                </p>
                <span className="text-xs text-gray-500">of available move captured</span>
              </div>
              <div className="bg-gray-750 rounded-lg p-4">
                <span className="text-xs text-gray-400">Overall Missed R</span>
                <p className="text-2xl font-bold text-yellow-400">
                  +{postExitAnalysis.avgMissedR.toFixed(2)}R
                </p>
                <span className="text-xs text-gray-500">left on the table per trade</span>
              </div>
              <div className="bg-gray-750 rounded-lg p-4">
                <span className="text-xs text-gray-400">Reached Target After Exit</span>
                <p className={`text-2xl font-bold ${
                  postExitAnalysis.reachedTargetPercent > 30
                    ? 'text-red-400'
                    : 'text-green-400'
                }`}>
                  {postExitAnalysis.reachedTargetPercent.toFixed(0)}%
                </p>
                <span className="text-xs text-gray-500">{postExitAnalysis.tradesReachedTarget} trades</span>
              </div>
              <div className="bg-gray-750 rounded-lg p-4">
                <span className="text-xs text-gray-400">Sample Size</span>
                <p className="text-2xl font-bold text-gray-200">
                  {postExitAnalysis.tradesWithData}
                </p>
                <span className="text-xs text-gray-500">trades reviewed</span>
              </div>
            </div>

            {/* Missed R by Stop Adjustment Reason */}
            {missedRByStopReason.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-3">Missed R by Stop Adjustment Reason</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="px-4 py-2 text-left text-gray-400">Reason</th>
                        <th className="px-4 py-2 text-right text-gray-400">Trades</th>
                        <th className="px-4 py-2 text-right text-gray-400">Avg Missed R</th>
                        <th className="px-4 py-2 text-right text-gray-400">% Hit Target After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missedRByStopReason.map((row) => (
                        <tr key={row.reason} className="border-b border-gray-700">
                          <td className="px-4 py-2 text-gray-200">{row.reason}</td>
                          <td className="px-4 py-2 text-right text-gray-200">{row.tradeCount}</td>
                          <td className={`px-4 py-2 text-right font-mono ${
                            row.avgMissedR > 1 ? 'text-red-400' : 'text-yellow-400'
                          }`}>
                            +{row.avgMissedR.toFixed(2)}R
                          </td>
                          <td className={`px-4 py-2 text-right ${
                            row.reachedTargetPercent > 30 ? 'text-red-400' : 'text-green-400'
                          }`}>
                            {row.reachedTargetPercent.toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Missed R by Exit Type */}
            {missedRByExitType.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-3">Missed R by Exit Type</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="px-4 py-2 text-left text-gray-400">Exit Type</th>
                        <th className="px-4 py-2 text-right text-gray-400">Trades</th>
                        <th className="px-4 py-2 text-right text-gray-400">Avg Missed R</th>
                        <th className="px-4 py-2 text-right text-gray-400">Avg Exit Efficiency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missedRByExitType.map((row) => (
                        <tr key={row.exitType} className="border-b border-gray-700">
                          <td className="px-4 py-2 text-gray-200">{row.exitType}</td>
                          <td className="px-4 py-2 text-right text-gray-200">{row.tradeCount}</td>
                          <td className={`px-4 py-2 text-right font-mono ${
                            row.avgMissedR > 1 ? 'text-red-400' : 'text-yellow-400'
                          }`}>
                            +{row.avgMissedR.toFixed(2)}R
                          </td>
                          <td className={`px-4 py-2 text-right ${
                            row.avgExitEfficiency >= 70
                              ? 'text-green-400'
                              : row.avgExitEfficiency >= 50
                                ? 'text-yellow-400'
                                : 'text-red-400'
                          }`}>
                            {row.avgExitEfficiency.toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Should-Have-Held Scatter */}
            {postExitScatter.length >= 3 && (
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-3">Should-Have-Held Analysis</h4>
                <p className="text-xs text-gray-500 mb-3">
                  Dots above the diagonal line = left money on the table. Blue = had BE adjustment.
                </p>
                <ResponsiveContainer width="100%" height={300}>
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      type="number"
                      dataKey="actualR"
                      name="Actual R"
                      stroke="#6b7280"
                      domain={['dataMin - 0.5', 'dataMax + 0.5']}
                      label={{ value: 'Actual R', position: 'bottom', fill: '#6b7280', fontSize: 12 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="wouldHaveR"
                      name="Would-Have R"
                      stroke="#6b7280"
                      domain={['dataMin - 0.5', 'dataMax + 0.5']}
                      label={{ value: 'Would-Have R', angle: -90, position: 'left', fill: '#6b7280', fontSize: 12 }}
                    />
                    <ZAxis range={[60, 200]} />
                    <ReferenceLine
                      segment={[
                        { x: Math.min(...postExitScatter.map(p => p.actualR)) - 1, y: Math.min(...postExitScatter.map(p => p.actualR)) - 1 },
                        { x: Math.max(...postExitScatter.map(p => p.actualR)) + 1, y: Math.max(...postExitScatter.map(p => p.actualR)) + 1 }
                      ]}
                      stroke="#22c55e"
                      strokeWidth={2}
                      strokeDasharray="3 3"
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                      formatter={(value: number, name: string) => [
                        `${value.toFixed(2)}R`,
                        name === 'actualR' ? 'Actual' : 'Would-Have'
                      ]}
                      labelFormatter={() => ''}
                    />
                    <Scatter
                      name="Trades"
                      data={postExitScatter}
                      fill="#3b82f6"
                    >
                      {postExitScatter.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.hadBEAdjustment ? '#3b82f6' : '#9ca3af'}
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Post-Exit Insights */}
            {postExitInsights.length > 0 && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                <h4 className="text-sm font-medium text-purple-400 mb-2">Post-Exit Insights</h4>
                <ul className="space-y-1">
                  {postExitInsights.map((insight, i) => (
                    <li key={i} className="text-sm text-gray-300">{insight}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <p>Review at least 3 closed trades to see post-exit analysis.</p>
            <p className="text-sm mt-2">
              Use the Post-Exit Review section in trade detail to record what happened after you exited.
            </p>
          </div>
        )}
      </div>

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
