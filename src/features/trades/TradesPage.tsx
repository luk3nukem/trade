import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../db';
import type { TradeRecord, TradeDirection, TradeStatus } from '../../types';
import {
  formatDuration,
  exportMultipleTrades,
  downloadTradeExport,
  getMultiTradeFilename,
  hasAuditErrors,
} from '../../utils';
import { getReviewDueDate, getTradeRMetrics, type TradeRMetrics } from '../../utils/tradeCalculations';

// Metrics cache
const metricsCache = new WeakMap<TradeRecord, TradeRMetrics>();
function getCachedMetrics(trade: TradeRecord): TradeRMetrics {
  let metrics = metricsCache.get(trade);
  if (!metrics) {
    metrics = getTradeRMetrics(trade);
    metricsCache.set(trade, metrics);
  }
  return metrics;
}

// Audit error cache
const auditErrorCache = new WeakMap<TradeRecord, boolean>();
function getCachedAuditErrors(trade: TradeRecord): boolean {
  let hasErrors = auditErrorCache.get(trade);
  if (hasErrors === undefined) {
    hasErrors = hasAuditErrors(trade);
    auditErrorCache.set(trade, hasErrors);
  }
  return hasErrors;
}

type SortField = 'entryTime' | 'pair' | 'direction' | 'pnl' | 'rMultiple' | 'setupTags' | 'status' | 'review' | 'age' | 'holdDuration';

// Review status for sorting and display
type ReviewStatus = 'reviewed' | 'due' | 'pending' | 'na';

// Helper to get review status for a trade
function getReviewStatus(trade: TradeRecord): ReviewStatus {
  const metrics = getCachedMetrics(trade);

  // Not applicable for open/partial trades or missed trades
  if (metrics.status !== 'closed' || trade.tradeTaken === false) {
    return 'na';
  }

  // Reviewed if reviewedAt is set
  if (trade.reviewedAt) {
    return 'reviewed';
  }

  // Check if review is due
  if (metrics.exitTime) {
    const dueDate = getReviewDueDate(metrics.exitTime);
    if (dueDate && new Date() >= dueDate) {
      return 'due';
    }
  }

  return 'pending';
}

// Helper to format age in compact format
function formatAge(timestamp: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(timestamp).getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }
  if (diffHours < 24) {
    return `${diffHours}h`;
  }
  if (diffDays < 7) {
    return `${diffDays}d`;
  }
  if (diffWeeks < 5) {
    return `${diffWeeks}w`;
  }
  if (diffMonths < 12) {
    return `${diffMonths}mo`;
  }
  const remainingMonths = diffMonths % 12;
  if (remainingMonths > 0) {
    return `${diffYears}y ${remainingMonths}mo`;
  }
  return `${diffYears}y`;
}

// Get age timestamp for a trade (exit time for closed, entry time for open)
function getAgeTimestamp(trade: TradeRecord): Date {
  const metrics = getCachedMetrics(trade);
  if (metrics.status === 'closed' && metrics.exitTime) {
    return new Date(metrics.exitTime);
  }
  return new Date(trade.entryTime);
}

// Format datetime for tooltip
function formatDateTimeFull(date: Date): string {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
type SortDirection = 'asc' | 'desc';

type TradeTakenFilter = 'all' | 'taken' | 'missed';

interface Filters {
  dateFrom: string;
  dateTo: string;
  pair: string;
  direction: '' | TradeDirection;
  status: '' | TradeStatus;
  contextTags: string[]; // Multi-select: show trades matching ANY selected tag
  tradeTaken: TradeTakenFilter;
}

const initialFilters: Filters = {
  dateFrom: '',
  dateTo: '',
  pair: '',
  direction: '',
  status: '',
  contextTags: [],
  tradeTaken: 'taken', // Default to showing only taken trades
};

export function TradesPage() {
  const navigate = useNavigate();
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('entryTime');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [selectedTradeIds, setSelectedTradeIds] = useState<Set<string>>(new Set());

  // Selection handlers
  const toggleTradeSelection = (tradeId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedTradeIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tradeId)) {
        newSet.delete(tradeId);
      } else {
        newSet.add(tradeId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedTradeIds.size === sortedTrades.length) {
      setSelectedTradeIds(new Set());
    } else {
      setSelectedTradeIds(new Set(sortedTrades.map(t => t.id!)));
    }
  };

  const handleExportSelected = () => {
    const selectedTrades = sortedTrades.filter(t => selectedTradeIds.has(t.id!));
    if (selectedTrades.length === 0) return;

    const exportData = exportMultipleTrades(selectedTrades);
    const filename = getMultiTradeFilename(selectedTrades.length);
    downloadTradeExport(exportData, filename);

    // Clear selection after export
    setSelectedTradeIds(new Set());
  };

  // Load trades from database
  useEffect(() => {
    const loadTrades = async () => {
      try {
        const allTrades = await db.trades.toArray();
        setTrades(allTrades);
      } catch (error) {
        console.error('Failed to load trades:', error);
      } finally {
        setLoading(false);
      }
    };
    loadTrades();
  }, []);

  // Get unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const pairs = [...new Set(trades.map((t) => t.pair))].filter(Boolean).sort();
    // Collect all unique context tags from all trades
    const allTags = trades.flatMap((t) => t.contextTags || []);
    const contextTags = [...new Set(allTags)].filter(Boolean).sort();
    return { pairs, contextTags };
  }, [trades]);

  // Apply filters
  const filteredTrades = useMemo(() => {
    return trades.filter((trade) => {
      // Date range filter
      if (filters.dateFrom) {
        const fromDate = new Date(filters.dateFrom);
        if (new Date(trade.entryTime) < fromDate) return false;
      }
      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo);
        toDate.setHours(23, 59, 59, 999);
        if (new Date(trade.entryTime) > toDate) return false;
      }

      // Pair filter
      if (filters.pair && trade.pair !== filters.pair) return false;

      // Direction filter
      if (filters.direction && trade.direction !== filters.direction) return false;

      // Status filter
      const metrics = getCachedMetrics(trade);
      if (filters.status && metrics.status !== filters.status) return false;

      // Context tags filter (match ANY selected tag)
      if (filters.contextTags.length > 0) {
        const tradeTags = trade.contextTags || [];
        const hasMatchingTag = filters.contextTags.some((tag) => tradeTags.includes(tag));
        if (!hasMatchingTag) return false;
      }

      // Trade taken filter
      if (filters.tradeTaken === 'taken' && trade.tradeTaken === false) return false;
      if (filters.tradeTaken === 'missed' && trade.tradeTaken !== false) return false;

      return true;
    });
  }, [trades, filters]);

  // Sort trades
  const sortedTrades = useMemo(() => {
    const sorted = [...filteredTrades].sort((a, b) => {
      const aMetrics = getCachedMetrics(a);
      const bMetrics = getCachedMetrics(b);
      let aVal: unknown = a[sortField as keyof TradeRecord];
      let bVal: unknown = b[sortField as keyof TradeRecord];

      // Handle dates
      if (sortField === 'entryTime') {
        aVal = new Date(a.entryTime).getTime();
        bVal = new Date(b.entryTime).getTime();
      }

      // Handle derived fields from metrics
      if (sortField === 'pnl') {
        aVal = aMetrics.pnl;
        bVal = bMetrics.pnl;
      }

      if (sortField === 'rMultiple') {
        aVal = aMetrics.rMultiple;
        bVal = bMetrics.rMultiple;
      }

      if (sortField === 'status') {
        aVal = aMetrics.status;
        bVal = bMetrics.status;
      }

      if (sortField === 'holdDuration') {
        aVal = aMetrics.holdDuration;
        bVal = bMetrics.holdDuration;
      }

      // Handle review status sorting
      if (sortField === 'review') {
        const statusOrder: Record<ReviewStatus, number> = { due: 0, pending: 1, reviewed: 2, na: 3 };
        aVal = statusOrder[getReviewStatus(a)];
        bVal = statusOrder[getReviewStatus(b)];
      }

      // Handle age sorting (by underlying timestamp)
      if (sortField === 'age') {
        aVal = getAgeTimestamp(a).getTime();
        bVal = getAgeTimestamp(b).getTime();
      }

      // Handle contextTags sorting (renamed from setupTags)
      if (sortField === 'setupTags') {
        aVal = (a.contextTags || []).join(',');
        bVal = (b.contextTags || []).join(',');
      }

      // Handle nullish values
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDirection === 'asc' ? 1 : -1;
      if (bVal == null) return sortDirection === 'asc' ? -1 : 1;

      // Compare
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      return 0;
    });
    return sorted;
  }, [filteredTrades, sortField, sortDirection]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const closedTrades = filteredTrades.filter((t) => getCachedMetrics(t).status === 'closed');
    const totalTrades = filteredTrades.length;
    const wins = closedTrades.filter((t) => (getCachedMetrics(t).pnl ?? 0) > 0).length;
    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
    const totalPnl = closedTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);
    const avgRMultiple = closedTrades.length > 0
      ? closedTrades.reduce((sum, t) => sum + (getCachedMetrics(t).rMultiple ?? 0), 0) / closedTrades.length
      : 0;

    return { totalTrades, winRate, totalPnl, avgRMultiple };
  }, [filteredTrades]);

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Handle filter change
  const handleFilterChange = (field: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  // Toggle a context tag in the filter
  const toggleContextTagFilter = (tag: string) => {
    setFilters((prev) => ({
      ...prev,
      contextTags: prev.contextTags.includes(tag)
        ? prev.contextTags.filter((t) => t !== tag)
        : [...prev.contextTags, tag],
    }));
  };

  // Clear all filters
  const clearFilters = () => {
    setFilters(initialFilters);
  };

  // Check if any filters are active (tradeTaken 'taken' is default, so only count as active if changed)
  const hasActiveFilters = filters.dateFrom !== '' ||
    filters.dateTo !== '' ||
    filters.pair !== '' ||
    filters.direction !== '' ||
    filters.status !== '' ||
    filters.contextTags.length > 0 ||
    filters.tradeTaken !== 'taken';

  // Format date for display
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Sort indicator component
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return (
      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={sortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'}
        />
      </svg>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Trade Log</h1>
          <p className="mt-1 text-gray-400">View and manage your trade history</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedTradeIds.size > 0 && (
            <button
              onClick={handleExportSelected}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Selected ({selectedTradeIds.size})
            </button>
          )}
          <Link
            to="/trades/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Trade
          </Link>
        </div>
      </div>

      {trades.length === 0 ? (
        /* Empty state */
        <div className="bg-gray-800 rounded-lg p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-white">No trades logged yet</h3>
          <p className="mt-2 text-gray-400">Start tracking your trading journey by logging your first trade.</p>
          <Link
            to="/trades/new"
            className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Log Your First Trade
          </Link>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
              {/* Show (Trade Taken Filter) */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Show</label>
                <select
                  value={filters.tradeTaken}
                  onChange={(e) => handleFilterChange('tradeTaken', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Trades</option>
                  <option value="taken">Taken Only</option>
                  <option value="missed">Missed Only</option>
                </select>
              </div>

              {/* Date From */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">From Date</label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Date To */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">To Date</label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Pair */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Pair</label>
                <select
                  value={filters.pair}
                  onChange={(e) => handleFilterChange('pair', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Pairs</option>
                  {filterOptions.pairs.map((pair) => (
                    <option key={pair} value={pair}>{pair}</option>
                  ))}
                </select>
              </div>

              {/* Direction */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Direction</label>
                <select
                  value={filters.direction}
                  onChange={(e) => handleFilterChange('direction', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All</option>
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All</option>
                  <option value="open">Open</option>
                  <option value="partial">Partial</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              {/* Context Tags Multi-Select */}
              <div className="relative">
                <label className="block text-xs text-gray-400 mb-1">Context Tags</label>
                <button
                  type="button"
                  onClick={() => setShowTagDropdown(!showTagDropdown)}
                  onBlur={() => setTimeout(() => setShowTagDropdown(false), 200)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-left flex items-center justify-between"
                >
                  <span className={filters.contextTags.length === 0 ? 'text-gray-400' : ''}>
                    {filters.contextTags.length === 0
                      ? 'All Tags'
                      : `${filters.contextTags.length} selected`}
                  </span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showTagDropdown && filterOptions.contextTags.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filterOptions.contextTags.map((tag) => (
                      <label
                        key={tag}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-600 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={filters.contextTags.includes(tag)}
                          onChange={() => toggleContextTagFilter(tag)}
                          className="rounded border-gray-500 bg-gray-600 text-blue-500 focus:ring-blue-500"
                        />
                        <span className="text-gray-200">{tag}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={clearFilters}
                  className="text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-sm text-gray-400">Total Trades</p>
              <p className="text-2xl font-bold text-white">{stats.totalTrades}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-sm text-gray-400">Win Rate</p>
              <p className={`text-2xl font-bold ${stats.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                {stats.winRate.toFixed(1)}%
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-sm text-gray-400">Total P&L</p>
              <p className={`text-2xl font-bold ${stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${stats.totalPnl.toFixed(2)}
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-sm text-gray-400">Avg R-Multiple</p>
              <p className={`text-2xl font-bold ${stats.avgRMultiple >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {stats.avgRMultiple >= 0 ? '+' : ''}{stats.avgRMultiple.toFixed(2)}R
              </p>
            </div>
          </div>

          {/* Trades - Mobile Cards / Desktop Table */}

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {sortedTrades.length === 0 ? (
              <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
                No trades match your filters
              </div>
            ) : (
              sortedTrades.map((trade) => {
                const metrics = getCachedMetrics(trade);
                const reviewStatus = getReviewStatus(trade);
                return (
                  <div
                    key={trade.id}
                    onClick={() => navigate(`/trades/${trade.id}`)}
                    className={`bg-gray-800 rounded-lg p-4 cursor-pointer active:bg-gray-750 transition-colors ${
                      trade.tradeTaken === false ? 'opacity-60' : ''
                    }`}
                  >
                    {/* Row 1: Pair, Direction, Status */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{trade.pair}</span>
                        {getCachedAuditErrors(trade) && (
                          <span className="inline-flex items-center justify-center w-4 h-4 bg-red-500 text-white text-xs font-bold rounded-full" title="Trade has data errors">!</span>
                        )}
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            trade.direction === 'long'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {trade.direction.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
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
                        {trade.tradeTaken === false && (
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-orange-500/20 text-orange-400">
                            Missed
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Row 2: P&L, R-Multiple, Review */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-4">
                        <span className={`font-medium ${
                          metrics.pnl === null
                            ? 'text-gray-400'
                            : metrics.pnl >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                        }`}>
                          {metrics.pnl !== null ? `$${metrics.pnl.toFixed(2)}` : '-'}
                        </span>
                        <span className={`text-sm ${
                          metrics.rMultiple === null
                            ? 'text-gray-400'
                            : metrics.rMultiple >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                        }`}>
                          {metrics.rMultiple !== null
                            ? `${metrics.rMultiple >= 0 ? '+' : ''}${metrics.rMultiple.toFixed(2)}R`
                            : '-'}
                        </span>
                      </div>
                      <div>
                        {reviewStatus === 'reviewed' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Reviewed
                          </span>
                        )}
                        {reviewStatus === 'due' && (
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400">
                            Due
                          </span>
                        )}
                        {reviewStatus === 'pending' && (
                          <span className="text-xs text-gray-500">Pending</span>
                        )}
                      </div>
                    </div>

                    {/* Row 3: Date, Age, Duration */}
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>{formatDate(trade.entryTime)}</span>
                      <div className="flex items-center gap-3">
                        <span title={formatDateTimeFull(getAgeTimestamp(trade))}>
                          {metrics.status === 'open' || metrics.status === 'partial' ? (
                            <span className="text-yellow-400">open {formatAge(new Date(trade.entryTime))}</span>
                          ) : (
                            formatAge(getAgeTimestamp(trade))
                          )}
                        </span>
                        <span>{formatDuration(metrics.holdDuration ?? undefined)}</span>
                      </div>
                    </div>

                    {/* Row 4: Tags (if any) */}
                    {trade.contextTags && trade.contextTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-gray-700">
                        {trade.contextTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                        {trade.contextTags.length > 3 && (
                          <span className="inline-flex px-1.5 py-0.5 bg-gray-600 text-gray-300 rounded text-xs">
                            +{trade.contextTags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block bg-gray-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="px-2 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={sortedTrades.length > 0 && selectedTradeIds.size === sortedTrades.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
                        title={selectedTradeIds.size === sortedTrades.length ? 'Deselect all' : 'Select all'}
                      />
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('entryTime')}
                        className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white"
                      >
                        Date/Time
                        <SortIndicator field="entryTime" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('pair')}
                        className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white"
                      >
                        Pair
                        <SortIndicator field="pair" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('direction')}
                        className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white"
                      >
                        Direction
                        <SortIndicator field="direction" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleSort('pnl')}
                        className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white ml-auto"
                      >
                        P&L
                        <SortIndicator field="pnl" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleSort('rMultiple')}
                        className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white ml-auto"
                      >
                        R-Multiple
                        <SortIndicator field="rMultiple" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('setupTags')}
                        className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white"
                      >
                        Context Tags
                        <SortIndicator field="setupTags" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('status')}
                        className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white"
                      >
                        Status
                        <SortIndicator field="status" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('review')}
                        className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white"
                      >
                        Review
                        <SortIndicator field="review" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleSort('age')}
                        className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white ml-auto"
                      >
                        Age
                        <SortIndicator field="age" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleSort('holdDuration')}
                        className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white ml-auto"
                      >
                        Duration
                        <SortIndicator field="holdDuration" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTrades.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center text-gray-400">
                        No trades match your filters
                      </td>
                    </tr>
                  ) : (
                    sortedTrades.map((trade) => {
                      const metrics = getCachedMetrics(trade);
                      return (
                        <tr
                          key={trade.id}
                          onClick={() => navigate(`/trades/${trade.id}`)}
                          className={`border-b border-gray-700 hover:bg-gray-750 cursor-pointer transition-colors ${
                            trade.tradeTaken === false ? 'opacity-60' : ''
                          } ${selectedTradeIds.has(trade.id!) ? 'bg-blue-500/10' : ''}`}
                        >
                          <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedTradeIds.has(trade.id!)}
                              onChange={(e) => toggleTradeSelection(trade.id!, e as unknown as React.MouseEvent)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-200">
                            {formatDate(trade.entryTime)}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-white">
                            <span className="flex items-center gap-1.5">
                              {trade.pair}
                              {getCachedAuditErrors(trade) && (
                                <span className="inline-flex items-center justify-center w-4 h-4 bg-red-500 text-white text-xs font-bold rounded-full" title="Trade has data errors">!</span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                                trade.direction === 'long'
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-red-500/20 text-red-400'
                              }`}
                            >
                              {trade.direction.toUpperCase()}
                            </span>
                          </td>
                          <td className={`px-4 py-3 text-sm text-right font-medium ${
                            metrics.pnl === null
                              ? 'text-gray-400'
                              : metrics.pnl >= 0
                                ? 'text-green-400'
                                : 'text-red-400'
                          }`}>
                            {metrics.pnl !== null ? `$${metrics.pnl.toFixed(2)}` : '-'}
                          </td>
                          <td className={`px-4 py-3 text-sm text-right font-medium ${
                            metrics.rMultiple === null
                              ? 'text-gray-400'
                              : metrics.rMultiple >= 0
                                ? 'text-green-400'
                                : 'text-red-400'
                          }`}>
                            {metrics.rMultiple !== null
                              ? `${metrics.rMultiple >= 0 ? '+' : ''}${metrics.rMultiple.toFixed(2)}R`
                              : '-'}
                          </td>
                          <td className="px-4 py-3">
                            {trade.contextTags && trade.contextTags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {trade.contextTags.slice(0, 2).map((tag) => (
                                  <span
                                    key={tag}
                                    className="inline-flex px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs"
                                  >
                                    {tag}
                                  </span>
                                ))}
                                {trade.contextTags.length > 2 && (
                                  <span className="inline-flex px-1.5 py-0.5 bg-gray-600 text-gray-300 rounded text-xs">
                                    +{trade.contextTags.length - 2}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
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
                              {trade.tradeTaken === false && (
                                <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-orange-500/20 text-orange-400">
                                  Missed
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {(() => {
                              const reviewStatus = getReviewStatus(trade);
                              if (reviewStatus === 'reviewed') {
                                return (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Reviewed
                                  </span>
                                );
                              }
                              if (reviewStatus === 'due') {
                                return (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/trades/${trade.id}`);
                                    }}
                                    className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
                                  >
                                    Due
                                  </button>
                                );
                              }
                              if (reviewStatus === 'pending') {
                                return (
                                  <span className="text-xs text-gray-500">
                                    Pending
                                  </span>
                                );
                              }
                              return <span className="text-sm text-gray-500">-</span>;
                            })()}
                          </td>
                          <td
                            className="px-4 py-3 text-sm text-gray-200 text-right"
                            title={formatDateTimeFull(getAgeTimestamp(trade))}
                          >
                            {metrics.status === 'open' || metrics.status === 'partial' ? (
                              <span className="text-yellow-400">open {formatAge(new Date(trade.entryTime))}</span>
                            ) : (
                              formatAge(getAgeTimestamp(trade))
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-200 text-right">
                            {formatDuration(metrics.holdDuration ?? undefined)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
