import { v4 as uuidv4 } from 'uuid';
import type {
  TradeRecord,
  TradeDirection,
  TradingSession,
  AssetClass,
  Timeframe,
  HTFBias,
  MarketCondition,
  ExitType,
  EmotionalState,
  ConfidenceLevel,
  TradeExit,
} from '../types';
import { deriveSession, calculateHoldDuration } from './tradeCalculations';

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

// Setup tag combinations - realistic multi-tag confluences
// Format: [tags[], weight, winBias] - more tags = higher win bias
const SETUP_TAG_COMBINATIONS: { tags: string[]; weight: number; winBias: number }[] = [
  // 3-4 tag high confluence setups (best win rates) - used frequently for combination analysis
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

  // Single tag setups (lower win rates)
  { tags: ['breakout'], weight: 6, winBias: 0.48 },
  { tags: ['pullback'], weight: 4, winBias: 0.50 },
  { tags: ['range_reversal'], weight: 4, winBias: 0.45 },
];

const TIMEFRAMES: Timeframe[] = ['15m', '1H', '4H'];
const TIMEFRAME_WEIGHTS = [35, 45, 20]; // 15m, 1H, 4H

const HTF_BIASES: HTFBias[] = ['bullish', 'bearish', 'neutral', 'ranging'];
const MARKET_CONDITIONS: MarketCondition[] = ['trending', 'ranging', 'volatile', 'breakout', 'reversal'];

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

// Generate a weekday date within the last N days
function generateWeekdayDate(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);

  // Skip weekends
  const day = date.getDay();
  if (day === 0) date.setDate(date.getDate() - 2); // Sunday -> Friday
  if (day === 6) date.setDate(date.getDate() - 1); // Saturday -> Friday

  return date;
}

// Generate entry time with session weighting
function generateEntryTime(baseDate: Date, session: TradingSession): Date {
  const date = new Date(baseDate);

  // Set hour based on session (UTC)
  let hour: number;
  switch (session) {
    case 'asian':
      hour = randomInt(1, 6);
      break;
    case 'london':
      hour = randomInt(8, 12);
      break;
    case 'overlap':
      hour = randomInt(13, 15);
      break;
    case 'new_york':
      hour = randomInt(16, 19);
      break;
    default:
      hour = randomInt(8, 18);
  }

  date.setUTCHours(hour, randomInt(0, 59), randomInt(0, 59), 0);
  return date;
}

// Generate exit time based on entry timeframe
function generateExitTime(entryTime: Date, entryTF: Timeframe): Date {
  const exit = new Date(entryTime);
  let minutesHeld: number;

  switch (entryTF) {
    case '1m':
      minutesHeld = randomInt(5, 30); // 5 min to 30 min
      break;
    case '5m':
      minutesHeld = randomInt(10, 60); // 10 min to 1 hour
      break;
    case '15m':
      minutesHeld = randomInt(15, 180); // 15 min to 3 hours
      break;
    case '30m':
      minutesHeld = randomInt(30, 240); // 30 min to 4 hours
      break;
    case '1H':
      minutesHeld = randomInt(60, 480); // 1 to 8 hours
      break;
    case '4H':
      minutesHeld = randomInt(240, 1440); // 4 to 24 hours
      break;
    case 'D1':
      minutesHeld = randomInt(1440, 4320); // 1 to 3 days
      break;
    case 'W1':
      minutesHeld = randomInt(7200, 14400); // 5 to 10 days
      break;
    case 'M1':
      minutesHeld = randomInt(20160, 43200); // 2 to 4 weeks
      break;
    default:
      minutesHeld = randomInt(30, 360);
  }

  exit.setMinutes(exit.getMinutes() + minutesHeld);
  return exit;
}

// Generate exits (unified exit system)
function generateExits(
  entryPrice: number,
  exitPrice: number,
  _direction: TradeDirection,
  positionSize: number,
  entryTime: Date,
  priceDecimals: number
): TradeExit[] {
  const numExits = randomInt(2, 3);
  const exits: TradeExit[] = [];

  const priceDiff = exitPrice - entryPrice;
  let remainingSize = positionSize;

  for (let i = 0; i < numExits; i++) {
    const isLast = i === numExits - 1;
    const sizePortion = isLast ? remainingSize : roundToDecimals(positionSize * randomBetween(0.25, 0.4), 2);
    remainingSize -= sizePortion;

    // Price moves progressively toward exit
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
// accountId and strategyId are the IDs of the default account/strategy (with isDefault: true)
export function generateDemoTrades(accountId: string, strategyId: string): TradeRecord[] {
  const trades: TradeRecord[] = [];

  // Plan the trade distribution across 3 months (~90 days)
  // Story: drawdown period around 6 weeks ago (days 38-48), then recovery
  const tradeDays: { daysAgo: number; isDrawdown: boolean; isRecovery: boolean }[] = [];

  // Generate ~50 trading days across 90 days (roughly 3-5 trades per week)
  let currentDay = 1;
  while (currentDay <= 90 && tradeDays.length < 48) {
    // Skip some days randomly to create gaps
    if (Math.random() > 0.65) {
      const isDrawdown = currentDay >= 38 && currentDay <= 48;
      const isRecovery = currentDay >= 49 && currentDay <= 60;
      tradeDays.push({ daysAgo: currentDay, isDrawdown, isRecovery });
    }
    currentDay++;
  }

  // Shuffle and take first 45 for closed trades
  const shuffledDays = tradeDays.sort(() => Math.random() - 0.5);

  // Define session weights (London/overlap better than Asian)
  const sessions: TradingSession[] = ['asian', 'london', 'overlap', 'new_york'];
  const sessionWeights = [12, 35, 30, 23];

  // Track revenge trade indices (always during drawdown period)
  const revengeTradeIndices = new Set<number>();
  const drawdownDayIndices = shuffledDays
    .map((d, i) => d.isDrawdown ? i : -1)
    .filter(i => i >= 0);

  // Pick 4 revenge trades during drawdown
  while (revengeTradeIndices.size < 4 && drawdownDayIndices.length > 0) {
    const idx = drawdownDayIndices[randomInt(0, drawdownDayIndices.length - 1)];
    revengeTradeIndices.add(idx);
  }

  // Track trades with partials (8-10)
  const partialTradeIndices = new Set<number>();
  while (partialTradeIndices.size < 9) {
    const idx = randomInt(0, 44);
    if (!revengeTradeIndices.has(idx)) {
      partialTradeIndices.add(idx);
    }
  }

  // Generate 45 closed trades
  for (let i = 0; i < 45; i++) {
    const dayInfo = shuffledDays[i] || { daysAgo: i * 2, isDrawdown: false, isRecovery: false };
    const isRevenge = revengeTradeIndices.has(i);
    const hasPartials = partialTradeIndices.has(i);

    // Select pair (weighted)
    const pairConfig = weightedRandom(PAIRS, PAIRS.map(p => p.weight));

    // Select setup tag combination (weighted)
    const setupConfig = weightedRandom(SETUP_TAG_COMBINATIONS, SETUP_TAG_COMBINATIONS.map(s => s.weight));

    // Select session (weighted, but Asian has worse outcomes)
    const session = weightedRandom(sessions, sessionWeights);

    // Select timeframes (weighted) - entry TF and analysis TFs (1-3)
    const entryTF = weightedRandom(TIMEFRAMES, TIMEFRAME_WEIGHTS);
    // Analysis TFs are usually higher than entry TF - generate 1-3 TFs
    const higherTFs: Timeframe[] = ['1H', '4H', 'D1', 'W1'];
    const analysisTFs: string[] = [];
    if (Math.random() > 0.2) { // 80% have at least one analysis TF
      // Determine how many TFs (1-3)
      const tfCount = Math.random() < 0.5 ? 1 : Math.random() < 0.7 ? 2 : 3;
      const shuffled = [...higherTFs].sort(() => Math.random() - 0.5);
      for (let i = 0; i < tfCount && i < shuffled.length; i++) {
        analysisTFs.push(shuffled[i]);
      }
    }

    // Direction (50/50)
    const direction: TradeDirection = Math.random() > 0.5 ? 'long' : 'short';

    // Determine if this is a winner based on:
    // - Setup win bias
    // - Session (Asian worse, London/overlap better)
    // - Pair (GBP/JPY always losing)
    // - Revenge trades always lose
    // - Drawdown period has more losses
    let winProbability = setupConfig.winBias;

    if (session === 'asian') winProbability -= 0.15;
    else if (session === 'overlap') winProbability += 0.08;
    else if (session === 'london') winProbability += 0.05;

    if (pairConfig.pair === 'GBP/JPY') winProbability -= 0.30; // GBP/JPY losing pair

    if (dayInfo.isDrawdown) winProbability -= 0.20;
    if (dayInfo.isRecovery) winProbability += 0.10;

    if (isRevenge) winProbability = 0; // Revenge trades always lose

    const isWinner = Math.random() < winProbability;

    // Generate R-multiple
    let rMultiple: number;
    if (isWinner) {
      if (hasPartials) {
        // Partial trades tend to have higher R (scaled out properly)
        rMultiple = roundToDecimals(randomBetween(1.5, 3.5), 2);
      } else {
        rMultiple = roundToDecimals(randomBetween(0.5, 2.5), 2);
      }
    } else {
      if (isRevenge) {
        rMultiple = roundToDecimals(randomBetween(-1.3, -1.5), 2); // Revenge = slippage/overtrading
      } else if (Math.random() < 0.15) {
        rMultiple = -0.5; // BE+ stop
      } else if (Math.random() < 0.1) {
        rMultiple = roundToDecimals(randomBetween(-1.3, -1.5), 2); // Slippage
      } else {
        rMultiple = -1; // Clean stop
      }
    }

    // Generate dates
    const baseDate = generateWeekdayDate(dayInfo.daysAgo);
    const entryTime = generateEntryTime(baseDate, session);
    const exitTime = generateExitTime(entryTime, entryTF);

    // Risk amount ($100-$300)
    const riskAmount = roundToDecimals(randomBetween(100, 300), 2);

    // Calculate position size based on risk and stop distance
    const stopPips = randomInt(15, 40);
    const stopDistance = stopPips * pairConfig.pipSize;

    // positionSize = riskAmount / (stopPips * pipValue per lot)
    const positionSize = roundToDecimals(riskAmount / (stopPips * pairConfig.pipValue), 2);

    // Price calculations
    const entryPrice = roundToDecimals(
      pairConfig.typicalPrice * randomBetween(0.98, 1.02),
      pairConfig.priceDecimals
    );

    const stopLoss = direction === 'long'
      ? roundToDecimals(entryPrice - stopDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice + stopDistance, pairConfig.priceDecimals);

    // Calculate exit price from R-multiple
    const exitMove = rMultiple * stopDistance;
    const exitPrice = direction === 'long'
      ? roundToDecimals(entryPrice + exitMove, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice - exitMove, pairConfig.priceDecimals);

    // Target price (primary profit target for planned R:R)
    const tpDistance = stopDistance * randomBetween(1.5, 2.5);
    const targetPrice = direction === 'long'
      ? roundToDecimals(entryPrice + tpDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice - tpDistance, pairConfig.priceDecimals);

    // Calculate P&L
    const pnl = roundToDecimals(rMultiple * riskAmount, 2);
    const commissions = roundToDecimals(randomBetween(2, 8), 2);
    const swap = Math.random() < 0.3 ? roundToDecimals(randomBetween(-5, 2), 2) : 0;
    const netPnl = roundToDecimals(pnl - commissions - Math.abs(swap), 2);

    // Planned and actual RR
    const plannedRR = roundToDecimals(tpDistance / stopDistance, 2);
    const actualRR = Math.abs(rMultiple);

    // Exit type (for trades with single exit - derived from exit array for multi-exit)
    let exitType: ExitType;
    if (hasPartials) {
      // Multiple exits - exitType is derived from exits array (undefined for multiple)
      exitType = 'tp_hit'; // Default, but will be undefined for multi-exit
    } else if (rMultiple >= plannedRR * 0.9) {
      exitType = 'tp_hit';
    } else if (rMultiple === -1) {
      exitType = 'sl_hit';
    } else if (rMultiple === -0.5) {
      exitType = 'be_stop_hit';
    } else if (rMultiple > 0) {
      exitType = Math.random() > 0.5 ? 'manual_close' : 'trail_stop_hit';
    } else {
      exitType = 'sl_hit';
    }

    // Generate exits - either multiple exits for scaled trades or single exit
    let exits: TradeExit[] = [];
    if (hasPartials && isWinner) {
      exits = generateExits(entryPrice, exitPrice, direction, positionSize, entryTime, pairConfig.priceDecimals);
    } else {
      // Single exit for this trade
      exits = [{
        id: uuidv4(),
        price: exitPrice,
        size: positionSize,
        time: exitTime,
        type: exitType,
        reason: undefined,
      }];
    }

    // Psychology
    let emotionalState: EmotionalState;
    let confidenceLevel: ConfidenceLevel;
    let followedPlan: boolean;

    if (isRevenge) {
      emotionalState = randomElement([1, 2]) as EmotionalState;
      confidenceLevel = 'low';
      followedPlan = false;
    } else if (dayInfo.isDrawdown) {
      emotionalState = randomElement([2, 3]) as EmotionalState;
      confidenceLevel = randomElement(['low', 'medium']);
      followedPlan = Math.random() > 0.3;
    } else {
      emotionalState = randomElement([3, 4, 5]) as EmotionalState;
      confidenceLevel = randomElement(['medium', 'high']);
      followedPlan = Math.random() > 0.1;
    }

    // HTF Bias and Market Condition
    const htfBias: HTFBias = randomElement(HTF_BIASES);
    const marketCondition: MarketCondition = randomElement(MARKET_CONDITIONS);

    // Notes for interesting trades
    let entryNotes = '';
    let closeNotes = '';

    if (isRevenge) {
      entryNotes = 'Frustrated from previous loss. Need to get it back.';
      closeNotes = 'Should not have taken this trade. Emotions got the better of me.';
    } else if (rMultiple >= 2.5) {
      closeNotes = 'Great execution! Let the trade run to full target.';
    } else if (rMultiple === -0.5) {
      closeNotes = 'Moved stop to BE, got stopped on retracement before continuation.';
    }

    // Tags
    const tags: string[] = [];
    if (isRevenge) tags.push('revenge');
    if (hasPartials) tags.push('scaled-exit');
    if (rMultiple >= 2) tags.push('big-winner');
    if (rMultiple <= -1.2) tags.push('slippage');

    // MAE/MFE - populate on about 60% of trades (now as price levels)
    let maePrice: number | null = null;
    let mfePrice: number | null = null;
    let maeR: number | undefined;
    let mfeR: number | undefined;
    let firstTouchWorstPrice: number | null = null;

    if (Math.random() < 0.6) {
      if (isWinner) {
        // Winners: MAE is always less than stop distance
        const maePercent = randomBetween(0.1, 0.7); // 10-70% of stop
        const maeDistance = stopDistance * maePercent;
        maeR = roundToDecimals(maePercent, 2);
        // For longs: worst price is below entry; for shorts: worst price is above entry
        maePrice = direction === 'long'
          ? roundToDecimals(entryPrice - maeDistance, pairConfig.priceDecimals)
          : roundToDecimals(entryPrice + maeDistance, pairConfig.priceDecimals);

        // MFE can be higher than exit (gave back some profit) or equal
        const mfeMultiple = randomBetween(1, 1.5); // 100-150% of actual move
        const actualMove = Math.abs(rMultiple) * stopDistance;
        const mfeDistance = actualMove * mfeMultiple;
        mfeR = roundToDecimals(Math.abs(rMultiple) * mfeMultiple, 2);
        // For longs: best price is above entry; for shorts: best price is below entry
        mfePrice = direction === 'long'
          ? roundToDecimals(entryPrice + mfeDistance, pairConfig.priceDecimals)
          : roundToDecimals(entryPrice - mfeDistance, pairConfig.priceDecimals);
      } else {
        // Losers: MAE is typically >= stop distance (they got stopped out)
        const maeMultiple = rMultiple === -0.5 ? randomBetween(0.4, 0.6) : randomBetween(0.85, 1.1);
        const maeDistance = stopDistance * maeMultiple;
        maeR = roundToDecimals(maeMultiple, 2);
        maePrice = direction === 'long'
          ? roundToDecimals(entryPrice - maeDistance, pairConfig.priceDecimals)
          : roundToDecimals(entryPrice + maeDistance, pairConfig.priceDecimals);

        // MFE: some losers ran in profit first
        const hadProfit = Math.random() < 0.4;
        if (hadProfit) {
          const mfePercent = randomBetween(0.2, 0.8);
          const mfeDistance = stopDistance * mfePercent;
          mfeR = roundToDecimals(mfePercent, 2);
          mfePrice = direction === 'long'
            ? roundToDecimals(entryPrice + mfeDistance, pairConfig.priceDecimals)
            : roundToDecimals(entryPrice - mfeDistance, pairConfig.priceDecimals);
        } else {
          const mfePercent = randomBetween(0, 0.2);
          const mfeDistance = stopDistance * mfePercent;
          mfeR = roundToDecimals(mfePercent, 2);
          mfePrice = direction === 'long'
            ? roundToDecimals(entryPrice + mfeDistance, pairConfig.priceDecimals)
            : roundToDecimals(entryPrice - mfeDistance, pairConfig.priceDecimals);
        }
      }

      // First-touch worst price - populate on ~70% of trades with MAE data
      // This is the worst price BEFORE the initial reaction in trader's favour
      // It should be <= maePrice (in absolute distance) since MAE is the overall worst
      if (maePrice !== null && mfePrice !== null && Math.random() < 0.7) {
        const maeDistance = Math.abs(entryPrice - maePrice);

        if (isWinner) {
          // For winners: first-touch adverse is typically small (level works quickly)
          // First touch is 30-80% of MAE (the rest of MAE may come from later retests)
          const firstTouchPercent = randomBetween(0.3, 0.8);
          const firstTouchDistance = maeDistance * firstTouchPercent;
          firstTouchWorstPrice = direction === 'long'
            ? roundToDecimals(entryPrice - firstTouchDistance, pairConfig.priceDecimals)
            : roundToDecimals(entryPrice + firstTouchDistance, pairConfig.priceDecimals);
        } else {
          // For losers: first-touch could be the full MAE (immediate failure)
          // or partial MAE (had a chance but then failed)
          const firstTouchPercent = randomBetween(0.5, 1.0);
          const firstTouchDistance = maeDistance * firstTouchPercent;
          firstTouchWorstPrice = direction === 'long'
            ? roundToDecimals(entryPrice - firstTouchDistance, pairConfig.priceDecimals)
            : roundToDecimals(entryPrice + firstTouchDistance, pairConfig.priceDecimals);
        }
      }
    }

    // Generate post-exit data for ~60% of closed trades
    // Leave ~40% unreviewed to demonstrate "Trades to Review" dashboard prompt
    let postExitBestPrice: number | null = null;
    let postExitWorstPrice: number | null = null;
    let reachedTargetPostExit: boolean | null = null;
    let postExitNotes = '';
    let reviewedAt: string | null = null;

    // Only generate post-exit data for older trades (closed >24 hours ago)
    const shouldHavePostExitData = dayInfo.daysAgo > 1 && Math.random() < 0.6;

    if (shouldHavePostExitData) {
      // Set review timestamp to some time after exit
      const reviewDate = new Date(exitTime.getTime() + randomInt(1, 5) * 24 * 60 * 60 * 1000);
      reviewedAt = reviewDate.toISOString();

      if (isWinner) {
        // Winning trades - did price continue or reverse after exit?
        if (Math.random() < 0.4) {
          // Price continued further (missed opportunity)
          const additionalMove = stopDistance * randomBetween(0.5, 2);
          postExitBestPrice = direction === 'long'
            ? roundToDecimals(exitPrice + additionalMove, pairConfig.priceDecimals)
            : roundToDecimals(exitPrice - additionalMove, pairConfig.priceDecimals);
          postExitWorstPrice = direction === 'long'
            ? roundToDecimals(exitPrice - stopDistance * randomBetween(0.1, 0.3), pairConfig.priceDecimals)
            : roundToDecimals(exitPrice + stopDistance * randomBetween(0.1, 0.3), pairConfig.priceDecimals);
          reachedTargetPostExit = Math.random() < 0.6; // 60% went on to hit target
          postExitNotes = reachedTargetPostExit
            ? 'Price continued to target after I exited. Could have held longer.'
            : 'Price extended further but reversed before target. Exit timing was decent.';
        } else {
          // Price reversed after exit (good exit timing)
          const reverseMove = stopDistance * randomBetween(0.3, 1.2);
          postExitBestPrice = direction === 'long'
            ? roundToDecimals(exitPrice + stopDistance * randomBetween(0, 0.3), pairConfig.priceDecimals)
            : roundToDecimals(exitPrice - stopDistance * randomBetween(0, 0.3), pairConfig.priceDecimals);
          postExitWorstPrice = direction === 'long'
            ? roundToDecimals(exitPrice - reverseMove, pairConfig.priceDecimals)
            : roundToDecimals(exitPrice + reverseMove, pairConfig.priceDecimals);
          reachedTargetPostExit = false;
          postExitNotes = 'Price reversed after exit. Good exit timing.';
        }
      } else {
        // Losing trades - did price recover after stopping us out?
        if (rMultiple === -0.5 || (exitType === 'be_stop_hit')) {
          // BE stop hit - did price continue to target?
          if (Math.random() < 0.65) {
            // Price continued to target after BE stop (BE cost us money)
            const continueMove = stopDistance * randomBetween(1.5, 3);
            postExitBestPrice = direction === 'long'
              ? roundToDecimals(stopLoss + continueMove, pairConfig.priceDecimals)
              : roundToDecimals(stopLoss - continueMove, pairConfig.priceDecimals);
            postExitWorstPrice = direction === 'long'
              ? roundToDecimals(stopLoss - stopDistance * 0.2, pairConfig.priceDecimals)
              : roundToDecimals(stopLoss + stopDistance * 0.2, pairConfig.priceDecimals);
            reachedTargetPostExit = true;
            postExitNotes = 'Price went on to hit my original target after stopping me out at BE. Moving to BE too early cost me this trade.';
          } else {
            // Price went further against after BE (BE saved us)
            const adverseMove = stopDistance * randomBetween(0.5, 2);
            postExitBestPrice = direction === 'long'
              ? roundToDecimals(stopLoss + stopDistance * randomBetween(0.2, 0.5), pairConfig.priceDecimals)
              : roundToDecimals(stopLoss - stopDistance * randomBetween(0.2, 0.5), pairConfig.priceDecimals);
            postExitWorstPrice = direction === 'long'
              ? roundToDecimals(stopLoss - adverseMove, pairConfig.priceDecimals)
              : roundToDecimals(stopLoss + adverseMove, pairConfig.priceDecimals);
            reachedTargetPostExit = false;
            postExitNotes = 'Price went further against after BE stop. Good decision to protect capital.';
          }
        } else {
          // Full stop loss - did price recover?
          if (Math.random() < 0.3) {
            // Price recovered and hit target (should have had wider stop)
            const recoverMove = stopDistance * randomBetween(2, 4);
            postExitBestPrice = direction === 'long'
              ? roundToDecimals(stopLoss + recoverMove, pairConfig.priceDecimals)
              : roundToDecimals(stopLoss - recoverMove, pairConfig.priceDecimals);
            postExitWorstPrice = direction === 'long'
              ? roundToDecimals(stopLoss - stopDistance * 0.3, pairConfig.priceDecimals)
              : roundToDecimals(stopLoss + stopDistance * 0.3, pairConfig.priceDecimals);
            reachedTargetPostExit = true;
            postExitNotes = 'Price recovered and hit target. Stop was too tight.';
          } else {
            // Price continued against us (stop was correct)
            const continueAdverse = stopDistance * randomBetween(0.5, 2);
            postExitBestPrice = direction === 'long'
              ? roundToDecimals(stopLoss + stopDistance * randomBetween(0, 0.3), pairConfig.priceDecimals)
              : roundToDecimals(stopLoss - stopDistance * randomBetween(0, 0.3), pairConfig.priceDecimals);
            postExitWorstPrice = direction === 'long'
              ? roundToDecimals(stopLoss - continueAdverse, pairConfig.priceDecimals)
              : roundToDecimals(stopLoss + continueAdverse, pairConfig.priceDecimals);
            reachedTargetPostExit = false;
            postExitNotes = 'Price continued against. Stop placement was correct.';
          }
        }
      }
    }

    const trade: TradeRecord = {
      // Let Dexie Cloud generate the ID with @id schema
      accountId,
      strategyId,
      pair: pairConfig.pair,
      assetClass: pairConfig.assetClass,
      direction,
      entryTime,
      exitTime,
      status: hasPartials ? 'closed' : 'closed', // All seed trades are closed
      entryPrice,
      stopLoss,
      targetPrice,
      exitPrice,
      positionSize,
      riskAmount,
      riskPercent: roundToDecimals(randomBetween(0.5, 2), 2),
      exits,
      stopAdjustments: [],
      exitType: hasPartials ? undefined : exitType, // undefined for multi-exit trades
      setupTags: setupConfig.tags,
      analysisTFs,
      entryTF,
      htfBias,
      marketCondition,
      emotionalState,
      confidenceLevel,
      followedPlan,
      planDeviation: followedPlan ? undefined : (isRevenge ? 'Revenge trade, not in plan' : 'Entered early'),
      isRevengeTrade: isRevenge,
      isOverTrade: isRevenge,
      entryNotes: entryNotes || undefined,
      closeNotes: closeNotes || undefined,
      screenshots: [],
      tags,
      session: deriveSession(entryTime),
      plannedRR,
      actualRR,
      rMultiple,
      stopDistance: roundToDecimals(stopDistance, pairConfig.priceDecimals),
      pnl,
      commissions,
      swap,
      netPnl,
      holdDuration: calculateHoldDuration(entryTime, exitTime),
      originalStopLoss: stopLoss,
      maePrice,
      mfePrice,
      firstTouchWorstPrice,
      maeR,
      mfeR,
      postExitBestPrice,
      postExitWorstPrice,
      reachedTargetPostExit,
      postExitNotes,
      reviewedAt,
      createdAt: new Date(entryTime.getTime() - 60000),
      updatedAt: exitTime,
      tradeTaken: true,
    };

    trades.push(trade);
  }

  // Generate 3 open trades with recent entry times
  for (let i = 0; i < 3; i++) {
    const pairConfig = weightedRandom(PAIRS, PAIRS.map(p => p.weight));
    const setupConfig = weightedRandom(SETUP_TAG_COMBINATIONS, SETUP_TAG_COMBINATIONS.map(s => s.weight));
    const entryTF = weightedRandom(TIMEFRAMES, TIMEFRAME_WEIGHTS);
    // Analysis TFs - generate 1-3 TFs
    const higherTFs: Timeframe[] = ['1H', '4H', 'D1', 'W1'];
    const analysisTFs: string[] = [];
    if (Math.random() > 0.2) {
      const tfCount = Math.random() < 0.5 ? 1 : Math.random() < 0.7 ? 2 : 3;
      const shuffled = [...higherTFs].sort(() => Math.random() - 0.5);
      for (let j = 0; j < tfCount && j < shuffled.length; j++) {
        analysisTFs.push(shuffled[j]);
      }
    }
    const direction: TradeDirection = Math.random() > 0.5 ? 'long' : 'short';

    // Recent entry (within last 24 hours)
    const entryTime = new Date();
    entryTime.setHours(entryTime.getHours() - randomInt(1, 20));

    const riskAmount = roundToDecimals(randomBetween(100, 300), 2);
    const stopPips = randomInt(15, 40);
    const stopDistance = stopPips * pairConfig.pipSize;
    const positionSize = roundToDecimals(riskAmount / (stopPips * pairConfig.pipValue), 2);

    const entryPrice = roundToDecimals(
      pairConfig.typicalPrice * randomBetween(0.98, 1.02),
      pairConfig.priceDecimals
    );

    const stopLoss = direction === 'long'
      ? roundToDecimals(entryPrice - stopDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice + stopDistance, pairConfig.priceDecimals);

    const tpDistance = stopDistance * randomBetween(1.5, 2.5);
    const targetPrice = direction === 'long'
      ? roundToDecimals(entryPrice + tpDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice - tpDistance, pairConfig.priceDecimals);

    const plannedRR = roundToDecimals(tpDistance / stopDistance, 2);

    // Use the passed default account/strategy IDs
    const openTrade: TradeRecord = {
      // Let Dexie Cloud generate the ID with @id schema
      accountId,
      strategyId,
      pair: pairConfig.pair,
      assetClass: pairConfig.assetClass,
      direction,
      entryTime,
      status: 'open',
      entryPrice,
      stopLoss,
      targetPrice,
      positionSize,
      riskAmount,
      riskPercent: roundToDecimals(randomBetween(0.5, 2), 2),
      exits: [],
      stopAdjustments: [],
      setupTags: setupConfig.tags,
      analysisTFs,
      entryTF,
      htfBias: randomElement(HTF_BIASES),
      marketCondition: randomElement(MARKET_CONDITIONS),
      emotionalState: randomElement([3, 4, 5]) as EmotionalState,
      confidenceLevel: randomElement(['medium', 'high']),
      followedPlan: true,
      screenshots: [],
      tags: [],
      session: deriveSession(entryTime),
      plannedRR,
      stopDistance: roundToDecimals(stopDistance, pairConfig.priceDecimals),
      originalStopLoss: stopLoss,
      maePrice: null,
      mfePrice: null,
      firstTouchWorstPrice: null,
      postExitBestPrice: null,
      postExitWorstPrice: null,
      reachedTargetPostExit: null,
      postExitNotes: '',
      reviewedAt: null,
      createdAt: new Date(entryTime.getTime() - 60000),
      updatedAt: entryTime,
      tradeTaken: true,
    };

    trades.push(openTrade);
  }

  // Generate 8-10 missed trades (tradeTaken: false) for selectivity analysis
  const NOT_TAKEN_REASONS = [
    'hesitation',
    'missed entry window',
    'away from desk',
    "didn't trust setup",
    'risk too high',
    'already in a trade',
    'end of session',
    'low confidence',
    'news event pending',
  ];

  const missedTradeCount = randomInt(8, 10);
  for (let i = 0; i < missedTradeCount; i++) {
    // Distribute across last 60 days
    const daysAgo = randomInt(5, 60);
    const baseDate = generateWeekdayDate(daysAgo);

    const pairConfig = weightedRandom(PAIRS, PAIRS.map(p => p.weight));
    const setupConfig = weightedRandom(SETUP_TAG_COMBINATIONS, SETUP_TAG_COMBINATIONS.map(s => s.weight));
    const session = weightedRandom(sessions, sessionWeights);
    const entryTF = weightedRandom(TIMEFRAMES, TIMEFRAME_WEIGHTS);
    // Analysis TFs - generate 1-3 TFs
    const higherTFs: Timeframe[] = ['1H', '4H', 'D1', 'W1'];
    const analysisTFs: string[] = [];
    if (Math.random() > 0.2) {
      const tfCount = Math.random() < 0.5 ? 1 : Math.random() < 0.7 ? 2 : 3;
      const shuffled = [...higherTFs].sort(() => Math.random() - 0.5);
      for (let j = 0; j < tfCount && j < shuffled.length; j++) {
        analysisTFs.push(shuffled[j]);
      }
    }
    const direction: TradeDirection = Math.random() > 0.5 ? 'long' : 'short';

    const entryTime = generateEntryTime(baseDate, session);
    const exitTime = generateExitTime(entryTime, entryTF);

    const riskAmount = roundToDecimals(randomBetween(100, 300), 2);
    const stopPips = randomInt(15, 40);
    const stopDistance = stopPips * pairConfig.pipSize;
    const positionSize = roundToDecimals(riskAmount / (stopPips * pairConfig.pipValue), 2);

    const entryPrice = roundToDecimals(
      pairConfig.typicalPrice * randomBetween(0.98, 1.02),
      pairConfig.priceDecimals
    );

    const stopLoss = direction === 'long'
      ? roundToDecimals(entryPrice - stopDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice + stopDistance, pairConfig.priceDecimals);

    const tpDistance = stopDistance * randomBetween(1.5, 2.5);
    const targetPrice = direction === 'long'
      ? roundToDecimals(entryPrice + tpDistance, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice - tpDistance, pairConfig.priceDecimals);

    // About 60% would have been winners
    const wouldHaveWon = Math.random() < 0.6;
    let rMultiple: number;
    if (wouldHaveWon) {
      rMultiple = roundToDecimals(randomBetween(0.8, 2.5), 2);
    } else {
      // Mix of clean stops and partial losses
      rMultiple = Math.random() < 0.7 ? -1 : roundToDecimals(randomBetween(-0.5, -0.8), 2);
    }

    // Calculate exit price from R-multiple
    const exitMove = rMultiple * stopDistance;
    const exitPrice = direction === 'long'
      ? roundToDecimals(entryPrice + exitMove, pairConfig.priceDecimals)
      : roundToDecimals(entryPrice - exitMove, pairConfig.priceDecimals);

    // Calculate hypothetical P&L
    const pnl = roundToDecimals(rMultiple * riskAmount, 2);
    const commissions = roundToDecimals(randomBetween(2, 8), 2);
    const netPnl = roundToDecimals(pnl - commissions, 2);

    const plannedRR = roundToDecimals(tpDistance / stopDistance, 2);
    const actualRR = Math.abs(rMultiple);

    // Reason for not taking - weight towards "hesitation" and "didn't trust setup" for winners
    let notTakenReason: string;
    if (wouldHaveWon && Math.random() < 0.6) {
      // Winners more likely to be missed due to hesitation/trust issues
      notTakenReason = randomElement(['hesitation', "didn't trust setup", 'low confidence']);
    } else {
      notTakenReason = randomElement(NOT_TAKEN_REASONS);
    }

    // Use the passed default account/strategy IDs
    const missedTrade: TradeRecord = {
      accountId,
      strategyId,
      pair: pairConfig.pair,
      assetClass: pairConfig.assetClass,
      direction,
      entryTime,
      exitTime,
      status: 'closed',
      entryPrice,
      stopLoss,
      targetPrice,
      exitPrice,
      positionSize,
      riskAmount,
      riskPercent: roundToDecimals(randomBetween(0.5, 2), 2),
      exits: [{
        id: uuidv4(),
        price: exitPrice,
        size: positionSize,
        time: exitTime,
        type: rMultiple >= 0 ? 'tp_hit' : 'sl_hit',
        reason: undefined,
      }],
      stopAdjustments: [],
      exitType: rMultiple >= 0 ? 'tp_hit' : 'sl_hit',
      setupTags: setupConfig.tags,
      analysisTFs,
      entryTF,
      htfBias: randomElement(HTF_BIASES),
      marketCondition: randomElement(MARKET_CONDITIONS),
      emotionalState: randomElement([3, 4]) as EmotionalState,
      confidenceLevel: randomElement(['low', 'medium']),
      followedPlan: true,
      screenshots: [],
      tags: ['missed-trade'],
      session: deriveSession(entryTime),
      plannedRR,
      actualRR,
      rMultiple,
      stopDistance: roundToDecimals(stopDistance, pairConfig.priceDecimals),
      pnl,
      commissions,
      swap: 0,
      netPnl,
      holdDuration: calculateHoldDuration(entryTime, exitTime),
      originalStopLoss: stopLoss,
      maePrice: null,
      mfePrice: null,
      firstTouchWorstPrice: null,
      postExitBestPrice: null,
      postExitWorstPrice: null,
      reachedTargetPostExit: null,
      postExitNotes: '',
      reviewedAt: null,
      createdAt: new Date(entryTime.getTime() - 60000),
      updatedAt: exitTime,
      // Missed trade fields
      tradeTaken: false,
      notTakenReason,
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
  wins: number;
  losses: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  totalPnl: number;
  byPair: Record<string, { count: number; pnl: number }>;
  bySetup: Record<string, { count: number; wins: number; winRate: number }>;
  bySession: Record<string, { count: number; wins: number; winRate: number }>;
  missedStats: { total: number; wouldHaveWon: number; wouldHaveLost: number };
} {
  const missed = trades.filter(t => t.tradeTaken === false);
  const taken = trades.filter(t => t.tradeTaken !== false);
  const closed = taken.filter(t => t.status === 'closed');
  const winners = closed.filter(t => (t.rMultiple ?? 0) > 0);
  const losers = closed.filter(t => (t.rMultiple ?? 0) < 0);

  const byPair: Record<string, { count: number; pnl: number }> = {};
  const bySetup: Record<string, { count: number; wins: number; winRate: number }> = {};
  const bySession: Record<string, { count: number; wins: number; winRate: number }> = {};

  for (const trade of closed) {
    // By pair
    if (!byPair[trade.pair]) byPair[trade.pair] = { count: 0, pnl: 0 };
    byPair[trade.pair].count++;
    byPair[trade.pair].pnl += trade.netPnl ?? 0;

    // By setup tags (count each tag individually)
    for (const tag of trade.setupTags || []) {
      if (!bySetup[tag]) bySetup[tag] = { count: 0, wins: 0, winRate: 0 };
      bySetup[tag].count++;
      if ((trade.rMultiple ?? 0) > 0) bySetup[tag].wins++;
    }

    // By session
    if (!bySession[trade.session]) bySession[trade.session] = { count: 0, wins: 0, winRate: 0 };
    bySession[trade.session].count++;
    if ((trade.rMultiple ?? 0) > 0) bySession[trade.session].wins++;
  }

  // Calculate win rates
  for (const setup in bySetup) {
    bySetup[setup].winRate = bySetup[setup].count > 0
      ? (bySetup[setup].wins / bySetup[setup].count) * 100
      : 0;
  }
  for (const session in bySession) {
    bySession[session].winRate = bySession[session].count > 0
      ? (bySession[session].wins / bySession[session].count) * 100
      : 0;
  }

  // Missed trade stats
  const missedWinners = missed.filter(t => (t.rMultiple ?? 0) > 0);
  const missedLosers = missed.filter(t => (t.rMultiple ?? 0) < 0);

  return {
    total: trades.length,
    closed: closed.length,
    open: taken.filter(t => t.status === 'open').length,
    missed: missed.length,
    taken: taken.length,
    wins: winners.length,
    losses: losers.length,
    winRate: closed.length > 0 ? (winners.length / closed.length) * 100 : 0,
    avgWinR: winners.length > 0
      ? winners.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / winners.length
      : 0,
    avgLossR: losers.length > 0
      ? losers.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / losers.length
      : 0,
    totalPnl: closed.reduce((sum, t) => sum + (t.netPnl ?? 0), 0),
    byPair,
    bySetup,
    bySession,
    missedStats: {
      total: missed.length,
      wouldHaveWon: missedWinners.length,
      wouldHaveLost: missedLosers.length,
    },
  };
}
