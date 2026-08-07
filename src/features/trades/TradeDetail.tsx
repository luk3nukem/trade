import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db } from '../../db';
import type { TradeRecord, TradeEvent } from '../../types';
import { ZONE_LEVEL_TYPES } from '../../types';
import {
  formatDuration,
  exportSingleTrade,
  downloadTradeExport,
  getSingleTradeFilename,
  copyTradeExportToClipboard,
} from '../../utils';
import type { AuditFindingWithAck } from '../../utils/tradeAuditor';
import {
  auditTradeWithAcknowledgements,
  hasUnacknowledgedErrors,
  acknowledgeFinding,
  unacknowledgeFinding,
} from '../../utils/tradeAuditor';
import { AddToNotebook } from '../../components/AddToNotebook';

// Helper to check if a level type is a zone
const isZoneLevelType = (levelType: string): boolean => {
  return ZONE_LEVEL_TYPES.includes(levelType as typeof ZONE_LEVEL_TYPES[number]);
};

import {
  getTradeRMetrics,
  getPreExitEvents,
  getPostExitEvents,
  derivePostExitMetrics,
  getReviewDueDate,
  isReviewDue,
  isPostExitReviewComplete,
  isPostExitReviewPartial,
  getEntryDepthPercent,
  isHighLowZoneType,
  getZoneOvershoot,
  getEffectiveReachedTarget,
  getReplayVerdict,
  getReplayVerdictText,
} from '../../utils/tradeCalculations';
import { useAppStore } from '../../stores/appStore';

// Component for displaying post-exit review data
function PostExitReviewDisplay({ trade }: { trade: TradeRecord }) {
  const { alertSettings } = useAppStore();
  const minRThreshold = alertSettings.minRThreshold ?? 1.0;

  const postExitMetrics = useMemo(() => derivePostExitMetrics(trade), [trade]);
  const postExitEvents = useMemo(() => getPostExitEvents(trade), [trade]);

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
    // Check if this was a stopout (sl_hit in exits)
    const isStopout = trade.exits.some(e => e.type === 'sl_hit');
    if (!isStopout || !postExitMetrics.wouldHaveR) {
      return null;
    }

    const moveR = postExitMetrics.wouldHaveR;
    if (moveR >= minRThreshold) {
      return {
        type: 'thesis_correct' as const,
        message: `Post-stop move: +${moveR.toFixed(1)}R - thesis was correct, stop placement was the issue`,
      };
    } else if (moveR > 0) {
      return {
        type: 'below_threshold' as const,
        message: `Post-stop move: +${moveR.toFixed(1)}R - below your ${minRThreshold}R threshold, thesis not validated`,
      };
    }
    return null;
  };

  const stopoutInsight = getStopoutInsight();

  // Helper to render post-exit sequence path
  const renderSequencePath = () => {
    if (postExitEvents.length === 0) return null;

    const direction = trade.direction;
    const entryPrice = trade.entryPrice;

    // Check if milestone is above or below entry
    const getArrow = (event: TradeEvent): string => {
      if (event.price === null) return '';
      if (direction === 'long') {
        return event.price >= entryPrice ? '^' : 'v';
      } else {
        return event.price <= entryPrice ? '^' : 'v';
      }
    };

    return (
      <div className="bg-gray-750 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-400 mb-3">After exit:</h4>
        <div className="flex flex-wrap items-center gap-2">
          {postExitEvents.map((event, index) => {
            const arrow = getArrow(event);
            const kindColor = event.eventType === 'post_exit_high'
              ? 'text-green-400'
              : event.eventType === 'post_exit_low'
                ? 'text-red-400'
                : event.eventType === 'leg'
                  ? 'text-blue-400'
                  : 'text-gray-300';

            return (
              <span key={event.id} className="flex items-center gap-1">
                {index > 0 && <span className="text-gray-500 mx-1">-&gt;</span>}
                <span className={kindColor}>
                  {arrow}{event.price !== null ? event.price.toFixed(5) : '-'}
                </span>
                <span className="text-xs text-gray-500">
                  ({event.eventType.replace(/_/g, ' ')})
                </span>
                {event.description && (
                  <span className="text-xs text-gray-500 ml-1">
                    - {event.description}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Post-Exit Sequence Path */}
      {renderSequencePath()}

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
            {postExitMetrics.postExitBestPrice !== null ? postExitMetrics.postExitBestPrice.toFixed(5) : '-'}
          </p>
        </div>

        {/* Post-Exit Worst Price */}
        <div className="bg-gray-750 rounded-lg p-4">
          <span className="text-xs text-gray-400">Worst Price After Exit</span>
          <p className="font-mono text-lg text-red-400">
            {postExitMetrics.postExitWorstPrice !== null ? postExitMetrics.postExitWorstPrice.toFixed(5) : '-'}
          </p>
        </div>

        {/* Missed R */}
        <div className="bg-gray-750 rounded-lg p-4">
          <span className="text-xs text-gray-400">Missed R</span>
          <p className={`font-mono text-lg ${
            postExitMetrics.missedR && postExitMetrics.missedR > 0
              ? 'text-yellow-400'
              : 'text-gray-200'
          }`}>
            {postExitMetrics.missedR !== undefined
              ? `+${postExitMetrics.missedR.toFixed(2)}R`
              : '-'}
          </p>
          <span className="text-xs text-gray-500">Additional R available</span>
        </div>

        {/* Exit Efficiency */}
        <div className="bg-gray-750 rounded-lg p-4">
          <span className="text-xs text-gray-400">Exit Efficiency</span>
          {trade.exits.some(e => e.type === 'sl_hit') ? (
            <>
              <p className="font-mono text-lg text-gray-500">N/A</p>
              <span className="text-xs text-gray-500">Not applicable for stopouts</span>
            </>
          ) : (
            <>
              <p className={`font-mono text-lg ${
                postExitMetrics.exitEfficiency !== undefined
                  ? postExitMetrics.exitEfficiency >= 80
                    ? 'text-green-400'
                    : postExitMetrics.exitEfficiency >= 50
                      ? 'text-yellow-400'
                      : 'text-red-400'
                  : 'text-gray-200'
              }`}>
                {postExitMetrics.exitEfficiency !== undefined
                  ? `${postExitMetrics.exitEfficiency.toFixed(0)}%`
                  : '-'}
              </p>
              <span className="text-xs text-gray-500">Move captured</span>
            </>
          )}
        </div>
      </div>

      {/* Reached Target Badge with Replay Verdict */}
      {(() => {
        const { value: reachedTarget, source } = getEffectiveReachedTarget(trade);
        const verdict = getReplayVerdict(trade);
        const verdictText = getReplayVerdictText(verdict);

        return (
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-400">Reached Target After Exit?</span>
              {reachedTarget === true && (
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${
                  verdict.type === 'target_touched_stopped_first'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {verdict.type === 'target_touched_stopped_first' ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  )}
                  Yes
                </span>
              )}
              {reachedTarget === false && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm font-medium">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  No
                </span>
              )}
              {reachedTarget === null && (
                <span className="text-gray-500">Not recorded</span>
              )}
            </div>
            {reachedTarget !== null && verdict.type !== 'no_data' && (
              <p className={`text-sm ${
                verdict.type === 'target_touched_stopped_first' ? 'text-green-400' :
                verdict.type === 'target_reached_hold_survives' ? 'text-amber-400' :
                'text-blue-400'
              }`}>
                {verdictText}
              </p>
            )}
            {source === 'legacy' && (
              <p className="text-xs text-gray-500">(from manual entry - milestones not available)</p>
            )}
          </div>
        );
      })()}

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

// Unified timeline item type
type TimelineItem =
  | { type: 'entry'; time: Date }
  | { type: 'event'; event: TradeEvent }
  | { type: 'exit'; exit: TradeRecord['exits'][0]; index: number }
  | { type: 'exit_divider' };

// Component for unified timeline display
function TimelineDisplay({ trade }: { trade: TradeRecord }) {
  const preExitEvents = useMemo(() => getPreExitEvents(trade), [trade]);
  const postExitEvents = useMemo(() => getPostExitEvents(trade), [trade]);
  const hasExits = trade.exits.length > 0;

  // Build unified timeline
  const timelineItems = useMemo(() => {
    const items: TimelineItem[] = [];

    // Entry marker
    items.push({ type: 'entry', time: new Date(trade.entryTime) });

    // Pre-exit events (including stop_moved)
    for (const event of preExitEvents) {
      items.push({ type: 'event', event });
    }

    // Exits (interleaved by time)
    for (let i = 0; i < trade.exits.length; i++) {
      items.push({ type: 'exit', exit: trade.exits[i], index: i });
    }

    // Sort pre-exit items by time (after entry)
    // Entry is always first, then sort events and exits by time
    const entryItem = items[0];
    const preExitItems = items.slice(1);

    // Sort by time where available, then by order
    preExitItems.sort((a, b) => {
      const getTime = (item: TimelineItem): number | null => {
        if (item.type === 'event') {
          return item.event.time ? new Date(item.event.time).getTime() : null;
        }
        if (item.type === 'exit') {
          return new Date(item.exit.time).getTime();
        }
        return null;
      };

      const getOrder = (item: TimelineItem): number => {
        if (item.type === 'event') return item.event.order;
        if (item.type === 'exit') return 1000 + item.index; // Exits after events with same time
        return 0;
      };

      const aTime = getTime(a);
      const bTime = getTime(b);

      if (aTime !== null && bTime !== null) {
        return aTime - bTime;
      }
      if (aTime !== null) return -1;
      if (bTime !== null) return 1;
      return getOrder(a) - getOrder(b);
    });

    // Add exit divider after last exit
    const sortedItems: TimelineItem[] = [entryItem, ...preExitItems];

    if (hasExits && postExitEvents.length > 0) {
      sortedItems.push({ type: 'exit_divider' });
    }

    // Post-exit events
    for (const event of postExitEvents) {
      sortedItems.push({ type: 'event', event });
    }

    return sortedItems;
  }, [trade, preExitEvents, postExitEvents, hasExits]);

  // Color-code by event type category
  const getEventColor = (type: string) => {
    if (type === 'trade_high' || type === 'post_exit_high') return 'bg-green-500';
    if (type === 'trade_low' || type === 'post_exit_low') return 'bg-red-500';
    if (type === 'stop_moved') return 'bg-amber-500';
    if (type.includes('spike') || type === 'pump') return 'bg-green-500';
    if (type === 'dump') return 'bg-red-500';
    if (type === 'liquidity_sweep' || type === 'retest') return 'bg-yellow-500';
    if (type === 'reversal') return 'bg-purple-500';
    if (type === 'news_reaction' || type === 'session_open_move') return 'bg-orange-500';
    if (type === 'stall_consolidation') return 'bg-gray-500';
    if (type === 'leg') return 'bg-blue-500';
    return 'bg-blue-500';
  };

  const getExitColor = (type: string) => {
    if (type === 'tp_hit') return 'bg-green-500';
    if (type === 'sl_hit') return 'bg-red-500';
    if (type === 'be_stop_hit') return 'bg-amber-500';
    if (type === 'trail_stop_hit') return 'bg-blue-500';
    return 'bg-gray-500';
  };

  const renderItem = (item: TimelineItem) => {
    if (item.type === 'entry') {
      return (
        <div key="entry" className="relative flex items-start gap-4 pl-6">
          <div className="absolute left-0 w-4 h-4 rounded-full bg-blue-500 ring-4 ring-gray-800" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400">
                {new Date(item.time).toLocaleString()}
              </span>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                ENTRY
              </span>
              <span className="text-xs text-gray-400 font-mono">
                @ {trade.entryPrice.toFixed(5)}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                trade.direction === 'long' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {trade.direction.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-gray-300 mt-1">
              Stop: {trade.stopLoss.toFixed(5)}
              {trade.targetPrice && ` · Target: ${trade.targetPrice.toFixed(5)}`}
            </p>
          </div>
        </div>
      );
    }

    if (item.type === 'event') {
      const event = item.event;
      const isStopMoved = event.eventType === 'stop_moved';

      return (
        <div key={event.id} className="relative flex items-start gap-4 pl-6">
          <div className={`absolute left-0 w-4 h-4 rounded-full ${getEventColor(event.eventType)} ring-4 ring-gray-800`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {event.time && (
                <span className="text-xs text-gray-400">
                  {new Date(event.time).toLocaleString()}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                isStopMoved ? 'bg-amber-500/20 text-amber-400' :
                getEventColor(event.eventType).replace('bg-', 'bg-').replace('500', '500/20')
              } ${isStopMoved ? '' : getEventColor(event.eventType).replace('bg-', 'text-').replace('500', '400')}`}>
                {isStopMoved ? 'SL MOVED' : event.eventType.replace(/_/g, ' ')}
              </span>
              {event.price !== null && (
                <span className="text-xs text-gray-400 font-mono">
                  {isStopMoved ? '→' : '@'} {event.price.toFixed(5)}
                </span>
              )}
            </div>
            {event.description && (
              <p className={`text-sm mt-1 ${isStopMoved ? 'text-amber-300' : 'text-gray-300'}`}>
                {event.description}
              </p>
            )}
          </div>
        </div>
      );
    }

    if (item.type === 'exit') {
      const exit = item.exit;
      return (
        <div key={exit.id} className="relative flex items-start gap-4 pl-6">
          <div className={`absolute left-0 w-4 h-4 rounded-full ${getExitColor(exit.type)} ring-4 ring-gray-800`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400">
                {new Date(exit.time).toLocaleString()}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                exit.type === 'tp_hit' ? 'bg-green-500/20 text-green-400' :
                exit.type === 'sl_hit' ? 'bg-red-500/20 text-red-400' :
                exit.type === 'be_stop_hit' ? 'bg-amber-500/20 text-amber-400' :
                exit.type === 'trail_stop_hit' ? 'bg-blue-500/20 text-blue-400' :
                'bg-gray-500/20 text-gray-400'
              }`}>
                {exit.type.replace(/_/g, ' ').toUpperCase()}
              </span>
              <span className="text-xs text-gray-400 font-mono">
                @ {exit.price.toFixed(5)}
              </span>
              <span className="text-xs text-gray-500">
                ({exit.size} units)
              </span>
            </div>
            {exit.reason && (
              <p className="text-sm text-gray-300 mt-1">{exit.reason}</p>
            )}
          </div>
        </div>
      );
    }

    if (item.type === 'exit_divider') {
      return (
        <div key="exit-divider" className="relative flex items-center gap-4 pl-6 py-2">
          <div className="absolute left-0 w-4 h-4 rounded-full bg-purple-500 ring-4 ring-gray-800" />
          <div className="flex-1 border-t border-purple-500/50" />
          <span className="text-sm font-medium text-purple-400 px-2">POST-EXIT</span>
          <div className="flex-1 border-t border-purple-500/50" />
        </div>
      );
    }

    return null;
  };

  if (timelineItems.length <= 1) {
    // Only entry marker, no other events
    return null;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
      <h3 className="text-lg font-medium text-white mb-4">Timeline</h3>
      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-700" />

        <div className="space-y-4">
          {timelineItems.map(item => renderItem(item))}
        </div>
      </div>
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
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [showAuditPanel, setShowAuditPanel] = useState(false);
  const [auditFindings, setAuditFindings] = useState<AuditFindingWithAck[]>([]);
  const [acknowledgedCount, setAcknowledgedCount] = useState(0);
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [confirmAckError, setConfirmAckError] = useState<AuditFindingWithAck | null>(null);
  const [tradeHasErrors, setTradeHasErrors] = useState(false);

  // Export trade as JSON file
  const handleExportTrade = () => {
    if (!trade) return;
    const exportData = exportSingleTrade(trade);
    const filename = getSingleTradeFilename(trade);
    downloadTradeExport(exportData, filename);
  };

  // Copy trade JSON to clipboard
  const handleCopyTradeJson = async () => {
    if (!trade) return;
    const exportData = exportSingleTrade(trade);
    const success = await copyTradeExportToClipboard(exportData);
    setCopyFeedback(success ? 'copied' : 'failed');
    setTimeout(() => setCopyFeedback('idle'), 2000);
  };

  // Run audit check on trade (async with acknowledgement status)
  const handleCheckRecord = async () => {
    if (!trade) return;
    const result = await auditTradeWithAcknowledgements(trade);
    setAuditFindings(result.findings);
    setAcknowledgedCount(result.acknowledgedCount);
    setShowAuditPanel(true);
  };

  // Handle acknowledging a finding
  const handleAcknowledgeFinding = async (finding: AuditFindingWithAck) => {
    if (!trade) return;

    // For errors, require confirmation
    if (finding.severity === 'error') {
      setConfirmAckError(finding);
      return;
    }

    await acknowledgeFinding(trade, finding);
    // Refresh findings
    const result = await auditTradeWithAcknowledgements(trade);
    setAuditFindings(result.findings);
    setAcknowledgedCount(result.acknowledgedCount);
    // Update badge state
    const hasErrors = await hasUnacknowledgedErrors(trade);
    setTradeHasErrors(hasErrors);
  };

  // Confirm acknowledging an error
  const handleConfirmAckError = async () => {
    if (!trade || !confirmAckError) return;
    await acknowledgeFinding(trade, confirmAckError);
    setConfirmAckError(null);
    // Refresh findings
    const result = await auditTradeWithAcknowledgements(trade);
    setAuditFindings(result.findings);
    setAcknowledgedCount(result.acknowledgedCount);
    // Update badge state
    const hasErrors = await hasUnacknowledgedErrors(trade);
    setTradeHasErrors(hasErrors);
  };

  // Handle unacknowledging a finding
  const handleUnacknowledgeFinding = async (finding: AuditFindingWithAck) => {
    if (!trade) return;
    await unacknowledgeFinding(trade, finding);
    // Refresh findings
    const result = await auditTradeWithAcknowledgements(trade);
    setAuditFindings(result.findings);
    setAcknowledgedCount(result.acknowledgedCount);
    // Update badge state
    const hasErrors = await hasUnacknowledgedErrors(trade);
    setTradeHasErrors(hasErrors);
  };

  // Load trade from database
  useEffect(() => {
    const loadTrade = async () => {
      if (!id) return;
      try {
        const found = await db.trades.get(id);
        setTrade(found || null);

        // Check for unacknowledged errors (for badge display)
        if (found) {
          const hasErrors = await hasUnacknowledgedErrors(found);
          setTradeHasErrors(hasErrors);
        }

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

  // Get derived metrics
  const metrics = useMemo(() => {
    if (!trade) return null;
    return getTradeRMetrics(trade);
  }, [trade]);

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

  if (!trade || !metrics) {
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
                Logged for analysis only - excluded from live stats.
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
                metrics.status === 'open'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : metrics.status === 'partial'
                    ? 'bg-orange-500/20 text-orange-400'
                    : metrics.status === 'closed'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {metrics.status.charAt(0).toUpperCase() + metrics.status.slice(1)}
            </span>
          </div>
          <p className="mt-1 text-gray-400">{formatDate(trade.entryTime)}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Check Record button */}
          <button
            onClick={handleCheckRecord}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white transition-colors ${
              tradeHasErrors
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
            title="Run data audit on this trade"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Check Record
            {tradeHasErrors && (
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
            )}
          </button>
          {/* Export button */}
          <button
            onClick={handleExportTrade}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
            title="Download trade as JSON"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
          {/* Copy JSON button */}
          <button
            onClick={handleCopyTradeJson}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              copyFeedback === 'copied'
                ? 'bg-green-600 text-white'
                : copyFeedback === 'failed'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-white'
            }`}
            title="Copy trade JSON to clipboard"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {copyFeedback === 'copied' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              )}
            </svg>
            {copyFeedback === 'copied' ? 'Copied!' : copyFeedback === 'failed' ? 'Failed' : 'Copy JSON'}
          </button>
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
        {/* Key Metrics Card */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Key Metrics</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-gray-400">R-Multiple</span>
              <p className={`font-mono text-lg font-medium ${
                metrics.rMultiple === null
                  ? 'text-gray-200'
                  : metrics.rMultiple >= 0
                    ? 'text-green-400'
                    : 'text-red-400'
              }`}>
                {metrics.rMultiple !== null
                  ? `${metrics.rMultiple >= 0 ? '+' : ''}${metrics.rMultiple}R`
                  : '-'}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">P&L</span>
              <p className={`font-mono text-lg font-medium ${
                metrics.pnl === null
                  ? 'text-gray-200'
                  : metrics.pnl >= 0
                    ? 'text-green-400'
                    : 'text-red-400'
              }`}>
                {metrics.pnl !== null ? `$${metrics.pnl.toFixed(2)}` : '-'}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">Session</span>
              <p className="text-gray-200">
                {metrics.session.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">Hold Duration</span>
              <p className="font-mono text-gray-200">{formatDuration(metrics.holdDuration ?? undefined)}</p>
            </div>
            <div>
              <span className="text-xs text-gray-400">MAE (Worst)</span>
              <p className="font-mono text-red-400">
                {metrics.maePrice !== null ? metrics.maePrice.toFixed(5) : '-'}
                {metrics.maeR !== null && ` (${metrics.maeR.toFixed(2)}R)`}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">MFE (Best)</span>
              <p className="font-mono text-green-400">
                {metrics.mfePrice !== null ? metrics.mfePrice.toFixed(5) : '-'}
                {metrics.mfeR !== null && ` (${metrics.mfeR.toFixed(2)}R)`}
              </p>
            </div>
          </div>
        </div>

        {/* Entry Details Card */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Entry Details</h3>
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
              {metrics.exitPrice && (
                <div className="flex justify-between items-center py-2 border-b border-gray-700 bg-purple-500/10 -mx-2 px-2">
                  <span className="text-sm font-medium text-purple-400">Avg Exit Price</span>
                  <span className="font-mono font-medium text-purple-400">{metrics.exitPrice.toFixed(5)}</span>
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
                <p className="font-mono text-gray-200">{metrics.stopDistance.toFixed(5)}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Planned R:R</span>
                <p className="font-mono text-gray-200">{metrics.plannedRR ?? '-'}</p>
              </div>
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
            </div>
          </div>
        </div>

        {/* Level Sequence Card */}
        {trade.levelSequence && trade.levelSequence.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-medium text-white mb-4">Level Sequence</h3>
            <div className="space-y-1">
              {trade.levelSequence.map((level, index) => {
                const isZone = isZoneLevelType(level.levelType) && level.priceFar;
                const penetration = level.penetrationPercent;
                const entryDepth = isZone ? getEntryDepthPercent(trade, level) : null;

                return (
                  <div
                    key={level.id}
                    className="py-1.5 px-2 bg-gray-750 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-4">{index + 1}</span>
                      <span className="text-sm text-gray-200 font-medium">
                        {level.levelType || '-'}
                        {level.levelDetail && (
                          <span className="text-blue-400 ml-1">{level.levelDetail}</span>
                        )}
                      </span>
                      {level.timeframe && (
                        <span className="text-xs text-gray-500">({level.timeframe})</span>
                      )}
                      {isZone ? (
                        <span className="text-xs text-gray-400 font-mono">
                          {isHighLowZoneType(level.levelType) ? (
                            <>{level.price} <span className="text-gray-500">(H)</span> to {level.priceFar} <span className="text-gray-500">(L)</span></>
                          ) : (
                            <>{level.price} to {level.priceFar}</>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 font-mono">@ {level.price || '-'}</span>
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
                        <span className="text-xs text-gray-600">-</span>
                      )}
                    </div>

                    {/* Zone metrics: entry depth and penetration */}
                    {isZone && (entryDepth !== null || (penetration !== null && penetration !== undefined)) && (
                      <div className="mt-1.5 ml-6 flex items-center gap-4">
                        {/* Entry depth */}
                        {entryDepth !== null && (
                          <div
                            className="flex items-center gap-2 cursor-help"
                            title="Entry depth: where your entry sat in the zone, direction-relative (100% = maximum discount)"
                          >
                            <span className="text-xs text-gray-500">Entry:</span>
                            <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  entryDepth >= 75 ? 'bg-green-500' :
                                  entryDepth >= 50 ? 'bg-blue-500' :
                                  entryDepth >= 25 ? 'bg-yellow-500' :
                                  'bg-orange-500'
                                }`}
                                style={{ width: `${entryDepth}%` }}
                              />
                            </div>
                            <span className={`text-xs ${
                              entryDepth >= 75 ? 'text-green-400' :
                              entryDepth >= 50 ? 'text-blue-400' :
                              entryDepth >= 25 ? 'text-yellow-400' :
                              'text-orange-400'
                            }`}>
                              {entryDepth}%
                            </span>
                          </div>
                        )}
                        {/* Front-run: show turn price for zones */}
                        {level.reaction === 'front_run' && level.turnPrice !== null && level.turnPrice !== undefined && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-blue-400">Turn:</span>
                            <span className="text-xs text-blue-300 font-mono">{level.turnPrice}</span>
                          </div>
                        )}
                        {/* Broken: show 100% indicator */}
                        {level.reaction === 'broken' && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-400">
                              100% {isHighLowZoneType(level.levelType) ? 'consumed' : 'penetrated'} (broken)
                            </span>
                          </div>
                        )}
                        {/* Penetration / Range consumed - hide for front_run and broken */}
                        {penetration !== null && penetration !== undefined && level.reaction !== 'front_run' && level.reaction !== 'broken' && (
                          <div
                            className="flex items-center gap-2 cursor-help"
                            title={isHighLowZoneType(level.levelType)
                              ? "Range consumed: how much of the zone was traversed before turning"
                              : "Penetration: how deep price went into the zone before turning"
                            }
                          >
                            <span className="text-xs text-gray-500">
                              {isHighLowZoneType(level.levelType) ? 'Consumed:' : 'Penetration:'}
                            </span>
                            <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
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
                            {(() => {
                              const overshoot = isHighLowZoneType(level.levelType) ? getZoneOvershoot(level) : null;
                              if (!overshoot) return null;
                              return (
                                <span className="text-xs text-amber-400 ml-1">
                                  (swept {overshoot.edge} by {overshoot.amount.toFixed(overshoot.amount < 1 ? 4 : 2)})
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Context Tags Card */}
        {trade.contextTags && trade.contextTags.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-medium text-white mb-4">Context Tags</h3>
            <div className="flex flex-wrap gap-1.5">
              {trade.contextTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-sm cursor-help"
                  title={tagDescriptions[tag] || undefined}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Entry Configuration Card */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Entry Configuration</h3>
          <div className="space-y-3">
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
                        blind_limit: 'Blind - limit order',
                        blind_market: 'Blind - market order',
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
          </div>
        </div>

        {/* Unified Timeline Display */}
        <TimelineDisplay trade={trade} />

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
                    {trade.exits.length > 1 && (
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-400">Drawdown After</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {trade.exits.map((exit, exitIndex) => {
                    const isLastExit = exitIndex === trade.exits.length - 1;
                    return (
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
                        {trade.exits.length > 1 && (
                          <td className="px-4 py-2 text-sm text-gray-200 text-right font-mono">
                            {!isLastExit && exit.drawdownAfter != null ? exit.drawdownAfter : '-'}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

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

        {/* Post-Exit Review Section - Only for closed trades */}
        {metrics.status === 'closed' && (() => {
          const isReviewComplete = isPostExitReviewComplete(trade);
          const isPartialReview = isPostExitReviewPartial(trade);
          const exitTime = metrics.exitTime;
          // Use market-hours-aware calculation
          const reviewDue = isReviewDue(trade);
          const reviewDueDate = exitTime ? getReviewDueDate(exitTime) : null;

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
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-white">Post-Exit Review</h3>
                <AddToNotebook />
              </div>

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
                          <>Fill in all fields to complete your review - post-exit price sequence (with favourable and adverse extremes), reached target, and notes.</>
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

      {/* Audit Panel Modal */}
      {showAuditPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-white">Record Audit</h3>
              <button
                onClick={() => setShowAuditPanel(false)}
                className="text-gray-400 hover:text-white"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {auditFindings.length === 0 ? (
              <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-green-400 font-medium">No issues found</span>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Unacknowledged Errors */}
                {auditFindings.filter(f => f.severity === 'error' && !f.isAcknowledged).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-red-400 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500"></span>
                      Errors ({auditFindings.filter(f => f.severity === 'error' && !f.isAcknowledged).length})
                    </h4>
                    <div className="space-y-2">
                      {auditFindings.filter(f => f.severity === 'error' && !f.isAcknowledged).map((finding, i) => (
                        <div key={`error-${i}`} className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-red-300">{finding.message}</p>
                              <p className="text-xs text-red-400/70 mt-1 font-mono">{finding.field}</p>
                            </div>
                            <button
                              onClick={() => handleAcknowledgeFinding(finding)}
                              className="shrink-0 text-xs px-2 py-1 text-red-400/70 hover:text-red-300 hover:bg-red-500/20 rounded transition-colors"
                              title="Acknowledge this finding"
                            >
                              Ack
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unacknowledged Warnings */}
                {auditFindings.filter(f => f.severity === 'warning' && !f.isAcknowledged).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-amber-400 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      Warnings ({auditFindings.filter(f => f.severity === 'warning' && !f.isAcknowledged).length})
                    </h4>
                    <div className="space-y-2">
                      {auditFindings.filter(f => f.severity === 'warning' && !f.isAcknowledged).map((finding, i) => (
                        <div key={`warning-${i}`} className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-amber-300">{finding.message}</p>
                              <p className="text-xs text-amber-400/70 mt-1 font-mono">{finding.field}</p>
                            </div>
                            <button
                              onClick={() => handleAcknowledgeFinding(finding)}
                              className="shrink-0 text-xs px-2 py-1 text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/20 rounded transition-colors"
                              title="Acknowledge this finding"
                            >
                              Ack
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unacknowledged Incomplete */}
                {auditFindings.filter(f => f.severity === 'incomplete' && !f.isAcknowledged).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                      Incomplete ({auditFindings.filter(f => f.severity === 'incomplete' && !f.isAcknowledged).length})
                    </h4>
                    <div className="space-y-2">
                      {auditFindings.filter(f => f.severity === 'incomplete' && !f.isAcknowledged).map((finding, i) => (
                        <div key={`incomplete-${i}`} className="p-3 bg-gray-700/50 border border-gray-600 rounded-lg">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-300">{finding.message}</p>
                              <p className="text-xs text-gray-500 mt-1 font-mono">{finding.field}</p>
                            </div>
                            <button
                              onClick={() => handleAcknowledgeFinding(finding)}
                              className="shrink-0 text-xs px-2 py-1 text-gray-500 hover:text-gray-300 hover:bg-gray-600 rounded transition-colors"
                              title="Acknowledge this finding"
                            >
                              Ack
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Acknowledged Findings (collapsed by default) */}
                {acknowledgedCount > 0 && (
                  <div className="border-t border-gray-700 pt-4">
                    <button
                      onClick={() => setShowAcknowledged(!showAcknowledged)}
                      className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-400 transition-colors w-full"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${showAcknowledged ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      Acknowledged ({acknowledgedCount})
                    </button>

                    {showAcknowledged && (
                      <div className="mt-3 space-y-2">
                        {auditFindings.filter(f => f.isAcknowledged).map((finding, i) => (
                          <div
                            key={`ack-${i}`}
                            className="p-3 bg-gray-800/50 border border-gray-700/50 rounded-lg opacity-60"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${
                                    finding.severity === 'error' ? 'bg-red-500/50' :
                                    finding.severity === 'warning' ? 'bg-amber-500/50' : 'bg-gray-500/50'
                                  }`}></span>
                                  <p className="text-sm text-gray-400">{finding.message}</p>
                                </div>
                                <p className="text-xs text-gray-600 mt-1 font-mono ml-4">{finding.field}</p>
                              </div>
                              <button
                                onClick={() => handleUnacknowledgeFinding(finding)}
                                className="shrink-0 text-xs px-2 py-1 text-gray-600 hover:text-gray-400 hover:bg-gray-700 rounded transition-colors"
                                title="Remove acknowledgement"
                              >
                                Unack
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowAuditPanel(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Acknowledgement Confirmation Modal */}
      {confirmAckError && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-white mb-2">Acknowledge Error?</h3>
            <p className="text-sm text-gray-400 mb-4">
              You're acknowledging an <span className="text-red-400 font-medium">error</span>. This finding won't appear in counts or summaries until the underlying data changes.
            </p>
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg mb-4">
              <p className="text-sm text-red-300">{confirmAckError.message}</p>
              <p className="text-xs text-red-400/70 mt-1 font-mono">{confirmAckError.field}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAckError(null)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAckError}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-white transition-colors"
              >
                Acknowledge
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
