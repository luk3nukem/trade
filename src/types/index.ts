// Trade direction
export type TradeDirection = 'long' | 'short';

// Trade status (derived from exits)
export type TradeStatus = 'open' | 'partial' | 'closed' | 'cancelled';

// Trading session (auto-derived from entry time)
export type TradingSession = 'asian' | 'london' | 'new_york' | 'overlap' | 'other';

// Trade outcome
export type TradeOutcome = 'win' | 'loss' | 'breakeven';

// Asset class
export type AssetClass = 'forex' | 'crypto' | 'stocks' | 'futures' | 'options' | 'indices' | 'commodities' | 'other';

// Timeframe (letter-first notation: M=minutes, H=hours, D=days, W=weeks, MN=monthly)
export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

// Exit type for individual exits
export type ExitType =
  | 'tp_hit'
  | 'sl_hit'
  | 'manual_close'
  | 'trail_stop_hit'
  | 'be_stop_hit'
  | 'time_exit';

// Trade exit record (unified exit system)
export interface TradeExit {
  id: string;
  price: number;
  size: number;        // portion of position closed (lots/contracts/shares)
  time: Date;
  type: ExitType;      // "tp_hit", "sl_hit", "manual_close", "trail_stop_hit", "be_stop_hit", "time_exit"
  reason?: string;     // optional note e.g. "TP at S/R", "momentum fading"
  drawdownAfter?: number | null; // worst price against trade direction after this exit (before next exit)
}

// Level reaction type
export type LevelReaction = 'bounced' | 'front_run' | 'swept_then_bounced' | 'broken' | null;

// Zone-type levels (have two edges: near and far)
export const ZONE_LEVEL_TYPES = ['HOB', 'LOB', 'DHOB', 'DLOB', 'OB', 'FVG', 'BB', 'IMB', 'ATR_Range'] as const;

// High/Low zone types: symmetric range types where edges are labeled High/Low instead of Near/Far
// For these types, price = high edge, priceFar = low edge (by magnitude, not approach direction)
export const HIGH_LOW_ZONE_TYPES = ['ATR_Range'] as const;

// Level types that show a detail field (e.g., fib ratio)
export const DETAIL_LEVEL_TYPES = ['fib'] as const;

// Level entry in a sequence (ordered shallowest to deepest)
export interface LevelEntry {
  id: string;
  levelType: string;      // "LCPB", "HOB", "fib", "S/R", ... autocomplete, user-extendable
  levelDetail: string;    // specific variant, e.g. fib ratio: "0.5", "0.705", "GP"
  timeframe: string;      // "H1", "H4", "D1", "W1", "MTF", ""
  price: number;          // for near_far zones: near edge; for high_low zones: high edge
  priceFar: number | null; // for near_far zones: far edge; for high_low zones: low edge; null = line level
  deepestPrice?: number | null; // zones only: extreme price reached inside zone before turn
  penetrationPercent?: number | null; // near_far zones: |deepestPrice - nearEdge| / |farEdge - nearEdge| × 100
                                       // high_low zones: rangeConsumedPercent (derived from traversal direction)
  turnPrice?: number | null; // where reaction actually began (front_run: short of level; swept_then_bounced on lines: beyond level)
  reaction: LevelReaction; // "bounced" | "front_run" | "swept_then_bounced" | "broken" | null (unresolved)
}

// Screenshot with URL (e.g., TradingView snapshot)
export interface Screenshot {
  id: string;
  url: string; // Image URL (e.g., TradingView snapshot URL)
  caption: string;
  createdAt: Date;
}

// Unified timeline event (replaces events, stopAdjustments, and postExitSequence)
export interface TradeEvent {
  id: string;
  order: number;          // authoritative sequence (1, 2, 3...)
  time: string | null;    // optional ISO string
  eventType: string;      // preset + custom event types
  price: number | null;   // price level for this event
  description: string;    // note or reason
}

// Event type presets
// Note: trade_high/trade_low are direction-neutral (just high/low price during trade)
// post_exit_high/post_exit_low are direction-neutral (just high/low price after exit)
export const EVENT_TYPE_PRESETS = [
  'trade_high',
  'trade_low',
  'stop_moved',
  'liquidity_sweep',
  'spike_up',
  'spike_down',
  'dump',
  'pump',
  'stall_consolidation',
  'reversal',
  'news_reaction',
  'session_open_move',
  'retest',
  'post_exit_high',
  'post_exit_low',
  'leg',
] as const;

// Legacy event type mappings for migration
export const LEGACY_EVENT_TYPE_MAP: Record<string, string> = {
  'worst_price': 'trade_low',    // Will be remapped based on actual price
  'best_price': 'trade_high',    // Will be remapped based on actual price
  'favourable_extreme': 'post_exit_high', // Will be remapped based on actual price
  'adverse_extreme': 'post_exit_low',     // Will be remapped based on actual price
};

export type EventTypePreset = typeof EVENT_TYPE_PRESETS[number];

// Not taken reason presets
// NOTE: 'front_run' is a protected reason that cannot be renamed/deleted
export const NOT_TAKEN_REASON_PRESETS = [
  'front_run',         // Protected: price turned before entry
  'doubted_setup',
  'broker_cancelled',
  'weekend_approaching',
  'missed_entry_window',
  'away_from_desk',
  'already_in_trade',
  'risk_too_high',
  'news_pending',
] as const;

export type NotTakenReasonPreset = typeof NOT_TAKEN_REASON_PRESETS[number];

// Protected reasons that cannot be renamed/deleted in the management UI
export const PROTECTED_NOT_TAKEN_REASONS = ['front_run'] as const;

// User-friendly labels for not-taken reasons
export const NOT_TAKEN_REASON_LABELS: Record<string, string> = {
  front_run: 'Front run — price turned before my entry',
  doubted_setup: 'Doubted setup',
  broker_cancelled: 'Broker cancelled',
  weekend_approaching: 'Weekend approaching',
  missed_entry_window: 'Missed entry window',
  away_from_desk: 'Away from desk',
  already_in_trade: 'Already in trade',
  risk_too_high: 'Risk too high',
  news_pending: 'News pending',
};

// Account entity
export interface Account {
  id?: string; // Optional - Dexie Cloud generates with @id
  name: string;
  broker: string;
  currency: string;
  startingBalance: number;
  currentBalance: number;
  isDefault?: boolean; // True for the default account (replaces hardcoded "default" ID)
  createdAt?: Date;
  updatedAt?: Date;
}

// Strategy entity
export interface Strategy {
  id?: string; // Optional - Dexie Cloud generates with @id
  name: string;
  description: string;
  rules: string;
  isDefault?: boolean; // True for the default strategy (replaces hardcoded "default" ID)
  createdAt?: Date;
  updatedAt?: Date;
}

// Glossary term for trading terminology
export interface GlossaryTerm {
  id?: string; // Optional - Dexie Cloud generates with @id
  term: string; // The acronym or short form (e.g. "DHOB", "RRT")
  definition: string; // Full explanation
  category?: string; // Optional grouping (e.g. "Order Blocks", "Fibonacci")
}

// Level type preference for custom level types (zone vs line)
export interface LevelTypePref {
  id?: string; // Optional - Dexie Cloud generates with @id
  levelType: string; // The level type name (e.g. "custom_zone", "my_level")
  isZone: boolean; // true = zone (has near/far edge), false = line (single price)
}

// Note status
export type NoteStatus = 'active' | 'validated' | 'retired';

// Confirmation counterfactual outcomes (for blind entries)
export type ConfirmationCounterfactual = 'appeared_worked' | 'appeared_failed' | 'never_appeared' | '';

// Blind entry confirmation types
export const BLIND_ENTRY_TYPES = ['blind_limit', 'blind_market'] as const;

// Note category presets
export const NOTE_CATEGORY_PRESETS = [
  'observation',
  'rule',
  'hypothesis',
  'mistake',
  'idea',
] as const;

// Trading notebook note
export interface Note {
  id?: string; // Optional - Dexie Cloud generates with @id
  createdAt: Date;
  updatedAt: Date;
  content: string;
  category: string; // free combo with autocomplete from presets
  status: NoteStatus; // "active" | "validated" | "retired"
  pinned: boolean;
}

// Type for creating new notes
export type CreateNote = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>;

// Trade record entity - v2 simplified schema
export interface TradeRecord {
  id?: string; // Optional - Dexie Cloud generates with @id
  createdAt: Date;
  updatedAt: Date;
  accountId: string;
  strategyId: string;

  // === Instrument & Direction ===
  pair: string;
  assetClass: AssetClass;
  direction: TradeDirection;

  // === Entry ===
  entryTime: Date;
  entryPrice: number;
  stopLoss: number;
  targetPrice?: number;  // Primary profit target for planned R:R

  // === Position Sizing ===
  positionSize: number;
  riskAmount?: number;
  riskPercent?: number;

  // === Exits ===
  exits: TradeExit[];

  // === Unified Timeline ===
  timeline: TradeEvent[];  // All events: worst/best price, stop moves, post-exit milestones

  // === Setup ===
  levelSequence: LevelEntry[]; // Levels in zone, ordered shallowest to deepest
  contextTags: string[];       // Replaces setupTags - describes trade context
  entryTF?: Timeframe;         // Timeframe used to execute entry
  entryConfirmation?: string;  // How the entry was executed
  confirmationTF?: string;     // Timeframe the confirmation was observed on

  // === Trade Taken / Missed ===
  tradeTaken: boolean;         // false = missed/paper trade, excluded from live stats
  notTakenReason: string;      // REQUIRED when tradeTaken === false
  frontRunTurnPrice?: number | null; // where price turned short of entry (when notTakenReason === 'front_run')

  // === Notes ===
  entryNotes?: string;         // Thesis and plan as you execute
  closeNotes?: string;         // Immediate review as the trade closes
  postExitNotes?: string;      // Post-exit reflection

  // === Post-Exit Review ===
  reachedTargetPostExit: boolean | null; // Did price hit targetPrice after you exited?
  reviewedAt: string | null;   // Timestamp of when the trade was reviewed post-exit

  // === Confirmation Counterfactual (for blind entries) ===
  confirmationCounterfactual?: string;  // "appeared_worked" | "appeared_failed" | "never_appeared" | ""
  counterfactualEntryPrice?: number | null; // where the confirmed entry would have filled (required when counterfactual = appeared_*)

  // === Screenshots ===
  screenshots: Screenshot[];
}

// Daily journal entry - v2 simplified
export interface DailyJournal {
  id?: string; // Optional - Dexie Cloud generates with @id
  date: Date;
  accountId: string;

  // Notes
  preMarketNotes?: string;
  endOfDayNotes?: string;
  lessonsLearned?: string;

  // Weekly review (for Friday entries with isWeeklyReview flag)
  isWeeklyReview?: boolean;
  weeklyDidWell?: string;
  weeklyToImprove?: string;
  weeklyAdjustment?: string;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

// Alert types
export type AlertSeverity = 'warning' | 'danger';

export type AlertType =
  | 'revenge_trade'
  | 'overtrade'
  | 'sizing_spike'
  | 'edge_decay'
  | 'drawdown'
  | 'losing_streak';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  relatedTradeIds: string[];
  timestamp: Date;
}

export interface AlertSettings {
  dailyTradeLimit: number;
  drawdownWarningThreshold: number;
  revengeTradeWindowMinutes: number;
  minRThreshold: number; // Minimum R move in trader's favour to validate thesis
  enabledAlerts: Record<AlertType, boolean>;
}

// Backup data structure for import/export
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

// Form state type (for managing the trade form)
export interface TradeFormData {
  // Instrument & Direction
  pair: string;
  assetClass: AssetClass;
  direction: TradeDirection;

  // Entry
  entryTime: string; // ISO string for datetime-local input
  entryPrice: string;
  stopLoss: string;
  targetPrice: string;

  // Position Sizing
  positionSize: string;
  riskAmount: string;
  riskPercent: string;

  // Exits
  exits: TradeExit[];

  // Timeline
  timeline: TradeEvent[];

  // Setup
  levelSequence: LevelEntry[];
  contextTags: string[];
  entryTF: Timeframe | '';
  entryConfirmation: string;
  confirmationTF: string;

  // Trade Taken / Missed
  tradeTaken: boolean;
  notTakenReason: string;
  frontRunTurnPrice: string;

  // Notes
  entryNotes: string;
  closeNotes: string;
  postExitNotes: string;

  // Screenshots
  screenshots: Screenshot[];

  // Account/Strategy selection
  accountId: string;
  strategyId: string;

  // Post-Exit Review
  reachedTargetPostExit: boolean | null;

  // Confirmation Counterfactual (for blind entries)
  confirmationCounterfactual: string;
  counterfactualEntryPrice: string;
}

// Type for creating new records (without id and timestamps)
export type CreateTradeRecord = Omit<TradeRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type CreateAccount = Omit<Account, 'id' | 'createdAt' | 'updatedAt'>;
export type CreateStrategy = Omit<Strategy, 'id' | 'createdAt' | 'updatedAt'>;
export type CreateDailyJournal = Omit<DailyJournal, 'id' | 'createdAt' | 'updatedAt'>;

// Type for updating records (all fields optional except id)
export type UpdateTradeRecord = Partial<TradeRecord> & { id: string };
export type UpdateAccount = Partial<Account> & { id: string };
export type UpdateStrategy = Partial<Strategy> & { id: string };
export type UpdateDailyJournal = Partial<DailyJournal> & { id: string };
