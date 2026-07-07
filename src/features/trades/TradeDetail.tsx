import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db } from '../../db';
import type { TradeRecord } from '../../types';
import { formatDuration } from '../../utils';
import { derivePostExitMetrics } from '../../utils/tradeCalculations';

// Emotional state emoji map
const EMOTIONAL_EMOJIS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '😰', label: 'Very Anxious' },
  2: { emoji: '😟', label: 'Anxious' },
  3: { emoji: '😐', label: 'Neutral' },
  4: { emoji: '😊', label: 'Confident' },
  5: { emoji: '🤩', label: 'Very Confident' },
};

// Component for displaying post-exit review data
function PostExitReviewDisplay({ trade }: { trade: TradeRecord }) {
  const postExitMetrics = useMemo(() => {
    if (!trade.postExitBestPrice) return null;
    return derivePostExitMetrics(
      trade.entryPrice,
      trade.exitPrice,
      trade.postExitBestPrice,
      trade.stopDistance,
      trade.direction,
      trade.rMultiple
    );
  }, [trade]);

  const formatReviewDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6">
      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Post-Exit Best Price */}
        <div className="bg-gray-750 rounded-lg p-4">
          <span className="text-xs text-gray-400">Best Price After Exit</span>
          <p className="font-mono text-lg text-green-400">
            {trade.postExitBestPrice !== null ? trade.postExitBestPrice.toFixed(5) : '-'}
          </p>
        </div>

        {/* Post-Exit Worst Price */}
        <div className="bg-gray-750 rounded-lg p-4">
          <span className="text-xs text-gray-400">Worst Price After Exit</span>
          <p className="font-mono text-lg text-red-400">
            {trade.postExitWorstPrice !== null ? trade.postExitWorstPrice.toFixed(5) : '-'}
          </p>
        </div>

        {/* Missed R */}
        <div className="bg-gray-750 rounded-lg p-4">
          <span className="text-xs text-gray-400">Missed R</span>
          <p className={`font-mono text-lg ${
            postExitMetrics?.missedR && postExitMetrics.missedR > 0
              ? 'text-yellow-400'
              : 'text-gray-200'
          }`}>
            {postExitMetrics?.missedR !== undefined
              ? `+${postExitMetrics.missedR.toFixed(2)}R`
              : '-'}
          </p>
          <span className="text-xs text-gray-500">Additional R available</span>
        </div>

        {/* Exit Efficiency */}
        <div className="bg-gray-750 rounded-lg p-4">
          <span className="text-xs text-gray-400">Exit Efficiency</span>
          <p className={`font-mono text-lg ${
            postExitMetrics?.exitEfficiency !== undefined
              ? postExitMetrics.exitEfficiency >= 80
                ? 'text-green-400'
                : postExitMetrics.exitEfficiency >= 50
                  ? 'text-yellow-400'
                  : 'text-red-400'
              : 'text-gray-200'
          }`}>
            {postExitMetrics?.exitEfficiency !== undefined
              ? `${postExitMetrics.exitEfficiency.toFixed(0)}%`
              : '-'}
          </p>
          <span className="text-xs text-gray-500">Move captured</span>
        </div>
      </div>

      {/* Reached Target Badge */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-400">Reached Target After Exit?</span>
        {trade.reachedTargetPostExit === true && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-sm font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Yes - Left money on the table
          </span>
        )}
        {trade.reachedTargetPostExit === false && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            No - Good exit timing
          </span>
        )}
        {trade.reachedTargetPostExit === null && (
          <span className="text-gray-500">Not recorded</span>
        )}
      </div>

      {/* Post-Exit Notes */}
      {trade.postExitNotes && (
        <div className="bg-gray-750 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Post-Exit Notes</h4>
          <p className="text-gray-200 whitespace-pre-wrap">{trade.postExitNotes}</p>
        </div>
      )}

      {/* Review Timestamp */}
      {trade.reviewedAt && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Reviewed on {formatReviewDate(trade.reviewedAt)}
        </div>
      )}
    </div>
  );
}

export function TradeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trade, setTrade] = useState<TradeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [tagDescriptions, setTagDescriptions] = useState<Record<string, string>>({});
  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({});

  // Load trade from database
  useEffect(() => {
    const loadTrade = async () => {
      if (!id) return;
      try {
        const found = await db.trades.get(id);
        setTrade(found || null);

        // Load glossary for tag tooltips
        const glossaryTerms = await db.glossaryTerms.toArray();
        const descMap: Record<string, string> = {};
        for (const term of glossaryTerms) {
          descMap[term.term] = term.definition;
        }
        setTagDescriptions(descMap);
      } catch (error) {
        console.error('Failed to load trade:', error);
      } finally {
        setLoading(false);
      }
    };
    loadTrade();
  }, [id]);

  // Create blob URLs for screenshots and clean up on unmount
  useEffect(() => {
    if (!trade?.screenshots) return;

    const newUrls: Record<string, string> = {};
    for (const screenshot of trade.screenshots) {
      // Create URL from blob if available
      if (screenshot.blob) {
        newUrls[screenshot.id] = URL.createObjectURL(screenshot.blob);
      }
      // Fall back to legacy base64 data
      else if (screenshot.data) {
        newUrls[screenshot.id] = screenshot.data;
      }
    }
    setScreenshotUrls(newUrls);

    // Cleanup blob URLs on unmount or when trade changes
    return () => {
      for (const url of Object.values(newUrls)) {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      }
    };
  }, [trade?.screenshots]);

  // Handle delete
  const handleDelete = async () => {
    if (!id) return;
    try {
      await db.trades.delete(id);
      navigate('/trades');
    } catch (error) {
      console.error('Failed to delete trade:', error);
    }
  };

  // Format date for display
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatShortDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!trade) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-medium text-white">Trade not found</h2>
        <p className="mt-2 text-gray-400">The trade you're looking for doesn't exist.</p>
        <Link
          to="/trades"
          className="inline-flex items-center gap-2 mt-6 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
        >
          Back to Trade Log
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Missed Trade Banner */}
      {trade.tradeTaken === false && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-orange-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-orange-400 font-medium">This trade was not taken</p>
              <p className="text-orange-400/80 text-sm">
                Logged for analysis only — excluded from live stats.
                {trade.notTakenReason && (
                  <span className="block mt-1">
                    <span className="font-medium">Reason:</span> {trade.notTakenReason}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{trade.pair}</h1>
            <span
              className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                trade.direction === 'long'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              {trade.direction.toUpperCase()}
            </span>
            <span
              className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                trade.status === 'open'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : trade.status === 'partial'
                    ? 'bg-orange-500/20 text-orange-400'
                    : trade.status === 'closed'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {trade.status.charAt(0).toUpperCase() + trade.status.slice(1)}
            </span>
          </div>
          <p className="mt-1 text-gray-400">{formatDate(trade.entryTime)}</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to={`/trades/${trade.id}/edit`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </Link>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Price Summary Card */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Price Levels</h3>
          <div className="space-y-4">
            {/* Visual price ladder */}
            <div className="relative">
              {trade.targetPrice && (
                <div className="flex justify-between items-center py-2 border-b border-gray-700 bg-green-500/10 -mx-2 px-2">
                  <span className="text-sm font-medium text-green-400">Target Price</span>
                  <span className="font-mono font-medium text-green-400">{trade.targetPrice}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-2 border-b border-gray-700 bg-blue-500/10 -mx-2 px-2">
                <span className="text-sm font-medium text-blue-400">Entry Price</span>
                <span className="font-mono font-medium text-blue-400">{trade.entryPrice}</span>
              </div>
              {trade.exitPrice && (
                <div className="flex justify-between items-center py-2 border-b border-gray-700 bg-purple-500/10 -mx-2 px-2">
                  <span className="text-sm font-medium text-purple-400">Avg Exit Price</span>
                  <span className="font-mono font-medium text-purple-400">{trade.exitPrice.toFixed(5)}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-2 bg-red-500/10 -mx-2 px-2 rounded-b">
                <span className="text-sm font-medium text-red-400">Stop Loss</span>
                <span className="font-mono font-medium text-red-400">{trade.stopLoss}</span>
              </div>
            </div>

            {/* Calculated metrics */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-700">
              <div>
                <span className="text-xs text-gray-400">Stop Distance</span>
                <p className="font-mono text-gray-200">{trade.stopDistance?.toFixed(5) ?? '-'}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Planned R:R</span>
                <p className="font-mono text-gray-200">{trade.plannedRR ?? '-'}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Actual R:R</span>
                <p className="font-mono text-gray-200">{trade.actualRR ?? '-'}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">R-Multiple</span>
                <p className={`font-mono font-medium ${
                  trade.rMultiple === undefined
                    ? 'text-gray-200'
                    : trade.rMultiple >= 0
                      ? 'text-green-400'
                      : 'text-red-400'
                }`}>
                  {trade.rMultiple !== undefined
                    ? `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple}R`
                    : '-'}
                </p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Worst Price</span>
                <p className="font-mono text-red-400">
                  {trade.maePrice !== null ? trade.maePrice.toFixed(5) : '-'}
                  {trade.maeR !== undefined && ` (${trade.maeR.toFixed(2)}R)`}
                </p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Best Price</span>
                <p className="font-mono text-green-400">
                  {trade.mfePrice !== null ? trade.mfePrice.toFixed(5) : '-'}
                  {trade.mfeR !== undefined && ` (${trade.mfeR.toFixed(2)}R)`}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* P&L Card */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Profit & Loss</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-gray-700">
              <span className="text-sm text-gray-400">Gross P&L</span>
              <span className={`font-mono font-medium ${
                trade.pnl === undefined
                  ? 'text-gray-200'
                  : trade.pnl >= 0
                    ? 'text-green-400'
                    : 'text-red-400'
              }`}>
                {trade.pnl !== undefined ? `$${trade.pnl.toFixed(2)}` : '-'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-700">
              <span className="text-sm text-gray-400">Commissions</span>
              <span className="font-mono text-gray-200">
                {trade.commissions !== undefined ? `-$${trade.commissions.toFixed(2)}` : '-'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-700">
              <span className="text-sm text-gray-400">Swap</span>
              <span className="font-mono text-gray-200">
                {trade.swap !== undefined ? `$${trade.swap.toFixed(2)}` : '-'}
              </span>
            </div>
            <div className="flex justify-between items-center py-3 bg-gray-750 -mx-2 px-2 rounded">
              <span className="text-sm font-medium text-white">Net P&L</span>
              <span className={`font-mono text-lg font-bold ${
                trade.netPnl === undefined
                  ? 'text-gray-200'
                  : trade.netPnl >= 0
                    ? 'text-green-400'
                    : 'text-red-400'
              }`}>
                {trade.netPnl !== undefined ? `$${trade.netPnl.toFixed(2)}` : '-'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-700">
              <div>
                <span className="text-xs text-gray-400">Position Size</span>
                <p className="font-mono text-gray-200">{trade.positionSize}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Risk Amount</span>
                <p className="font-mono text-gray-200">
                  {trade.riskAmount !== undefined ? `$${trade.riskAmount.toFixed(2)}` : '-'}
                </p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Risk %</span>
                <p className="font-mono text-gray-200">
                  {trade.riskPercent !== undefined ? `${trade.riskPercent}%` : '-'}
                </p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Hold Duration</span>
                <p className="font-mono text-gray-200">{formatDuration(trade.holdDuration)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stop Management Timeline */}
        {trade.stopAdjustments && trade.stopAdjustments.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-medium text-white mb-4">Stop Management</h3>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {/* Original Stop */}
              <div className="flex flex-col items-center min-w-[100px]">
                <div className="w-3 h-3 rounded-full bg-blue-500 mb-1" />
                <span className="text-xs text-gray-400">Original</span>
                <span className="text-sm font-mono text-white">{trade.originalStopLoss ?? trade.stopLoss}</span>
              </div>

              {/* Adjustments */}
              {trade.stopAdjustments.map((adj, idx) => (
                <div key={adj.id} className="flex items-center">
                  {/* Arrow */}
                  <div className="w-8 h-0.5 bg-gray-600" />
                  <svg className="w-4 h-4 text-gray-600 -ml-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>

                  {/* Adjustment */}
                  <div className="flex flex-col items-center min-w-[100px] ml-2">
                    <div className={`w-3 h-3 rounded-full mb-1 ${
                      adj.reason.toLowerCase().includes('be') ? 'bg-yellow-500' : 'bg-green-500'
                    }`} />
                    <span className="text-xs text-gray-400">{adj.reason || `Adj ${idx + 1}`}</span>
                    <span className="text-sm font-mono text-white">{adj.newStop}</span>
                    {adj.trigger && (
                      <span className="text-xs text-gray-500">{adj.trigger}</span>
                    )}
                    <span className="text-xs text-gray-500">
                      {adj.time instanceof Date ? formatShortDate(adj.time) : ''}
                    </span>
                  </div>
                </div>
              ))}

              {/* Final Exit */}
              {trade.exitPrice && (
                <>
                  <div className="w-8 h-0.5 bg-gray-600" />
                  <svg className="w-4 h-4 text-gray-600 -ml-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  <div className="flex flex-col items-center min-w-[100px] ml-2">
                    <div className={`w-3 h-3 rounded-full mb-1 ${
                      (trade.rMultiple ?? 0) >= 0 ? 'bg-green-500' : 'bg-red-500'
                    }`} />
                    <span className="text-xs text-gray-400">Exit</span>
                    <span className="text-sm font-mono text-white">{trade.exitPrice}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Exits Section */}
        {trade.exits && trade.exits.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-medium text-white mb-4">Exits</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-400">Time</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-400">Price</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-400">Size</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-400">Type</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-400">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {trade.exits.map((exit) => (
                    <tr key={exit.id} className="border-b border-gray-700">
                      <td className="px-4 py-2 text-sm text-gray-200">
                        {formatShortDate(exit.time)}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-200 text-right font-mono">
                        {exit.price}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-200 text-right font-mono">
                        {exit.size}
                      </td>
                      <td className="px-4 py-2 text-sm">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          exit.type === 'tp_hit' ? 'bg-green-500/20 text-green-400' :
                          exit.type === 'sl_hit' ? 'bg-red-500/20 text-red-400' :
                          exit.type === 'be_stop_hit' ? 'bg-yellow-500/20 text-yellow-400' :
                          exit.type === 'trail_stop_hit' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {exit.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-200">
                        {exit.reason || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Setup & Context Card */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Setup & Context</h3>
          <div className="space-y-3">
            {/* Setup Tags as pills */}
            <div>
              <span className="text-sm text-gray-400">Setup Tags</span>
              {trade.setupTags && trade.setupTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {trade.setupTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-sm cursor-help"
                      title={tagDescriptions[tag] || undefined}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-gray-200">-</p>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-400">Analysis TF</span>
              <span className="text-gray-200">{trade.analysisTF || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-400">Entry TF</span>
              <span className="text-gray-200">{trade.entryTF || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-400">HTF Bias</span>
              <span className={`${
                trade.htfBias === 'bullish'
                  ? 'text-green-400'
                  : trade.htfBias === 'bearish'
                    ? 'text-red-400'
                    : 'text-gray-200'
              }`}>
                {trade.htfBias ? trade.htfBias.charAt(0).toUpperCase() + trade.htfBias.slice(1) : '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-400">HTF Market Condition</span>
              <span className="text-gray-200">
                {trade.marketCondition
                  ? trade.marketCondition.charAt(0).toUpperCase() + trade.marketCondition.slice(1)
                  : '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-400">Session</span>
              <span className="text-gray-200">
                {trade.session.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-400">Exit Type</span>
              <span className="text-gray-200">
                {trade.exitType
                  ? trade.exitType.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())
                  : '-'}
              </span>
            </div>
          </div>
        </div>

        {/* Psychology Card */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Psychology</h3>
          <div className="space-y-4">
            {/* Emotional State */}
            {trade.emotionalState && (
              <div className="flex items-center gap-3">
                <span className="text-2xl">{EMOTIONAL_EMOJIS[trade.emotionalState]?.emoji}</span>
                <div>
                  <span className="text-sm text-gray-400">Emotional State</span>
                  <p className="text-gray-200">{EMOTIONAL_EMOJIS[trade.emotionalState]?.label}</p>
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-sm text-gray-400">Confidence Level</span>
              <span className="text-gray-200">
                {trade.confidenceLevel
                  ? trade.confidenceLevel.charAt(0).toUpperCase() + trade.confidenceLevel.slice(1)
                  : '-'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-400">Followed Plan</span>
              <span className={trade.followedPlan ? 'text-green-400' : 'text-red-400'}>
                {trade.followedPlan ? 'Yes' : 'No'}
              </span>
            </div>

            {!trade.followedPlan && trade.planDeviation && (
              <div className="bg-red-500/10 rounded p-3">
                <span className="text-xs text-red-400">Plan Deviation</span>
                <p className="text-gray-200 mt-1">{trade.planDeviation}</p>
              </div>
            )}

            <div className="flex gap-4">
              {trade.isRevengeTrade && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Revenge Trade
                </span>
              )}
              {trade.isOverTrade && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Over Trade
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Notes Section */}
        {(trade.preTradeNotes || trade.postTradeNotes) && (
          <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-medium text-white mb-4">Notes</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {trade.preTradeNotes && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Pre-Trade Analysis</h4>
                  <p className="text-gray-200 whitespace-pre-wrap">{trade.preTradeNotes}</p>
                </div>
              )}
              {trade.postTradeNotes && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Post-Trade Review</h4>
                  <p className="text-gray-200 whitespace-pre-wrap">{trade.postTradeNotes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Screenshots Gallery */}
        {trade.screenshots && trade.screenshots.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-medium text-white mb-4">Screenshots</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {trade.screenshots.filter(s => s.blob || (s.data && s.data.length > 0)).map((screenshot) => (
                <div key={screenshot.id} className="space-y-2">
                  {screenshotUrls[screenshot.id] && (
                    <button
                      onClick={() => setLightboxImage(screenshotUrls[screenshot.id])}
                      className="w-full aspect-video bg-gray-700 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all"
                    >
                      <img
                        src={screenshotUrls[screenshot.id]}
                        alt={screenshot.caption || 'Trade screenshot'}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Hide broken images
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </button>
                  )}
                  {screenshot.caption && (
                    <p className="text-xs text-gray-400 text-center">{screenshot.caption}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {trade.tags && trade.tags.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-medium text-white mb-4">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {trade.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex px-3 py-1 bg-gray-700 rounded-full text-sm text-gray-200"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Post-Exit Review Section - Only for closed trades */}
        {trade.status === 'closed' && (
          <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-medium text-white mb-4">Post-Exit Review</h3>

            {!trade.reviewedAt ? (
              // CTA card for unreviewed trades
              <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg p-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-medium text-white mb-1">Time for a post-exit review</h4>
                    <p className="text-gray-400 mb-4">
                      This trade closed on{' '}
                      <span className="text-gray-300">
                        {trade.exitTime ? new Date(trade.exitTime).toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric'
                        }) : 'unknown date'}
                      </span>
                      . Come back and record what happened next — did price continue to your target?
                    </p>
                    <Link
                      to={`/trades/${trade.id}/edit`}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Add Post-Exit Review
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              // Display reviewed post-exit data
              <PostExitReviewDisplay trade={trade} />
            )}
          </div>
        )}
      </div>

      {/* Back link */}
      <div className="pt-4">
        <Link
          to="/trades"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Trade Log
        </Link>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-white">Delete Trade</h3>
            <p className="mt-2 text-gray-400">
              Are you sure you want to delete this trade? This action cannot be undone.
            </p>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-white transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90"
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 p-2 text-white hover:text-gray-300"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={lightboxImage}
            alt="Screenshot"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
            onError={() => setLightboxImage(null)}
          />
        </div>
      )}
    </div>
  );
}
