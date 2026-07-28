import { v4 as uuidv4 } from 'uuid';
import type {
  TradeRecord,
  TradeDirection,
  TradingSession,
  AssetClass,
  Timeframe,
  TradeExit,
  TradeEvent,
  LevelEntry,
  LevelReaction,
} from '../types';
import { ZONE_LEVEL_TYPES, NOT_TAKEN_REASON_PRESETS } from '../types';

// Pair configuration with weights and pip values
interface PairConfig {
  pair: string;
  weight: number;
  assetClass: AssetClass;
  pipValue: number; // $ per pip per standard lot
  priceDecimals: number;
  typicalPrice: number;
  pipSize: number; // Size of one pip
}

const PAIRS: PairConfig[] = [
  { pair: 'EUR/USD', weight: 25, assetClass: 'forex', pipValue: 10, priceDecimals: 5, typicalPrice: 1.0850, pipSize: 0.0001 },
  { pair: 'GBP/USD', weight: 25, assetClass: 'forex', pipValue: 10, priceDecimals: 5, typicalPrice: 1.2650, pipSize: 0.0001 },
  { pair: 'USD/JPY', weight: 15, assetClass: 'forex', pipValue: 6.67, priceDecimals: 3, typicalPrice: 149.50, pipSize: 0.01 },
  { pair: 'GBP/JPY', weight: 10, assetClass: 'forex', pipValue: 6.67, priceDecimals: 3, typicalPrice: 189.20, pipSize: 0.01 },
  { pair: 'AUD/USD', weight: 10, assetClass: 'forex', pipValue: 10, priceDecimals: 5, typicalPrice: 0.6520, pipSize: 0.0001 },
  { pair: 'BTC/USD', weight: 10, assetClass: 'crypto', pipValue: 1, priceDecimals: 2, typicalPrice: 67500, pipSize: 1 },
  { pair: 'NAS100', weight: 5, assetClass: 'indices', pipValue: 1, priceDecimals: 2, typicalPrice: 19850, pipSize: 0.25 },
];

// Context tag combinations - realistic multi-tag confluences
const CONTEXT_TAG_COMBINATIONS: { tags: string[]; weight: number; winBias: number }[] = [
  // 3-4 tag high confluence setups
  { tags: ['order_block', '0.618_fib', 'liquidity_sweep'], weight: 12, winBias: 0.72 },
  { tags: ['FVG', 'order_block', 'EMA_confluence'], weight: 10, winBias: 0.70 },
  { tags: ['breaker_block', '0.5_fib', 'session_high_low'], weight: 8, winBias: 0.68 },
  { tags: ['order_block', '0.618_fib', 'liquidity_sweep', 'supply_zone'], weight: 6, winBias: 0.75 },
  { tags: ['FVG', 'demand_zone', 'prev_day_high_low'], weight: 8, winBias: 0.65 },
  { tags: ['hidden_OB', 'imbalance', 'VWAP'], weight: 6, winBias: 0.64 },

  // 2 tag moderate confluence setups
  { tags: ['order_block', 'EMA_confluence'], weight: 10, winBias: 0.62 },
  { tags: ['FVG', '0.618_fib'], weight: 10, winBias: 0.60 },
  { tags: ['liquidity_sweep', 'supply_zone'], weight: 8, winBias: 0.58 },
  { tags: ['breakout', 'VWAP'], weight: 8, winBias: 0.52 },
  { tags: ['pullback', 'EMA_confluence'], weight: 8, winBias: 0.55 },
  { tags: ['demand_zone', '0.5_fib'], weight: 6, winBias: 0.56 },

  // Single tag setups
  { tags: ['breakout'], weight: 6, winBias: 0.48 },
  { tags: ['pullback'], weight: 4, winBias: 0.50 },
  { tags: ['range_reversal'], weight: 4, winBias: 0.45 },
];

const TIMEFRAMES: Timeframe[] = ['M15', 'H1', 'H4'];
const TIMEFRAME_WEIGHTS = [35, 45, 20];

// Level types
const LEVEL_TYPES = ['LCPB', 'HOB', 'LOB', 'DHOB', 'DLOB', 'fib', 'S/R', 'EQ', 'FVG', 'OB'];
const LEVEL_TIMEFRAMES = ['M15', 'H1', 'H4', 'D1', 'MTF', ''];

// Entry confirmation types
const ENTRY_CONFIRMATIONS = ['blind_limit', 'blind_market', 'structural', 'partial_confirmation'];
const CONFIRMATION_TFS: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1'];

// Helper functions
function weightedRandom<T>(items: T[], weights: number[]): T {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    random -= weights[i];
    if (random <= 0) return items[i];
  }
  return items[items.length - 1];
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// Generate level sequence for a trade
function generateLevelSequence(
  entryPrice: number,
  stopLoss: number,
  direction: TradeDirection,
  isWinner: boolean,
  priceDecimals: number
): LevelEntry[] {
  if (Math.random() > 0.4) return [];

  const stopDistance = Math.abs(entryPrice - stopLoss);
  const levelCount = randomInt(2, 4);
  const levels: LevelEntry[] = [];
  const turnPosition = isWinner ? randomInt(1, levelCount) : levelCount + 1;

  for (let i = 0; i < levelCount; i++) {
    const depthRatio = (i + 1) / (levelCount + 1);
    const distanceFromEntry = stopDistance * depthRatio * 0.9;

    const levelPrice = direction === 'long'
      ? roundToDecimals(entryPrice - distanceFromEntry, priceDecimals)
      : roundToDecimals(entryPrice + distanceFromEntry, priceDecimals);

    let reaction: LevelReaction;
    if (i + 1 < turnPosition) {
      reaction = Math.random() > 0.5 ? 'broken' : 'swept_then_bounced';
    } else if (i + 1 === turnPosition) {
      reaction = Math.random() > 0.3 ? 'bounced' : 'swept_then_bounced';
    } else {
      reaction = null;
    }

    if (i === 0 && turnPosition === 1 && Math.random() > 0.5) {
      reaction = Math.random() > 0.3 ? 'bounced' : 'front_run';
    }

    const levelType = randomElement(LEVEL_TYPES);
    let levelDetail = '';
    if (levelType.toLowerCase() === 'fib') {
      const fibDetails = ['0.25', '0.5', '0.618', '0.705', '0.75', '0.786', 'GP'];
      levelDetail = randomElement(fibDetails);
    }

    const isZone = ZONE_LEVEL_TYPES.includes(levelType as typeof ZONE_LEVEL_TYPES[number]);
    let priceFar: number | null = null;
    let deepestPrice: number | null = null;
    let penetrationPercent: number | null = null;

    if (isZone) {
      const zoneWidth = stopDistance * randomBetween(0.1, 0.4);
      priceFar = direction === 'long'
        ? roundToDecimals(levelPrice - zoneWidth, priceDecimals)
        : roundToDecimals(levelPrice + zoneWidth, priceDecimals);

      if (reaction !== null && reaction !== 'front_run') {
        let penetrationPct: number;
        if (reaction === 'bounced') {
          penetrationPct = randomBetween(5, 45);
        } else if (reaction === 'swept_then_bounced') {
          penetrationPct = randomBetween(40, 90);
        } else {
          penetrationPct = 100;
        }

        penetrationPercent = Math.round(penetrationPct);
        const actualPenetration = zoneWidth * (penetrationPct / 100);
        deepestPrice = direction === 'long'
          ? roundToDecimals(levelPrice - actualPenetration, priceDecimals)
          : roundToDecimals(levelPrice + actualPenetration, priceDecimals);
      }
    }

    levels.push({
      id: uuidv4(),
      levelType,
      levelDetail,
      timeframe: randomElement(LEVEL_TIMEFRAMES),
      price: levelPrice,
      priceFar,
      deepestPrice,
      penetrationPercent,
      reaction,
    });
  }

  return levels;
}

// Generate timeline events for a trade
function generateTimeline(
  entryPrice: number,
  exitPrice: number,
  stopLoss: number,
  direction: TradeDirection,
  isWinner: boolean,
  exitTime: Date,
  priceDecimals: number
): TradeEvent[] {
  const events: TradeEvent[] = [];
  let order = 1;
  const stopDistance = Math.abs(entryPrice - stopLoss);

  // Generate worst_price event (MAE) ~60% of trades
  if (Math.random() < 0.6) {
    let maePrice: number;
    if (isWinner) {
      const maePercent = randomBetween(0.1, 0.7);
      const maeDistance = stopDistance * maePercent;
      maePrice = direction === 'long'
        ? roundToDecimals(entryPrice - maeDistance, priceDecimals)
        : roundToDecimals(entryPrice + maeDistance, priceDecimals);
    } else {
      const maeMultiple = randomBetween(0.85, 1.1);
      const maeDistance = stopDistance * maeMultiple;
      maePrice = direction === 'long'
        ? roundToDecimals(entryPrice - maeDistance, priceDecimals)
        : roundToDecimals(entryPrice + maeDistance, priceDecimals);
    }

    events.push({
      id: uuidv4(),
      order: order++,
      time: null,
      eventType: 'worst_price',
      price: maePrice,
      description: direction === 'long' ? 'Lowest reached' : 'Highest reached',
    });
  }

  // Generate best_price event (MFE) ~60% of trades
  if (Math.random() < 0.6) {
    let mfePrice: number;
    if (isWinner) {
      const mfeMultiple = randomBetween(1, 1.5);
      const actualMove = Math.abs(exitPrice - entryPrice);
      const mfeDistance = actualMove * mfeMultiple;
      mfePrice = direction === 'long'
        ? roundToDecimals(entryPrice + mfeDistance, priceDecimals)
        : roundToDecimals(entryPrice - mfeDistance, priceDecimals);
    } else {
      const mfePercent = randomBetween(0, 0.4);
      const mfeDistance = stopDistance * mfePercent;
      mfePrice = direction === 'long'
        ? roundToDecimals(entryPrice + mfeDistance, priceDecimals)
        : roundToDecimals(entryPrice - mfeDistance, priceDecimals);
    }

    events.push({
      id: uuidv4(),
      order: order++,
      time: null,
      eventType: 'best_price',
      price: mfePrice,
      description: direction === 'long' ? 'Highest reached' : 'Lowest reached',
    });
  }

  // Generate stop_moved event ~30% of winners
  if (isWinner && Math.random() < 0.3) {
    const newStopPrice = direction === 'long'
      ? roundToDecimals(entryPrice + stopDistance * randomBetween(0.2, 0.5), priceDecimals)
      : roundToDecimals(entryPrice - stopDistance * randomBetween(0.2, 0.5), priceDecimals);

    events.push({
      id: uuidv4(),
      order: order++,
      time: null,
      eventType: 'stop_moved',
      price: newStopPrice,
      description: 'Moved to breakeven',
    });
  }

  // Generate additional mid-trade events ~20% of trades
  if (Math.random() < 0.2) {
    const midTradeEvents = ['liquidity_sweep', 'spike_up', 'spike_down', 'retest', 'consolidation'];
    events.push({
      id: uuidv4(),
      order: order++,
      time: null,
      eventType: randomElement(midTradeEvents),
      price: null,
      description: '',
    });
  }

  // Generate post-exit events for ~60% of older trades
  const now = new Date();
  const daysSinceExit = (now.getTime() - exitTime.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceExit > 1 && Math.random() < 0.6) {
    // Favourable extreme (post-exit best price)
    let postExitBestPrice: number;
    if (isWinner && Math.random() < 0.4) {
      const additionalMove = stopDistance * randomBetween(0.5, 2);
      postExitBestPrice = direction === 'long'
        ? roundToDecimals(exitPrice + additionalMove, priceDecimals)
        : roundToDecimals(exitPrice - additionalMove, priceDecimals);
    } else {
      const smallMove = stopDistance * randomBetween(0, 0.3);
      postExitBestPrice = direction === 'long'
        ? roundToDecimals(exitPrice + smallMove, priceDecimals)
        : roundToDecimals(exitPrice - smallMove, priceDecimals);
    }

    events.push({
      id: uuidv4(),
      order: order++,
      time: null,
      eventType: 'favourable_extreme',
      price: postExitBestPrice,
      description: 'Post-exit best price',
    });

    // Adverse extreme (post-exit worst price)
    const adverseMove = stopDistance * randomBetween(0.2, 1.2);
    const postExitWorstPrice = direction === 'long'
      ? roundToDecimals(exitPrice - adverseMove, priceDecimals)
      : roundToDecimals(exitPrice + adverseMove, priceDecimals);

    events.push({
      id: uuidv4(),
      order: order++,
      time: null,
      eventType: 'adverse_extreme',
      price: postExitWorstPrice,
      description: 'Post-exit worst price',
    });

    // Add leg event ~30% of trades with post-exit data
    if (Math.random() < 0.3) {
      events.push({
        id: uuidv4(),
        order: order++,
        time: null,
        eventType: 'leg',
        price: null,
        description: 'Price made another leg after exit',
      });
    }
  }

  return events;
}

// Generate a weekday date within the last N days
function generateWeekdayDate(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const day = date.getDay();
  if (day === 0) date.setDate(date.getDate() - 2);
  if (day === 6) date.setDate(date.getDate() - 1);
  return date;
}

// Generate entry time with session weighting
function generateEntryTime(baseDate: Date, session: TradingSession): Date {
  const date = new Date(baseDate);
  let hour: number;
  switch (session) {
    case 'asian': hour = randomInt(1, 6); break;
    case 'london': hour = randomInt(8, 12); break;
    case 'overlap': hour = randomInt(13, 15); break;
    case 'new_york': hour = randomInt(16, 19); break;
    default: hour = randomInt(8, 18);
  }
  date.setUTCHours(hour, randomInt(0, 59), randomInt(0, 59), 0);
  return date;
}

// Generate exit time based on entry timeframe
function generateExitTime(entryTime: Date, entryTF: Timeframe): Date {
  const exit = new Date(entryTime);
  let minutesHeld: number;

  switch (entryTF) {
    case 'M1': minutesHeld = randomInt(5, 30); break;
    case 'M5': minutesHeld = randomInt(10, 60); break;
    case 'M15': minutesHeld = randomInt(15, 180); break;
    case 'M30': minutesHeld = randomInt(30, 240); break;
    case 'H1': minutesHeld = randomInt(60, 480); break;
    case 'H4': minutesHeld = randomInt(240, 1440); break;
    case 'D1': minutesHeld = randomInt(1440, 4320); break;
    case 'W1': minutesHeld = randomInt(7200, 14400); break;
    case 'MN': minutesHeld = randomInt(20160, 43200); break;
    default: minutesHeld = randomInt(30, 360);
  }

  exit.setMinutes(exit.getMinutes() + minutesHeld);
  return exit;
}

// Generate exits (unified exit system)
function generateExits(
  entryPrice: number,
  exitPrice: number,
  positionSize: number,
  entryTime: Date,
  priceDecimals: number,
  hasPartials: boolean
): TradeExit[] {
  if (!hasPartials) {
    const exitTime = new Date(entryTime);
    exitTime.setMinutes(exitTime.getMinutes() + randomInt(30, 240));
    return [{
      id: uuidv4(),
      price: exitPrice,
      size: positionSize,
      time: exitTime,
      type: 'tp_hit',
      reason: undefined,
    }];
  }

  const numExits = randomInt(2, 3);
  const exits: TradeExit[] = [];
  const priceDiff = exitPrice - entryPrice;
  let remainingSize = positionSize;

  for (let i = 0; i < numExits; i++) {
    const isLast = i === numExits - 1;
    const sizePortion = isLast ? remainingSize : roundToDecimals(positionSize * randomBetween(0.25, 0.4), 2);
    remainingSize -= sizePortion;

    const progress = (i + 1) / numExits;
    const exitPricePartial = roundToDecimals(entryPrice + priceDiff * progress * randomBetween(0.7, 1), priceDecimals);

    const exitTime = new Date(entryTime);
    exitTime.setMinutes(exitTime.getMinutes() + randomInt(10, 120) * (i + 1));

    exits.push({
      id: uuidv4(),
      price: exitPricePartial,
      size: sizePortion,
      time: exitTime,
      type: 'tp_hit',
      reason: i === 0 ? 'TP1 hit' : i === 1 ? 'TP2 hit' : 'Final exit',
    });
  }

  return exits;
}

// Main seed data generation
export function generateDemoTrades(accountId: string, strategyId: string): TradeRecord[] {
  const trades: TradeRecord[] = [];

  // Plan trade distribution across 3 months
  const tradeDays: { daysAgo: number; isDrawdown: boolean; isRecovery: boolean }[] = [];
  let currentDay = 1;
  while (currentDay <= 90 && tradeDays.length < 48) {
    if (Math.random() > 0.65) {
      const isDrawdown = currentDay >= 38 && currentDay <= 48;
      const isRecovery = currentDay >= 49 && currentDay <= 60;
      tradeDays.push({ daysAgo: currentDay, isDrawdown, isRecovery });
    }
    currentDay++;
  }

  const shuffledDays = tradeDays.sort(() => Math.random() - 0.5);
  const sessions: TradingSession[] = ['asian', 'london', 'overlap', 'new_york'];
  const sessionWeights = [12, 35, 30, 23];

  // Track partial trade indices
  const partialTradeIndices = new Set<number>();
  while (partialTradeIndices.size < 9) {
    partialTradeIndices.add(randomInt(0, 44));
  }

  // Generate 45 closed trades
  for (let i = 0; i < 45; i++) {
    const dayInfo = shuffledDays[i] || { daysAgo: i * 2, isDrawdown: false, isRecovery: false };
    const hasPartials = partialTradeIndices.has(i);
    const pairConfig = weightedRandom(PAIRS, PAIRS.map(p => p.weight));
    const contextConfig = weightedRandom(CONTEXT_TAG_COMBINATIONS, CONTEXT_TAG_COMBINATIONS.map(s => s.weight));
    const session = weightedRandom(sessions, sessionWeights);
    const entryTF = weightedRandom(TIMEFRAMES, TIMEFRAME_WEIGHTS);
    const direction: TradeDirection = Math.random() > 0.5 ? 'long' : 'short';

    // Determine winner
    let winProbability = contextConfig.winBias;
    if (session === 'asian') winProbability -= 0.15;
    else if (session === 'overlap') winProbability += 0.08;
    if (pairConfig.pair === 'GBP/JPY') winProbability -= 0.30;
    if (dayInfo.isDrawdown) winProbability -= 0.20;
    if (dayInfo.isRecovery) winProbability += 0.10;
    const isWinner = Math.random() < winProbability;

    // Generate R-multiple
    let rMultiple: number;
    if (isWinner) {
      rMultiple = hasPartials
        ? roundToDecimals(randomBetween(1.5, 3.5), 2)
        : roundToDecimals(randomBetween(0.5, 2.5), 2);
    } else {
      if (Math.random() < 0.15) {
        rMultiple = -0.5;
      } else {
        rMultiple = -1;
      }
    }

    // Generate dates
    const baseDate = generateWeekdayDate(dayInfo.daysAgo);
    const entryTime = generateEntryTime(baseDate, session);
    const exitTime = generateExitTime(entryTime, entryTF);

    // Risk and position sizing
    const riskAmount = roundToDecimals(randomBetween(100, 300), 2);
    const stopPips = randomInt(15, 40);
    const stopDistance = stopPips * pairConfig.pipSize;
    const positionSize = roundToDecimals(riskAmount / (stopPips * pairConfig.pipValue), 2);

    // Price calculations
    const entryPrice = roundToDecimals(pairConfig.typicalPrice * randomBetween(0.98, 1.02), pairConfig.priceDecimals);
    const stopLoss = direction === 'long'
      ? roundToDecimals(entryPrice - stopDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice + stopDistance, pairConfig.priceDecimals);

    const exitMove = rMultiple * stopDistance;
    const exitPrice = direction === 'long'
      ? roundToDecimals(entryPrice + exitMove, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice - exitMove, pairConfig.priceDecimals);

    const tpDistance = stopDistance * randomBetween(1.5, 2.5);
    const targetPrice = direction === 'long'
      ? roundToDecimals(entryPrice + tpDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice - tpDistance, pairConfig.priceDecimals);

    // Generate exits
    const exits = generateExits(entryPrice, exitPrice, positionSize, entryTime, pairConfig.priceDecimals, hasPartials && isWinner);

    // Generate timeline
    const timeline = generateTimeline(entryPrice, exitPrice, stopLoss, direction, isWinner, exitTime, pairConfig.priceDecimals);

    // Generate level sequence
    const levelSequence = generateLevelSequence(entryPrice, stopLoss, direction, isWinner, pairConfig.priceDecimals);

    // Entry confirmation
    let entryConfirmation: string | undefined;
    let confirmationTF: string | undefined;
    if (Math.random() < 0.7) {
      entryConfirmation = weightedRandom(ENTRY_CONFIRMATIONS, [25, 15, 40, 20]);
      if (entryConfirmation === 'structural' || entryConfirmation === 'partial_confirmation') {
        confirmationTF = randomElement(CONFIRMATION_TFS);
      }
    }

    // Notes
    let entryNotes = '';
    let closeNotes = '';
    if (rMultiple >= 2.5) {
      closeNotes = 'Great execution! Let the trade run to full target.';
    } else if (rMultiple === -0.5) {
      closeNotes = 'Moved stop to BE, got stopped on retracement before continuation.';
    }

    // Post-exit review data for older trades
    const shouldHavePostExitData = dayInfo.daysAgo > 1 && Math.random() < 0.6;
    let reachedTargetPostExit: boolean | null = null;
    let postExitNotes = '';
    let reviewedAt: string | null = null;

    if (shouldHavePostExitData) {
      const reviewDate = new Date(exitTime.getTime() + randomInt(1, 5) * 24 * 60 * 60 * 1000);
      reviewedAt = reviewDate.toISOString();
      reachedTargetPostExit = isWinner ? Math.random() < 0.6 : Math.random() < 0.3;
      postExitNotes = isWinner
        ? (reachedTargetPostExit ? 'Price continued after exit.' : 'Good exit timing.')
        : (reachedTargetPostExit ? 'Price recovered - stop was too tight.' : 'Price continued against - stop was correct.');
    }

    const trade: TradeRecord = {
      accountId,
      strategyId,
      pair: pairConfig.pair,
      assetClass: pairConfig.assetClass,
      direction,
      entryTime,
      entryPrice,
      stopLoss,
      targetPrice,
      positionSize,
      riskAmount,
      riskPercent: roundToDecimals(randomBetween(0.5, 2), 2),
      exits,
      timeline,
      levelSequence,
      contextTags: contextConfig.tags,
      entryTF,
      entryConfirmation,
      confirmationTF,
      tradeTaken: true,
      notTakenReason: '',
      entryNotes: entryNotes || undefined,
      closeNotes: closeNotes || undefined,
      postExitNotes,
      reachedTargetPostExit,
      reviewedAt,
      screenshots: [],
      createdAt: new Date(entryTime.getTime() - 60000),
      updatedAt: exitTime,
    };

    trades.push(trade);
  }

  // Generate 3 open trades
  for (let i = 0; i < 3; i++) {
    const pairConfig = weightedRandom(PAIRS, PAIRS.map(p => p.weight));
    const contextConfig = weightedRandom(CONTEXT_TAG_COMBINATIONS, CONTEXT_TAG_COMBINATIONS.map(s => s.weight));
    const entryTF = weightedRandom(TIMEFRAMES, TIMEFRAME_WEIGHTS);
    const direction: TradeDirection = Math.random() > 0.5 ? 'long' : 'short';

    const entryTime = new Date();
    entryTime.setHours(entryTime.getHours() - randomInt(1, 20));

    const riskAmount = roundToDecimals(randomBetween(100, 300), 2);
    const stopPips = randomInt(15, 40);
    const stopDistance = stopPips * pairConfig.pipSize;
    const positionSize = roundToDecimals(riskAmount / (stopPips * pairConfig.pipValue), 2);

    const entryPrice = roundToDecimals(pairConfig.typicalPrice * randomBetween(0.98, 1.02), pairConfig.priceDecimals);
    const stopLoss = direction === 'long'
      ? roundToDecimals(entryPrice - stopDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice + stopDistance, pairConfig.priceDecimals);

    const tpDistance = stopDistance * randomBetween(1.5, 2.5);
    const targetPrice = direction === 'long'
      ? roundToDecimals(entryPrice + tpDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice - tpDistance, pairConfig.priceDecimals);

    const openTrade: TradeRecord = {
      accountId,
      strategyId,
      pair: pairConfig.pair,
      assetClass: pairConfig.assetClass,
      direction,
      entryTime,
      entryPrice,
      stopLoss,
      targetPrice,
      positionSize,
      riskAmount,
      riskPercent: roundToDecimals(randomBetween(0.5, 2), 2),
      exits: [],
      timeline: [],
      levelSequence: [],
      contextTags: contextConfig.tags,
      entryTF,
      entryConfirmation: Math.random() < 0.6 ? 'structural' : undefined,
      confirmationTF: Math.random() < 0.6 ? randomElement(CONFIRMATION_TFS) : undefined,
      tradeTaken: true,
      notTakenReason: '',
      screenshots: [],
      reachedTargetPostExit: null,
      reviewedAt: null,
      createdAt: new Date(entryTime.getTime() - 60000),
      updatedAt: entryTime,
    };

    trades.push(openTrade);
  }

  // Generate 10 missed trades
  const missedTradeCount = 10;
  for (let i = 0; i < missedTradeCount; i++) {
    const daysAgo = randomInt(5, 60);
    const baseDate = generateWeekdayDate(daysAgo);
    const pairConfig = weightedRandom(PAIRS, PAIRS.map(p => p.weight));
    const contextConfig = weightedRandom(CONTEXT_TAG_COMBINATIONS, CONTEXT_TAG_COMBINATIONS.map(s => s.weight));
    const session = weightedRandom(sessions, sessionWeights);
    const entryTF = weightedRandom(TIMEFRAMES, TIMEFRAME_WEIGHTS);
    const direction: TradeDirection = Math.random() > 0.5 ? 'long' : 'short';

    const entryTime = generateEntryTime(baseDate, session);
    const riskAmount = roundToDecimals(randomBetween(100, 300), 2);
    const stopPips = randomInt(15, 40);
    const stopDistance = stopPips * pairConfig.pipSize;
    const positionSize = roundToDecimals(riskAmount / (stopPips * pairConfig.pipValue), 2);

    const entryPrice = roundToDecimals(pairConfig.typicalPrice * randomBetween(0.98, 1.02), pairConfig.priceDecimals);
    const stopLoss = direction === 'long'
      ? roundToDecimals(entryPrice - stopDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice + stopDistance, pairConfig.priceDecimals);

    const tpDistance = stopDistance * randomBetween(1.5, 2.5);
    const targetPrice = direction === 'long'
      ? roundToDecimals(entryPrice + tpDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice - tpDistance, pairConfig.priceDecimals);

    // Pick a reason from presets or custom
    const notTakenReason = Math.random() < 0.8
      ? randomElement([...NOT_TAKEN_REASON_PRESETS])
      : 'custom reason';

    const missedTrade: TradeRecord = {
      accountId,
      strategyId,
      pair: pairConfig.pair,
      assetClass: pairConfig.assetClass,
      direction,
      entryTime,
      entryPrice,
      stopLoss,
      targetPrice,
      positionSize,
      riskAmount,
      riskPercent: roundToDecimals(randomBetween(0.5, 2), 2),
      exits: [],
      timeline: [],
      levelSequence: [],
      contextTags: contextConfig.tags,
      entryTF,
      tradeTaken: false,
      notTakenReason,
      screenshots: [],
      reachedTargetPostExit: null,
      reviewedAt: null,
      createdAt: new Date(entryTime.getTime() - 60000),
      updatedAt: entryTime,
    };

    trades.push(missedTrade);
  }

  // Sort by entry time
  trades.sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime());

  return trades;
}

// Summary statistics for verification
export function getDemoDataStats(trades: TradeRecord[]): {
  total: number;
  closed: number;
  open: number;
  missed: number;
  taken: number;
  byPair: Record<string, number>;
  byContextTag: Record<string, number>;
} {
  const missed = trades.filter(t => t.tradeTaken === false);
  const taken = trades.filter(t => t.tradeTaken !== false);
  const closed = taken.filter(t => t.exits.length > 0);
  const open = taken.filter(t => t.exits.length === 0);

  const byPair: Record<string, number> = {};
  const byContextTag: Record<string, number> = {};

  for (const trade of taken) {
    byPair[trade.pair] = (byPair[trade.pair] || 0) + 1;
    for (const tag of trade.contextTags || []) {
      byContextTag[tag] = (byContextTag[tag] || 0) + 1;
    }
  }

  return {
    total: trades.length,
    closed: closed.length,
    open: open.length,
    missed: missed.length,
    taken: taken.length,
    byPair,
    byContextTag,
  };
}
