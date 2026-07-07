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
  ScatterChart,
  Scatter,
  ZAxis,
} from 'recharts';
import type { TradeRecord } from '../../types';
import { getTimeAnalysis, getTimeInsights, getTimeframeAnalysis } from '../../utils';

interface Props {
  trades: TradeRecord[];
}

export function TimeAnalysis({ trades }: Props) {
  const timeData = useMemo(() => getTimeAnalysis(trades), [trades]);
  const timeframeData = useMemo(() => getTimeframeAnalysis(trades), [trades]);
  const insights = useMemo(
    () => getTimeInsights(timeData.sessions, timeData.daysOfWeek),
    [timeData]
  );

  // Filter to trading days only (Mon-Fri)
  const tradingDays = timeData.daysOfWeek.filter(d => d.dayIndex >= 1 && d.dayIndex <= 5);

  // Session chart data - order: Asian, London, Overlap, NY
  const sessionOrder = ['asian', 'london', 'overlap', 'new_york'];
  const sessionLabels: Record<string, string> = {
    asian: 'Asian',
    london: 'London',
    overlap: 'Overlap',
    new_york: 'NY',
  };
  const sessionData = sessionOrder
    .map(s => timeData.sessions.find(sess => sess.session === s))
    .filter(Boolean)
    .map(s => ({
      session: sessionLabels[s!.session] || s!.session,
      avgR: s!.avgR,
      count: s!.count,
    }));

  // Format hold time for display
  const formatHoldTime = (minutes: number) => {
    if (minutes < 60) return minutes + 'm';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h';
    const days = Math.floor(hours / 24);
    return days + 'd';
  };

  if (timeData.sessions.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No closed trades to analyze.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Session & Day Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Session Breakdown */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Performance by Session</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={sessionData} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="session" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => v + 'R'} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                formatter={(value: number, name: string) => {
                  if (name === 'avgR') return [value.toFixed(2) + 'R', 'Avg R'];
                  return [value, name];
                }}
                labelFormatter={(label) => label}
              />
              <ReferenceLine y={0} stroke="#6b7280" />
              <Bar dataKey="avgR" radius={[4, 4, 0, 0]}>
                {sessionData.map((entry, index) => (
                  <Cell key={index} fill={entry.avgR >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2 text-xs text-gray-400">
            {sessionData.map(s => (
              <span key={s.session}>{s.session}: {s.count} trades</span>
            ))}
          </div>
        </div>

        {/* Day of Week */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Performance by Day</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={tradingDays} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="dayName" stroke="#6b7280" fontSize={12} tickFormatter={(v) => v.slice(0, 3)} />
              <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => v + 'R'} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                formatter={(value: number, name: string) => {
                  if (name === 'avgR') return [value.toFixed(2) + 'R', 'Avg R'];
                  return [value, name];
                }}
              />
              <ReferenceLine y={0} stroke="#6b7280" />
              <Bar dataKey="avgR" radius={[4, 4, 0, 0]}>
                {tradingDays.map((entry, index) => (
                  <Cell key={index} fill={entry.avgR >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2 text-xs text-gray-400">
            {tradingDays.map(d => (
              <span key={d.dayName}>{d.dayName.slice(0, 3)}: {d.count}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Hour of Day Heatmap */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-medium text-white mb-4">Performance by Hour (Entry Time)</h3>
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-[600px]">
            {timeData.hourlyStats.map(h => {
              let bgColor = 'bg-gray-700';
              if (h.count > 0) {
                if (h.intensity > 0.5) bgColor = 'bg-green-500';
                else if (h.intensity > 0.2) bgColor = 'bg-green-700';
                else if (h.intensity > 0) bgColor = 'bg-green-900';
                else if (h.intensity > -0.2) bgColor = 'bg-red-900';
                else if (h.intensity > -0.5) bgColor = 'bg-red-700';
                else bgColor = 'bg-red-500';
              }

              return (
                <div
                  key={h.hour}
                  className={`flex-1 min-w-[24px] rounded ${bgColor} p-2 text-center`}
                  title={`${h.hour}:00 - ${h.count} trades, Avg P&L: $${h.avgPnl.toFixed(2)}, Avg R: ${h.avgR.toFixed(2)}R`}
                >
                  <div className="text-xs text-gray-300">{h.hour}</div>
                  {h.count > 0 && (
                    <div className="text-[10px] text-gray-400 mt-1">{h.count}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded bg-red-500" />
            <span>Loss</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded bg-gray-700" />
            <span>No data</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded bg-green-500" />
            <span>Profit</span>
          </div>
        </div>
      </div>

      {/* Hold Time Analysis */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-medium text-white mb-4">Hold Time vs R-Multiple</h3>
        {timeData.holdTimeData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ left: 10, right: 20, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                type="number"
                dataKey="holdMinutes"
                name="Hold Time"
                stroke="#6b7280"
                fontSize={12}
                tickFormatter={formatHoldTime}
                label={{ value: 'Hold Time', position: 'bottom', fill: '#6b7280', fontSize: 11 }}
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
                  if (name === 'Hold Time') return [formatHoldTime(value), 'Hold Time'];
                  if (name === 'R-Multiple') return [value.toFixed(2) + 'R', 'R-Multiple'];
                  return [value, name];
                }}
                labelFormatter={(_, payload) => payload[0]?.payload?.pair || ''}
              />
              <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
              <Scatter
                data={timeData.holdTimeData.filter(d => d.isWinner)}
                fill="#22c55e"
                name="Winners"
              />
              <Scatter
                data={timeData.holdTimeData.filter(d => !d.isWinner)}
                fill="#ef4444"
                name="Losers"
              />
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-gray-500">
            No hold time data available
          </div>
        )}
        <div className="flex justify-center gap-6 mt-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-gray-400">Winners</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-gray-400">Losers</span>
          </div>
        </div>
      </div>

      {/* Timeframe Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Analysis Timeframe */}
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Performance by Analysis TF</h3>
            <p className="text-sm text-gray-400">Timeframe where you identified the setup</p>
          </div>
          {timeframeData.analysisTF.filter(tf => tf.timeframe !== 'Not set').length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={timeframeData.analysisTF.filter(tf => tf.timeframe !== 'Not set')}
                margin={{ left: 10, right: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="timeframe" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => v + 'R'} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'avgR') return [value.toFixed(2) + 'R', 'Avg R'];
                    return [value, name];
                  }}
                />
                <ReferenceLine y={0} stroke="#6b7280" />
                <Bar dataKey="avgR" radius={[4, 4, 0, 0]}>
                  {timeframeData.analysisTF.filter(tf => tf.timeframe !== 'Not set').map((entry, index) => (
                    <Cell key={index} fill={entry.avgR >= 0 ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-500">
              No analysis timeframe data recorded
            </div>
          )}
          <div className="flex justify-center gap-4 mt-2 text-xs text-gray-400 flex-wrap">
            {timeframeData.analysisTF.filter(tf => tf.timeframe !== 'Not set').map(tf => (
              <span key={tf.timeframe}>{tf.timeframe}: {tf.count} ({tf.winRate.toFixed(0)}%)</span>
            ))}
          </div>
        </div>

        {/* Entry Timeframe */}
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Performance by Entry TF</h3>
            <p className="text-sm text-gray-400">Timeframe where you executed the entry</p>
          </div>
          {timeframeData.entryTF.filter(tf => tf.timeframe !== 'Not set').length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={timeframeData.entryTF.filter(tf => tf.timeframe !== 'Not set')}
                margin={{ left: 10, right: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="timeframe" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => v + 'R'} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'avgR') return [value.toFixed(2) + 'R', 'Avg R'];
                    return [value, name];
                  }}
                />
                <ReferenceLine y={0} stroke="#6b7280" />
                <Bar dataKey="avgR" radius={[4, 4, 0, 0]}>
                  {timeframeData.entryTF.filter(tf => tf.timeframe !== 'Not set').map((entry, index) => (
                    <Cell key={index} fill={entry.avgR >= 0 ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-500">
              No entry timeframe data recorded
            </div>
          )}
          <div className="flex justify-center gap-4 mt-2 text-xs text-gray-400 flex-wrap">
            {timeframeData.entryTF.filter(tf => tf.timeframe !== 'Not set').map(tf => (
              <span key={tf.timeframe}>{tf.timeframe}: {tf.count} ({tf.winRate.toFixed(0)}%)</span>
            ))}
          </div>
        </div>
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
