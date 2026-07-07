import Dexie, { type EntityTable } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import type { TradeRecord, Account, Strategy, DailyJournal, TagDefinition, GlossaryTerm } from '../types';

// Database class extending Dexie with cloud sync
class TradingDiaryDB extends Dexie {
  trades!: EntityTable<TradeRecord, 'id'>;
  accounts!: EntityTable<Account, 'id'>;
  strategies!: EntityTable<Strategy, 'id'>;
  dailyJournals!: EntityTable<DailyJournal, 'id'>;
  glossaryTerms!: EntityTable<GlossaryTerm, 'id'>;

  constructor() {
    super('tradingDiary', { addons: [dexieCloud] });

    // Version 1 - original schema
    this.version(1).stores({
      trades: 'id, accountId, strategyId, pair, setupType, session, status, entryTime, exitTime, direction, [accountId+strategyId]',
      accounts: 'id',
      strategies: 'id',
      dailyJournals: 'id, date, accountId',
    });

    // Version 2 - migrate setupType/keyLevelType to setupTags array
    this.version(2)
      .stores({
        // Replace setupType index with *setupTags (multi-entry index)
        trades: 'id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction, [accountId+strategyId]',
        accounts: 'id',
        strategies: 'id',
        dailyJournals: 'id, date, accountId',
      })
      .upgrade((tx) => {
        return tx
          .table('trades')
          .toCollection()
          .modify((trade) => {
            // Migrate setupType and keyLevelType to setupTags array
            const tags: string[] = [];

            // Add setupType if it exists
            if (trade.setupType && typeof trade.setupType === 'string' && trade.setupType.trim()) {
              tags.push(trade.setupType.trim());
            }

            // Add keyLevelType if it exists
            if (trade.keyLevelType && typeof trade.keyLevelType === 'string' && trade.keyLevelType.trim()) {
              tags.push(trade.keyLevelType.trim());
            }

            // Set the new setupTags array
            trade.setupTags = tags;

            // Remove old fields
            delete trade.setupType;
            delete trade.keyLevelType;
          });
      });

    // Version 3 - Dexie Cloud compatible schema with @id for cloud-generated IDs
    this.version(3)
      .stores({
        trades: '@id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction',
        accounts: '@id',
        strategies: '@id',
        dailyJournals: '@id, date, accountId',
      });

    // Version 4 - Split timeframe into analysisTF and entryTF
    this.version(4)
      .stores({
        trades: '@id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction, entryTF',
        accounts: '@id',
        strategies: '@id',
        dailyJournals: '@id, date, accountId',
      })
      .upgrade((tx) => {
        return tx
          .table('trades')
          .toCollection()
          .modify((trade) => {
            // Migrate timeframe to entryTF, set analysisTF to undefined
            if (trade.timeframe) {
              // Map old timeframe values to new format if needed
              const tfMap: Record<string, string> = {
                '1h': '1H',
                '4h': '4H',
                'daily': 'D1',
                'weekly': 'W1',
                'monthly': 'M1',
              };
              trade.entryTF = tfMap[trade.timeframe] || trade.timeframe;
            }
            trade.analysisTF = undefined;
            delete trade.timeframe;
          });
      });

    // Version 5 - Add stopAdjustments field for stop management tracking
    this.version(5)
      .stores({
        trades: '@id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction, entryTF',
        accounts: '@id',
        strategies: '@id',
        dailyJournals: '@id, date, accountId',
      })
      .upgrade((tx) => {
        return tx
          .table('trades')
          .toCollection()
          .modify((trade) => {
            // Initialize stopAdjustments array for all existing trades
            if (!trade.stopAdjustments) {
              trade.stopAdjustments = [];
            }
          });
      });

    // Version 6 - Unified exit system: replace TP1/2/3 + partials with targetPrice + exits
    this.version(6)
      .stores({
        trades: '@id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction, entryTF',
        accounts: '@id',
        strategies: '@id',
        dailyJournals: '@id, date, accountId',
      })
      .upgrade((tx) => {
        return tx
          .table('trades')
          .toCollection()
          .modify((trade) => {
            // Migrate takeProfit1 to targetPrice
            if (trade.takeProfit1 !== undefined) {
              trade.targetPrice = trade.takeProfit1;
            }
            // Remove old TP fields
            delete trade.takeProfit1;
            delete trade.takeProfit2;
            delete trade.takeProfit3;

            // Initialize exits array
            trade.exits = [];

            // Convert existing partials to exits
            if (trade.partials && Array.isArray(trade.partials) && trade.partials.length > 0) {
              for (const partial of trade.partials) {
                trade.exits.push({
                  id: partial.id || crypto.randomUUID(),
                  price: partial.price,
                  size: partial.size,
                  time: partial.time,
                  type: 'tp_hit',
                  reason: partial.reason || undefined,
                });
              }
            } else if (trade.exitPrice !== undefined && trade.status === 'closed') {
              // No partials but has exitPrice - create single exit from old data
              const exitTypeMap: Record<string, string> = {
                'tp1': 'tp_hit',
                'tp2': 'tp_hit',
                'tp3': 'tp_hit',
                'stop_loss': 'sl_hit',
                'trailing_stop': 'trail_stop_hit',
                'break_even': 'be_stop_hit',
                'manual': 'manual_close',
                'time_based': 'time_exit',
                'partial': 'tp_hit',
              };
              trade.exits.push({
                id: crypto.randomUUID(),
                price: trade.exitPrice,
                size: trade.positionSize || 1,
                time: trade.exitTime || new Date(),
                type: exitTypeMap[trade.exitType] || 'manual_close',
                reason: undefined,
              });
            }

            // Remove old partials array
            delete trade.partials;
          });
      });

    // Version 7 - Add tradeTaken field for missed/paper trade tracking
    this.version(7)
      .stores({
        trades: '@id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction, entryTF, tradeTaken',
        accounts: '@id',
        strategies: '@id',
        dailyJournals: '@id, date, accountId',
      })
      .upgrade((tx) => {
        return tx
          .table('trades')
          .toCollection()
          .modify((trade) => {
            // Set tradeTaken to true for all existing trades (they were real trades)
            if (trade.tradeTaken === undefined) {
              trade.tradeTaken = true;
            }
            // Initialize notTakenReason as empty string
            if (trade.notTakenReason === undefined) {
              trade.notTakenReason = '';
            }
          });
      });

    // Version 8 - MAE/MFE now stored as price levels instead of pip distances
    // Reset existing values since they can't be reliably converted
    this.version(8)
      .stores({
        trades: '@id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction, entryTF, tradeTaken',
        accounts: '@id',
        strategies: '@id',
        dailyJournals: '@id, date, accountId',
      })
      .upgrade((tx) => {
        return tx
          .table('trades')
          .toCollection()
          .modify((trade) => {
            // Reset MAE/MFE values - old pip distances can't be converted to prices
            // User can re-enter them as price levels
            delete trade.mae;
            delete trade.mfe;
            trade.maePrice = null;
            trade.mfePrice = null;
            trade.maeR = undefined;
            trade.mfeR = undefined;
          });
      });

    // Version 9 - Add tagDefinitions table for tag glossary
    this.version(9)
      .stores({
        trades: '@id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction, entryTF, tradeTaken',
        accounts: '@id',
        strategies: '@id',
        dailyJournals: '@id, date, accountId',
        tagDefinitions: 'tag', // Primary key is the tag name
      });

    // Version 10 - Add glossary table and migrate tagDefinitions
    this.version(10)
      .stores({
        trades: '@id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction, entryTF, tradeTaken',
        accounts: '@id',
        strategies: '@id',
        dailyJournals: '@id, date, accountId',
        tagDefinitions: null, // Remove tagDefinitions table
        glossaryTerms: 'term, category', // New glossary table
      })
      .upgrade(async (tx) => {
        // Migrate any existing tagDefinitions to glossary
        const oldDefs = await tx.table('tagDefinitions').toArray();
        if (oldDefs.length > 0) {
          const glossaryEntries = oldDefs.map((def: TagDefinition) => ({
            term: def.tag,
            definition: def.description,
            category: 'Setup Tags', // Default category for migrated tags
          }));
          await tx.table('glossaryTerms').bulkAdd(glossaryEntries);
        }
      });

    // Version 11 - Add post-exit tracking fields
    this.version(11)
      .stores({
        trades: '@id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction, entryTF, tradeTaken',
        accounts: '@id',
        strategies: '@id',
        dailyJournals: '@id, date, accountId',
        glossaryTerms: 'term, category',
      })
      .upgrade((tx) => {
        return tx
          .table('trades')
          .toCollection()
          .modify((trade) => {
            // Initialize post-exit tracking fields for all existing trades
            if (trade.postExitBestPrice === undefined) {
              trade.postExitBestPrice = null;
            }
            if (trade.postExitWorstPrice === undefined) {
              trade.postExitWorstPrice = null;
            }
            if (trade.reachedTargetPostExit === undefined) {
              trade.reachedTargetPostExit = null;
            }
            if (trade.postExitNotes === undefined) {
              trade.postExitNotes = '';
            }
            if (trade.reviewedAt === undefined) {
              trade.reviewedAt = null;
            }
          });
      });

    // Version 12 - Change glossary to use @id for Dexie Cloud compatibility
    this.version(12)
      .stores({
        trades: '@id, accountId, strategyId, pair, *setupTags, session, status, entryTime, exitTime, direction, entryTF, tradeTaken',
        accounts: '@id',
        strategies: '@id',
        dailyJournals: '@id, date, accountId',
        glossaryTerms: '@id, term, category', // Changed from 'term, category' to '@id, term, category'
      })
      .upgrade(async (tx) => {
        // Migration: Copy existing glossary entries to new schema with @id
        // Dexie will automatically generate new IDs for entries without one
        const existingTerms = await tx.table('glossaryTerms').toArray();

        // Clear and re-add with new schema (Dexie Cloud will generate @id)
        await tx.table('glossaryTerms').clear();

        for (const term of existingTerms) {
          // Add without id - Dexie Cloud will generate @id
          await tx.table('glossaryTerms').add({
            term: term.term,
            definition: term.definition,
            category: term.category,
          });
        }
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

// Default account seed data
const DEFAULT_ACCOUNT: Account = {
  id: 'default',
  name: 'Default Account',
  broker: '',
  currency: 'USD',
  startingBalance: 0,
  currentBalance: 0,
};

// Default strategy seed data
const DEFAULT_STRATEGY: Strategy = {
  id: 'default',
  name: 'Default Strategy',
  description: '',
  rules: '',
};

// Initialize seed data on first load
export async function initializeSeedData(): Promise<void> {
  // Check and insert default account if it doesn't exist
  const existingAccount = await db.accounts.get('default');
  if (!existingAccount) {
    await db.accounts.add(DEFAULT_ACCOUNT);
    console.log('Default account created');
  }

  // Check and insert default strategy if it doesn't exist
  const existingStrategy = await db.strategies.get('default');
  if (!existingStrategy) {
    await db.strategies.add(DEFAULT_STRATEGY);
    console.log('Default strategy created');
  }
}

export default db;
