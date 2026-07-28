import Dexie, { type EntityTable } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import type { TradeRecord, Account, Strategy, DailyJournal, GlossaryTerm, LevelTypePref } from '../types';

// Database class extending Dexie with cloud sync
class TradingDiaryDB extends Dexie {
  trades!: EntityTable<TradeRecord, 'id'>;
  accounts!: EntityTable<Account, 'id'>;
  strategies!: EntityTable<Strategy, 'id'>;
  dailyJournals!: EntityTable<DailyJournal, 'id'>;
  glossaryTerms!: EntityTable<GlossaryTerm, 'id'>;
  levelTypePrefs!: EntityTable<LevelTypePref, 'id'>;
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
}

// Helper to get the default account
export async function getDefaultAccount(): Promise<Account | undefined> {
  return db.accounts.filter(a => a.isDefault === true).first();
}

// Helper to get the default strategy
export async function getDefaultStrategy(): Promise<Strategy | undefined> {
  return db.strategies.filter(s => s.isDefault === true).first();
}

export default db;
