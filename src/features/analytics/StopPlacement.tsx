import { useMemo, useState } from 'react';
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
  ReferenceLine,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import type { TradeRecord } from '../../types';
import {
  getMAEDistribution,
  getStopEfficiencyData,
  getMAEOutcomeData,
  getStopPlacementSummary,
  getStopPlacementInsights,
  simulateStopAdjustment,
  getBEAnalysis,
  getStopAdjustmentTriggerAnalysis,
  getStopDestinationAnalysis,
  getStopManagementInsights,
} from '../../utils';
import { useAppStore } from '../../stores/appStore';

interface Props {
  trades: TradeRecord[];
}

export function StopPlacement({ trades }: Props) {
  const [stopAdjustment, setStopAdjustment] = useState(0);
  const { alertSettings } = useAppStore();
  const minRThreshold = alertSettings.minRThreshold ?? 1.0;

  const summary = useMemo(() => getStopPlacementSummary(trades), [trades]);
  const maeDistribution = useMemo(() => getMAEDistribution(trades, 6), [trades]);
  const stopEfficiency = useMemo(() => getStopEfficiencyData(trades), [trades]);
  const maeOutcome = useMemo(() => getMAEOutcomeData(trades), [trades]);
  const insights = useMemo(() => getStopPlacementInsights(summary), [summary]);

  // Stop Tightness Simulator
  const simulationResult = useMemo(
    () => simulateStopAdjustment(trades, stopAdjustment / 100),
    [trades, stopAdjustment]
  );

  // BE & Stop Management Analytics (pass minRThreshold for post-exit validation)
  const beAnalysis = useMemo(() => getBEAnalysis(trades, minRThreshold), [trades, minRThreshold]);
  const triggerAnalysis = useMemo(() => getStopAdjustmentTriggerAnalysis(trades), [trades]);
  const destinationAnalysis = useMemo(() => getStopDestinationAnalysis(trades), [trades]);
  const stopMgmtInsights = useMemo(
    () => getStopManagementInsights(beAnalysis, triggerAnalysis, destinationAnalysis, minRThreshold),
    [beAnalysis, triggerAnalysis, destinationAnalysis, minRThreshold]
  );

  if (summary.totalTrades === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No closed trades to analyze.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Data Availability Notice */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <p className="text-sm text-amber-400">
          Showing {summary.tradesWithMAE} of {summary.totalTrades} trades (only trades with MAE/MFE data).
          {summary.tradesWithMAE < summary.totalTrades && 
            ' Log MAE/MFE on more trades to improve accuracy.'}
        </p>
      </div>

      {/* Summary Card */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-medium text-white mb-4">Stop Placement Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-750 rounded-lg p-4">
            <p className="text-xs text-gray-400">Avg Stop Distance</p>
            <p className="text-xl font-bold text-white">{summary.avgStopDistance.toFixed(4)}</p>
          </div>
          <div className="bg-gray-750 rounded-lg p-4">
            <p className="text-xs text-gray-400">Avg MAE (Winners)</p>
            <p className="text-xl font-bold text-green-400">{summary.avgMAEWinners.toFixed(2)}R</p>
          </div>
          <div className="bg-gray-750 rounded-lg p-4">
            <p className="text-xs text-gray-400">Avg MAE (Losers)</p>
            <p className="text-xl font-bold text-red-400">{summary.avgMAELosers.toFixed(2)}R</p>
          </div>
          <div className="bg-gray-750 rounded-lg p-4">
            <p className="text-xs text-gray-400">Suggested Optimal</p>
            <p className="text-xl font-bold text-blue-400">{(summary.suggestedOptimalStop * 100).toFixed(0)}%</p>
            <p className="text-xs text-gray-500">of current stop</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="bg-gray-750 rounded-lg p-4">
            <p className="text-xs text-gray-400">Winners MAE &lt; 50% Stop</p>
            <p className="text-lg font-bold text-green-400">
              {summary.winnersMAEUnderHalfStopPercent.toFixed(1)}%
              <span className="text-sm text-gray-500 ml-2">({summary.winnersMAEUnderHalfStop} trades)</span>
            </p>
          </div>
          <div className="bg-gray-750 rounded-lg p-4">
            <p className="text-xs text-gray-400">Losers MAE &gt; 80% Stop</p>
            <p className="text-lg font-bold text-red-400">
              {summary.losersMAEOverEightyStopPercent.toFixed(1)}%
              <span className="text-sm text-gray-500 ml-2">({summary.losersMAEOverEightyStop} trades)</span>
            </p>
          </div>
        </div>
      </div>

      {/* MAE Distribution Histogram */}
      {maeDistribution.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">MAE Distribution</h3>
            <p className="text-sm text-gray-400">How far trades move against you before resolving</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={maeDistribution} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                formatter={(value: number, name: string) => {
                  const label = name === 'winners' ? 'Winners' : 'Losers';
                  return [value + ' trades', label];
                }}
              />
              <Bar dataKey="winners" stackId="a" fill="#22c55e" name="winners" />
              <Bar dataKey="losers" stackId="a" fill="#ef4444" name="losers" />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-6 mt-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-green-500" />
              <span className="text-gray-400">Winners</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-red-500" />
              <span className="text-gray-400">Losers</span>
            </div>
          </div>
        </div>
      )}

      {/* Scatter Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stop Efficiency Scatter */}
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Stop Efficiency</h3>
            <p className="text-sm text-gray-400">Stop distance vs outcome</p>
          </div>
          {stopEfficiency.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ left: 10, right: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  type="number"
                  dataKey="stopDistance"
                  name="Stop Distance"
                  stroke="#6b7280"
                  fontSize={12}
                  tickFormatter={(v) => v.toFixed(4)}
                  label={{ value: 'Stop Distance', position: 'bottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="rMultiple"
                  name="R-Multiple"
                  stroke="#6b7280"
                  fontSize={12}
                  tickFormatter={(v) => v + 'R'}
                />
                <ZAxis range={[40, 40]} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'Stop Distance') return [value.toFixed(5), 'Stop'];
                    return [value.toFixed(2) + 'R', name];
                  }}
                  labelFormatter={(_, payload) => payload[0]?.payload?.pair || ''}
                />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Scatter
                  data={stopEfficiency.filter(d => d.isWinner)}
                  fill="#22c55e"
                  name="Winners"
                />
                <Scatter
                  data={stopEfficiency.filter(d => !d.isWinner)}
                  fill="#ef4444"
                  name="Losers"
                />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500">
              No stop distance data available
            </div>
          )}
        </div>

        {/* MAE vs Outcome Scatter */}
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">MAE vs Outcome</h3>
            <p className="text-sm text-gray-400">Drawdown during trade vs final result</p>
          </div>
          {maeOutcome.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ left: 10, right: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  type="number"
                  dataKey="maeR"
                  name="MAE"
                  stroke="#6b7280"
                  fontSize={12}
                  tickFormatter={(v) => v.toFixed(1) + 'R'}
                  label={{ value: 'MAE (R)', position: 'bottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="rMultiple"
                  name="R-Multiple"
                  stroke="#6b7280"
                  fontSize={12}
                  tickFormatter={(v) => v + 'R'}
                />
                <ZAxis range={[40, 40]} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  formatter={(value: number, name: string) => [value.toFixed(2) + 'R', name]}
                  labelFormatter={(_, payload) => payload[0]?.payload?.pair || ''}
                />
                <ReferenceLine x={1} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'Stop', fill: '#f59e0b', fontSize: 10 }} />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Scatter
                  data={maeOutcome.filter(d => d.isWinner)}
                  fill="#22c55e"
                  name="Winners"
                />
                <Scatter
                  data={maeOutcome.filter(d => !d.isWinner)}
                  fill="#ef4444"
                  name="Losers"
                />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500">
              No MAE data available
            </div>
          )}
        </div>
      </div>

      {/* Stop Tightness Simulator */}
      {simulationResult.simulatedTrades.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Stop Tightness Simulator</h3>
            <p className="text-sm text-gray-400">
              What if you used tighter or wider stops? Based on historical MAE data.
            </p>
          </div>

          {/* Slider and Presets */}
          <div className="mb-6">
            <div className="flex items-center gap-4 mb-3">
              <label className="text-sm text-gray-400 whitespace-nowrap">Stop Adjustment:</label>
              <input
                type="range"
                min={-50}
                max={50}
                step={5}
                value={stopAdjustment}
                onChange={(e) => setStopAdjustment(Number(e.target.value))}
                className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className={`text-lg font-bold min-w-[60px] text-right ${
                stopAdjustment < 0 ? 'text-amber-400' : stopAdjustment > 0 ? 'text-blue-400' : 'text-gray-400'
              }`}>
                {stopAdjustment > 0 ? '+' : ''}{stopAdjustment}%
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[-30, -20, -10, 0, 10, 20, 30].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setStopAdjustment(preset)}
                  className={`px-3 py-1 text-xs rounded ${
                    stopAdjustment === preset
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {preset > 0 ? '+' : ''}{preset}%
                </button>
              ))}
            </div>
          </div>

          {/* Comparison Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-750 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Original Total R</p>
              <p className="text-xl font-bold text-white">
                {simulationResult.originalTotalR.toFixed(2)}R
              </p>
            </div>
            <div className="bg-gray-750 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Simulated Total R</p>
              <p className={`text-xl font-bold ${
                simulationResult.simulatedTotalR > simulationResult.originalTotalR
                  ? 'text-green-400'
                  : simulationResult.simulatedTotalR < simulationResult.originalTotalR
                  ? 'text-red-400'
                  : 'text-white'
              }`}>
                {simulationResult.simulatedTotalR.toFixed(2)}R
              </p>
              <p className="text-xs text-gray-500">
                {simulationResult.simulatedTotalR >= simulationResult.originalTotalR ? '+' : ''}
                {(simulationResult.simulatedTotalR - simulationResult.originalTotalR).toFixed(2)}R
              </p>
            </div>
            <div className="bg-gray-750 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Win Rate Change</p>
              <p className="text-lg font-bold text-white">
                {simulationResult.originalWinRate.toFixed(1)}% → {simulationResult.simulatedWinRate.toFixed(1)}%
              </p>
              <p className={`text-xs ${
                simulationResult.simulatedWinRate >= simulationResult.originalWinRate
                  ? 'text-green-400'
                  : 'text-red-400'
              }`}>
                {simulationResult.simulatedWinRate >= simulationResult.originalWinRate ? '+' : ''}
                {(simulationResult.simulatedWinRate - simulationResult.originalWinRate).toFixed(1)}%
              </p>
            </div>
            <div className="bg-gray-750 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Impact</p>
              <p className="text-sm text-gray-300">
                <span className="text-red-400">{simulationResult.stoppedOutCount}</span> stopped out early
              </p>
              <p className="text-sm text-gray-300">
                <span className="text-green-400">{simulationResult.improvedCount}</span> improved R
              </p>
            </div>
          </div>

          {/* Equity Curve Comparison */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-300 mb-3">Equity Curve Comparison</h4>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={simulationResult.equityCurve} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis
                  dataKey="tradeIndex"
                  stroke="#6b7280"
                  fontSize={11}
                  label={{ value: 'Trade #', position: 'bottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  stroke="#6b7280"
                  fontSize={11}
                  tickFormatter={(v) => v + 'R'}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  formatter={(value: number, name: string) => [value.toFixed(2) + 'R', name]}
                />
                <Legend />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="original"
                  stroke="#6b7280"
                  strokeWidth={2}
                  dot={false}
                  name="Original"
                />
                <Line
                  type="monotone"
                  dataKey="simulated"
                  stroke={stopAdjustment < 0 ? '#f59e0b' : '#3b82f6'}
                  strokeWidth={2}
                  dot={false}
                  name={`Simulated (${stopAdjustment > 0 ? '+' : ''}${stopAdjustment}%)`}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Simulation Insight */}
          <div className={`p-3 rounded-lg text-sm ${
            simulationResult.simulatedTotalR > simulationResult.originalTotalR
              ? 'bg-green-500/10 border border-green-500/30 text-green-300'
              : simulationResult.simulatedTotalR < simulationResult.originalTotalR
              ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
              : 'bg-gray-700 text-gray-300'
          }`}>
            {stopAdjustment < 0 ? (
              simulationResult.simulatedTotalR > simulationResult.originalTotalR ? (
                <>Tightening stops by {Math.abs(stopAdjustment)}% would have improved results by{' '}
                {(simulationResult.simulatedTotalR - simulationResult.originalTotalR).toFixed(2)}R.
                Consider reducing your stop distance.</>
              ) : (
                <>Tightening stops by {Math.abs(stopAdjustment)}% would have stopped out{' '}
                {simulationResult.stoppedOutCount} winners early, costing{' '}
                {Math.abs(simulationResult.simulatedTotalR - simulationResult.originalTotalR).toFixed(2)}R.
                Your current stops may already be optimal.</>
              )
            ) : stopAdjustment > 0 ? (
              simulationResult.simulatedTotalR > simulationResult.originalTotalR ? (
                <>Widening stops by {stopAdjustment}% would have saved{' '}
                {simulationResult.improvedCount} trades, gaining{' '}
                {(simulationResult.simulatedTotalR - simulationResult.originalTotalR).toFixed(2)}R.
                You may be getting stopped out prematurely.</>
              ) : (
                <>Widening stops by {stopAdjustment}% would have increased losses.
                Your current stop placement appears effective.</>
              )
            ) : (
              <>Adjust the slider to simulate different stop distances.</>
            )}
          </div>
        </div>
      )}

      {/* BE & Stop Management Analytics */}
      {(beAnalysis.movedToBE.count > 0 || beAnalysis.stayedOriginal.count > 0) && (
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Break-Even & Stop Management</h3>
            <p className="text-sm text-gray-400">
              Analysis of your stop adjustment behavior and effectiveness
            </p>
          </div>

          {/* BE Comparison */}
          {beAnalysis.movedToBE.count > 0 && beAnalysis.stayedOriginal.count > 0 && (
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-750 rounded-lg p-4">
                <h4 className="text-sm font-medium text-amber-400 mb-3">Moved to BE</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Trades</span>
                    <span className="text-white">{beAnalysis.movedToBE.count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Avg R</span>
                    <span className={beAnalysis.movedToBE.avgR >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {beAnalysis.movedToBE.avgR.toFixed(2)}R
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Win Rate</span>
                    <span className="text-white">{beAnalysis.movedToBE.winRate.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total P&L</span>
                    <span className={beAnalysis.movedToBE.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                      ${beAnalysis.movedToBE.totalPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="bg-gray-750 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-400 mb-3">Stayed at Original</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Trades</span>
                    <span className="text-white">{beAnalysis.stayedOriginal.count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Avg R</span>
                    <span className={beAnalysis.stayedOriginal.avgR >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {beAnalysis.stayedOriginal.avgR.toFixed(2)}R
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Win Rate</span>
                    <span className="text-white">{beAnalysis.stayedOriginal.winRate.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total P&L</span>
                    <span className={beAnalysis.stayedOriginal.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                      ${beAnalysis.stayedOriginal.totalPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* BE Outcomes */}
          {beAnalysis.movedToBE.count > 0 && (
            <div className="bg-gray-750 rounded-lg p-4 mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">BE Move Outcomes</h4>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-green-400">{beAnalysis.beOutcomes.heldForWin}</p>
                  <p className="text-xs text-gray-400">Held to Win</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-400">{beAnalysis.beOutcomes.savedByBE}</p>
                  <p className="text-xs text-gray-400">Saved from Loss</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-400">{beAnalysis.beOutcomes.missedProfit}</p>
                  <p className="text-xs text-gray-400">Missed Profit (1R+ MFE)</p>
                </div>
              </div>
            </div>
          )}

          {/* BE Post-Exit Validation (uses minRThreshold) */}
          {beAnalysis.postExitValidation.tradesWithPostExitData > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
              <h4 className="text-sm font-medium text-amber-400 mb-3">BE Post-Exit Analysis</h4>
              <p className="text-xs text-gray-400 mb-3">
                Using your {minRThreshold}R threshold to validate if BE cost you on correct trades
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <p className="text-xl font-bold text-gray-200">
                    {beAnalysis.postExitValidation.tradesWithPostExitData}
                  </p>
                  <p className="text-xs text-gray-400">BE stops reviewed</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-red-400">
                    {beAnalysis.postExitValidation.thesisCostYou}
                  </p>
                  <p className="text-xs text-gray-400">BE cost you ({'>='}{minRThreshold}R after)</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-green-400">
                    {beAnalysis.postExitValidation.belowThreshold}
                  </p>
                  <p className="text-xs text-gray-400">BE was correct ({'<'}{minRThreshold}R after)</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-amber-400">
                    +{beAnalysis.postExitValidation.avgPostExitMoveR.toFixed(2)}R
                  </p>
                  <p className="text-xs text-gray-400">Avg move after BE stop</p>
                </div>
              </div>
            </div>
          )}

          {/* Stop Adjustment Triggers */}
          {triggerAnalysis.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Stop Adjustment by Trigger</h4>
              <div className="space-y-2">
                {triggerAnalysis.slice(0, 5).map((trigger, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-750 rounded px-3 py-2">
                    <span className="text-sm text-gray-300">{trigger.trigger}</span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-400">{trigger.count} trades</span>
                      <span className={trigger.avgRAfter >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {trigger.avgRAfter.toFixed(2)}R
                      </span>
                      <span className="text-gray-400">{trigger.winRate.toFixed(0)}% WR</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stop Destinations */}
          {destinationAnalysis.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Stop Adjustment Destinations</h4>
              <div className="space-y-2">
                {destinationAnalysis.slice(0, 5).map((dest, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-750 rounded px-3 py-2">
                    <span className="text-sm text-gray-300">{dest.destination}</span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-400">{dest.count} trades</span>
                      <span className={dest.avgR >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {dest.avgR.toFixed(2)}R
                      </span>
                      <span className="text-gray-400">{dest.winRate.toFixed(0)}% WR</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stop Management Insights */}
          {stopMgmtInsights.length > 0 && (
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
              <h4 className="text-sm font-medium text-purple-400 mb-2">Stop Management Insights</h4>
              <ul className="space-y-1">
                {stopMgmtInsights.map((insight, i) => (
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
          <h4 className="text-sm font-medium text-blue-400 mb-2">Stop Placement Insights</h4>
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
