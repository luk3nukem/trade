import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db } from '../../db';
import type { TradeRecord } from '../../types';
import { ZONE_LEVEL_TYPES } from '../../types';
import { formatDuration } from '../../utils';

// Helper to check if a level type is a zone
const isZoneLevelType = (levelType: string): boolean => {
  return ZONE_LEVEL_TYPES.includes(levelType as typeof ZONE_LEVEL_TYPES[number]);
};
import { derivePostExitMetrics, isPostExitReviewComplete, isPostExitReviewPartial, getReviewDueDate, isReviewDue } from '../../utils/tradeCalculations';
import { useAppStore } from '../../stores/appStore';

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
  const { alertSettings } = useAppStore();
  const minRThreshold = alertSettings.minRThreshold ?? 1.0;

  const postExitMetrics = useMemo(() => {
    if (!trade.postExitBestPrice) return null;
    return derivePostExitMetrics(
      trade.entryPrice,
      trade.exitPrice,
      trade.postExitBestPrice,
      trade.stopDistance,
      trade.direction,
      trade.rMultiple,
      trade.exitType
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

  // Determine stopout insight message
  const getStopoutInsight = () => {
    if (!postExitMetrics?.isStopout || postExitMetrics.postStopMoveR === undefined) {
      return null;
    }

    const moveR = postExitMetrics.postStopMoveR;
    if (moveR >= minRThreshold) {
      return {
        type: 'thesis_correct' as const,
        message: `Post-stop move: +${moveR.toFixed(1)}R — thesis was correct, stop placement was the issue`,
      };
    } else if (moveR > 0) {
      return {
        type: 'below_threshold' as const,
        message: `Post-stop move: +${moveR.toFixed(1)}R — below your ${minRThreshold}R threshold, thesis not validated`,
      };
    }
    return null;
  };

  const stopoutInsight = getStopoutInsight();

  return (
    <div className="space-y-6">
      {/* Stopout Insight Banner */}
      {stopoutInsight && (
        <div className={`rounded-lg p-4 ${
          stopoutInsight.type === 'thesis_correct'
            ? 'bg-amber-500/10 border border-amber-500/30'
            : 'bg-gray-700/50 border border-gray-600'
        }`}>
          <div className="flex items-start gap-3">
            {stopoutInsight.type === 'thesis_correct' ? (
              <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <p className={`text-sm ${
              stopoutInsight.type === 'thesis_correct' ? 'text-amber-300' : 'text-gray-300'
            }`}>
              {stopoutInsight.message}
            </p>
          </div>
        </div>
      )}

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

        {/* Post-Stop Move R or Missed R */}
        <div className="bg-gray-750 rounded-lg p-4">
          <span className="text-xs text-gray-400">
            {postExitMetrics?.isStopout ? 'Post-Stop Move' : 'Missed R'}
          </span>
          <p className={`font-mono text-lg ${
            postExitMetrics?.missedR && postExitMetrics.missedR > 0
              ? 'text-yellow-400'
              : 'text-gray-200'
          }`}>
            {postExitMetrics?.missedR !== undefined
              ? `+${postExitMetrics.missedR.toFixed(2)}R`
              : '-'}
          </p>
          <span className="text-xs text-gray-500">
            {postExitMetrics?.isStopout ? 'Move in your favour after stop' : 'Additional R available'}
          </span>
        </div>

        {/* Exit Efficiency - hide for stopouts since it doesn't make sense */}
        <div className="bg-gray-750 rounded-lg p-4">
          <span className="text-xs text-gray-400">Exit Efficiency</span>
          {postExitMetrics?.isStopout ? (
            <>
              <p className="font-mono text-lg text-gray-500">N/A</p>
              <span className="text-xs text-gray-500">Not applicable for stopouts</span>
            </>
          ) : (
            <>
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
            </>
          )}
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

        {/* In-Trade Events Timeline */}
        {trade.events && trade.events.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-medium text-white mb-4">In-Trade Events</h3>
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-700" />

              <div className="space-y-4">
                {[...trade.events]
                  .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
                  .map((event) => {
                    // Color-code by event type category
                    const getEventColor = (type: string) => {
                      if (type.includes('spike') || type === 'pump') return 'bg-green-500';
                      if (type === 'dump') return 'bg-red-500';
                      if (type === 'liquidity_sweep' || type === 'retest') return 'bg-yellow-500';
                      if (type === 'reversal') return 'bg-purple-500';
                      if (type === 'news_reaction' || type === 'session_open_move') return 'bg-orange-500';
                      if (type === 'stall_consolidation') return 'bg-gray-500';
                      return 'bg-blue-500';
                    };

                    return (
                      <div key={event.id} className="relative flex items-start gap-4 pl-6">
                        {/* Timeline dot */}
                        <div className={`absolute left-0 w-4 h-4 rounded-full ${getEventColor(event.eventType)} ring-4 ring-gray-800`} />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-gray-400">
                              {event.time instanceof Date
                                ? event.time.toLocaleString()
                                : new Date(event.time).toLocaleString()}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              getEventColor(event.eventType).replace('bg-', 'bg-').replace('500', '500/20')
                            } ${getEventColor(event.eventType).replace('bg-', 'text-').replace('500', '400')}`}>
                              {event.eventType.replace(/_/g, ' ')}
                            </span>
                          </div>
                          {event.description && (
                            <p className="text-sm text-gray-300 mt-1">{event.description}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
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
            <div className="flex justify-between items-start">
              <span className="text-sm text-gray-400">Analysis TFs</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {trade.analysisTFs && trade.analysisTFs.length > 0 ? (
                  trade.analysisTFs.map((tf) => (
                    <span
                      key={tf}
                      className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-sm"
                    >
                      {tf}
                    </span>
                  ))
                ) : (
                  <span className="text-gray-200">-</span>
                )}
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-400">Entry TF</span>
              <span className="text-gray-200">{trade.entryTF || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-400">Entry Confirmation</span>
              <span className="text-gray-200">
                {trade.entryConfirmation
                  ? (() => {
                      const label = {
                        blind_limit: 'Blind — limit order',
                        blind_market: 'Blind — market order',
                        structural: 'Structural confirmation',
                        partial_confirmation: 'Partial confirmation',
                      }[trade.entryConfirmation] || trade.entryConfirmation;
                      // Append confirmationTF for structural/partial
                      if ((trade.entryConfirmation === 'structural' || trade.entryConfirmation === 'partial_confirmation') && trade.confirmationTF) {
                        return `${label} (${trade.confirmationTF})`;
                      }
                      return label;
                    })()
                  : '-'}
              </span>
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

            {/* Level Sequence Mini-Ladder */}
            {trade.levelSequence && trade.levelSequence.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-700">
                <span className="text-sm text-gray-400">Level Sequence</span>
                <div className="mt-2 space-y-1">
                  {trade.levelSequence.map((level, index) => {
                    const isZone = isZoneLevelType(level.levelType) && level.priceFar;
                    const penetration = level.penetrationPercent;

                    return (
                      <div
                        key={level.id}
                        className="py-1.5 px-2 bg-gray-750 rounded"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-4">{index + 1}</span>
                          <span className="text-sm text-gray-200 font-medium">{level.levelType || '—'}</span>
                          {level.timeframe && (
                            <span className="text-xs text-gray-500">({level.timeframe})</span>
                          )}
                          {isZone ? (
                            <span className="text-xs text-gray-400 font-mono">
                              {level.price} → {level.priceFar}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 font-mono">@ {level.price || '—'}</span>
                          )}
                          <span className="flex-1" />
                          {level.reaction && (
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                              level.reaction === 'bounced' ? 'bg-green-500/20 text-green-400' :
                              level.reaction === 'front_run' ? 'bg-blue-500/20 text-blue-400' :
                              level.reaction === 'swept_then_bounced' ? 'bg-amber-500/20 text-amber-400' :
                              'bg-red-500/20 text-red-400'
                            }`}>
                              {level.reaction === 'bounced' ? 'Bounced' :
                               level.reaction === 'front_run' ? 'Front-run' :
                               level.reaction === 'swept_then_bounced' ? 'SFP' :
                               'Broken'}
                            </span>
                          )}
                          {!level.reaction && (
                            <span className="text-xs text-gray-600">—</span>
                          )}
                        </div>

                        {/* Zone penetration bar */}
                        {isZone && penetration !== null && penetration !== undefined && (
                          <div className="mt-1.5 ml-6">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    penetration >= 75 ? 'bg-red-500' :
                                    penetration >= 50 ? 'bg-orange-500' :
                                    penetration >= 25 ? 'bg-yellow-500' :
                                    'bg-green-500'
                                  }`}
                                  style={{ width: `${Math.min(100, penetration)}%` }}
                                />
                              </div>
                              <span className={`text-xs ${
                                penetration >= 75 ? 'text-red-400' :
                                penetration >= 50 ? 'text-orange-400' :
                                penetration >= 25 ? 'text-yellow-400' :
                                'text-green-400'
                              }`}>
                                {penetration}%
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
        {(trade.entryNotes || trade.closeNotes) && (
          <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-medium text-white mb-4">Notes</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {trade.entryNotes && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Entry Notes</h4>
                  <p className="text-gray-200 whitespace-pre-wrap">{trade.entryNotes}</p>
                </div>
              )}
              {trade.closeNotes && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Close Notes</h4>
                  <p className="text-gray-200 whitespace-pre-wrap">{trade.closeNotes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Screenshots Gallery */}
        {trade.screenshots && trade.screenshots.filter(s => s.url).length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-medium text-white mb-4">Screenshots</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {trade.screenshots.filter(s => s.url).map((screenshot) => (
                <div key={screenshot.id} className="space-y-2">
                  <button
                    onClick={() => setLightboxImage(screenshot.url)}
                    className="w-full aspect-video bg-gray-700 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all group relative"
                  >
                    <img
                      src={screenshot.url}
                      alt={screenshot.caption || 'Trade screenshot'}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // Replace broken image with placeholder
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent && !parent.querySelector('.error-placeholder')) {
                          const placeholder = document.createElement('div');
                          placeholder.className = 'error-placeholder flex flex-col items-center justify-center w-full h-full p-2 text-center';
                          placeholder.innerHTML = `
                            <svg class="w-8 h-8 text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span class="text-xs text-gray-400">Image unavailable</span>
                          `;
                          parent.appendChild(placeholder);
                        }
                      }}
                    />
                  </button>
                  <div className="text-center">
                    {screenshot.caption && (
                      <p className="text-xs text-gray-400">{screenshot.caption}</p>
                    )}
                    <a
                      href={screenshot.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open original
                    </a>
                  </div>
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
        {trade.status === 'closed' && (() => {
          const isReviewComplete = isPostExitReviewComplete(
            trade.postExitBestPrice,
            trade.postExitWorstPrice,
            trade.reachedTargetPostExit,
            trade.postExitNotes
          );
          const isPartialReview = isPostExitReviewPartial(
            trade.postExitBestPrice,
            trade.postExitWorstPrice,
            trade.reachedTargetPostExit,
            trade.postExitNotes
          );
          const exitTime = trade.exitTime ? new Date(trade.exitTime) : null;
          // Use market-hours-aware calculation (skips weekends for non-crypto)
          const reviewDue = exitTime ? isReviewDue(exitTime, trade.assetClass) : false;
          const reviewDueDate = exitTime ? getReviewDueDate(exitTime, trade.assetClass) : null;

          const formatExitDateTime = (date: Date) => {
            return date.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            }) + ' at ' + date.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit'
            });
          };

          const formatDueDate = (date: Date) => {
            return date.toLocaleDateString('en-US', {
              weekday: 'long',
              day: 'numeric',
              month: 'short'
            }) + ', ' + date.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit'
            });
          };

          return (
            <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
              <h3 className="text-lg font-medium text-white mb-4">Post-Exit Review</h3>

              {isReviewComplete ? (
                // Display completed review data
                <PostExitReviewDisplay trade={trade} />
              ) : (
                // CTA card for incomplete/unreviewed trades
                <div className={`rounded-lg p-6 ${
                  isPartialReview
                    ? 'bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30'
                    : reviewDue
                      ? 'bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/30'
                      : 'bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30'
                }`}>
                  <div className="flex items-start gap-4">
                    <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                      isPartialReview
                        ? 'bg-amber-500/20'
                        : reviewDue
                          ? 'bg-red-500/20'
                          : 'bg-blue-500/20'
                    }`}>
                      <svg className={`w-6 h-6 ${
                        isPartialReview
                          ? 'text-amber-400'
                          : reviewDue
                            ? 'text-red-400'
                            : 'text-blue-400'
                      }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h4 className={`text-lg font-medium mb-1 ${
                        isPartialReview
                          ? 'text-amber-300'
                          : reviewDue
                            ? 'text-red-300'
                            : 'text-white'
                      }`}>
                        {isPartialReview
                          ? 'Review incomplete'
                          : reviewDue
                            ? 'Post-exit review is due'
                            : 'Post-exit review scheduled'}
                      </h4>
                      <p className="text-gray-400 mb-4">
                        {isPartialReview ? (
                          <>Fill in all fields to complete your review — best price, worst price, reached target, and notes.</>
                        ) : reviewDue ? (
                          <>Record what happened after your exit to improve your exit strategy.</>
                        ) : exitTime && reviewDueDate ? (
                          <>
                            This trade closed on{' '}
                            <span className="text-gray-300">{formatExitDateTime(exitTime)}</span>.
                            Review due <span className="text-gray-300">{formatDueDate(reviewDueDate)}</span>.
                          </>
                        ) : (
                          <>Record what happened after your exit.</>
                        )}
                      </p>
                      <Link
                        to={`/trades/${trade.id}/edit`}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium transition-colors ${
                          isPartialReview
                            ? 'bg-amber-600 hover:bg-amber-500'
                            : reviewDue
                              ? 'bg-red-600 hover:bg-red-500'
                              : 'bg-blue-600 hover:bg-blue-500'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        {isPartialReview ? 'Complete Review' : reviewDue ? 'Add Review Now' : 'Add Post-Exit Review'}
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
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
          {/* Close button */}
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 p-2 text-white hover:text-gray-300"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* Open original link */}
          <a
            href={lightboxImage}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-4 left-4 flex items-center gap-2 px-3 py-2 bg-gray-800/80 hover:bg-gray-700 rounded-lg text-white text-sm transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open original
          </a>
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
