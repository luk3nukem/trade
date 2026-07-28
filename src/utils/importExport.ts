import { db } from '../db';
import type { TradeRecord, Account, Strategy, DailyJournal } from '../types';
import { getTradeRMetrics, type TradeRMetrics } from './tradeCalculations';

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

// Backup version for migration compatibility
// Version 3: v2 schema - unified timeline, no psychology/market context
const BACKUP_VERSION = 3;

// Backup data structure
export interface BackupData {
  version: number;
  exportedAt: string;
  data: {
    trades: TradeRecord[];
    accounts: Account[];
    strategies: Strategy[];
    dailyJournals: DailyJournal[];
  };
  metadata: {
    tradeCount: number;
    accountCount: number;
    strategyCount: number;
    journalCount: number;
    hasScreenshots: boolean;
    screenshotCount: number;
  };
}

// Import result
export interface ImportResult {
  success: boolean;
  imported: {
    trades: number;
    accounts: number;
    strategies: number;
    journals: number;
  };
  skipped: {
    trades: number;
    accounts: number;
    strategies: number;
    journals: number;
  };
  errors: string[];
}

// Export all data as JSON backup
export async function exportFullBackup(): Promise<BackupData> {
  const trades = await db.trades.toArray();
  const accounts = await db.accounts.toArray();
  const strategies = await db.strategies.toArray();
  const dailyJournals = await db.dailyJournals.toArray();

  // Count screenshots (now URL-based, no conversion needed)
  let screenshotCount = 0;
  for (const trade of trades) {
    if (trade.screenshots) {
      screenshotCount += trade.screenshots.filter(s => s.url).length;
    }
  }

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      trades,
      accounts,
      strategies,
      dailyJournals,
    },
    metadata: {
      tradeCount: trades.length,
      accountCount: accounts.length,
      strategyCount: strategies.length,
      journalCount: dailyJournals.length,
      hasScreenshots: screenshotCount > 0,
      screenshotCount,
    },
  };
}

// Download backup as JSON file
export function downloadBackup(backup: BackupData): void {
  const date = new Date().toISOString().split('T')[0];
  const filename = `trading-diary-backup-${date}.json`;
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Validate backup structure
export function validateBackup(data: unknown): { valid: boolean; error?: string; backup?: BackupData } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid backup file: not a valid JSON object' };
  }

  const backup = data as Record<string, unknown>;

  if (typeof backup.version !== 'number') {
    return { valid: false, error: 'Invalid backup file: missing version' };
  }

  // Reject old backups from before v2 schema
  if (backup.version < 3) {
    return { valid: false, error: 'Backup predates schema v2 and cannot be imported. Please use an export from the current version.' };
  }

  if (!backup.data || typeof backup.data !== 'object') {
    return { valid: false, error: 'Invalid backup file: missing data section' };
  }

  const dataSection = backup.data as Record<string, unknown>;

  if (!Array.isArray(dataSection.trades)) {
    return { valid: false, error: 'Invalid backup file: trades must be an array' };
  }

  if (!Array.isArray(dataSection.accounts)) {
    return { valid: false, error: 'Invalid backup file: accounts must be an array' };
  }

  if (!Array.isArray(dataSection.strategies)) {
    return { valid: false, error: 'Invalid backup file: strategies must be an array' };
  }

  if (!Array.isArray(dataSection.dailyJournals)) {
    return { valid: false, error: 'Invalid backup file: dailyJournals must be an array' };
  }

  return { valid: true, backup: data as BackupData };
}

// Import backup data (adds to existing, skips duplicates)
export async function importBackup(backup: BackupData): Promise<ImportResult> {
  const result: ImportResult = {
    success: true,
    imported: { trades: 0, accounts: 0, strategies: 0, journals: 0 },
    skipped: { trades: 0, accounts: 0, strategies: 0, journals: 0 },
    errors: [],
  };

  try {
    // Get existing IDs to check for duplicates
    const existingTradeIds = new Set((await db.trades.toArray()).map((t) => t.id));
    const existingAccountIds = new Set((await db.accounts.toArray()).map((a) => a.id));
    const existingStrategyIds = new Set((await db.strategies.toArray()).map((s) => s.id));
    const existingJournalIds = new Set((await db.dailyJournals.toArray()).map((j) => j.id));

    // Import accounts (skip duplicates)
    for (const account of backup.data.accounts) {
      if (existingAccountIds.has(account.id)) {
        result.skipped.accounts++;
      } else {
        try {
          await db.accounts.add(account);
          result.imported.accounts++;
        } catch (e) {
          result.errors.push(`Failed to import account ${account.name}: ${e}`);
        }
      }
    }

    // Import strategies (skip duplicates)
    for (const strategy of backup.data.strategies) {
      if (existingStrategyIds.has(strategy.id)) {
        result.skipped.strategies++;
      } else {
        try {
          await db.strategies.add(strategy);
          result.imported.strategies++;
        } catch (e) {
          result.errors.push(`Failed to import strategy ${strategy.name}: ${e}`);
        }
      }
    }

    // Import trades (skip duplicates)
    for (const trade of backup.data.trades) {
      if (existingTradeIds.has(trade.id)) {
        result.skipped.trades++;
      } else {
        try {
          // Convert date strings back to Date objects for v2 schema
          const tradeWithDates: TradeRecord = {
            ...trade,
            entryTime: new Date(trade.entryTime),
            createdAt: new Date(trade.createdAt),
            updatedAt: new Date(trade.updatedAt),
            exits: trade.exits?.map((e) => ({
              ...e,
              time: new Date(e.time),
            })) ?? [],
            timeline: trade.timeline ?? [],
            levelSequence: trade.levelSequence ?? [],
            contextTags: trade.contextTags ?? [],
            screenshots: trade.screenshots?.map((s: { id: string; url: string; caption: string; createdAt: string | Date }) => ({
              id: s.id,
              url: s.url,
              caption: s.caption,
              createdAt: new Date(s.createdAt),
            })) ?? [],
          };
          await db.trades.add(tradeWithDates);
          result.imported.trades++;
        } catch (e) {
          result.errors.push(`Failed to import trade ${trade.pair}: ${e}`);
        }
      }
    }

    // Import daily journals (skip duplicates)
    for (const journal of backup.data.dailyJournals) {
      if (existingJournalIds.has(journal.id)) {
        result.skipped.journals++;
      } else {
        try {
          const journalWithDates: DailyJournal = {
            ...journal,
            date: new Date(journal.date),
            createdAt: new Date(journal.createdAt),
            updatedAt: new Date(journal.updatedAt),
          };
          await db.dailyJournals.add(journalWithDates);
          result.imported.journals++;
        } catch (e) {
          result.errors.push(`Failed to import journal: ${e}`);
        }
      }
    }
  } catch (e) {
    result.success = false;
    result.errors.push(`Import failed: ${e}`);
  }

  return result;
}

// Export trades as CSV
export async function exportTradesCSV(accountId?: string, strategyId?: string): Promise<string> {
  let trades = await db.trades.toArray();

  // Apply filters
  if (accountId) {
    trades = trades.filter((t) => t.accountId === accountId);
  }
  if (strategyId) {
    trades = trades.filter((t) => t.strategyId === strategyId);
  }

  // Sort by entry time
  trades.sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

  // Define CSV columns for v2 schema
  const columns = [
    'id',
    'accountId',
    'strategyId',
    'pair',
    'assetClass',
    'direction',
    'entryTime',
    'entryPrice',
    'stopLoss',
    'targetPrice',
    'positionSize',
    'riskAmount',
    'riskPercent',
    'tradeTaken',
    'notTakenReason',
    'contextTags',
    'entryTF',
    'entryConfirmation',
    'confirmationTF',
    'entryNotes',
    'closeNotes',
    'postExitNotes',
    'reachedTargetPostExit',
    'reviewedAt',
    'timeline',
    'exits',
    'levelSequence',
    'createdAt',
    'updatedAt',
  ];

  // Create CSV header
  const header = columns.join(',');

  // Create CSV rows
  const rows = trades.map((trade) => {
    return columns
      .map((col) => {
        const value = trade[col as keyof TradeRecord];

        if (value === undefined || value === null) {
          return '';
        }

        if (value instanceof Date) {
          return `"${value.toISOString()}"`;
        }

        if (Array.isArray(value)) {
          // For contextTags, use pipe-separated format
          if (col === 'contextTags') {
            return `"${value.join('|')}"`;
          }
          // For complex arrays (timeline, exits, levelSequence), serialize as JSON
          return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
        }

        if (typeof value === 'string') {
          // Escape quotes and wrap in quotes
          return `"${value.replace(/"/g, '""')}"`;
        }

        if (typeof value === 'boolean') {
          return value ? 'true' : 'false';
        }

        return String(value);
      })
      .join(',');
  });

  return [header, ...rows].join('\n');
}

// Download CSV file
export function downloadCSV(csv: string, filename?: string): void {
  const date = new Date().toISOString().split('T')[0];
  const finalFilename = filename ?? `trading-diary-trades-${date}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = finalFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Clear specific data types
export async function clearTrades(): Promise<number> {
  const count = await db.trades.count();
  await db.trades.clear();
  return count;
}

export async function clearJournals(): Promise<number> {
  const count = await db.dailyJournals.count();
  await db.dailyJournals.clear();
  return count;
}

export async function clearEverything(): Promise<{
  trades: number;
  journals: number;
  accounts: number;
  strategies: number;
}> {
  const counts = {
    trades: await db.trades.count(),
    journals: await db.dailyJournals.count(),
    accounts: await db.accounts.count(),
    strategies: await db.strategies.count(),
  };

  await db.trades.clear();
  await db.dailyJournals.clear();
  await db.accounts.clear();
  await db.strategies.clear();

  // Re-create default account and strategy (no id - Dexie Cloud will auto-generate)
  await db.accounts.add({
    name: 'Default Account',
    broker: '',
    currency: 'USD',
    startingBalance: 0,
    currentBalance: 0,
    isDefault: true,
  });

  await db.strategies.add({
    name: 'Default Strategy',
    description: '',
    rules: '',
    isDefault: true,
  });

  return counts;
}

// Calculate account balance from trades
export async function calculateAccountBalance(accountId: string | undefined): Promise<number> {
  if (!accountId) return 0;
  const account = await db.accounts.get(accountId);
  if (!account) return 0;

  const trades = await db.trades.where('accountId').equals(accountId).toArray();
  const closedTrades = trades.filter((t) => getCachedMetrics(t).status === 'closed');

  const totalPnl = closedTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);

  return account.startingBalance + totalPnl;
}

// Get trade count for account
export async function getAccountTradeCount(accountId: string | undefined): Promise<number> {
  if (!accountId) return 0;
  return await db.trades.where('accountId').equals(accountId).count();
}

// Get trade count for strategy
export async function getStrategyTradeCount(strategyId: string | undefined): Promise<number> {
  if (!strategyId) return 0;
  return await db.trades.where('strategyId').equals(strategyId).count();
}

// Get strategy stats
export async function getStrategyStats(strategyId: string | undefined): Promise<{
  tradeCount: number;
  winRate: number;
  totalPnl: number;
}> {
  if (!strategyId) return { tradeCount: 0, winRate: 0, totalPnl: 0 };
  const trades = await db.trades.where('strategyId').equals(strategyId).toArray();
  const closedTrades = trades.filter((t) => getCachedMetrics(t).status === 'closed');

  if (closedTrades.length === 0) {
    return { tradeCount: 0, winRate: 0, totalPnl: 0 };
  }

  const wins = closedTrades.filter((t) => (getCachedMetrics(t).rMultiple ?? 0) > 0).length;
  const totalPnl = closedTrades.reduce((sum, t) => sum + (getCachedMetrics(t).pnl ?? 0), 0);

  return {
    tradeCount: trades.length,
    winRate: (wins / closedTrades.length) * 100,
    totalPnl,
  };
}
