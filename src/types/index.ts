// Trade direction
export type TradeDirection = 'long' | 'short';

// Trade status
export type TradeStatus = 'open' | 'partial' | 'closed' | 'cancelled';

// Trading session (auto-derived from entry time)
export type TradingSession = 'asian' | 'london' | 'new_york' | 'overlap' | 'other';

// Trade outcome
export type TradeOutcome = 'win' | 'loss' | 'breakeven';

// Asset class
export type AssetClass = 'forex' | 'crypto' | 'stocks' | 'futures' | 'options' | 'indices' | 'commodities' | 'other';

// Timeframe
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1H' | '4H' | 'D1' | 'W1' | 'M1';

// HTF Bias (Higher Timeframe Bias)
export type HTFBias = 'bullish' | 'bearish' | 'neutral' | 'ranging';

// Market condition
export type MarketCondition = 'trending' | 'ranging' | 'volatile' | 'choppy' | 'breakout' | 'reversal';

// Confidence level
export type ConfidenceLevel = 'low' | 'medium' | 'high';

// Exit type for individual exits
export type ExitType =
  | 'tp_hit'
  | 'sl_hit'
  | 'manual_close'
  | 'trail_stop_hit'
  | 'be_stop_hit'
  | 'time_exit';

// Emotional state (1-5 scale)
export type EmotionalState = 1 | 2 | 3 | 4 | 5;

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

// Legacy partial exit record (for migration compatibility)
export interface PartialExit {
  id: string;
  price: number;
  size: number;
  time: Date;
  reason: string;
}

// Stop adjustment record
export interface StopAdjustment {
  id: string;
  time: Date;
  newStop: number;
  reason: string;
  trigger?: string;
}

// Screenshot with caption
export interface Screenshot {
  id: string;
  data: string; // base64 or URL
  caption: string;
  createdAt: Date;
}

// Account entity
export interface Account {
  id?: string; // Optional - Dexie Cloud generates with @id
  name: string;
  broker: string;
  currency: string;
  startingBalance: number;
  currentBalance: number;
  createdAt?: Date;
  updatedAt?: Date;
}

// Strategy entity
export interface Strategy {
  id?: string; // Optional - Dexie Cloud generates with @id
  name: string;
  description: string;
  rules: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Tag definition for glossary (deprecated - use GlossaryTerm instead)
export interface TagDefinition {
  tag: string; // Primary key - the tag name
  description: string;
}

// Glossary term for trading terminology
export interface GlossaryTerm {
  id?: string; // Optional - Dexie Cloud generates with @id
  term: string; // The acronym or short form (e.g. "DHOB", "RRT")
  definition: string; // Full explanation
  category?: string; // Optional grouping (e.g. "Order Blocks", "Fibonacci")
}

// Trade record entity - full spec
export interface TradeRecord {
  id?: string; // Optional - Dexie Cloud generates with @id
  accountId: string;
  strategyId: string;

  // === Instrument & Direction ===
  pair: string;
  assetClass: AssetClass;
  direction: TradeDirection;

  // === Entry & Exit ===
  entryTime: Date;
  exitTime?: Date;
  status: TradeStatus; // auto-derived: no exitTime = open

  // === Price Levels ===
  entryPrice: number;
  stopLoss: number;
  targetPrice?: number;  // Primary profit target for planned R:R
  exitPrice?: number;    // Auto-derived: weighted average of all exits

  // === Position Sizing ===
  positionSize: number;
  riskAmount?: number;
  riskPercent?: number;

  // === Exits ===
  exits: TradeExit[];           // Unified exit records
  stopAdjustments: StopAdjustment[];
  exitType?: ExitType;          // Auto-derived: single exit type or undefined for multiple

  // === Setup & Market Context ===
  setupTags: string[]; // Multi-tag confluence system
  analysisTF?: Timeframe; // Timeframe used to identify the setup (e.g. H4, D1)
  entryTF?: Timeframe; // Timeframe used to execute entry (e.g. 15m, 1H)
  htfBias?: HTFBias;
  marketCondition?: MarketCondition;

  // === Trade Taken / Missed ===
  tradeTaken: boolean; // false = missed/paper trade, excluded from live stats
  notTakenReason?: string; // reason for not taking trade (only relevant when tradeTaken is false)

  // === Psychology ===
  emotionalState?: EmotionalState;
  confidenceLevel?: ConfidenceLevel;
  followedPlan?: boolean;
  planDeviation?: string; // shown only if followedPlan is false
  isRevengeTrade?: boolean;
  isOverTrade?: boolean;

  // === Notes & Screenshots ===
  preTradeNotes?: string;
  postTradeNotes?: string;
  screenshots: Screenshot[];
  tags: string[];

  // === MAE/MFE (for stop/exit analysis) ===
  maePrice: number | null; // Maximum Adverse Excursion - worst price reached during trade
  mfePrice: number | null; // Maximum Favorable Excursion - best price reached during trade
  maeR?: number; // MAE expressed in R-multiples (derived from maePrice)
  mfeR?: number; // MFE expressed in R-multiples (derived from mfePrice)

  // === Post-Exit Tracking ===
  postExitBestPrice: number | null; // Best price in your favour after full exit
  postExitWorstPrice: number | null; // Worst price against your direction after exit
  reachedTargetPostExit: boolean | null; // Did price hit targetPrice after you exited?
  postExitNotes: string; // Reflection on what happened after exit
  reviewedAt: string | null; // Timestamp of when the trade was reviewed post-exit

  // === Auto-calculated fields ===
  session: TradingSession; // derived from entryTime
  plannedRR?: number; // |entryPrice - targetPrice| / |entryPrice - stopLoss|
  actualRR?: number; // |exitPrice - entryPrice| / |entryPrice - stopLoss|
  rMultiple?: number; // signed actualRR (positive for winners)
  stopDistance?: number; // |entryPrice - stopLoss|
  pnl?: number; // R-multiple × riskAmount (derived from exits)
  commissions?: number;
  swap?: number;
  netPnl?: number; // pnl - commissions - swap
  holdDuration?: number; // exitTime - entryTime in minutes
  originalStopLoss?: number; // set on first save, never overwritten

  // === Metadata ===
  createdAt: Date;
  updatedAt: Date;
}

// Daily journal entry
export interface DailyJournal {
  id?: string; // Optional - Dexie Cloud generates with @id
  date: Date;
  accountId: string;

  // Pre-market preparation
  preMarketNotes?: string;
  marketBias?: string;
  keyLevels?: string;
  newsEvents?: string;

  // Daily plan
  tradingPlan?: string;
  maxTrades?: number;
  maxLoss?: number;

  // End of day review
  endOfDayNotes?: string;
  lessonsLearned?: string;

  // Performance summary (calculated from trades)
  totalTrades?: number;
  winningTrades?: number;
  losingTrades?: number;
  totalPnl?: number;

  // Mental/emotional state
  mentalState?: string;
  energyLevel?: number; // 1-10 scale
  focusLevel?: number; // 1-10 scale
  emotionalScore?: number; // 1-5 scale (same as trade form)

  // Execution quality
  grade?: 'A' | 'B' | 'C' | 'D' | 'F';

  // Rule adherence
  followedPlan?: boolean;
  rulesViolated?: string[];

  // Goals
  dailyGoal?: string;
  goalAchieved?: boolean;

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
  | 'losing_streak'
  | 'plan_deviation_streak';

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

  // Entry & Exit
  entryTime: string; // ISO string for datetime-local input
  exitTime: string;

  // Price Levels
  entryPrice: string;
  stopLoss: string;
  targetPrice: string;   // Primary profit target
  maePrice: string;      // Worst price reached during trade (price level)
  mfePrice: string;      // Best price reached during trade (price level)

  // Position Sizing
  positionSize: string;
  riskAmount: string;
  riskPercent: string;

  // Exits
  exits: TradeExit[];
  stopAdjustments: StopAdjustment[];

  // Setup & Market Context
  setupTags: string[];
  analysisTF: Timeframe | '';
  entryTF: Timeframe | '';
  htfBias: HTFBias | '';
  marketCondition: MarketCondition | '';

  // Trade Taken / Missed
  tradeTaken: boolean;
  notTakenReason: string;

  // Psychology
  emotionalState: EmotionalState | null;
  confidenceLevel: ConfidenceLevel | '';
  followedPlan: boolean;
  planDeviation: string;
  isRevengeTrade: boolean;
  isOverTrade: boolean;

  // Notes & Screenshots
  preTradeNotes: string;
  postTradeNotes: string;
  screenshots: Screenshot[];
  tags: string[];

  // Fees
  commissions: string;
  swap: string;

  // Account/Strategy selection
  accountId: string;
  strategyId: string;

  // Post-Exit Review
  postExitBestPrice: string;
  postExitWorstPrice: string;
  reachedTargetPostExit: boolean | null;
  postExitNotes: string;
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
