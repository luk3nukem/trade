import { useState, useEffect } from 'react';
import { db } from '../../db';
import type { DailyJournal, Account, EmotionalState } from '../../types';

interface Props {
  date: Date;
  accountId?: string;
  onSave?: () => void;
  onCancel?: () => void;
}

const EMOTIONAL_STATES: { value: EmotionalState; emoji: string; label: string }[] = [
  { value: 1, emoji: '1', label: 'Very Anxious' },
  { value: 2, emoji: '2', label: 'Anxious' },
  { value: 3, emoji: '3', label: 'Neutral' },
  { value: 4, emoji: '4', label: 'Confident' },
  { value: 5, emoji: '5', label: 'Very Confident' },
];

const GRADES: { value: 'A' | 'B' | 'C' | 'D' | 'F'; label: string; color: string }[] = [
  { value: 'A', label: 'A - Excellent', color: 'text-green-400' },
  { value: 'B', label: 'B - Good', color: 'text-blue-400' },
  { value: 'C', label: 'C - Average', color: 'text-yellow-400' },
  { value: 'D', label: 'D - Poor', color: 'text-orange-400' },
  { value: 'F', label: 'F - Failed', color: 'text-red-400' },
];

export function DailyJournalForm({ date, accountId, onSave, onCancel }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState(accountId || 'default');
  const [existingEntry, setExistingEntry] = useState<DailyJournal | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form fields
  const [preMarketNotes, setPreMarketNotes] = useState('');
  const [marketBias, setMarketBias] = useState('');
  const [keyLevels, setKeyLevels] = useState('');
  const [newsEvents, setNewsEvents] = useState('');
  const [endOfDayNotes, setEndOfDayNotes] = useState('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [emotionalScore, setEmotionalScore] = useState<EmotionalState | null>(null);
  const [grade, setGrade] = useState<'A' | 'B' | 'C' | 'D' | 'F' | ''>('');

  // Load accounts and existing entry
  useEffect(() => {
    const loadData = async () => {
      const allAccounts = await db.accounts.toArray();
      setAccounts(allAccounts);

      // Look for existing entry for this date and account
      const dateStr = date.toISOString().split('T')[0];
      const entries = await db.dailyJournals.toArray();
      const existing = entries.find(e => {
        const entryDate = new Date(e.date).toISOString().split('T')[0];
        return entryDate === dateStr && e.accountId === selectedAccountId;
      });

      if (existing) {
        setExistingEntry(existing);
        setPreMarketNotes(existing.preMarketNotes || '');
        setMarketBias(existing.marketBias || '');
        setKeyLevels(existing.keyLevels || '');
        setNewsEvents(existing.newsEvents || '');
        setEndOfDayNotes(existing.endOfDayNotes || '');
        setLessonsLearned(existing.lessonsLearned || '');
        setEmotionalScore((existing.emotionalScore as EmotionalState) || null);
        setGrade(existing.grade || '');
      } else {
        setExistingEntry(null);
        resetForm();
      }
    };
    loadData();
  }, [date, selectedAccountId]);

  const resetForm = () => {
    setPreMarketNotes('');
    setMarketBias('');
    setKeyLevels('');
    setNewsEvents('');
    setEndOfDayNotes('');
    setLessonsLearned('');
    setEmotionalScore(null);
    setGrade('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const now = new Date();
      const journalData: Partial<DailyJournal> = {
        date,
        accountId: selectedAccountId,
        preMarketNotes: preMarketNotes || undefined,
        marketBias: marketBias || undefined,
        keyLevels: keyLevels || undefined,
        newsEvents: newsEvents || undefined,
        endOfDayNotes: endOfDayNotes || undefined,
        lessonsLearned: lessonsLearned || undefined,
        emotionalScore: emotionalScore || undefined,
        grade: grade || undefined,
        updatedAt: now,
      };

      if (existingEntry) {
        // Update existing entry
        await db.dailyJournals.update(existingEntry.id, journalData);
      } else {
        // Create new entry - don't provide id, let Dexie Cloud generate it
        const newEntry = {
          ...journalData,
          createdAt: now,
          updatedAt: now,
        };
        await db.dailyJournals.add(newEntry as DailyJournal);
      }

      onSave?.();
    } catch (error) {
      console.error('Failed to save journal entry:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (d: Date) => {
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-white">{formatDate(date)}</h3>
          <p className="text-sm text-gray-400">
            {existingEntry ? 'Edit journal entry' : 'New journal entry'}
          </p>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-white"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Account Selector */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Account</label>
        <select
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>{acc.name}</option>
          ))}
        </select>
      </div>

      {/* Pre-Market Section */}
      <div className="bg-gray-750 rounded-lg p-4 space-y-4">
        <h4 className="text-sm font-medium text-gray-300">Pre-Market Preparation</h4>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Market Bias</label>
          <input
            type="text"
            value={marketBias}
            onChange={(e) => setMarketBias(e.target.value)}
            placeholder="e.g., Bullish on ES, bearish on NQ"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Key Levels</label>
          <textarea
            value={keyLevels}
            onChange={(e) => setKeyLevels(e.target.value)}
            placeholder="Support/resistance levels to watch..."
            rows={2}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">News Events</label>
          <textarea
            value={newsEvents}
            onChange={(e) => setNewsEvents(e.target.value)}
            placeholder="Economic releases, earnings, etc..."
            rows={2}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Pre-Market Notes</label>
          <textarea
            value={preMarketNotes}
            onChange={(e) => setPreMarketNotes(e.target.value)}
            placeholder="General observations, plan for the day..."
            rows={3}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
      </div>

      {/* End of Day Section */}
      <div className="bg-gray-750 rounded-lg p-4 space-y-4">
        <h4 className="text-sm font-medium text-gray-300">End of Day Review</h4>

        <div>
          <label className="block text-xs text-gray-400 mb-1">End of Day Notes</label>
          <textarea
            value={endOfDayNotes}
            onChange={(e) => setEndOfDayNotes(e.target.value)}
            placeholder="What went well? What didn't? Overall assessment..."
            rows={4}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Lesson Learned</label>
          <textarea
            value={lessonsLearned}
            onChange={(e) => setLessonsLearned(e.target.value)}
            placeholder="Key takeaway from today..."
            rows={2}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
      </div>

      {/* Emotional Score */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Emotional State</label>
        <div className="flex gap-2">
          {EMOTIONAL_STATES.map(({ value, emoji, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setEmotionalScore(value)}
              className={`flex-1 py-3 rounded-lg border transition-all ${
                emotionalScore === value
                  ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                  : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
              }`}
              title={label}
            >
              <div className="text-xl font-bold">{emoji}</div>
              <div className="text-xs mt-1">{label.split(' ')[0]}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Grade */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Execution Grade</label>
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value as typeof grade)}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select grade...</option>
          {GRADES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {grade && (
          <p className={`text-sm mt-1 ${GRADES.find(g => g.value === grade)?.color}`}>
            {grade === 'A' && 'Excellent execution of your trading plan'}
            {grade === 'B' && 'Good execution with minor deviations'}
            {grade === 'C' && 'Average execution, room for improvement'}
            {grade === 'D' && 'Poor execution, significant deviations'}
            {grade === 'F' && 'Failed to follow plan, major discipline issues'}
          </p>
        )}
      </div>

      {/* Save Button */}
      <div className="flex justify-end gap-3">
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
        >
          {isSaving ? 'Saving...' : existingEntry ? 'Update Entry' : 'Save Entry'}
        </button>
      </div>
    </div>
  );
}
