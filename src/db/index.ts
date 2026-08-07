import Dexie, { type EntityTable } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import type { TradeRecord, Account, Strategy, DailyJournal, GlossaryTerm, LevelTypePref, Note, AcknowledgedFinding } from '../types';
import { normalizeHighLowZoneEdges, isHighLowZoneType } from '../utils/tradeCalculations';

// Database class extending Dexie with cloud sync
class TradingDiaryDB extends Dexie {
  trades!: EntityTable<TradeRecord, 'id'>;
  accounts!: EntityTable<Account, 'id'>;
  strategies!: EntityTable<Strategy, 'id'>;
  dailyJournals!: EntityTable<DailyJournal, 'id'>;
  glossaryTerms!: EntityTable<GlossaryTerm, 'id'>;
  levelTypePrefs!: EntityTable<LevelTypePref, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  acknowledgedFindings!: EntityTable<AcknowledgedFinding, 'id'>;
  settings!: EntityTable<{ id: string; [key: string]: unknown }, 'id'>;

  constructor() {
    super('tradingDiary', { addons: [dexieCloud] });

    // Fresh v1 schema - complete reset
    this.version(1).stores({
      trades: '@id, accountId, strategyId, pair, entryTime',
      accounts: '@id',
      strategies: '@id',
      dailyJournals: '@id, date, accountId',
      glossaryTerms: '@id, term',
      levelTypePrefs: '@id, levelType',
      settings: '@id',
    });

    // v2 schema - add notes table
    this.version(2).stores({
      trades: '@id, accountId, strategyId, pair, entryTime',
      accounts: '@id',
      strategies: '@id',
      dailyJournals: '@id, date, accountId',
      glossaryTerms: '@id, term',
      levelTypePrefs: '@id, levelType',
      notes: '@id, category, status, pinned, createdAt',
      settings: '@id',
    });

    // v3 schema - add acknowledgedFindings table for audit acknowledgements
    this.version(3).stores({
      trades: '@id, accountId, strategyId, pair, entryTime',
      accounts: '@id',
      strategies: '@id',
      dailyJournals: '@id, date, accountId',
      glossaryTerms: '@id, term',
      levelTypePrefs: '@id, levelType',
      notes: '@id, category, status, pinned, createdAt',
      acknowledgedFindings: '@id, tradeId',
      settings: '@id',
    });

    // Configure Dexie Cloud
    const cloudUrl = import.meta.env.VITE_DEXIE_CLOUD_URL;
    if (cloudUrl) {
      this.cloud.configure({
        databaseUrl: cloudUrl,
        requireAuth: true, // Require auth for cross-device sync
      });
    }
  }
}

// Create and export the database instance
export const db = new TradingDiaryDB();

// Default account seed data (no id - Dexie Cloud will auto-generate)
const DEFAULT_ACCOUNT: Omit<Account, 'id'> = {
  name: 'Default Account',
  broker: '',
  currency: 'USD',
  startingBalance: 0,
  currentBalance: 0,
  isDefault: true,
};

// Default strategy seed data (no id - Dexie Cloud will auto-generate)
const DEFAULT_STRATEGY: Omit<Strategy, 'id'> = {
  name: 'Default Strategy',
  description: '',
  rules: '',
  isDefault: true,
};

// Initialize seed data on first load
export async function initializeSeedData(): Promise<void> {
  // Check and insert default account if none exists with isDefault flag
  const existingDefaultAccount = await db.accounts.filter(a => a.isDefault === true).first();
  if (!existingDefaultAccount) {
    await db.accounts.add(DEFAULT_ACCOUNT as Account);
    console.log('Default account created');
  }

  // Check and insert default strategy if none exists with isDefault flag
  const existingDefaultStrategy = await db.strategies.filter(s => s.isDefault === true).first();
  if (!existingDefaultStrategy) {
    await db.strategies.add(DEFAULT_STRATEGY as Strategy);
    console.log('Default strategy created');
  }

  // Run data migrations
  await migrateHighLowZoneEdges();
}

// Helper to get the default account
export async function getDefaultAccount(): Promise<Account | undefined> {
  return db.accounts.filter(a => a.isDefault === true).first();
}

// Helper to get the default strategy
export async function getDefaultStrategy(): Promise<Strategy | undefined> {
  return db.strategies.filter(s => s.isDefault === true).first();
}

// Migration: normalize high_low zone edges (ensure price = high, priceFar = low)
export async function migrateHighLowZoneEdges(): Promise<number> {
  let migratedCount = 0;
  const allTrades = await db.trades.toArray();

  for (const trade of allTrades) {
    if (!trade.levelSequence || trade.levelSequence.length === 0) continue;

    let needsUpdate = false;
    const updatedLevels = trade.levelSequence.map((level) => {
      if (!isHighLowZoneType(level.levelType) || level.priceFar === null) return level;
      // Check if edges need swapping (price should be high, priceFar should be low)
      if (level.price < level.priceFar) {
        needsUpdate = true;
        return normalizeHighLowZoneEdges(level);
      }
      return level;
    });

    if (needsUpdate && trade.id) {
      await db.trades.update(trade.id, { levelSequence: updatedLevels });
      migratedCount++;
    }
  }

  if (migratedCount > 0) {
    console.log(`Migrated ${migratedCount} trade(s) with high_low zone edge normalization`);
  }
  return migratedCount;
}

export default db;
