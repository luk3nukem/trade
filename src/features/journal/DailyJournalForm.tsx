import { useState, useEffect } from 'react';
import { db } from '../../db';
import type { DailyJournal, Account } from '../../types';

interface Props {
  date: Date;
  accountId?: string;
  onSave?: () => void;
  onCancel?: () => void;
}

export function DailyJournalForm({ date, accountId, onSave, onCancel }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState(accountId || '');
  const [existingEntry, setExistingEntry] = useState<DailyJournal | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Simplified form fields (v2 schema)
  const [preMarketNotes, setPreMarketNotes] = useState('');
  const [endOfDayNotes, setEndOfDayNotes] = useState('');
  const [lessonsLearned, setLessonsLearned] = useState('');

  // Load accounts and existing entry
  useEffect(() => {
    const loadData = async () => {
      const allAccounts = await db.accounts.toArray();
      setAccounts(allAccounts);

      // Set default account if none selected
      const effectiveAccountId = selectedAccountId || allAccounts.find(a => a.isDefault)?.id || '';
      if (!selectedAccountId && effectiveAccountId) {
        setSelectedAccountId(effectiveAccountId);
      }

      // Look for existing entry for this date and account
      const dateStr = date.toISOString().split('T')[0];
      const entries = await db.dailyJournals.toArray();
      const existing = entries.find(e => {
        const entryDate = new Date(e.date).toISOString().split('T')[0];
        return entryDate === dateStr && e.accountId === effectiveAccountId;
      });

      if (existing) {
        setExistingEntry(existing);
        setPreMarketNotes(existing.preMarketNotes || '');
        setEndOfDayNotes(existing.endOfDayNotes || '');
        setLessonsLearned(existing.lessonsLearned || '');
      } else {
        setExistingEntry(null);
        resetForm();
      }
    };
    loadData();
  }, [date, selectedAccountId]);

  const resetForm = () => {
    setPreMarketNotes('');
    setEndOfDayNotes('');
    setLessonsLearned('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const now = new Date();
      const journalData: Partial<DailyJournal> = {
        date,
        accountId: selectedAccountId,
        preMarketNotes: preMarketNotes || undefined,
        endOfDayNotes: endOfDayNotes || undefined,
        lessonsLearned: lessonsLearned || undefined,
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

      {/* Pre-Market Notes */}
      <div className="bg-gray-750 rounded-lg p-4 space-y-4">
        <h4 className="text-sm font-medium text-gray-300">Pre-Market</h4>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Pre-Market Notes</label>
          <textarea
            value={preMarketNotes}
            onChange={(e) => setPreMarketNotes(e.target.value)}
            placeholder="Observations, bias, key levels, plan for the day..."
            rows={4}
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
          <label className="block text-xs text-gray-400 mb-1">Lessons Learned</label>
          <textarea
            value={lessonsLearned}
            onChange={(e) => setLessonsLearned(e.target.value)}
            placeholder="Key takeaway from today..."
            rows={2}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
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
