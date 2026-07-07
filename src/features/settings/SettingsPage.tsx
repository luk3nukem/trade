import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useObservable } from 'dexie-react-hooks';
import { db } from '../../db';
import { useAppStore } from '../../stores/appStore';
import {
  generateDemoTrades,
  getDemoDataStats,
  exportFullBackup,
  downloadBackup,
  validateBackup,
  importBackup,
  exportTradesCSV,
  downloadCSV,
  clearTrades,
  clearJournals,
  clearEverything,
  calculateAccountBalance,
  getAccountTradeCount,
  getStrategyStats,
} from '../../utils';
import type { AlertType, Account, Strategy, BackupData, ImportResult } from '../../types';

type ModalType =
  | 'loadDemo'
  | 'clearTrades'
  | 'clearJournals'
  | 'clearAll'
  | 'addAccount'
  | 'editAccount'
  | 'deleteAccount'
  | 'addStrategy'
  | 'editStrategy'
  | 'deleteStrategy'
  | 'importConfirm'
  | 'importResult'
  | 'addTag'
  | 'renameTag'
  | 'deleteTag'
  | 'mergeTags'
  | null;

const ALERT_TYPE_LABELS: Record<AlertType, { name: string; description: string }> = {
  revenge_trade: {
    name: 'Revenge Trade Detection',
    description: 'Alert when entering a trade too soon after a loss',
  },
  overtrade: {
    name: 'Overtrade Warning',
    description: 'Alert when exceeding daily trade limit',
  },
  sizing_spike: {
    name: 'Position Size Spike',
    description: 'Alert when position size exceeds 1.5x rolling average',
  },
  edge_decay: {
    name: 'Edge Decay',
    description: 'Alert when last 20 trades have negative expectancy',
  },
  drawdown: {
    name: 'Drawdown Warning',
    description: 'Alert when drawdown exceeds threshold',
  },
  losing_streak: {
    name: 'Losing Streak',
    description: 'Alert on 3+ consecutive losses',
  },
  plan_deviation_streak: {
    name: 'Plan Deviation Streak',
    description: 'Alert on 3+ consecutive plan deviations',
  },
};

interface AccountWithStats extends Account {
  currentBalance: number;
  tradeCount: number;
}

interface StrategyWithStats extends Strategy {
  tradeCount: number;
  winRate: number;
  totalPnl: number;
}

interface TagWithStats {
  name: string;
  tradeCount: number;
}

export function SettingsPage() {
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Accounts state
  const [accounts, setAccounts] = useState<AccountWithStats[]>([]);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [accountForm, setAccountForm] = useState({ name: '', broker: '', currency: 'USD', startingBalance: '' });
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null);

  // Strategies state
  const [strategies, setStrategies] = useState<StrategyWithStats[]>([]);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [strategyForm, setStrategyForm] = useState({ name: '', description: '', rules: '' });
  const [strategyToDelete, setStrategyToDelete] = useState<Strategy | null>(null);

  // Setup Tags state
  const [tags, setTags] = useState<TagWithStats[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<TagWithStats | null>(null);
  const [tagRenameValue, setTagRenameValue] = useState('');
  const [tagToDelete, setTagToDelete] = useState<TagWithStats | null>(null);
  const [selectedTagsForMerge, setSelectedTagsForMerge] = useState<string[]>([]);
  const [mergeTargetTag, setMergeTargetTag] = useState('');

  // Import state
  const [pendingBackup, setPendingBackup] = useState<BackupData | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Clear confirmation
  const [confirmText, setConfirmText] = useState('');

  const { alertSettings, setAlertSettings, toggleAlertType, clearDismissedAlerts, dashboardFilters } = useAppStore();

  // Cloud sync state
  const currentUser = useObservable(db.cloud?.currentUser);
  const syncState = useObservable(db.cloud?.syncState);
  const isLoggedIn = currentUser?.isLoggedIn ?? false;

  const handleCloudLogin = async () => {
    try {
      console.log('Attempting Dexie Cloud login...');
      await db.cloud.login();
      console.log('Login successful');
    } catch (error) {
      console.error('Login failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setMessage({ type: 'error', text: `Login failed: ${errorMessage}` });
    }
  };

  const handleCloudLogout = async () => {
    try {
      await db.cloud.logout();
      setMessage({ type: 'success', text: 'Logged out successfully.' });
    } catch (error) {
      console.error('Logout failed:', error);
      setMessage({ type: 'error', text: 'Logout failed. Please try again.' });
    }
  };

  // Load accounts with computed stats
  const loadAccounts = async () => {
    const allAccounts = await db.accounts.toArray();
    const accountsWithStats: AccountWithStats[] = [];

    for (const account of allAccounts) {
      const currentBalance = await calculateAccountBalance(account.id);
      const tradeCount = await getAccountTradeCount(account.id);
      accountsWithStats.push({
        ...account,
        currentBalance,
        tradeCount,
      });
    }

    setAccounts(accountsWithStats);
  };

  // Load strategies with computed stats
  const loadStrategies = async () => {
    const allStrategies = await db.strategies.toArray();
    const strategiesWithStats: StrategyWithStats[] = [];

    for (const strategy of allStrategies) {
      const stats = await getStrategyStats(strategy.id);
      strategiesWithStats.push({
        ...strategy,
        ...stats,
      });
    }

    setStrategies(strategiesWithStats);
  };

  // Load setup tags with trade counts
  const loadTags = async () => {
    const allTrades = await db.trades.toArray();
    const tagCounts = new Map<string, number>();

    // Count trades per tag
    for (const trade of allTrades) {
      const tradeTags = trade.setupTags || [];
      for (const tag of tradeTags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    // Convert to sorted array
    const tagsWithStats: TagWithStats[] = Array.from(tagCounts.entries())
      .map(([name, tradeCount]) => ({ name, tradeCount }))
      .sort((a, b) => b.tradeCount - a.tradeCount);

    setTags(tagsWithStats);
  };

  // Initial load
  useEffect(() => {
    loadAccounts();
    loadStrategies();
    loadTags();
  }, []);

  // Account handlers
  const handleAddAccount = async () => {
    if (!accountForm.name.trim()) return;

    setLoading(true);
    try {
      const accountName = accountForm.name.trim();
      // Don't provide an ID - let Dexie Cloud generate it with @id schema
      const newAccount = {
        name: accountName,
        broker: accountForm.broker.trim(),
        currency: accountForm.currency,
        startingBalance: parseFloat(accountForm.startingBalance) || 0,
        currentBalance: parseFloat(accountForm.startingBalance) || 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.accounts.add(newAccount as Account);
      await loadAccounts();
      setAccountForm({ name: '', broker: '', currency: 'USD', startingBalance: '' });
      setActiveModal(null);
      setMessage({ type: 'success', text: `Account "${accountName}" created successfully.` });
    } catch (error) {
      console.error('Failed to add account:', error);
      setMessage({ type: 'error', text: 'Failed to add account. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  const handleEditAccount = async () => {
    if (!editingAccount || !accountForm.name.trim()) return;

    setLoading(true);
    try {
      await db.accounts.update(editingAccount.id, {
        name: accountForm.name.trim(),
        broker: accountForm.broker.trim(),
        currency: accountForm.currency,
        startingBalance: parseFloat(accountForm.startingBalance) || 0,
        updatedAt: new Date(),
      });

      await loadAccounts();
      setEditingAccount(null);
      setAccountForm({ name: '', broker: '', currency: 'USD', startingBalance: '' });
      setActiveModal(null);
      setMessage({ type: 'success', text: 'Account updated successfully.' });
    } catch (error) {
      console.error('Failed to update account:', error);
      setMessage({ type: 'error', text: 'Failed to update account. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!accountToDelete) return;

    setLoading(true);
    try {
      const wasDefault = accountToDelete.isDefault;
      await db.accounts.delete(accountToDelete.id);

      // If we deleted the last account (or the default), create a new default
      const remainingAccounts = await db.accounts.toArray();
      if (remainingAccounts.length === 0) {
        await db.accounts.add({
          name: 'Default Account',
          broker: '',
          currency: 'USD',
          startingBalance: 0,
          currentBalance: 0,
          isDefault: true,
        });
      } else if (wasDefault) {
        // If we deleted the default, make the first remaining account the new default
        const firstAccount = remainingAccounts[0];
        await db.accounts.update(firstAccount.id!, { isDefault: true });
      }

      await loadAccounts();
      setAccountToDelete(null);
      setActiveModal(null);
      setMessage({ type: 'success', text: `Account "${accountToDelete.name}" deleted.` });
    } catch (error) {
      console.error('Failed to delete account:', error);
      setMessage({ type: 'error', text: 'Failed to delete account. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  const openEditAccount = (account: Account) => {
    setEditingAccount(account);
    setAccountForm({
      name: account.name,
      broker: account.broker,
      currency: account.currency,
      startingBalance: String(account.startingBalance),
    });
    setActiveModal('editAccount');
  };

  const openDeleteAccount = (account: AccountWithStats) => {
    if (account.tradeCount > 0) {
      setMessage({
        type: 'error',
        text: `This account has ${account.tradeCount} trades. Reassign or delete them first.`,
      });
      return;
    }
    setAccountToDelete(account);
    setActiveModal('deleteAccount');
  };

  // Strategy handlers
  const handleAddStrategy = async () => {
    if (!strategyForm.name.trim()) return;

    setLoading(true);
    try {
      const strategyName = strategyForm.name.trim();
      // Don't provide an ID - let Dexie Cloud generate it with @id schema
      const newStrategy = {
        name: strategyName,
        description: strategyForm.description.trim(),
        rules: strategyForm.rules.trim(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.strategies.add(newStrategy as Strategy);
      await loadStrategies();
      setStrategyForm({ name: '', description: '', rules: '' });
      setActiveModal(null);
      setMessage({ type: 'success', text: `Strategy "${strategyName}" created successfully.` });
    } catch (error) {
      console.error('Failed to add strategy:', error);
      setMessage({ type: 'error', text: 'Failed to add strategy. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  const handleEditStrategy = async () => {
    if (!editingStrategy || !strategyForm.name.trim()) return;

    setLoading(true);
    try {
      await db.strategies.update(editingStrategy.id, {
        name: strategyForm.name.trim(),
        description: strategyForm.description.trim(),
        rules: strategyForm.rules.trim(),
        updatedAt: new Date(),
      });

      await loadStrategies();
      setEditingStrategy(null);
      setStrategyForm({ name: '', description: '', rules: '' });
      setActiveModal(null);
      setMessage({ type: 'success', text: 'Strategy updated successfully.' });
    } catch (error) {
      console.error('Failed to update strategy:', error);
      setMessage({ type: 'error', text: 'Failed to update strategy. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStrategy = async () => {
    if (!strategyToDelete) return;

    setLoading(true);
    try {
      const wasDefault = strategyToDelete.isDefault;
      await db.strategies.delete(strategyToDelete.id);

      // If we deleted the last strategy (or the default), create a new default
      const remainingStrategies = await db.strategies.toArray();
      if (remainingStrategies.length === 0) {
        await db.strategies.add({
          name: 'Default Strategy',
          description: '',
          rules: '',
          isDefault: true,
        });
      } else if (wasDefault) {
        // If we deleted the default, make the first remaining strategy the new default
        const firstStrategy = remainingStrategies[0];
        await db.strategies.update(firstStrategy.id!, { isDefault: true });
      }

      await loadStrategies();
      setStrategyToDelete(null);
      setActiveModal(null);
      setMessage({ type: 'success', text: `Strategy "${strategyToDelete.name}" deleted.` });
    } catch (error) {
      console.error('Failed to delete strategy:', error);
      setMessage({ type: 'error', text: 'Failed to delete strategy. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  const openEditStrategy = (strategy: Strategy) => {
    setEditingStrategy(strategy);
    setStrategyForm({
      name: strategy.name,
      description: strategy.description,
      rules: strategy.rules,
    });
    setActiveModal('editStrategy');
  };

  const openDeleteStrategy = (strategy: StrategyWithStats) => {
    if (strategy.tradeCount > 0) {
      setMessage({
        type: 'error',
        text: `This strategy has ${strategy.tradeCount} trades. Reassign or delete them first.`,
      });
      return;
    }
    setStrategyToDelete(strategy);
    setActiveModal('deleteStrategy');
  };

  // Tag handlers
  const handleAddTag = async () => {
    const tagName = newTagName.trim();
    if (!tagName) return;

    // Check if tag already exists
    const exists = tags.some((t) => t.name.toLowerCase() === tagName.toLowerCase());
    if (exists) {
      setMessage({ type: 'error', text: `Tag "${tagName}" already exists.` });
      return;
    }

    // Add tag by creating a dummy entry and then removing it (or just add to UI)
    // For now, we'll just reload tags - the tag will appear when used on a trade
    // We need a way to store "available" tags that aren't yet used
    // For simplicity, we'll just show a success message
    setMessage({ type: 'success', text: `Tag "${tagName}" is now available. Use it when creating trades.` });
    setNewTagName('');
    setActiveModal(null);
  };

  const handleRenameTag = async () => {
    if (!editingTag || !tagRenameValue.trim()) return;

    const oldName = editingTag.name;
    const newName = tagRenameValue.trim();

    if (oldName === newName) {
      setActiveModal(null);
      return;
    }

    // Check if new name already exists
    const exists = tags.some((t) => t.name.toLowerCase() === newName.toLowerCase() && t.name !== oldName);
    if (exists) {
      setMessage({ type: 'error', text: `Tag "${newName}" already exists.` });
      return;
    }

    setLoading(true);
    try {
      // Update all trades that have this tag
      await db.trades
        .filter((trade) => (trade.setupTags || []).includes(oldName))
        .modify((trade) => {
          const tags = trade.setupTags || [];
          const index = tags.indexOf(oldName);
          if (index !== -1) {
            tags[index] = newName;
            trade.setupTags = tags;
          }
        });

      await loadTags();
      setEditingTag(null);
      setTagRenameValue('');
      setActiveModal(null);
      setMessage({ type: 'success', text: `Renamed "${oldName}" to "${newName}" across ${editingTag.tradeCount} trades.` });
    } catch (error) {
      console.error('Failed to rename tag:', error);
      setMessage({ type: 'error', text: 'Failed to rename tag. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTag = async () => {
    if (!tagToDelete) return;

    setLoading(true);
    try {
      if (tagToDelete.tradeCount > 0) {
        // Remove tag from all trades that have it
        await db.trades
          .filter((trade) => (trade.setupTags || []).includes(tagToDelete.name))
          .modify((trade) => {
            trade.setupTags = (trade.setupTags || []).filter((t) => t !== tagToDelete.name);
          });
      }

      await loadTags();
      setTagToDelete(null);
      setActiveModal(null);
      setMessage({
        type: 'success',
        text: tagToDelete.tradeCount > 0
          ? `Removed tag "${tagToDelete.name}" from ${tagToDelete.tradeCount} trades.`
          : `Tag "${tagToDelete.name}" removed.`,
      });
    } catch (error) {
      console.error('Failed to delete tag:', error);
      setMessage({ type: 'error', text: 'Failed to delete tag. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  const handleMergeTags = async () => {
    if (selectedTagsForMerge.length < 2 || !mergeTargetTag) return;

    const tagsToRemove = selectedTagsForMerge.filter((t) => t !== mergeTargetTag);

    setLoading(true);
    try {
      // Get all trades that have any of the tags to remove
      const affectedTrades = await db.trades
        .filter((trade) => {
          const tradeTags = trade.setupTags || [];
          return tagsToRemove.some((tag) => tradeTags.includes(tag));
        })
        .toArray();

      // Update each affected trade
      for (const trade of affectedTrades) {
        const tradeTags = trade.setupTags || [];
        const newTags = new Set<string>();

        for (const tag of tradeTags) {
          if (tagsToRemove.includes(tag)) {
            // Replace with target tag
            newTags.add(mergeTargetTag);
          } else {
            newTags.add(tag);
          }
        }

        await db.trades.update(trade.id, { setupTags: Array.from(newTags) });
      }

      await loadTags();
      setSelectedTagsForMerge([]);
      setMergeTargetTag('');
      setActiveModal(null);
      setMessage({
        type: 'success',
        text: `Merged ${tagsToRemove.join(', ')} into "${mergeTargetTag}" across ${affectedTrades.length} trades.`,
      });
    } catch (error) {
      console.error('Failed to merge tags:', error);
      setMessage({ type: 'error', text: 'Failed to merge tags. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  const openRenameTag = (tag: TagWithStats) => {
    setEditingTag(tag);
    setTagRenameValue(tag.name);
    setActiveModal('renameTag');
  };

  const openDeleteTag = (tag: TagWithStats) => {
    setTagToDelete(tag);
    setActiveModal('deleteTag');
  };

  const toggleTagForMerge = (tagName: string) => {
    setSelectedTagsForMerge((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  };

  // Demo data handler
  const handleLoadDemoData = async () => {
    setLoading(true);
    setMessage(null);

    try {
      // Find the default account and strategy by isDefault flag
      const defaultAccount = await db.accounts.filter(a => a.isDefault === true).first();
      const defaultStrategy = await db.strategies.filter(s => s.isDefault === true).first();

      if (!defaultAccount?.id || !defaultStrategy?.id) {
        setMessage({
          type: 'error',
          text: 'Default account or strategy not found. Please ensure they exist.',
        });
        setLoading(false);
        return;
      }

      // Generate demo trades using default account/strategy IDs
      const trades = generateDemoTrades(defaultAccount.id, defaultStrategy.id);

      // Add trades one by one to handle Dexie Cloud ID generation
      for (const trade of trades) {
        await db.trades.add(trade);
      }

      const stats = getDemoDataStats(trades);
      await loadAccounts();
      await loadStrategies();

      setMessage({
        type: 'success',
        text: `Loaded ${stats.total} demo trades (${stats.closed} closed, ${stats.open} open). Win rate: ${stats.winRate.toFixed(1)}%, Total P&L: $${stats.totalPnl.toFixed(2)}`,
      });
    } catch (error) {
      console.error('Failed to load demo data:', error);
      setMessage({
        type: 'error',
        text: 'Failed to load demo data. See console for details.',
      });
    } finally {
      setLoading(false);
      setActiveModal(null);
    }
  };

  // Export handlers
  const handleExportBackup = async () => {
    setLoading(true);
    try {
      const backup = await exportFullBackup();
      downloadBackup(backup);

      let warningText = '';
      if (backup.metadata.screenshotCount > 0) {
        warningText = ` (includes ${backup.metadata.screenshotCount} screenshots - file may be large)`;
      }

      setMessage({
        type: 'success',
        text: `Exported ${backup.metadata.tradeCount} trades, ${backup.metadata.accountCount} accounts, ${backup.metadata.strategyCount} strategies, ${backup.metadata.journalCount} journal entries${warningText}`,
      });
    } catch (error) {
      console.error('Failed to export backup:', error);
      setMessage({ type: 'error', text: 'Failed to export backup. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    setLoading(true);
    try {
      const csv = await exportTradesCSV(
        dashboardFilters.accountId || undefined,
        dashboardFilters.strategyId || undefined
      );
      downloadCSV(csv);

      const filterText = dashboardFilters.accountId || dashboardFilters.strategyId
        ? ' (filtered by current global filters)'
        : '';

      setMessage({ type: 'success', text: `Exported trades to CSV${filterText}` });
    } catch (error) {
      console.error('Failed to export CSV:', error);
      setMessage({ type: 'error', text: 'Failed to export CSV. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  // Import handler
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const validation = validateBackup(json);

      if (!validation.valid) {
        setMessage({ type: 'error', text: validation.error ?? 'Invalid backup file' });
        return;
      }

      setPendingBackup(validation.backup!);
      setActiveModal('importConfirm');
    } catch (error) {
      console.error('Failed to read backup file:', error);
      setMessage({ type: 'error', text: 'Failed to read backup file. Make sure it is valid JSON.' });
    }

    // Reset file input
    e.target.value = '';
  };

  const handleImportConfirm = async () => {
    if (!pendingBackup) return;

    setLoading(true);
    try {
      const result = await importBackup(pendingBackup);
      setImportResult(result);
      setPendingBackup(null);
      setActiveModal('importResult');
      await loadAccounts();
      await loadStrategies();
    } catch (error) {
      console.error('Failed to import backup:', error);
      setMessage({ type: 'error', text: 'Failed to import backup. See console for details.' });
    } finally {
      setLoading(false);
    }
  };

  // Clear handlers
  const handleClearTrades = async () => {
    if (confirmText !== 'DELETE') return;

    setLoading(true);
    try {
      const count = await clearTrades();
      await loadAccounts();
      setMessage({ type: 'success', text: `Cleared ${count} trades from the database.` });
    } catch (error) {
      console.error('Failed to clear trades:', error);
      setMessage({ type: 'error', text: 'Failed to clear trades. See console for details.' });
    } finally {
      setLoading(false);
      setActiveModal(null);
      setConfirmText('');
    }
  };

  const handleClearJournals = async () => {
    if (confirmText !== 'DELETE') return;

    setLoading(true);
    try {
      const count = await clearJournals();
      setMessage({ type: 'success', text: `Cleared ${count} journal entries from the database.` });
    } catch (error) {
      console.error('Failed to clear journals:', error);
      setMessage({ type: 'error', text: 'Failed to clear journals. See console for details.' });
    } finally {
      setLoading(false);
      setActiveModal(null);
      setConfirmText('');
    }
  };

  const handleClearEverything = async () => {
    if (confirmText !== 'DELETE') return;

    setLoading(true);
    try {
      const counts = await clearEverything();
      await loadAccounts();
      await loadStrategies();
      setMessage({
        type: 'success',
        text: `Cleared ${counts.trades} trades, ${counts.journals} journals, ${counts.accounts} accounts, ${counts.strategies} strategies. Default account and strategy have been recreated.`,
      });
    } catch (error) {
      console.error('Failed to clear everything:', error);
      setMessage({ type: 'error', text: 'Failed to clear data. See console for details.' });
    } finally {
      setLoading(false);
      setActiveModal(null);
      setConfirmText('');
    }
  };

  const closeModal = () => {
    setActiveModal(null);
    setConfirmText('');
    setEditingAccount(null);
    setEditingStrategy(null);
    setAccountToDelete(null);
    setStrategyToDelete(null);
    setPendingBackup(null);
    setImportResult(null);
    setAccountForm({ name: '', broker: '', currency: 'USD', startingBalance: '' });
    setStrategyForm({ name: '', description: '', rules: '' });
    // Reset tag state
    setNewTagName('');
    setEditingTag(null);
    setTagRenameValue('');
    setTagToDelete(null);
    setSelectedTagsForMerge([]);
    setMergeTargetTag('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="mt-1 text-gray-400">Manage your trading diary data and preferences</p>
        </div>
        <Link
          to="/settings/glossary"
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Trading Glossary
        </Link>
      </div>

      {/* Status Message */}
      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-500/20 border border-green-500/30 text-green-400'
              : 'bg-red-500/20 border border-red-500/30 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Cloud Sync Section */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-medium text-white mb-4">Cloud Sync</h2>

        <div className="flex items-center justify-between p-4 bg-gray-750 rounded-lg">
          <div className="flex items-center gap-4">
            {/* Sync Status Indicator */}
            <div className="flex items-center gap-2">
              {(() => {
                const phase = syncState?.phase as string | undefined;
                let dotClass = 'bg-yellow-500';
                let statusText = 'Initializing...';

                if (!isLoggedIn) {
                  dotClass = 'bg-yellow-500';
                  statusText = 'Not signed in';
                } else if (phase === 'in-sync') {
                  dotClass = 'bg-green-500';
                  statusText = 'Synced';
                } else if (phase === 'error') {
                  dotClass = 'bg-red-500';
                  statusText = 'Sync error';
                } else if (phase === 'pushing') {
                  dotClass = 'bg-blue-500 animate-pulse';
                  statusText = 'Pushing changes...';
                } else if (phase === 'pulling') {
                  dotClass = 'bg-blue-500 animate-pulse';
                  statusText = 'Pulling changes...';
                } else if (phase === 'connecting') {
                  dotClass = 'bg-yellow-500 animate-pulse';
                  statusText = 'Connecting...';
                } else if (phase) {
                  dotClass = 'bg-yellow-500 animate-pulse';
                  statusText = phase;
                }

                return (
                  <>
                    <span className={`w-3 h-3 rounded-full ${dotClass}`} />
                    <span className="text-white">{statusText}</span>
                  </>
                );
              })()}
            </div>

            {/* User Info */}
            {isLoggedIn && currentUser?.email && (
              <div className="text-sm text-gray-400">
                Signed in as <span className="text-gray-300">{currentUser.email}</span>
              </div>
            )}
          </div>

          {/* Login/Logout Button */}
          {isLoggedIn ? (
            <button
              onClick={handleCloudLogout}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Sign Out
            </button>
          ) : (
            <button
              onClick={handleCloudLogin}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Sign In to Sync
            </button>
          )}
        </div>

        {/* Sync error details */}
        {syncState?.error && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-400">{syncState.error.message}</p>
          </div>
        )}

        {/* Info text */}
        <p className="mt-4 text-sm text-gray-400">
          {isLoggedIn
            ? 'Your data is synced across all your devices. Changes are automatically saved to the cloud.'
            : 'Sign in to sync your trading data across devices. Your data is currently stored locally only.'}
        </p>
      </div>

      {/* Accounts Section */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-white">Accounts</h2>
          <button
            onClick={() => {
              setAccountForm({ name: '', broker: '', currency: 'USD', startingBalance: '' });
              setActiveModal('addAccount');
            }}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            + Add Account
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Broker</th>
                <th className="pb-2 font-medium">Currency</th>
                <th className="pb-2 font-medium text-right">Starting</th>
                <th className="pb-2 font-medium text-right">Current</th>
                <th className="pb-2 font-medium text-right">Trades</th>
                <th className="pb-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {accounts.map((account) => (
                <tr key={account.id} className="text-gray-200">
                  <td className="py-3">
                    {account.name}
                    {account.isDefault && (
                      <span className="ml-2 px-1.5 py-0.5 bg-gray-700 text-gray-400 text-xs rounded">
                        Default
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-gray-400">{account.broker || '-'}</td>
                  <td className="py-3">{account.currency}</td>
                  <td className="py-3 text-right">${account.startingBalance.toLocaleString()}</td>
                  <td className={`py-3 text-right ${account.currentBalance >= account.startingBalance ? 'text-green-400' : 'text-red-400'}`}>
                    ${account.currentBalance.toLocaleString()}
                  </td>
                  <td className="py-3 text-right">{account.tradeCount}</td>
                  <td className="py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditAccount(account)}
                        className="p-1 text-gray-400 hover:text-white transition-colors"
                        title="Edit"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => openDeleteAccount(account)}
                        className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strategies Section */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-white">Strategies</h2>
          <button
            onClick={() => {
              setStrategyForm({ name: '', description: '', rules: '' });
              setActiveModal('addStrategy');
            }}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            + Add Strategy
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Description</th>
                <th className="pb-2 font-medium text-right">Trades</th>
                <th className="pb-2 font-medium text-right">Win Rate</th>
                <th className="pb-2 font-medium text-right">P&L</th>
                <th className="pb-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {strategies.map((strategy) => (
                <tr key={strategy.id} className="text-gray-200">
                  <td className="py-3">
                    {strategy.name}
                    {strategy.isDefault && (
                      <span className="ml-2 px-1.5 py-0.5 bg-gray-700 text-gray-400 text-xs rounded">
                        Default
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-gray-400 max-w-xs truncate">
                    {strategy.description || '-'}
                  </td>
                  <td className="py-3 text-right">{strategy.tradeCount}</td>
                  <td className="py-3 text-right">
                    {strategy.tradeCount > 0 ? `${strategy.winRate.toFixed(1)}%` : '-'}
                  </td>
                  <td className={`py-3 text-right ${strategy.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {strategy.tradeCount > 0 ? `$${strategy.totalPnl.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditStrategy(strategy)}
                        className="p-1 text-gray-400 hover:text-white transition-colors"
                        title="Edit"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => openDeleteStrategy(strategy)}
                        className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Setup Tags Section */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-white">Setup Tags</h2>
          <div className="flex gap-2">
            {selectedTagsForMerge.length >= 2 && (
              <button
                onClick={() => setActiveModal('mergeTags')}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors"
              >
                Merge Selected ({selectedTagsForMerge.length})
              </button>
            )}
            <button
              onClick={() => setActiveModal('addTag')}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
            >
              + Add Tag
            </button>
          </div>
        </div>

        {tags.length === 0 ? (
          <p className="text-gray-400 text-sm">No setup tags found. Tags appear here when used on trades.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2 font-medium w-10">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="pb-2 font-medium">Tag Name</th>
                  <th className="pb-2 font-medium text-right">Trades</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {tags.map((tag) => (
                  <tr key={tag.name} className="text-gray-200">
                    <td className="py-3">
                      <input
                        type="checkbox"
                        checked={selectedTagsForMerge.includes(tag.name)}
                        onChange={() => toggleTagForMerge(tag.name)}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
                      />
                    </td>
                    <td className="py-3">
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm">
                        {tag.name}
                      </span>
                    </td>
                    <td className="py-3 text-right text-gray-400">{tag.tradeCount}</td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openRenameTag(tag)}
                          className="p-1 text-gray-400 hover:text-white transition-colors"
                          title="Rename"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => openDeleteTag(tag)}
                          className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedTagsForMerge.length > 0 && selectedTagsForMerge.length < 2 && (
          <p className="mt-3 text-sm text-gray-400">
            Select at least 2 tags to merge them.
          </p>
        )}
      </div>

      {/* Import & Export Section */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-medium text-white mb-4">Import & Export</h2>

        <div className="space-y-4">
          {/* Export Full Backup */}
          <div className="flex items-center justify-between p-4 bg-gray-750 rounded-lg">
            <div>
              <h3 className="font-medium text-white">Export Full Backup</h3>
              <p className="text-sm text-gray-400 mt-1">
                Export all data (trades, accounts, strategies, journals) as JSON.
                Screenshots are included as base64.
              </p>
            </div>
            <button
              onClick={handleExportBackup}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              Export Backup
            </button>
          </div>

          {/* Import Backup */}
          <div className="flex items-center justify-between p-4 bg-gray-750 rounded-lg">
            <div>
              <h3 className="font-medium text-white">Import Backup</h3>
              <p className="text-sm text-gray-400 mt-1">
                Import a JSON backup file. Data will be added to existing records (duplicates skipped).
              </p>
            </div>
            <label className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap">
              Import Backup
              <input
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          </div>

          {/* Export Trades CSV */}
          <div className="flex items-center justify-between p-4 bg-gray-750 rounded-lg">
            <div>
              <h3 className="font-medium text-white">Export Trades as CSV</h3>
              <p className="text-sm text-gray-400 mt-1">
                Export trades as a flat CSV file (no screenshots). Respects current global filters.
              </p>
            </div>
            <button
              onClick={handleExportCSV}
              disabled={loading}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              Export CSV
            </button>
          </div>

          {/* Load Demo Data */}
          <div className="flex items-center justify-between p-4 bg-gray-750 rounded-lg">
            <div>
              <h3 className="font-medium text-white">Load Demo Data</h3>
              <p className="text-sm text-gray-400 mt-1">
                Add ~50 realistic demo trades with multiple accounts and strategies.
              </p>
            </div>
            <button
              onClick={() => setActiveModal('loadDemo')}
              disabled={loading}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              Load Demo Data
            </button>
          </div>

          <div className="border-t border-gray-700 pt-4 mt-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">Danger Zone</h3>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setActiveModal('clearTrades')}
                disabled={loading}
                className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 rounded-lg transition-colors"
              >
                Clear All Trades
              </button>
              <button
                onClick={() => setActiveModal('clearJournals')}
                disabled={loading}
                className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 rounded-lg transition-colors"
              >
                Clear All Journal Entries
              </button>
              <button
                onClick={() => setActiveModal('clearAll')}
                disabled={loading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors"
              >
                Clear Everything
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Alert Configuration Section */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-medium text-white mb-4">Alert Configuration</h2>

        {/* Alert Thresholds */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Daily Trade Limit</label>
            <input
              type="number"
              min="1"
              max="50"
              value={alertSettings.dailyTradeLimit}
              onChange={(e) => setAlertSettings({ dailyTradeLimit: parseInt(e.target.value) || 5 })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Max trades per day before overtrade alert</p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Drawdown Threshold (%)</label>
            <input
              type="number"
              min="1"
              max="50"
              step="0.5"
              value={alertSettings.drawdownWarningThreshold}
              onChange={(e) => setAlertSettings({ drawdownWarningThreshold: parseFloat(e.target.value) || 5 })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Alert when drawdown exceeds this %</p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Revenge Trade Window (min)</label>
            <input
              type="number"
              min="5"
              max="120"
              value={alertSettings.revengeTradeWindowMinutes}
              onChange={(e) => setAlertSettings({ revengeTradeWindowMinutes: parseInt(e.target.value) || 30 })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Time window after loss to flag revenge trades</p>
          </div>
        </div>

        {/* Alert Type Toggles */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-300">Alert Types</h3>
          {(Object.keys(ALERT_TYPE_LABELS) as AlertType[]).map((type) => {
            const { name, description } = ALERT_TYPE_LABELS[type];
            const isEnabled = alertSettings.enabledAlerts[type];

            return (
              <div key={type} className="flex items-center justify-between p-3 bg-gray-750 rounded-lg">
                <div>
                  <p className="text-white">{name}</p>
                  <p className="text-xs text-gray-500">{description}</p>
                </div>
                <button
                  onClick={() => toggleAlertType(type, !isEnabled)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    isEnabled ? 'bg-blue-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      isEnabled ? 'left-7' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>

        {/* Clear Dismissed Alerts */}
        <div className="mt-6 pt-4 border-t border-gray-700">
          <button
            onClick={clearDismissedAlerts}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Reset dismissed alerts
          </button>
        </div>
      </div>

      {/* About Section */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-medium text-white mb-4">About</h2>
        <div className="space-y-2 text-sm text-gray-400">
          <p>Trading Diary - Track and analyze your trades</p>
          <p>Data is stored locally in your browser using IndexedDB</p>
        </div>
      </div>

      {/* Modals */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            {/* Add Account Modal */}
            {activeModal === 'addAccount' && (
              <>
                <h3 className="text-lg font-medium text-white mb-4">Add Account</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Name *</label>
                    <input
                      type="text"
                      value={accountForm.name}
                      onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="My Trading Account"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Broker</label>
                    <input
                      type="text"
                      value={accountForm.broker}
                      onChange={(e) => setAccountForm({ ...accountForm, broker: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="FTMO, IC Markets, etc."
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Currency</label>
                    <select
                      value={accountForm.currency}
                      onChange={(e) => setAccountForm({ ...accountForm, currency: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="JPY">JPY</option>
                      <option value="AUD">AUD</option>
                      <option value="CAD">CAD</option>
                      <option value="CHF">CHF</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Starting Balance</label>
                    <input
                      type="number"
                      step="any"
                      value={accountForm.startingBalance}
                      onChange={(e) => setAccountForm({ ...accountForm, startingBalance: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="10000"
                    />
                  </div>
                </div>
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddAccount}
                    disabled={loading || !accountForm.name.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Adding...' : 'Add Account'}
                  </button>
                </div>
              </>
            )}

            {/* Edit Account Modal */}
            {activeModal === 'editAccount' && (
              <>
                <h3 className="text-lg font-medium text-white mb-4">Edit Account</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Name *</label>
                    <input
                      type="text"
                      value={accountForm.name}
                      onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Broker</label>
                    <input
                      type="text"
                      value={accountForm.broker}
                      onChange={(e) => setAccountForm({ ...accountForm, broker: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Currency</label>
                    <select
                      value={accountForm.currency}
                      onChange={(e) => setAccountForm({ ...accountForm, currency: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="JPY">JPY</option>
                      <option value="AUD">AUD</option>
                      <option value="CAD">CAD</option>
                      <option value="CHF">CHF</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Starting Balance</label>
                    <input
                      type="number"
                      step="any"
                      value={accountForm.startingBalance}
                      onChange={(e) => setAccountForm({ ...accountForm, startingBalance: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleEditAccount}
                    disabled={loading || !accountForm.name.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </>
            )}

            {/* Delete Account Modal */}
            {activeModal === 'deleteAccount' && accountToDelete && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Delete Account</h3>
                <p className="text-gray-400 mb-6">
                  Are you sure you want to delete "{accountToDelete.name}"? This action cannot be undone.
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={loading}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </>
            )}

            {/* Add Strategy Modal */}
            {activeModal === 'addStrategy' && (
              <>
                <h3 className="text-lg font-medium text-white mb-4">Add Strategy</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Name *</label>
                    <input
                      type="text"
                      value={strategyForm.name}
                      onChange={(e) => setStrategyForm({ ...strategyForm, name: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="OB Retest"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Description</label>
                    <input
                      type="text"
                      value={strategyForm.description}
                      onChange={(e) => setStrategyForm({ ...strategyForm, description: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Brief description of the strategy"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Rules</label>
                    <textarea
                      value={strategyForm.rules}
                      onChange={(e) => setStrategyForm({ ...strategyForm, rules: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="1. Entry criteria&#10;2. Exit criteria&#10;3. Risk management rules"
                    />
                  </div>
                </div>
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddStrategy}
                    disabled={loading || !strategyForm.name.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Adding...' : 'Add Strategy'}
                  </button>
                </div>
              </>
            )}

            {/* Edit Strategy Modal */}
            {activeModal === 'editStrategy' && (
              <>
                <h3 className="text-lg font-medium text-white mb-4">Edit Strategy</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Name *</label>
                    <input
                      type="text"
                      value={strategyForm.name}
                      onChange={(e) => setStrategyForm({ ...strategyForm, name: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Description</label>
                    <input
                      type="text"
                      value={strategyForm.description}
                      onChange={(e) => setStrategyForm({ ...strategyForm, description: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Rules</label>
                    <textarea
                      value={strategyForm.rules}
                      onChange={(e) => setStrategyForm({ ...strategyForm, rules: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleEditStrategy}
                    disabled={loading || !strategyForm.name.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </>
            )}

            {/* Delete Strategy Modal */}
            {activeModal === 'deleteStrategy' && strategyToDelete && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Delete Strategy</h3>
                <p className="text-gray-400 mb-6">
                  Are you sure you want to delete "{strategyToDelete.name}"? This action cannot be undone.
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteStrategy}
                    disabled={loading}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </>
            )}

            {/* Load Demo Modal */}
            {activeModal === 'loadDemo' && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Load Demo Data</h3>
                <p className="text-gray-400 mb-4">
                  This will add approximately 50 demo trades with various setups, sessions, and outcomes.
                </p>
                <p className="text-gray-400 mb-4 text-sm">
                  Demo data includes trades across two accounts (Default Account and Demo Prop Firm)
                  and two strategies (Default Strategy and Breakout Scalp) to demonstrate multi-account/strategy filtering.
                </p>
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleLoadDemoData}
                    disabled={loading}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Loading...' : 'Load Demo Data'}
                  </button>
                </div>
              </>
            )}

            {/* Import Confirm Modal */}
            {activeModal === 'importConfirm' && pendingBackup && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Import Backup</h3>
                <p className="text-gray-400 mb-4">This backup contains:</p>
                <ul className="list-disc list-inside text-gray-400 mb-4 space-y-1">
                  <li>{pendingBackup.metadata.tradeCount} trades</li>
                  <li>{pendingBackup.metadata.journalCount} journal entries</li>
                  <li>{pendingBackup.metadata.accountCount} accounts</li>
                  <li>{pendingBackup.metadata.strategyCount} strategies</li>
                  {pendingBackup.metadata.hasScreenshots && (
                    <li>{pendingBackup.metadata.screenshotCount} screenshots</li>
                  )}
                </ul>
                <p className="text-yellow-400 text-sm mb-4">
                  Import will ADD to existing data (not replace). Duplicate records will be skipped.
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleImportConfirm}
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Importing...' : 'Continue Import'}
                  </button>
                </div>
              </>
            )}

            {/* Import Result Modal */}
            {activeModal === 'importResult' && importResult && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Import Complete</h3>
                <div className="space-y-2 text-gray-400 mb-4">
                  <p>Imported:</p>
                  <ul className="list-disc list-inside pl-2 space-y-1">
                    <li>{importResult.imported.trades} trades</li>
                    <li>{importResult.imported.journals} journal entries</li>
                    <li>{importResult.imported.accounts} accounts</li>
                    <li>{importResult.imported.strategies} strategies</li>
                  </ul>
                  {(importResult.skipped.trades > 0 ||
                    importResult.skipped.accounts > 0 ||
                    importResult.skipped.strategies > 0 ||
                    importResult.skipped.journals > 0) && (
                    <>
                      <p className="mt-3">Skipped (already exist):</p>
                      <ul className="list-disc list-inside pl-2 space-y-1">
                        {importResult.skipped.trades > 0 && <li>{importResult.skipped.trades} trades</li>}
                        {importResult.skipped.accounts > 0 && <li>{importResult.skipped.accounts} accounts</li>}
                        {importResult.skipped.strategies > 0 && <li>{importResult.skipped.strategies} strategies</li>}
                        {importResult.skipped.journals > 0 && <li>{importResult.skipped.journals} journals</li>}
                      </ul>
                    </>
                  )}
                  {importResult.errors.length > 0 && (
                    <div className="mt-3 text-red-400">
                      <p>Errors ({importResult.errors.length}):</p>
                      <ul className="list-disc list-inside pl-2 space-y-1 text-sm max-h-32 overflow-y-auto">
                        {importResult.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={closeModal}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    Done
                  </button>
                </div>
              </>
            )}

            {/* Clear Trades Modal */}
            {activeModal === 'clearTrades' && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Clear All Trades</h3>
                <p className="text-gray-400 mb-4">
                  This will permanently delete all trades. Accounts and strategies will be preserved.
                </p>
                <p className="text-gray-400 mb-4">
                  Type <span className="text-red-400 font-mono">DELETE</span> to confirm:
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Type DELETE"
                />
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleClearTrades}
                    disabled={loading || confirmText !== 'DELETE'}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Clearing...' : 'Clear Trades'}
                  </button>
                </div>
              </>
            )}

            {/* Clear Journals Modal */}
            {activeModal === 'clearJournals' && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Clear All Journal Entries</h3>
                <p className="text-gray-400 mb-4">
                  This will permanently delete all journal entries.
                </p>
                <p className="text-gray-400 mb-4">
                  Type <span className="text-red-400 font-mono">DELETE</span> to confirm:
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Type DELETE"
                />
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleClearJournals}
                    disabled={loading || confirmText !== 'DELETE'}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Clearing...' : 'Clear Journals'}
                  </button>
                </div>
              </>
            )}

            {/* Clear Everything Modal */}
            {activeModal === 'clearAll' && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Clear Everything</h3>
                <p className="text-gray-400 mb-4">
                  This will permanently delete ALL data: trades, journal entries, accounts, and strategies.
                  Default account and strategy will be recreated.
                </p>
                <p className="text-gray-400 mb-4">
                  Type <span className="text-red-400 font-mono">DELETE</span> to confirm:
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Type DELETE"
                />
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleClearEverything}
                    disabled={loading || confirmText !== 'DELETE'}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Clearing...' : 'Clear Everything'}
                  </button>
                </div>
              </>
            )}

            {/* Add Tag Modal */}
            {activeModal === 'addTag' && (
              <>
                <h3 className="text-lg font-medium text-white mb-4">Add Setup Tag</h3>
                <p className="text-gray-400 mb-4 text-sm">
                  Add a new tag to use when categorizing trades. Tags will appear in the list once used.
                </p>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Tag Name</label>
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., liquidity_sweep"
                  />
                </div>
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddTag}
                    disabled={loading || !newTagName.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                  >
                    Add Tag
                  </button>
                </div>
              </>
            )}

            {/* Rename Tag Modal */}
            {activeModal === 'renameTag' && editingTag && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Rename Tag</h3>
                <p className="text-gray-400 mb-4">
                  Renaming "{editingTag.name}" will update {editingTag.tradeCount} trade{editingTag.tradeCount !== 1 ? 's' : ''}.
                </p>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">New Name</label>
                  <input
                    type="text"
                    value={tagRenameValue}
                    onChange={(e) => setTagRenameValue(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRenameTag}
                    disabled={loading || !tagRenameValue.trim() || tagRenameValue === editingTag.name}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Renaming...' : 'Rename Tag'}
                  </button>
                </div>
              </>
            )}

            {/* Delete Tag Modal */}
            {activeModal === 'deleteTag' && tagToDelete && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Delete Tag</h3>
                {tagToDelete.tradeCount > 0 ? (
                  <p className="text-gray-400 mb-4">
                    This will remove the tag "{tagToDelete.name}" from {tagToDelete.tradeCount} trade{tagToDelete.tradeCount !== 1 ? 's' : ''}.
                    The trades themselves will not be deleted.
                  </p>
                ) : (
                  <p className="text-gray-400 mb-4">
                    Delete the tag "{tagToDelete.name}"? It is not used by any trades.
                  </p>
                )}
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteTag}
                    disabled={loading}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Deleting...' : 'Delete Tag'}
                  </button>
                </div>
              </>
            )}

            {/* Merge Tags Modal */}
            {activeModal === 'mergeTags' && selectedTagsForMerge.length >= 2 && (
              <>
                <h3 className="text-lg font-medium text-white mb-2">Merge Tags</h3>
                <p className="text-gray-400 mb-4">
                  Select which tag name to keep. All trades using the other tags will be updated to use the selected tag.
                </p>
                <div className="space-y-2 mb-4">
                  <label className="block text-sm text-gray-400 mb-2">Tags to merge:</label>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {selectedTagsForMerge.map((tag) => (
                      <span key={tag} className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <label className="block text-sm text-gray-400 mb-1">Keep this tag name:</label>
                  <select
                    value={mergeTargetTag}
                    onChange={(e) => setMergeTargetTag(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select tag to keep...</option>
                    {selectedTagsForMerge.map((tag) => (
                      <option key={tag} value={tag}>{tag}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={closeModal}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleMergeTags}
                    disabled={loading || !mergeTargetTag}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-lg transition-colors"
                  >
                    {loading ? 'Merging...' : 'Merge Tags'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
