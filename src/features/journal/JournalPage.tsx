import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db';
import { useAppStore } from '../../stores/appStore';
import { createScreenshotUrl } from '../../utils/screenshotHelpers';
import type { TradeRecord, DailyJournal, Account } from '../../types';
import { DailyJournalForm } from './DailyJournalForm';

type JournalTab = 'timeline' | 'daily' | 'weekly' | 'screenshots';

const TABS: { id: JournalTab; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'daily', label: 'Daily Journal' },
  { id: 'weekly', label: 'Weekly Review' },
  { id: 'screenshots', label: 'Screenshots' },
];

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-500',
  B: 'bg-blue-500',
  C: 'bg-yellow-500',
  D: 'bg-orange-500',
  F: 'bg-red-500',
};

export function JournalPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<JournalTab>('timeline');
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [journals, setJournals] = useState<DailyJournal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // Timeline state
  const [timelineVisibleDays, setTimelineVisibleDays] = useState(14);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // Daily journal state
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [showJournalForm, setShowJournalForm] = useState(false);

  // Weekly review state
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    return monday;
  });

  // Screenshots state
  const [screenshotFilter, setScreenshotFilter] = useState({ pair: '', dateFrom: '', dateTo: '' });
  const [selectedScreenshot, setSelectedScreenshot] = useState<{
    url: string;
    pair: string;
    rMultiple: number;
    tradeId?: string;
    date: string;
  } | null>(null);
  const [screenshotBlobUrls, setScreenshotBlobUrls] = useState<Record<string, string>>({});

  const { dashboardFilters } = useAppStore();

  // Load data
  const loadData = useCallback(async () => {
    try {
      const [allTrades, allJournals, allAccounts] = await Promise.all([
        db.trades.toArray(),
        db.dailyJournals.toArray(),
        db.accounts.toArray(),
      ]);
      setTrades(allTrades);
      setJournals(allJournals);
      setAccounts(allAccounts);
    } catch (error) {
      console.error('Failed to load journal data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Timeline data grouped by date
  const timelineData = useMemo(() => {
    const closedTrades = trades
      .filter(t => t.status === 'closed')
      .sort((a, b) => new Date(b.exitTime!).getTime() - new Date(a.exitTime!).getTime());

    const dayMap = new Map<string, { trades: TradeRecord[]; journal?: DailyJournal }>();

    // Group trades by date
    for (const trade of closedTrades) {
      const dateStr = new Date(trade.exitTime!).toISOString().split('T')[0];
      if (!dayMap.has(dateStr)) {
        dayMap.set(dateStr, { trades: [] });
      }
      dayMap.get(dateStr)!.trades.push(trade);
    }

    // Add journal entries
    for (const journal of journals) {
      const dateStr = new Date(journal.date).toISOString().split('T')[0];
      if (!dayMap.has(dateStr)) {
        dayMap.set(dateStr, { trades: [], journal });
      } else {
        dayMap.get(dateStr)!.journal = journal;
      }
    }

    // Convert to array and sort by date descending
    return Array.from(dayMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateStr, data]) => ({ dateStr, ...data }));
  }, [trades, journals]);

  // Calendar data for daily journal
  const calendarData = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const journalDates = new Set(
      journals.map(j => new Date(j.date).toISOString().split('T')[0])
    );
    const tradeDates = new Set(
      trades.map(t => new Date(t.entryTime).toISOString().split('T')[0])
    );

    const days: Array<{
      date: Date;
      isCurrentMonth: boolean;
      hasJournal: boolean;
      hasTrades: boolean;
    }> = [];

    // Previous month padding
    for (let i = startPadding - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      days.push({
        date,
        isCurrentMonth: false,
        hasJournal: journalDates.has(date.toISOString().split('T')[0]),
        hasTrades: tradeDates.has(date.toISOString().split('T')[0]),
      });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      days.push({
        date,
        isCurrentMonth: true,
        hasJournal: journalDates.has(date.toISOString().split('T')[0]),
        hasTrades: tradeDates.has(date.toISOString().split('T')[0]),
      });
    }

    // Next month padding
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const date = new Date(year, month + 1, d);
      days.push({
        date,
        isCurrentMonth: false,
        hasJournal: journalDates.has(date.toISOString().split('T')[0]),
        hasTrades: tradeDates.has(date.toISOString().split('T')[0]),
      });
    }

    return days;
  }, [calendarMonth, journals, trades]);

  // Weekly review data
  const weeklyData = useMemo(() => {
    const weekEnd = new Date(selectedWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const weekTrades = trades.filter(t => {
      if (t.status !== 'closed' || !t.exitTime) return false;
      const exitDate = new Date(t.exitTime);
      return exitDate >= selectedWeekStart && exitDate <= weekEnd;
    });

    const wins = weekTrades.filter(t => (t.rMultiple ?? 0) > 0);
    const totalPnl = weekTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const avgR = weekTrades.length > 0
      ? weekTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / weekTrades.length
      : 0;

    const sorted = [...weekTrades].sort((a, b) => (b.rMultiple ?? 0) - (a.rMultiple ?? 0));
    const bestTrade = sorted[0];
    const worstTrade = sorted[sorted.length - 1];

    // Find Friday journal entry with weekly review
    const friday = new Date(selectedWeekStart);
    friday.setDate(friday.getDate() + 4);
    const fridayStr = friday.toISOString().split('T')[0];
    const weeklyJournal = journals.find(j => {
      const journalDate = new Date(j.date).toISOString().split('T')[0];
      return journalDate === fridayStr && j.isWeeklyReview;
    });

    return {
      weekStart: selectedWeekStart,
      weekEnd,
      trades: weekTrades,
      stats: {
        totalTrades: weekTrades.length,
        winRate: weekTrades.length > 0 ? (wins.length / weekTrades.length) * 100 : 0,
        totalPnl,
        avgR,
        bestTrade,
        worstTrade,
      },
      weeklyJournal,
    };
  }, [selectedWeekStart, trades, journals]);

  // Screenshots data - collect all screenshots from filtered trades
  const screenshotsData = useMemo(() => {
    const screenshots: Array<{
      id: string;
      blob?: Blob;
      data?: string;
      caption: string;
      pair: string;
      rMultiple: number;
      tradeId?: string;
      date: string;
    }> = [];

    for (const trade of trades) {
      if (!trade.screenshots || trade.screenshots.length === 0) continue;

      // Apply filters
      if (screenshotFilter.pair && !trade.pair.toLowerCase().includes(screenshotFilter.pair.toLowerCase())) {
        continue;
      }
      if (screenshotFilter.dateFrom) {
        const tradeDate = new Date(trade.entryTime).toISOString().split('T')[0];
        if (tradeDate < screenshotFilter.dateFrom) continue;
      }
      if (screenshotFilter.dateTo) {
        const tradeDate = new Date(trade.entryTime).toISOString().split('T')[0];
        if (tradeDate > screenshotFilter.dateTo) continue;
      }

      for (const ss of trade.screenshots) {
        if (ss.blob || (ss.data && ss.data.length > 0)) {
          screenshots.push({
            id: ss.id,
            blob: ss.blob,
            data: ss.data,
            caption: ss.caption,
            pair: trade.pair,
            rMultiple: trade.rMultiple ?? 0,
            tradeId: trade.id,
            date: new Date(trade.entryTime).toISOString().split('T')[0],
          });
        }
      }
    }

    return screenshots.sort((a, b) => b.date.localeCompare(a.date));
  }, [trades, screenshotFilter]);

  // Create blob URLs for screenshots
  useEffect(() => {
    const newUrls: Record<string, string> = {};

    for (const ss of screenshotsData) {
      // Use utility function to safely create URL (handles Blob, Uint8Array, ArrayBuffer, base64)
      const url = createScreenshotUrl(ss as { id: string; blob?: Blob; data?: string; caption: string; createdAt: Date });
      if (url) {
        newUrls[ss.id] = url;
      }
    }

    // Cleanup old blob URLs
    for (const [id, url] of Object.entries(screenshotBlobUrls)) {
      if (!newUrls[id] && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }

    setScreenshotBlobUrls(newUrls);

    // Cleanup on unmount
    return () => {
      for (const url of Object.values(newUrls)) {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshotsData]);

  // Get selected day's journal
  const selectedDayJournal = useMemo(() => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    return journals.find(j => {
      const journalDate = new Date(j.date).toISOString().split('T')[0];
      return journalDate === dateStr;
    });
  }, [selectedDate, journals]);

  // Weekly review save handler
  const handleSaveWeeklyReview = async (
    didWell: string,
    toImprove: string,
    adjustment: string
  ) => {
    const friday = new Date(selectedWeekStart);
    friday.setDate(friday.getDate() + 4);
    friday.setHours(12, 0, 0, 0);

    const existingEntry = weeklyData.weeklyJournal;
    const now = new Date();

    if (existingEntry) {
      await db.dailyJournals.update(existingEntry.id, {
        weeklyDidWell: didWell,
        weeklyToImprove: toImprove,
        weeklyAdjustment: adjustment,
        updatedAt: now,
      });
    } else {
      // Find the default account ID (by isDefault flag)
      const defaultAccount = accounts.find(a => a.isDefault);
      const accountId = dashboardFilters.accountId || defaultAccount?.id || '';

      // Don't provide an id - let Dexie Cloud generate it with @id schema
      const newEntry = {
        date: friday,
        accountId,
        isWeeklyReview: true,
        weeklyDidWell: didWell,
        weeklyToImprove: toImprove,
        weeklyAdjustment: adjustment,
        createdAt: now,
        updatedAt: now,
      };
      await db.dailyJournals.add(newEntry as DailyJournal);
    }

    loadData();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const toggleDayExpanded = (dateStr: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) {
        next.delete(dateStr);
      } else {
        next.add(dateStr);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  const renderTimelineTab = () => (
    <div className="space-y-4">
      {timelineData.slice(0, timelineVisibleDays).map(({ dateStr, trades: dayTrades, journal }) => (
        <div key={dateStr} className="bg-gray-800 rounded-lg overflow-hidden">
          {/* Day Header */}
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-white font-medium">{formatDate(dateStr)}</span>
                {journal && (
                  <div className="flex items-center gap-2">
                    {journal.grade && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${GRADE_COLORS[journal.grade]}`}>
                        {journal.grade}
                      </span>
                    )}
                    {journal.emotionalScore && (
                      <span className="text-xs text-gray-400">
                        Mood: {journal.emotionalScore}/5
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">
                  {dayTrades.length} trade{dayTrades.length !== 1 ? 's' : ''}
                </span>
                {journal && (
                  <button
                    onClick={() => toggleDayExpanded(dateStr)}
                    className="text-blue-400 hover:text-blue-300 text-sm"
                  >
                    {expandedDays.has(dateStr) ? 'Collapse' : 'Expand'}
                  </button>
                )}
              </div>
            </div>

            {/* Journal Preview */}
            {journal && !expandedDays.has(dateStr) && journal.preMarketNotes && (
              <p className="mt-2 text-sm text-gray-400 line-clamp-2">
                {journal.preMarketNotes.substring(0, 100)}
                {journal.preMarketNotes.length > 100 ? '...' : ''}
              </p>
            )}

            {/* Expanded Journal */}
            {journal && expandedDays.has(dateStr) && (
              <div className="mt-4 space-y-3 text-sm">
                {journal.preMarketNotes && (
                  <div>
                    <span className="text-gray-500">Pre-market:</span>
                    <p className="text-gray-300 mt-1">{journal.preMarketNotes}</p>
                  </div>
                )}
                {journal.endOfDayNotes && (
                  <div>
                    <span className="text-gray-500">End of day:</span>
                    <p className="text-gray-300 mt-1">{journal.endOfDayNotes}</p>
                  </div>
                )}
                {journal.lessonsLearned && (
                  <div>
                    <span className="text-gray-500">Lesson:</span>
                    <p className="text-gray-300 mt-1">{journal.lessonsLearned}</p>
                  </div>
                )}
              </div>
            )}

            {/* Add Journal CTA */}
            {!journal && dayTrades.length > 0 && (
              <button
                onClick={() => {
                  setSelectedDate(new Date(dateStr));
                  setShowJournalForm(true);
                  setActiveTab('daily');
                }}
                className="mt-2 text-sm text-blue-400 hover:text-blue-300"
              >
                + Add journal entry
              </button>
            )}
          </div>

          {/* Trades List */}
          {dayTrades.length > 0 && (
            <div className="divide-y divide-gray-700/50">
              {dayTrades.map(trade => (
                <button
                  key={trade.id}
                  onClick={() => navigate(`/trades/${trade.id}`)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-750 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      trade.direction === 'long' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {trade.direction.toUpperCase()}
                    </span>
                    <span className="text-white">{trade.pair}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`font-medium ${
                      (trade.rMultiple ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {(trade.rMultiple ?? 0) >= 0 ? '+' : ''}{(trade.rMultiple ?? 0).toFixed(2)}R
                    </span>
                    <span className={`text-sm ${
                      (trade.netPnl ?? trade.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      ${(trade.netPnl ?? trade.pnl ?? 0).toFixed(2)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Load More */}
      {timelineVisibleDays < timelineData.length && (
        <button
          onClick={() => setTimelineVisibleDays(prev => prev + 14)}
          className="w-full py-3 text-blue-400 hover:text-blue-300 bg-gray-800 rounded-lg"
        >
          Load more days
        </button>
      )}

      {timelineData.length === 0 && (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">No trading activity yet</p>
        </div>
      )}
    </div>
  );

  const renderDailyJournalTab = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Calendar */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))}
            className="p-2 text-gray-400 hover:text-white"
          >
            &lt;
          </button>
          <span className="text-white font-medium">
            {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))}
            className="p-2 text-gray-400 hover:text-white"
          >
            &gt;
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-xs text-gray-500 py-1">{day}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {calendarData.map((day, i) => {
            const dateStr = day.date.toISOString().split('T')[0];
            const isSelected = selectedDate.toISOString().split('T')[0] === dateStr;
            const isToday = new Date().toISOString().split('T')[0] === dateStr;

            return (
              <button
                key={i}
                onClick={() => {
                  setSelectedDate(day.date);
                  setShowJournalForm(true);
                }}
                className={`
                  relative p-2 rounded-lg text-sm transition-colors
                  ${!day.isCurrentMonth ? 'text-gray-600' : 'text-gray-300'}
                  ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}
                  ${isToday && !isSelected ? 'ring-1 ring-blue-500' : ''}
                `}
              >
                {day.date.getDate()}
                {(day.hasJournal || day.hasTrades) && (
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                    {day.hasJournal && <div className="w-1 h-1 rounded-full bg-blue-400" />}
                    {day.hasTrades && <div className="w-1 h-1 rounded-full bg-green-400" />}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex justify-center">
          <button
            onClick={() => {
              setSelectedDate(new Date());
              setCalendarMonth(new Date());
              setShowJournalForm(true);
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
          >
            Today
          </button>
        </div>

        <div className="mt-4 flex justify-center gap-4 text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-400" />
            <span>Journal</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span>Trades</span>
          </div>
        </div>
      </div>

      {/* Journal Form */}
      <div className="bg-gray-800 rounded-lg p-4">
        {showJournalForm ? (
          <DailyJournalForm
            date={selectedDate}
            accountId={dashboardFilters.accountId || undefined}
            onSave={() => {
              loadData();
              setShowJournalForm(false);
            }}
            onCancel={() => setShowJournalForm(false)}
          />
        ) : selectedDayJournal ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-white">
                {selectedDate.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </h3>
              <button
                onClick={() => setShowJournalForm(true)}
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                Edit
              </button>
            </div>
            {selectedDayJournal.grade && (
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded text-sm font-medium text-white ${GRADE_COLORS[selectedDayJournal.grade]}`}>
                  Grade: {selectedDayJournal.grade}
                </span>
                {selectedDayJournal.emotionalScore && (
                  <span className="text-gray-400">
                    Mood: {selectedDayJournal.emotionalScore}/5
                  </span>
                )}
              </div>
            )}
            {selectedDayJournal.preMarketNotes && (
              <div>
                <h4 className="text-sm text-gray-500 mb-1">Pre-Market Notes</h4>
                <p className="text-gray-300 text-sm">{selectedDayJournal.preMarketNotes}</p>
              </div>
            )}
            {selectedDayJournal.endOfDayNotes && (
              <div>
                <h4 className="text-sm text-gray-500 mb-1">End of Day Review</h4>
                <p className="text-gray-300 text-sm">{selectedDayJournal.endOfDayNotes}</p>
              </div>
            )}
            {selectedDayJournal.lessonsLearned && (
              <div>
                <h4 className="text-sm text-gray-500 mb-1">Lesson Learned</h4>
                <p className="text-gray-300 text-sm">{selectedDayJournal.lessonsLearned}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">No journal entry for this day</p>
            <button
              onClick={() => setShowJournalForm(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              Create Entry
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderWeeklyReviewTab = () => {
    const { stats, weeklyJournal } = weeklyData;

    return (
      <div className="space-y-6">
        {/* Week Selector */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => {
              const prev = new Date(selectedWeekStart);
              prev.setDate(prev.getDate() - 7);
              setSelectedWeekStart(prev);
            }}
            className="p-2 text-gray-400 hover:text-white"
          >
            &lt;
          </button>
          <span className="text-white font-medium">
            {selectedWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {' - '}
            {weeklyData.weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <button
            onClick={() => {
              const next = new Date(selectedWeekStart);
              next.setDate(next.getDate() + 7);
              setSelectedWeekStart(next);
            }}
            className="p-2 text-gray-400 hover:text-white"
          >
            &gt;
          </button>
        </div>

        {/* Week Stats */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">Week Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-gray-750 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">Trades</p>
              <p className="text-xl font-bold text-white">{stats.totalTrades}</p>
            </div>
            <div className="bg-gray-750 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">Win Rate</p>
              <p className="text-xl font-bold text-white">{stats.winRate.toFixed(1)}%</p>
            </div>
            <div className="bg-gray-750 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">Total P&L</p>
              <p className={`text-xl font-bold ${stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${stats.totalPnl.toFixed(2)}
              </p>
            </div>
            <div className="bg-gray-750 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">Avg R</p>
              <p className={`text-xl font-bold ${stats.avgR >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {stats.avgR.toFixed(2)}R
              </p>
            </div>
            <div className="bg-gray-750 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">Best/Worst</p>
              <div className="flex justify-center gap-2 text-sm">
                {stats.bestTrade && (
                  <span className="text-green-400">+{(stats.bestTrade.rMultiple ?? 0).toFixed(1)}R</span>
                )}
                {stats.bestTrade && stats.worstTrade && <span className="text-gray-500">/</span>}
                {stats.worstTrade && (
                  <span className="text-red-400">{(stats.worstTrade.rMultiple ?? 0).toFixed(1)}R</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Unreviewed Trades & Post-Exit Stats */}
        <WeeklyPostExitSection
          weekTrades={weeklyData.trades}
        />

        {/* Weekly Review Form */}
        <WeeklyReviewForm
          didWell={weeklyJournal?.weeklyDidWell || ''}
          toImprove={weeklyJournal?.weeklyToImprove || ''}
          adjustment={weeklyJournal?.weeklyAdjustment || ''}
          onSave={handleSaveWeeklyReview}
        />
      </div>
    );
  };

  const renderScreenshotsTab = () => (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Pair</label>
            <input
              type="text"
              value={screenshotFilter.pair}
              onChange={(e) => setScreenshotFilter(prev => ({ ...prev, pair: e.target.value }))}
              placeholder="Filter by pair..."
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">From Date</label>
            <input
              type="date"
              value={screenshotFilter.dateFrom}
              onChange={(e) => setScreenshotFilter(prev => ({ ...prev, dateFrom: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To Date</label>
            <input
              type="date"
              value={screenshotFilter.dateTo}
              onChange={(e) => setScreenshotFilter(prev => ({ ...prev, dateTo: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Screenshot Grid */}
      {screenshotsData.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {screenshotsData.map((ss) => (
            <button
              key={ss.id}
              onClick={() => setSelectedScreenshot({
                url: screenshotBlobUrls[ss.id] || '',
                pair: ss.pair,
                rMultiple: ss.rMultiple,
                tradeId: ss.tradeId,
                date: ss.date,
              })}
              className="bg-gray-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all"
            >
              <div className="aspect-video bg-gray-900">
                {screenshotBlobUrls[ss.id] && (
                  <img
                    src={screenshotBlobUrls[ss.id]}
                    alt={`${ss.pair} trade`}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="p-2">
                <div className="flex items-center justify-between">
                  <span className="text-white text-sm font-medium">{ss.pair}</span>
                  <span className={`text-sm ${ss.rMultiple >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {ss.rMultiple >= 0 ? '+' : ''}{ss.rMultiple.toFixed(1)}R
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{ss.date}</p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">No screenshots found</p>
        </div>
      )}

      {/* Lightbox */}
      {selectedScreenshot && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedScreenshot(null)}
        >
          <div
            className="bg-gray-800 rounded-lg max-w-4xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <div>
                <span className="text-white font-medium">{selectedScreenshot.pair}</span>
                <span className={`ml-3 ${selectedScreenshot.rMultiple >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {selectedScreenshot.rMultiple >= 0 ? '+' : ''}{selectedScreenshot.rMultiple.toFixed(2)}R
                </span>
                <span className="ml-3 text-gray-400">{selectedScreenshot.date}</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate(`/trades/${selectedScreenshot.tradeId}`)}
                  className="text-blue-400 hover:text-blue-300 text-sm"
                >
                  View Trade
                </button>
                <button
                  onClick={() => setSelectedScreenshot(null)}
                  className="text-gray-400 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>
            <img
              src={selectedScreenshot.url}
              alt={`${selectedScreenshot.pair} trade`}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'timeline':
        return renderTimelineTab();
      case 'daily':
        return renderDailyJournalTab();
      case 'weekly':
        return renderWeeklyReviewTab();
      case 'screenshots':
        return renderScreenshotsTab();
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Journal</h1>
        <p className="mt-1 text-gray-400">Daily trading journal and reflections</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-700">
        <nav className="flex gap-1 -mb-px">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {renderTabContent()}
    </div>
  );
}

// Weekly Review Form Component
function WeeklyReviewForm({
  didWell,
  toImprove,
  adjustment,
  onSave,
}: {
  didWell: string;
  toImprove: string;
  adjustment: string;
  onSave: (didWell: string, toImprove: string, adjustment: string) => void;
}) {
  const [localDidWell, setLocalDidWell] = useState(didWell);
  const [localToImprove, setLocalToImprove] = useState(toImprove);
  const [localAdjustment, setLocalAdjustment] = useState(adjustment);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setLocalDidWell(didWell);
    setLocalToImprove(toImprove);
    setLocalAdjustment(adjustment);
  }, [didWell, toImprove, adjustment]);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(localDidWell, localToImprove, localAdjustment);
    setIsSaving(false);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 space-y-4">
      <h3 className="text-lg font-medium text-white">Weekly Review</h3>

      <div>
        <label className="block text-sm text-gray-400 mb-1">
          Top 3 things I did well this week
        </label>
        <textarea
          value={localDidWell}
          onChange={(e) => setLocalDidWell(e.target.value)}
          placeholder="1. &#10;2. &#10;3. "
          rows={4}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">
          Top 3 things to improve
        </label>
        <textarea
          value={localToImprove}
          onChange={(e) => setLocalToImprove(e.target.value)}
          placeholder="1. &#10;2. &#10;3. "
          rows={4}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">
          One specific adjustment for next week
        </label>
        <textarea
          value={localAdjustment}
          onChange={(e) => setLocalAdjustment(e.target.value)}
          placeholder="This week I will focus on..."
          rows={2}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save Review'}
        </button>
      </div>
    </div>
  );
}

// Weekly Post-Exit Section Component
function WeeklyPostExitSection({
  weekTrades,
}: {
  weekTrades: TradeRecord[];
}) {
  const navigate = useNavigate();

  // Get unreviewed closed trades from this week
  const unreviewedTrades = useMemo(() => {
    return weekTrades.filter(t =>
      t.status === 'closed' &&
      t.tradeTaken !== false &&
      !t.reviewedAt
    );
  }, [weekTrades]);

  // Calculate post-exit stats for reviewed trades
  const reviewedStats = useMemo(() => {
    const reviewedTrades = weekTrades.filter(t =>
      t.status === 'closed' &&
      t.tradeTaken !== false &&
      t.reviewedAt &&
      t.postExitBestPrice !== null
    );

    if (reviewedTrades.length === 0) {
      return null;
    }

    let totalMissedR = 0;
    let totalEfficiency = 0;
    let efficiencyCount = 0;

    for (const trade of reviewedTrades) {
      if (!trade.stopDistance || trade.stopDistance === 0 || trade.exitPrice === undefined) continue;

      // Calculate missed R
      const priceDiff = trade.postExitBestPrice! - trade.exitPrice;
      const signedMove = trade.direction === 'long' ? priceDiff : -priceDiff;
      const missedR = signedMove > 0 ? signedMove / trade.stopDistance : 0;
      totalMissedR += missedR;

      // Calculate exit efficiency
      if (trade.rMultiple !== undefined && trade.rMultiple > 0) {
        const wouldHaveR = Math.abs(trade.postExitBestPrice! - trade.entryPrice) / trade.stopDistance;
        if (wouldHaveR > 0) {
          const efficiency = (trade.rMultiple / wouldHaveR) * 100;
          totalEfficiency += efficiency;
          efficiencyCount++;
        }
      }
    }

    return {
      tradesReviewed: reviewedTrades.length,
      avgMissedR: totalMissedR / reviewedTrades.length,
      avgExitEfficiency: efficiencyCount > 0 ? totalEfficiency / efficiencyCount : null,
    };
  }, [weekTrades]);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  // Don't render if no data to show
  if (unreviewedTrades.length === 0 && !reviewedStats) {
    return null;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6 space-y-4">
      <h3 className="text-lg font-medium text-white">Post-Exit Review Status</h3>

      {/* Unreviewed Trades */}
      {unreviewedTrades.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-yellow-400 mb-3">
            {unreviewedTrades.length} {unreviewedTrades.length === 1 ? 'trade needs' : 'trades need'} post-exit review
          </h4>
          <div className="space-y-2">
            {unreviewedTrades.slice(0, 5).map((trade) => (
              <button
                key={trade.id}
                onClick={() => navigate(`/trades/${trade.id}`)}
                className="w-full flex items-center justify-between bg-gray-800/50 hover:bg-gray-700 rounded-lg p-2 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
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
                    {trade.exitTime ? formatDate(trade.exitTime) : ''}
                  </span>
                </div>
                <span
                  className={`font-mono font-medium ${
                    (trade.rMultiple ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {trade.rMultiple !== undefined
                    ? `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R`
                    : '-'}
                </span>
              </button>
            ))}
            {unreviewedTrades.length > 5 && (
              <p className="text-sm text-gray-500 text-center">
                +{unreviewedTrades.length - 5} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Reviewed Stats */}
      {reviewedStats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-gray-750 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400">Trades Reviewed</p>
            <p className="text-xl font-bold text-white">{reviewedStats.tradesReviewed}</p>
          </div>
          {reviewedStats.avgExitEfficiency !== null && (
            <div className="bg-gray-750 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">Avg Exit Efficiency</p>
              <p className={`text-xl font-bold ${
                reviewedStats.avgExitEfficiency >= 70
                  ? 'text-green-400'
                  : reviewedStats.avgExitEfficiency >= 50
                    ? 'text-yellow-400'
                    : 'text-red-400'
              }`}>
                {reviewedStats.avgExitEfficiency.toFixed(0)}%
              </p>
            </div>
          )}
          <div className="bg-gray-750 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400">Avg Missed R</p>
            <p className="text-xl font-bold text-yellow-400">
              +{reviewedStats.avgMissedR.toFixed(2)}R
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
