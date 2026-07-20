import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from 'recharts';
import type { TradeRecord } from '../../types';
import { getRMultipleDistribution, getPlannedVsActual, getPositionSizingData, CHART_TOOLTIP_STYLES } from '../../utils';
import { TradeListModal } from '../../components';

interface Props {
  trades: TradeRecord[];
}

export function RiskDistribution({ trades }: Props) {
  const navigate = useNavigate();
  const rDistribution = useMemo(() => getRMultipleDistribution(trades), [trades]);
  const plannedVsActual = useMemo(() => getPlannedVsActual(trades), [trades]);
  const positionSizing = useMemo(() => getPositionSizingData(trades), [trades]);

  // Modal state for drill-down
  const [modalTrades, setModalTrades] = useState<TradeRecord[]>([]);
  const [modalTitle, setModalTitle] = useState('');

  if (rDistribution.every(b => b.count === 0)) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No closed trades to analyze.</p>
      </div>
    );
  }

  const stdDevText = positionSizing.stdDev > 0 
    ? ' (±' + positionSizing.stdDev.toFixed(2) + '%)'
    : '';

  return (
    <div className="space-y-6">
      {/* R-Multiple Histogram */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-white">R-Multiple Distribution</h3>
          <p className="text-sm text-gray-400">Your trading signature. Click a bar to see trades.</p>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={rDistribution} margin={{ left: 10, right: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="#6b7280"
              fontSize={11}
              angle={-45}
              textAnchor="end"
              height={60}
              interval={0}
            />
            <YAxis stroke="#6b7280" fontSize={12} />
            <Tooltip
              {...CHART_TOOLTIP_STYLES}
              formatter={(value: number) => [value + ' trades', 'Count']}
            />
            <Bar
              dataKey="count"
              radius={[4, 4, 0, 0]}
              className="cursor-pointer"
              onClick={(data) => {
                if (!data) return;
                const bucket = data as { min: number; max: number; label: string };
                const bucketTrades = trades.filter(t => {
                  if (t.status !== 'closed' || t.rMultiple === undefined) return false;
                  const r = t.rMultiple;
                  if (bucket.max === Infinity) return r > bucket.min;
                  if (bucket.min === -Infinity) return r <= bucket.max;
                  // Handle zero specially (belongs to -0.5 to 0 bucket)
                  if (r === 0) return bucket.min === -0.5 && bucket.max === 0;
                  return r > bucket.min && r <= bucket.max;
                });
                setModalTitle(`R-Multiple: ${bucket.label}`);
                setModalTrades(bucketTrades);
              }}
            >
              {rDistribution.map((entry, index) => (
                <Cell key={index} fill={entry.isPositive ? '#22c55e' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Scatter Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Planned vs Actual R:R */}
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Planned vs Actual R:R</h3>
            <p className="text-sm text-gray-400">Diagonal = perfect execution. Click a dot to view trade.</p>
          </div>
          {plannedVsActual.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ left: 10, right: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  type="number"
                  dataKey="plannedRR"
                  name="Planned R:R"
                  stroke="#6b7280"
                  fontSize={12}
                  domain={[0, 'dataMax']}
                  label={{ value: 'Planned R:R', position: 'bottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="actualRR"
                  name="Actual R:R"
                  stroke="#6b7280"
                  fontSize={12}
                  domain={[0, 'dataMax']}
                />
                <ZAxis range={[50, 50]} />
                <Tooltip
                  {...CHART_TOOLTIP_STYLES}
                  formatter={(value: number, name: string) => [value.toFixed(2), name]}
                  labelFormatter={(_, payload) => {
                    const data = payload[0]?.payload;
                    if (!data) return '';
                    const trade = trades.find(t => t.id === data.tradeId);
                    const dateStr = trade?.entryTime ? new Date(trade.entryTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
                    return `${data.pair} ${dateStr}`;
                  }}
                />
                <ReferenceLine
                  segment={[{ x: 0, y: 0 }, { x: 5, y: 5 }]}
                  stroke="#6b7280"
                  strokeDasharray="5 5"
                  label={{ value: 'Perfect', fill: '#6b7280', fontSize: 10, position: 'end' }}
                />
                <Scatter
                  data={plannedVsActual.filter(d => d.isWinner)}
                  fill="#22c55e"
                  name="Winners"
                  className="cursor-pointer"
                  onClick={(data) => {
                    if (data?.tradeId) navigate(`/trades/${data.tradeId}`);
                  }}
                />
                <Scatter
                  data={plannedVsActual.filter(d => !d.isWinner)}
                  fill="#ef4444"
                  name="Losers"
                  className="cursor-pointer"
                  onClick={(data) => {
                    if (data?.tradeId) navigate(`/trades/${data.tradeId}`);
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500">
              No trades with both planned and actual R:R
            </div>
          )}
          <div className="flex justify-center gap-6 mt-2 text-xs">
            <span className="text-gray-400">Above line = exceeded target</span>
            <span className="text-gray-400">Below line = underperformed</span>
          </div>
        </div>

        {/* Position Sizing Consistency */}
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-white">Position Sizing Consistency</h3>
            <p className="text-sm text-gray-400">
              Avg risk: {positionSizing.avgRiskPercent.toFixed(2)}%{stdDevText}. Click a dot to view trade.
            </p>
          </div>
          {positionSizing.points.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ left: 10, right: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  type="number"
                  dataKey="tradeIndex"
                  name="Trade #"
                  stroke="#6b7280"
                  fontSize={12}
                  label={{ value: 'Trade #', position: 'bottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="riskPercent"
                  name="Risk %"
                  stroke="#6b7280"
                  fontSize={12}
                  tickFormatter={(v) => v + '%'}
                  domain={[0, 'dataMax']}
                />
                <ZAxis range={[40, 40]} />
                <Tooltip
                  {...CHART_TOOLTIP_STYLES}
                  formatter={(value: number, name: string) => {
                    if (name === 'Risk %') return [value.toFixed(2) + '%', 'Risk'];
                    return [value, name];
                  }}
                  labelFormatter={(_, payload) => {
                    const p = payload[0]?.payload;
                    if (!p) return '';
                    const trade = trades.find(t => t.id === p.tradeId);
                    const dateStr = trade?.entryTime ? new Date(trade.entryTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
                    return `${p.pair} ${dateStr}${p.isOutlier ? ' (Outlier)' : ''}`;
                  }}
                />
                <ReferenceLine
                  y={positionSizing.avgRiskPercent}
                  stroke="#3b82f6"
                  strokeDasharray="5 5"
                  label={{ value: 'Avg', fill: '#3b82f6', fontSize: 10 }}
                />
                <Scatter
                  data={positionSizing.points.filter(d => d.isWinner && !d.isOutlier)}
                  fill="#22c55e"
                  name="Winners"
                  className="cursor-pointer"
                  onClick={(data) => {
                    if (data?.tradeId) navigate(`/trades/${data.tradeId}`);
                  }}
                />
                <Scatter
                  data={positionSizing.points.filter(d => !d.isWinner && !d.isOutlier)}
                  fill="#ef4444"
                  name="Losers"
                  className="cursor-pointer"
                  onClick={(data) => {
                    if (data?.tradeId) navigate(`/trades/${data.tradeId}`);
                  }}
                />
                <Scatter
                  data={positionSizing.points.filter(d => d.isOutlier)}
                  fill="#f59e0b"
                  name="Outliers"
                  shape="diamond"
                  className="cursor-pointer"
                  onClick={(data) => {
                    if (data?.tradeId) navigate(`/trades/${data.tradeId}`);
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500">
              No position sizing data available
            </div>
          )}
          <div className="flex justify-center gap-4 mt-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-gray-400">Winners</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-gray-400">Losers</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-amber-500" style={{ transform: 'rotate(45deg)' }} />
              <span className="text-gray-400">Outliers</span>
            </div>
          </div>
        </div>
      </div>

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
