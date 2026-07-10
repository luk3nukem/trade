import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { db } from '../../db';
import { useAppStore } from '../../stores/appStore';
import type { TradeRecord, Account, Strategy } from '../../types';
import {
  filterTrades,
  calculateDashboardStats,
  generateEquityCurve,
  generateRollingPerformance,
  generateCalendarMonth,
  getOpenTrades,
  getRecentClosedTrades,
  getTradesForDate,
  calculateTimeHeld,
  isPostExitReviewComplete,
} from '../../utils';
import { AlertsPanel } from './AlertsPanel';

// Component to show trades that need post-exit review
function TradesToReviewSection({
  trades,
  navigate,
}: {
  trades: TradeRecord[];
  navigate: (path: string) => void;
}) {
  // Get trades that need review: closed, review incomplete, closed more than 72 hours ago
  // Uses full datetime precision (not just date)
  // Checks actual field completion, not just reviewedAt timestamp
  const tradesToReview = useMemo(() => {
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    return trades.filter((t) => {
      if (t.status !== 'closed') return false;
      // Check if review is actually complete (all 4 fields filled)
      const reviewComplete = isPostExitReviewComplete(
        t.postExitBestPrice,
        t.postExitWorstPrice,
        t.reachedTargetPostExit,
        t.postExitNotes
      );
      if (reviewComplete) return false;
      if (!t.exitTime) return false;
      const exitTime = new Date(t.exitTime);
      return exitTime < seventyTwoHoursAgo;
    }).sort((a, b) => {
      // Sort by exit time, oldest first
      const aExit = a.exitTime ? new Date(a.exitTime).getTime() : 0;
      const bExit = b.exitTime ? new Date(b.exitTime).getTime() : 0;
      return aExit - bExit;
    }).slice(0, 5); // Show at most 5
  }, [trades]);

  // Total count for display
  const totalUnreviewed = useMemo(() => {
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    return trades.filter((t) => {
      if (t.status !== 'closed') return false;
      const reviewComplete = isPostExitReviewComplete(
        t.postExitBestPrice,
        t.postExitWorstPrice,
        t.reachedTargetPostExit,
        t.postExitNotes
      );
      if (reviewComplete) return false;
      if (!t.exitTime) return false;
      const exitTime = new Date(t.exitTime);
      return exitTime < seventyTwoHoursAgo;
    }).length;
  }, [trades]);

  if (tradesToReview.length === 0) {
    return null;
  }

  const getTimeSinceClose = (exitTime: Date) => {
    const now = Date.now();
    const exitMs = new Date(exitTime).getTime();
    const diffMs = now - exitMs;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `closed ${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    }
    return `closed ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  };

  return (
    <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-medium text-white">
              {totalUnreviewed} {totalUnreviewed === 1 ? 'trade' : 'trades'} due for review
            </h3>
            <p className="text-sm text-gray-400">
              Record what happened after you exited to improve your exit strategy
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {tradesToReview.map((trade) => (
          <button
            key={trade.id}
            onClick={() => navigate(`/trades/${trade.id}`)}
            className="w-full flex items-center justify-between bg-gray-800/50 hover:bg-gray-800 rounded-lg p-3 transition-colors text-left"
          >
            <div className="flex items-center gap-4">
              <span className="font-medium text-white">{trade.pair}</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  trade.direction === 'long'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}
              >
                {trade.direction.charAt(0).toUpperCase()}
              </span>
              <span className="text-sm text-gray-400">
                {trade.exitTime ? getTimeSinceClose(trade.exitTime) : 'unknown'}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span
                className={`font-mono font-medium ${
                  (trade.rMultiple ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {trade.rMultiple !== undefined
                  ? `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R`
                  : '-'}
              </span>
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>

      {totalUnreviewed > 5 && (
        <p className="mt-3 text-sm text-gray-400 text-center">
          And {totalUnreviewed - 5} more...
        </p>
      )}
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    dashboardFilters,
    setDashboardFilters,
    clearDashboardFilters,
    selectedCalendarDate,
    setSelectedCalendarDate,
  } = useAppStore();

  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [equityMode, setEquityMode] = useState<'pnl' | 'r'>('pnl');
  const [calendarDate, setCalendarDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [showTagDropdown, setShowTagDropdown] = useState(false);

  // Get available setup tags from all trades
  const availableSetupTags = useMemo(() => {
    const allTags = trades.flatMap((t) => t.setupTags || []);
    return [...new Set(allTags)].filter(Boolean).sort();
  }, [trades]);

  // Toggle a setup tag in the filter
  const toggleSetupTagFilter = (tag: string) => {
    const currentTags = dashboardFilters.setupTags;
    const newTags = currentTags.includes(tag)
      ? currentTags.filter((t) => t !== tag)
      : [...currentTags, tag];
    setDashboardFilters({ setupTags: newTags });
  };

  // Load data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [allTrades, allAccounts, allStrategies] = await Promise.all([
          db.trades.toArray(),
          db.accounts.toArray(),
          db.strategies.toArray(),
        ]);
        setTrades(allTrades);
        setAccounts(allAccounts);
        setStrategies(allStrategies);
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Filter trades based on dashboard filters
  const filteredTrades = useMemo(() => {
    return filterTrades(trades, {
      dateFrom: dashboardFilters.dateFrom ? new Date(dashboardFilters.dateFrom) : undefined,
      dateTo: dashboardFilters.dateTo ? new Date(dashboardFilters.dateTo) : undefined,
      accountId: dashboardFilters.accountId || undefined,
      strategyId: dashboardFilters.strategyId || undefined,
      setupTags: dashboardFilters.setupTags?.length > 0 ? dashboardFilters.setupTags : undefined,
    });
  }, [trades, dashboardFilters]);

  // Exclude missed/paper trades from dashboard stats (tradeTaken === false)
  const takenTrades = useMemo(() => {
    return filteredTrades.filter((t) => t.tradeTaken !== false);
  }, [filteredTrades]);

  // All taken trades (unfiltered) - for review section which should show regardless of dashboard filters
  const allTakenTrades = useMemo(() => {
    return trades.filter((t) => t.tradeTaken !== false);
  }, [trades]);

  // Calculate stats (only from taken trades)
  const stats = useMemo(() => calculateDashboardStats(takenTrades), [takenTrades]);

  // Generate chart data (only from taken trades)
  const equityCurveData = useMemo(() => generateEquityCurve(takenTrades), [takenTrades]);
  const rollingData = useMemo(() => generateRollingPerformance(takenTrades, 20), [takenTrades]);
  const calendarData = useMemo(
    () => generateCalendarMonth(takenTrades, calendarDate.year, calendarDate.month),
    [takenTrades, calendarDate]
  );

  // Get open trades and recent trades (only from taken trades)
  const openTrades = useMemo(() => getOpenTrades(takenTrades), [takenTrades]);

  // Recent trades (possibly filtered by calendar date, only taken trades)
  const recentTrades = useMemo(() => {
    if (selectedCalendarDate) {
      return getTradesForDate(takenTrades, selectedCalendarDate);
    }
    return getRecentClosedTrades(takenTrades, 10);
  }, [takenTrades, selectedCalendarDate]);

  // Check if filters are active
  const hasActiveFilters = dashboardFilters.dateFrom !== '' ||
    dashboardFilters.dateTo !== '' ||
    dashboardFilters.accountId !== '' ||
    dashboardFilters.strategyId !== '' ||
    dashboardFilters.setupTags.length > 0;

  // Format date for display
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Navigate calendar
  const prevMonth = () => {
    setCalendarDate((prev) => {
      const newMonth = prev.month - 1;
      if (newMonth < 0) {
        return { year: prev.year - 1, month: 11 };
      }
      return { ...prev, month: newMonth };
    });
  };

  const nextMonth = () => {
    setCalendarDate((prev) => {
      const newMonth = prev.month + 1;
      if (newMonth > 11) {
        return { year: prev.year + 1, month: 0 };
      }
      return { ...prev, month: newMonth };
    });
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

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
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="mt-1 text-gray-400">Overview of your trading performance</p>
        </div>
      </div>

      {/* Global Filters */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">From Date</label>
            <input
              type="date"
              value={dashboardFilters.dateFrom}
              onChange={(e) => setDashboardFilters({ dateFrom: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To Date</label>
            <input
              type="date"
              value={dashboardFilters.dateTo}
              onChange={(e) => setDashboardFilters({ dateTo: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Account</label>
            <select
              value={dashboardFilters.accountId}
              onChange={(e) => setDashboardFilters({ accountId: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Accounts</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Strategy</label>
            <select
              value={dashboardFilters.strategyId}
              onChange={(e) => setDashboardFilters({ strategyId: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Strategies</option>
              {strategies.map((strat) => (
                <option key={strat.id} value={strat.id}>{strat.name}</option>
              ))}
            </select>
          </div>
          {/* Setup Tags Multi-Select */}
          <div className="relative">
            <label className="block text-xs text-gray-400 mb-1">Setup Tags</label>
            <button
              type="button"
              onClick={() => setShowTagDropdown(!showTagDropdown)}
              onBlur={() => setTimeout(() => setShowTagDropdown(false), 200)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-left flex items-center justify-between"
            >
              <span className={dashboardFilters.setupTags.length === 0 ? 'text-gray-400' : ''}>
                {dashboardFilters.setupTags.length === 0
                  ? 'All Tags'
                  : `${dashboardFilters.setupTags.length} selected`}
              </span>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showTagDropdown && availableSetupTags.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {availableSetupTags.map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-gray-600 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={dashboardFilters.setupTags.includes(tag)}
                      onChange={() => toggleSetupTagFilter(tag)}
                      className="rounded border-gray-500 bg-gray-600 text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-gray-200">{tag}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        {hasActiveFilters && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={clearDashboardFilters}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {/* Alerts Panel */}
      <AlertsPanel />

      {/* Trades to Review Section */}
      <TradesToReviewSection trades={allTakenTrades} navigate={navigate} />

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        {/* Total Trades */}
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400">Total Trades</p>
          <p className="text-xl font-bold text-white">{stats.totalTrades}</p>
        </div>

        {/* Win Rate */}
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400">Win Rate</p>
          <p className={`text-xl font-bold ${stats.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
            {stats.winRate.toFixed(1)}%
          </p>
        </div>

        {/* Profit Factor */}
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400">Profit Factor</p>
          <p className={`text-xl font-bold ${stats.profitFactor >= 1 ? 'text-green-400' : 'text-red-400'}`}>
            {stats.profitFactor.toFixed(2)}
          </p>
        </div>

        {/* Expectancy */}
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400">Expectancy</p>
          <p className={`text-xl font-bold ${stats.expectancy >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {stats.expectancy >= 0 ? '+' : ''}{stats.expectancy.toFixed(2)}R
          </p>
        </div>

        {/* Avg Winner / Avg Loser */}
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400">Avg Win / Loss</p>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-green-400">+{stats.avgWinnerR.toFixed(1)}R</span>
            <span className="text-gray-500">/</span>
            <span className="text-lg font-bold text-red-400">{stats.avgLoserR.toFixed(1)}R</span>
          </div>
        </div>

        {/* Max Drawdown */}
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400">Max Drawdown</p>
          <p className="text-xl font-bold text-red-400">
            ${stats.maxDrawdown.toFixed(0)}
          </p>
          <p className="text-xs text-gray-500">{stats.maxDrawdownPercent.toFixed(1)}%</p>
        </div>

        {/* Current Streak */}
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400">Streak</p>
          <p className={`text-xl font-bold ${
            stats.currentStreak.type === 'W' ? 'text-green-400' :
            stats.currentStreak.type === 'L' ? 'text-red-400' : 'text-gray-400'
          }`}>
            {stats.currentStreak.count}{stats.currentStreak.type || '-'}
          </p>
        </div>

        {/* Best / Worst Trade */}
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400">Best / Worst</p>
          <div className="space-y-0.5">
            <p className="text-sm">
              <span className="text-green-400">
                {stats.bestTrade ? `+${stats.bestTrade.rMultiple.toFixed(1)}R` : '-'}
              </span>
              {stats.bestTrade && <span className="text-gray-500 text-xs ml-1">{stats.bestTrade.pair}</span>}
            </p>
            <p className="text-sm">
              <span className="text-red-400">
                {stats.worstTrade ? `${stats.worstTrade.rMultiple.toFixed(1)}R` : '-'}
              </span>
              {stats.worstTrade && <span className="text-gray-500 text-xs ml-1">{stats.worstTrade.pair}</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Equity Curve */}
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-white">Equity Curve</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setEquityMode('pnl')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  equityMode === 'pnl'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                $ P&L
              </button>
              <button
                onClick={() => setEquityMode('r')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  equityMode === 'r'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                R-Multiple
              </button>
            </div>
          </div>

          {equityCurveData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={equityCurveData}>
                <defs>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  stroke="#6b7280"
                  fontSize={12}
                />
                <YAxis
                  stroke="#6b7280"
                  fontSize={12}
                  tickFormatter={(value) => equityMode === 'pnl' ? `$${value}` : `${value}R`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  labelFormatter={(date) => new Date(date).toLocaleDateString()}
                  formatter={(value: number, name: string) => {
                    if (name === 'cumulativePnl' || name === 'pnl') {
                      return [`$${value.toFixed(2)}`, name === 'cumulativePnl' ? 'Cumulative' : 'Trade P&L'];
                    }
                    return [`${value.toFixed(2)}R`, name === 'cumulativeR' ? 'Cumulative' : 'Trade R'];
                  }}
                />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey={equityMode === 'pnl' ? 'cumulativePnl' : 'cumulativeR'}
                  stroke={stats.totalNetPnl >= 0 ? '#22c55e' : '#ef4444'}
                  fill={stats.totalNetPnl >= 0 ? 'url(#colorProfit)' : 'url(#colorLoss)'}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-gray-500">
              No closed trades to display
            </div>
          )}
        </div>

        {/* Rolling Performance */}
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-medium text-white">Rolling Performance</h3>
              <p className="text-xs text-gray-400">Last 20 trades - Is your edge alive?</p>
            </div>
          </div>

          {rollingData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={rollingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="tradeIndex"
                  stroke="#6b7280"
                  fontSize={12}
                  label={{ value: 'Trade #', position: 'bottom', fill: '#6b7280', fontSize: 10 }}
                />
                <YAxis
                  yAxisId="left"
                  stroke="#6b7280"
                  fontSize={12}
                  domain={[-2, 2]}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#6b7280"
                  fontSize={12}
                  domain={[0, 3]}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'rollingExpectancy') return [`${value.toFixed(2)}R`, 'Expectancy'];
                    return [value.toFixed(2), 'Profit Factor'];
                  }}
                />
                <ReferenceLine yAxisId="left" y={0} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'Break-even', fill: '#f59e0b', fontSize: 10 }} />
                <ReferenceLine yAxisId="right" y={1} stroke="#6b7280" strokeDasharray="3 3" />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="rollingExpectancy"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="rollingExpectancy"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="rollingProfitFactor"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={false}
                  name="rollingProfitFactor"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-gray-500">
              Need at least 20 trades for rolling analysis
            </div>
          )}

          <div className="flex justify-center gap-6 mt-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-blue-500" />
              <span className="text-gray-400">Expectancy (R)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-purple-500" />
              <span className="text-gray-400">Profit Factor</span>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Heatmap */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">Trading Calendar</h3>
          <div className="flex items-center gap-4">
            <button
              onClick={prevMonth}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-white font-medium min-w-[140px] text-center">
              {monthNames[calendarDate.month]} {calendarDate.year}
            </span>
            <button
              onClick={nextMonth}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1">
          {/* Day headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="text-center text-xs text-gray-500 py-2">
              {day}
            </div>
          ))}

          {/* Empty cells for days before the first of the month */}
          {Array.from({ length: new Date(calendarDate.year, calendarDate.month, 1).getDay() }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}

          {/* Calendar days */}
          {calendarData.days.map((day) => {
            const isSelected = selectedCalendarDate === day.dateStr;
            const bgColor = day.trades === 0
              ? 'bg-gray-700'
              : day.intensity > 0
                ? day.intensity > 0.5
                  ? 'bg-green-600'
                  : 'bg-green-800'
                : day.intensity < -0.5
                  ? 'bg-red-600'
                  : 'bg-red-800';

            return (
              <button
                key={day.dateStr}
                onClick={() => setSelectedCalendarDate(isSelected ? null : day.dateStr)}
                className={`aspect-square rounded flex flex-col items-center justify-center text-xs transition-all ${bgColor} ${
                  isSelected ? 'ring-2 ring-blue-500' : ''
                } hover:ring-2 hover:ring-gray-500`}
                title={`${day.dateStr}: ${day.trades} trades, $${day.netPnl.toFixed(2)}`}
              >
                <span className="text-gray-200">{day.date.getDate()}</span>
                {day.trades > 0 && (
                  <span className="text-[10px] text-gray-400">{day.trades}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-600" />
            <span>Loss</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-gray-700" />
            <span>No trades</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-600" />
            <span>Profit</span>
          </div>
        </div>

        {selectedCalendarDate && (
          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">
                Showing trades for {new Date(selectedCalendarDate).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric'
                })}
              </p>
              <button
                onClick={() => setSelectedCalendarDate(null)}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                Show recent trades
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Open Trades Panel */}
      {openTrades.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Open Trades</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {openTrades.map((trade) => (
              <button
                key={trade.id}
                onClick={() => navigate(`/trades/${trade.id}`)}
                className="bg-gray-750 rounded-lg p-4 text-left hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-white">{trade.pair}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      trade.direction === 'long'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {trade.direction.toUpperCase()}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-400">Entry:</span>
                    <span className="ml-1 text-gray-200 font-mono">{trade.entryPrice}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Stop:</span>
                    <span className="ml-1 text-red-400 font-mono">{trade.stopLoss}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Risk:</span>
                    <span className="ml-1 text-gray-200">
                      {trade.riskAmount ? `$${trade.riskAmount.toFixed(2)}` : '-1R'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">Time:</span>
                    <span className="ml-1 text-gray-200">{calculateTimeHeld(trade.entryTime)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent Trades Table */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">
            {selectedCalendarDate ? 'Trades for Selected Date' : 'Recent Trades'}
          </h3>
          <Link
            to="/trades"
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            View All
          </Link>
        </div>

        {recentTrades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Pair</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Dir</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">Entry</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">Exit</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">P&L</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">R</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Setup</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((trade) => (
                  <tr
                    key={trade.id}
                    onClick={() => navigate(`/trades/${trade.id}`)}
                    className="border-b border-gray-700 hover:bg-gray-750 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 text-xs text-gray-300">
                      {formatDate(trade.exitTime || trade.entryTime)}
                    </td>
                    <td className="px-3 py-2 text-xs font-medium text-white">{trade.pair}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          trade.direction === 'long'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {trade.direction.charAt(0).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-300 text-right font-mono">
                      {trade.entryPrice}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-300 text-right font-mono">
                      {trade.exitPrice ?? '-'}
                    </td>
                    <td className={`px-3 py-2 text-xs text-right font-medium ${
                      (trade.netPnl ?? trade.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      ${(trade.netPnl ?? trade.pnl ?? 0).toFixed(2)}
                    </td>
                    <td className={`px-3 py-2 text-xs text-right font-medium ${
                      (trade.rMultiple ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {trade.rMultiple !== undefined
                        ? `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R`
                        : '-'}
                    </td>
                    <td className="px-3 py-2">
                      {trade.setupTags && trade.setupTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {trade.setupTags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex px-1 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px]"
                            >
                              {tag}
                            </span>
                          ))}
                          {trade.setupTags.length > 2 && (
                            <span className="text-[10px] text-gray-400">+{trade.setupTags.length - 2}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            {selectedCalendarDate ? 'No trades on this date' : 'No trades logged yet'}
          </div>
        )}
      </div>
    </div>
  );
}
