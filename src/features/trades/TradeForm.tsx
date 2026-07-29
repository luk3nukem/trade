import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { FormSection } from '../../components/FormSection';
import { db } from '../../db';
import { useAppStore } from '../../stores/appStore';
import type {
  TradeFormData,
  TradeRecord,
  AssetClass,
  Timeframe,
  ExitType,
  TradeExit,
  TradeEvent,
  Screenshot,
  Account,
  Strategy,
  LevelEntry,
  LevelReaction,
  LevelTypePref,
} from '../../types';
import { ZONE_LEVEL_TYPES, DETAIL_LEVEL_TYPES, EVENT_TYPE_PRESETS, NOT_TAKEN_REASON_PRESETS, NOT_TAKEN_REASON_LABELS } from '../../types';
import {
  deriveSession,
  calculateStopDistance,
  calculatePlannedRR,
  calculateActualRR,
  calculateRMultiple,
  calculateTotalExitsPnl,
  calculateHoldDuration,
  formatDuration,
  validateStopLoss,
  parseLocalDateTime,
  getCurrentDateTimeString,
  toLocalDateTimeString,
  isHighLowZoneType,
  getRangeConsumedPercent,
} from '../../utils';

// Preset level types - zones have two edges, lines are single price
const PRESET_ZONE_TYPES = ZONE_LEVEL_TYPES as readonly string[];
const PRESET_LINE_TYPES = ['LCPB', 'fib', 'S/R', 'EQ'] as const;
const ALL_PRESET_TYPES = [...PRESET_ZONE_TYPES, ...PRESET_LINE_TYPES] as string[];

// Level types that show a detail field
const DETAIL_TYPES = DETAIL_LEVEL_TYPES as readonly string[];

// Preset fib level detail options
const PRESET_FIB_DETAILS = ['0.25', '0.5', '0.705', '0.75', '0.786', 'GP'] as const;

// Helper to check if a level type should show detail input
const isDetailLevelType = (levelType: string): boolean => {
  return DETAIL_TYPES.includes(levelType.toLowerCase());
};

// Normalize level detail (trim, normalize case, fix decimal inconsistencies)
const normalizeLevelDetail = (detail: string): string => {
  const trimmed = detail.trim();
  if (trimmed.toLowerCase() === 'gp') return 'GP';
  if (/^\.?\d/.test(trimmed)) {
    const numMatch = trimmed.match(/^\.?(\d+\.?\d*)/);
    if (numMatch) {
      const num = parseFloat(trimmed.startsWith('.') ? `0${trimmed}` : trimmed);
      if (!isNaN(num)) {
        return num.toString();
      }
    }
  }
  return trimmed;
};

// Normalize a timeframe string (trim whitespace, uppercase unit letter)
const normalizeLevelTimeframe = (tf: string): string => {
  const trimmed = tf.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^(\d+)([mhdwMHDW])$/i);
  if (match) {
    const num = match[1];
    const unit = match[2].toUpperCase();
    return `${unit}${num}`;
  }
  const match2 = trimmed.match(/^([mhdwMHDW])(\d+)$/i);
  if (match2) {
    const unit = match2[1].toUpperCase();
    const num = match2[2];
    return `${unit}${num}`;
  }
  return trimmed.toUpperCase();
};

// Initial form state for v2 schema
const getInitialFormData = (): TradeFormData => ({
  pair: '',
  assetClass: 'forex',
  direction: 'long',
  entryTime: getCurrentDateTimeString(),
  entryPrice: '',
  stopLoss: '',
  targetPrice: '',
  positionSize: '',
  riskAmount: '',
  riskPercent: '',
  exits: [],
  timeline: [],
  levelSequence: [],
  contextTags: [],
  entryTF: '',
  entryConfirmation: '',
  confirmationTF: '',
  tradeTaken: true,
  notTakenReason: '',
  frontRunTurnPrice: '',
  entryNotes: '',
  closeNotes: '',
  postExitNotes: '',
  screenshots: [],
  accountId: '',
  strategyId: '',
  reachedTargetPostExit: null,
});

// Options for selects
const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: 'forex', label: 'Forex' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'stocks', label: 'Stocks' },
  { value: 'futures', label: 'Futures' },
  { value: 'options', label: 'Options' },
  { value: 'indices', label: 'Indices' },
  { value: 'commodities', label: 'Commodities' },
  { value: 'other', label: 'Other' },
];

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: 'M1', label: 'M1' },
  { value: 'M5', label: 'M5' },
  { value: 'M15', label: 'M15' },
  { value: 'M30', label: 'M30' },
  { value: 'H1', label: 'H1' },
  { value: 'H4', label: 'H4' },
  { value: 'D1', label: 'D1' },
  { value: 'W1', label: 'W1' },
  { value: 'MN', label: 'MN' },
];

const ENTRY_CONFIRMATION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '---' },
  { value: 'blind_limit', label: 'Blind - limit order at level' },
  { value: 'blind_market', label: 'Blind - market order at touch' },
  { value: 'structural', label: 'Waited for structural confirmation' },
  { value: 'partial_confirmation', label: 'Partial confirmation' },
];

const EXIT_TYPES: { value: ExitType; label: string }[] = [
  { value: 'tp_hit', label: 'TP Hit' },
  { value: 'sl_hit', label: 'SL Hit' },
  { value: 'manual_close', label: 'Manual Close' },
  { value: 'trail_stop_hit', label: 'Trail Stop Hit' },
  { value: 'be_stop_hit', label: 'BE Stop Hit' },
  { value: 'time_exit', label: 'Time Exit' },
];

// Preset level timeframes for the combo input
const PRESET_LEVEL_TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN', 'MTF'];

// Preset confirmation timeframes
const PRESET_CONFIRMATION_TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

// Helper to check if a level type is a zone (has two edges) - for preset types only
const isPresetZoneType = (levelType: string): boolean => {
  return PRESET_ZONE_TYPES.includes(levelType);
};

// Helper to check if a level type is a preset line type
const isPresetLineType = (levelType: string): boolean => {
  return (PRESET_LINE_TYPES as readonly string[]).includes(levelType);
};

// Check if type is known (preset) vs custom
const isKnownLevelType = (levelType: string): boolean => {
  return ALL_PRESET_TYPES.includes(levelType);
};

// Helper to calculate penetration percent for zone levels
const calculatePenetrationPercent = (
  nearEdge: number,
  farEdge: number,
  deepestPrice: number | null | undefined
): number | null => {
  if (!deepestPrice || !nearEdge || !farEdge || nearEdge === farEdge) return null;
  const zoneWidth = Math.abs(farEdge - nearEdge);
  const penetration = Math.abs(deepestPrice - nearEdge);
  const percent = (penetration / zoneWidth) * 100;
  return Math.min(100, Math.max(0, Math.round(percent)));
};

interface ValidationErrors {
  pair?: string;
  direction?: string;
  entryPrice?: string;
  stopLoss?: string;
  entryTime?: string;
  notTakenReason?: string;
  frontRunTurnPrice?: string;
}

interface ValidationWarnings {
  riskPercent?: string;
  stopLoss?: string;
  targetPrice?: string;
  exitWarnings?: Record<string, string>;
}

export function TradeForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const { dashboardFilters } = useAppStore();

  const [formData, setFormData] = useState<TradeFormData>(getInitialFormData);
  const [originalStopLoss, setOriginalStopLoss] = useState<number | undefined>();
  const [createdAt, setCreatedAt] = useState<Date | undefined>();
  const [existingReviewedAt, setExistingReviewedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [warnings, setWarnings] = useState<ValidationWarnings>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(isEditMode);
  const [previousPairs, setPreviousPairs] = useState<string[]>([]);
  const [previousContextTags, setPreviousContextTags] = useState<string[]>([]);
  const [tagDescriptions, setTagDescriptions] = useState<Record<string, string>>({});
  const [contextTagInput, setContextTagInput] = useState('');
  const [showPairSuggestions, setShowPairSuggestions] = useState(false);
  const [showContextTagSuggestions, setShowContextTagSuggestions] = useState(false);

  // Accounts and strategies
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);

  // Add strategy modal
  const [showAddStrategy, setShowAddStrategy] = useState(false);
  const [newStrategyName, setNewStrategyName] = useState('');
  const [isAddingStrategy, setIsAddingStrategy] = useState(false);

  // Screenshot URL input state
  const [screenshotUrlInput, setScreenshotUrlInput] = useState('');
  const [screenshotCaptionInput, setScreenshotCaptionInput] = useState('');

  // Level type autocomplete state
  const [previousLevelTypes, setPreviousLevelTypes] = useState<string[]>([]);
  const [levelTypePrefs, setLevelTypePrefs] = useState<LevelTypePref[]>([]);
  const [levelTypeInputs, setLevelTypeInputs] = useState<Record<number, string>>({});
  const [showLevelTypeSuggestions, setShowLevelTypeSuggestions] = useState<Record<number, boolean>>({});

  // Level timeframe autocomplete state
  const [previousLevelTimeframes, setPreviousLevelTimeframes] = useState<string[]>([]);
  const [levelTfInputs, setLevelTfInputs] = useState<Record<number, string>>({});
  const [showLevelTfSuggestions, setShowLevelTfSuggestions] = useState<Record<number, boolean>>({});

  // Level detail autocomplete state
  const [previousLevelDetails, setPreviousLevelDetails] = useState<string[]>([]);
  const [levelDetailInputs, setLevelDetailInputs] = useState<Record<number, string>>({});
  const [showLevelDetailSuggestions, setShowLevelDetailSuggestions] = useState<Record<number, boolean>>({});

  // Confirmation TF combo input state
  const [confirmationTfInput, setConfirmationTfInput] = useState('');
  const [showConfirmationTfSuggestions, setShowConfirmationTfSuggestions] = useState(false);

  // Timeline state
  const [previousEventTypes, setPreviousEventTypes] = useState<string[]>([]);
  const [eventTypeInput, setEventTypeInput] = useState('');
  const [showEventTypeSuggestions, setShowEventTypeSuggestions] = useState(false);
  const [newEventTime, setNewEventTime] = useState('');
  const [newEventType, setNewEventType] = useState('');
  const [newEventPrice, setNewEventPrice] = useState('');
  const [newEventDescription, setNewEventDescription] = useState('');
  // Inline event type editing state
  const [editingEventTypeId, setEditingEventTypeId] = useState<string | null>(null);
  const [inlineEventTypeInput, setInlineEventTypeInput] = useState('');
  const [showInlineEventTypeSuggestions, setShowInlineEventTypeSuggestions] = useState(false);

  // Load existing trade data for edit mode
  useEffect(() => {
    if (!id) return;

    const loadTrade = async () => {
      try {
        const trade = await db.trades.get(id);
        if (trade) {
          setFormData({
            pair: trade.pair,
            assetClass: trade.assetClass,
            direction: trade.direction,
            entryTime: toLocalDateTimeString(new Date(trade.entryTime)),
            entryPrice: String(trade.entryPrice),
            stopLoss: String(trade.stopLoss),
            targetPrice: trade.targetPrice ? String(trade.targetPrice) : '',
            positionSize: String(trade.positionSize),
            riskAmount: trade.riskAmount ? String(trade.riskAmount) : '',
            riskPercent: trade.riskPercent ? String(trade.riskPercent) : '',
            exits: trade.exits || [],
            // Convert UTC ISO times back to local datetime-local format for display
            timeline: (trade.timeline || []).map(event => ({
              ...event,
              time: event.time ? toLocalDateTimeString(new Date(event.time)) : null,
            })),
            levelSequence: (trade.levelSequence || []).map(l => ({
              ...l,
              levelDetail: l.levelDetail ?? '',
            })),
            contextTags: trade.contextTags || [],
            entryTF: trade.entryTF || '',
            entryConfirmation: trade.entryConfirmation || '',
            confirmationTF: trade.confirmationTF || '',
            tradeTaken: trade.tradeTaken ?? true,
            notTakenReason: trade.notTakenReason || '',
            frontRunTurnPrice: trade.frontRunTurnPrice?.toString() || '',
            entryNotes: trade.entryNotes || '',
            closeNotes: trade.closeNotes || '',
            postExitNotes: trade.postExitNotes || '',
            screenshots: trade.screenshots || [],
            accountId: trade.accountId,
            strategyId: trade.strategyId,
            reachedTargetPostExit: trade.reachedTargetPostExit ?? null,
          });
          setOriginalStopLoss(trade.stopLoss);
          setCreatedAt(trade.createdAt);
          setExistingReviewedAt(trade.reviewedAt || null);
        }
      } catch (error) {
        console.error('Failed to load trade:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadTrade();
  }, [id]);

  // Load previously used pairs, context tags, accounts and strategies
  useEffect(() => {
    const loadSuggestions = async () => {
      const trades = await db.trades.toArray();
      const pairs = [...new Set(trades.map((t) => t.pair))].filter(Boolean);
      const allTags = trades.flatMap((t) => t.contextTags || []);
      const uniqueTags = [...new Set(allTags)].filter(Boolean);
      setPreviousPairs(pairs);
      setPreviousContextTags(uniqueTags);

      // Collect all unique level types from all trades
      const allLevelTypes = trades.flatMap((t) =>
        (t.levelSequence || []).map((l) => l.levelType).filter(Boolean)
      );
      const uniqueLevelTypes = [...new Set(allLevelTypes)].filter(Boolean);
      setPreviousLevelTypes(uniqueLevelTypes);

      // Collect all unique level timeframes
      const allLevelTimeframes = trades.flatMap((t) =>
        (t.levelSequence || []).map((l) => l.timeframe).filter(Boolean)
      );
      const uniqueLevelTimeframes = [...new Set(allLevelTimeframes)]
        .filter(tf => tf && !PRESET_LEVEL_TIMEFRAMES.includes(tf));
      setPreviousLevelTimeframes(uniqueLevelTimeframes);

      // Collect all unique level details
      const allLevelDetails = trades.flatMap((t) =>
        (t.levelSequence || []).map((l) => (l as { levelDetail?: string }).levelDetail).filter((d): d is string => Boolean(d))
      );
      const uniqueLevelDetails = [...new Set(allLevelDetails)]
        .filter(d => !PRESET_FIB_DETAILS.includes(d as typeof PRESET_FIB_DETAILS[number]));
      setPreviousLevelDetails(uniqueLevelDetails);

      // Load level type zone preferences
      const prefs = await db.levelTypePrefs.toArray();
      setLevelTypePrefs(prefs);

      // Collect all unique event types from timeline
      const allEventTypes = trades.flatMap((t) =>
        (t.timeline || []).map((e) => e.eventType).filter(Boolean)
      );
      const uniqueEventTypes = [...new Set(allEventTypes)]
        .filter(et => et && !EVENT_TYPE_PRESETS.includes(et as typeof EVENT_TYPE_PRESETS[number]));
      setPreviousEventTypes(uniqueEventTypes);

      // Load glossary for tag descriptions
      const glossaryTerms = await db.glossaryTerms.toArray();
      const descMap: Record<string, string> = {};
      for (const term of glossaryTerms) {
        descMap[term.term] = term.definition;
      }
      setTagDescriptions(descMap);

      // Load accounts and strategies
      const allAccounts = await db.accounts.toArray();
      const allStrategies = await db.strategies.toArray();
      setAccounts(allAccounts);
      setStrategies(allStrategies);

      // Find default account/strategy by isDefault flag
      const defaultAccount = allAccounts.find(a => a.isDefault);
      const defaultStrategy = allStrategies.find(s => s.isDefault);

      // Set default account/strategy from global filter if not editing
      if (!id) {
        setFormData((prev) => ({
          ...prev,
          accountId: dashboardFilters.accountId || defaultAccount?.id || '',
          strategyId: dashboardFilters.strategyId || defaultStrategy?.id || '',
        }));
      }
    };
    loadSuggestions();
  }, [id, dashboardFilters.accountId, dashboardFilters.strategyId]);

  // Auto-clear confirmationTF when entryConfirmation changes to non-structural
  useEffect(() => {
    if (formData.entryConfirmation !== 'structural' && formData.entryConfirmation !== 'partial_confirmation') {
      if (formData.confirmationTF) {
        setFormData(prev => ({ ...prev, confirmationTF: '' }));
        setConfirmationTfInput('');
      }
    }
  }, [formData.entryConfirmation]);

  // Auto-calculated values derived from exits
  const calculated = useMemo(() => {
    const entryPrice = parseFloat(formData.entryPrice) || 0;
    const currentStopLoss = parseFloat(formData.stopLoss) || 0;
    const stopForRCalc = originalStopLoss ?? currentStopLoss;
    const targetPrice = formData.targetPrice ? parseFloat(formData.targetPrice) : undefined;
    const positionSize = parseFloat(formData.positionSize) || 0;
    const entryTime = parseLocalDateTime(formData.entryTime);

    // Derive exit values from exits array
    const exits = formData.exits || [];
    const totalExitSize = exits.reduce((sum, e) => sum + (e.size || 0), 0);

    // Weighted average exit price
    let exitPrice: number | undefined;
    if (exits.length > 0 && totalExitSize > 0) {
      const weightedSum = exits.reduce((sum, e) => sum + (e.price * e.size), 0);
      exitPrice = weightedSum / totalExitSize;
    }

    // Last exit time
    let exitTime: Date | undefined;
    if (exits.length > 0) {
      const sortedExits = [...exits].sort((a, b) =>
        new Date(b.time).getTime() - new Date(a.time).getTime()
      );
      exitTime = sortedExits[0]?.time instanceof Date
        ? sortedExits[0].time
        : new Date(sortedExits[0]?.time);
    }

    // Derive status from exits
    let status: 'open' | 'partial' | 'closed' = 'open';
    if (exits.length > 0) {
      if (totalExitSize >= positionSize) {
        status = 'closed';
      } else {
        status = 'partial';
      }
    }

    const session = entryTime ? deriveSession(entryTime) : 'other';
    const stopDistance = entryPrice && stopForRCalc ? calculateStopDistance(entryPrice, stopForRCalc) : undefined;
    const plannedRR = entryPrice && stopForRCalc ? calculatePlannedRR(entryPrice, stopForRCalc, targetPrice) : undefined;
    const actualRR = entryPrice && stopForRCalc ? calculateActualRR(entryPrice, stopForRCalc, exitPrice) : undefined;
    const rMultiple = entryPrice && stopForRCalc ? calculateRMultiple(entryPrice, stopForRCalc, exitPrice, formData.direction) : undefined;

    // Calculate P&L using R-based method
    const riskAmount = parseFloat(formData.riskAmount) || 0;
    let pnl: number | undefined;
    if (entryPrice && stopForRCalc && riskAmount && positionSize && exits.length > 0) {
      pnl = calculateTotalExitsPnl(
        entryPrice,
        stopForRCalc,
        riskAmount,
        positionSize,
        formData.direction,
        exits.map(e => ({ price: e.price, size: e.size }))
      );
    }
    const holdDuration = entryTime ? calculateHoldDuration(entryTime, exitTime) : undefined;

    return {
      session,
      status,
      exitPrice,
      exitTime,
      totalExitSize,
      stopDistance,
      plannedRR,
      actualRR,
      rMultiple,
      pnl,
      holdDuration,
    };
  }, [formData, originalStopLoss]);

  // Validate form
  const validate = useCallback((): boolean => {
    const newErrors: ValidationErrors = {};
    const newWarnings: ValidationWarnings = {};

    // Required fields
    if (!formData.pair.trim()) {
      newErrors.pair = 'Pair is required';
    }
    if (!formData.entryPrice) {
      newErrors.entryPrice = 'Entry price is required';
    }
    if (!formData.stopLoss) {
      newErrors.stopLoss = 'Stop loss is required';
    }
    if (!formData.entryTime) {
      newErrors.entryTime = 'Entry time is required';
    }

    // notTakenReason is REQUIRED when tradeTaken === false
    if (!formData.tradeTaken && !formData.notTakenReason.trim()) {
      newErrors.notTakenReason = 'Reason is required for missed trades';
    }

    // frontRunTurnPrice is REQUIRED when notTakenReason === 'front_run'
    if (!formData.tradeTaken && formData.notTakenReason === 'front_run' && !formData.frontRunTurnPrice.trim()) {
      newErrors.frontRunTurnPrice = 'Turn price is required for front-run misses';
    }

    // Stop loss validation (direction consistency)
    if (formData.entryPrice && formData.stopLoss) {
      const entryPrice = parseFloat(formData.entryPrice);
      const stopLoss = parseFloat(formData.stopLoss);
      const slValidation = validateStopLoss(entryPrice, stopLoss, formData.direction);
      if (!slValidation.valid) {
        newErrors.stopLoss = slValidation.message;
      }
    }

    // Risk percent warning
    if (formData.riskPercent) {
      const riskPct = parseFloat(formData.riskPercent);
      if (riskPct > 2) {
        newWarnings.riskPercent = 'Risk exceeds 2% of account';
      }
    }

    // Price sanity checks
    const entryPrice = parseFloat(formData.entryPrice) || 0;
    const stopLoss = parseFloat(formData.stopLoss) || 0;

    if (entryPrice > 0 && stopLoss > 0) {
      const stopDistance = Math.abs(stopLoss - entryPrice);
      const stopDistancePercent = stopDistance / entryPrice;
      const threshold = formData.assetClass === 'crypto' ? 0.25 : 0.10;
      if (stopDistancePercent > threshold) {
        const pctFormatted = (stopDistancePercent * 100).toFixed(1);
        newWarnings.stopLoss = `Stop is ${pctFormatted}% away from entry - check for a typo`;
      }

      // Check target price
      const targetPrice = parseFloat(formData.targetPrice) || 0;
      if (targetPrice > 0 && Math.abs(targetPrice - entryPrice) / entryPrice > 0.5) {
        newWarnings.targetPrice = `Target looks very different from entry - check for a typo`;
      }

      // Exit price and time sanity
      if (formData.exits && formData.exits.length > 0) {
        const exitWarnings: Record<string, string> = {};
        const entryTimestamp = formData.entryTime ? new Date(formData.entryTime).getTime() : null;

        for (const exit of formData.exits) {
          const warnings: string[] = [];

          // Price sanity
          if (exit.price > 0) {
            if (Math.abs(exit.price - entryPrice) / entryPrice > 0.5) {
              warnings.push('Price looks very different from entry');
            } else {
              const exitPnlDirection = formData.direction === 'long'
                ? exit.price - entryPrice
                : entryPrice - exit.price;
              const rMult = exitPnlDirection / stopDistance;
              if (Math.abs(rMult) > 20) {
                warnings.push(`This implies ${rMult.toFixed(1)}R - check price`);
              }
            }
          }

          // Time sanity - exit before entry
          if (entryTimestamp && exit.time instanceof Date) {
            const exitTimestamp = exit.time.getTime();
            if (exitTimestamp < entryTimestamp) {
              warnings.push('Exit time is before entry time');
            }
          }

          if (warnings.length > 0) {
            exitWarnings[exit.id] = warnings.join('; ');
          }
        }
        if (Object.keys(exitWarnings).length > 0) {
          newWarnings.exitWarnings = exitWarnings;
        }
      }
    }

    setErrors(newErrors);
    setWarnings(newWarnings);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Handle form field changes
  const handleChange = (field: keyof TradeFormData, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Handle exits
  const addExit = () => {
    const newExit: TradeExit = {
      id: uuidv4(),
      price: 0,
      size: 0,
      time: new Date(),
      type: 'tp_hit',
      reason: '',
    };
    setFormData((prev) => ({
      ...prev,
      exits: [...prev.exits, newExit],
    }));
  };

  const updateExit = (id: string, field: keyof TradeExit, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      exits: prev.exits.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
    }));
  };

  const removeExit = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      exits: prev.exits.filter((e) => e.id !== id),
    }));
  };

  // Handle timeline events
  const addTimelineEvent = () => {
    if (!newEventType.trim()) return;
    const maxOrder = formData.timeline.reduce((max, e) => Math.max(max, e.order), 0);
    const newEvent: TradeEvent = {
      id: uuidv4(),
      order: maxOrder + 1,
      time: newEventTime || null,
      eventType: newEventType.trim(),
      price: newEventPrice ? parseFloat(newEventPrice) : null,
      description: newEventDescription.trim(),
    };
    setFormData((prev) => ({
      ...prev,
      timeline: [...prev.timeline, newEvent].sort((a, b) => a.order - b.order),
    }));
    setNewEventTime('');
    setNewEventType('');
    setNewEventPrice('');
    setNewEventDescription('');
    setEventTypeInput('');
  };

  const updateTimelineEvent = (id: string, field: keyof TradeEvent, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      timeline: prev.timeline.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
    }));
  };

  const removeTimelineEvent = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      timeline: prev.timeline.filter((e) => e.id !== id),
    }));
  };

  const reorderTimelineEvent = (index: number, direction: 'up' | 'down') => {
    setFormData((prev) => {
      const newTimeline = [...prev.timeline];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newTimeline.length) return prev;
      [newTimeline[index], newTimeline[targetIndex]] = [newTimeline[targetIndex], newTimeline[index]];
      // Renumber orders
      newTimeline.forEach((e, i) => { e.order = i + 1; });
      return { ...prev, timeline: newTimeline };
    });
  };

  // Add screenshot URL
  const addScreenshotUrl = () => {
    const url = screenshotUrlInput.trim();
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return;

    const newScreenshot: Screenshot = {
      id: uuidv4(),
      url,
      caption: screenshotCaptionInput.trim(),
      createdAt: new Date(),
    };

    setFormData((prev) => ({
      ...prev,
      screenshots: [...prev.screenshots, newScreenshot],
    }));

    setScreenshotUrlInput('');
    setScreenshotCaptionInput('');
  };

  const updateScreenshotCaption = (id: string, caption: string) => {
    setFormData((prev) => ({
      ...prev,
      screenshots: prev.screenshots.map((s) => (s.id === id ? { ...s, caption } : s)),
    }));
  };

  const removeScreenshot = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      screenshots: prev.screenshots.filter((s) => s.id !== id),
    }));
  };

  // Add strategy handler
  const handleAddStrategy = async () => {
    if (!newStrategyName.trim()) return;

    setIsAddingStrategy(true);
    try {
      const newStrategy = {
        name: newStrategyName.trim(),
        description: '',
        rules: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const newId = await db.strategies.add(newStrategy as Strategy);
      const allStrategies = await db.strategies.toArray();
      setStrategies(allStrategies);
      handleChange('strategyId', newId as string);
      setNewStrategyName('');
      setShowAddStrategy(false);
    } catch (error) {
      console.error('Failed to add strategy:', error);
    } finally {
      setIsAddingStrategy(false);
    }
  };

  // Submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const now = new Date();
      const entryTime = parseLocalDateTime(formData.entryTime)!;
      const entryPrice = parseFloat(formData.entryPrice);
      const stopLoss = parseFloat(formData.stopLoss);

      // Build trade data for v2 schema
      const tradeData = {
        accountId: formData.accountId,
        strategyId: formData.strategyId,
        pair: formData.pair.trim().toUpperCase(),
        assetClass: formData.assetClass,
        direction: formData.direction,
        entryTime,
        entryPrice,
        stopLoss,
        targetPrice: formData.targetPrice ? parseFloat(formData.targetPrice) : undefined,
        positionSize: parseFloat(formData.positionSize) || 0,
        riskAmount: formData.riskAmount ? parseFloat(formData.riskAmount) : undefined,
        riskPercent: formData.riskPercent ? parseFloat(formData.riskPercent) : undefined,
        exits: formData.exits,
        // Normalize timeline event times to UTC ISO strings
        timeline: formData.timeline.map(event => ({
          ...event,
          // Convert local datetime string to UTC ISO, or keep null
          time: event.time ? new Date(event.time).toISOString() : null,
        })),
        levelSequence: formData.levelSequence.map(level => ({
          ...level,
          timeframe: normalizeLevelTimeframe(level.timeframe),
          levelDetail: normalizeLevelDetail(level.levelDetail),
        })),
        contextTags: formData.contextTags,
        entryTF: formData.entryTF || undefined,
        entryConfirmation: formData.entryConfirmation || undefined,
        confirmationTF: (formData.entryConfirmation === 'structural' || formData.entryConfirmation === 'partial_confirmation')
          ? (formData.confirmationTF || undefined)
          : undefined,
        tradeTaken: formData.tradeTaken,
        notTakenReason: !formData.tradeTaken ? formData.notTakenReason.trim() : '',
        frontRunTurnPrice: !formData.tradeTaken && formData.notTakenReason === 'front_run' && formData.frontRunTurnPrice.trim()
          ? parseFloat(formData.frontRunTurnPrice)
          : null,
        entryNotes: formData.entryNotes.trim() || undefined,
        closeNotes: formData.closeNotes.trim() || undefined,
        postExitNotes: formData.postExitNotes.trim() || undefined,
        screenshots: formData.screenshots,
        reachedTargetPostExit: formData.reachedTargetPostExit,
        // Review is complete when reachedTargetPostExit is set and postExitNotes is filled
        reviewedAt: (() => {
          const hasReachedTarget = formData.reachedTargetPostExit !== null;
          const hasNotes = formData.postExitNotes.trim() !== '';
          const isComplete = hasReachedTarget && hasNotes;
          return isComplete ? (existingReviewedAt || now.toISOString()) : null;
        })(),
        createdAt: isEditMode ? createdAt! : now,
        updatedAt: now,
      };

      if (isEditMode) {
        await db.trades.put({ ...tradeData, id: id! } as TradeRecord);
        navigate(`/trades/${id}`);
      } else {
        await db.trades.add(tradeData as TradeRecord);
        navigate('/trades');
      }
    } catch (error) {
      console.error('Failed to save trade:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter suggestions
  const filteredPairs = previousPairs.filter((p) =>
    p.toLowerCase().includes(formData.pair.toLowerCase())
  );

  // Context tag suggestions
  const filteredContextTags = previousContextTags
    .filter((tag) => !formData.contextTags.includes(tag))
    .filter((tag) => tag.toLowerCase().includes(contextTagInput.toLowerCase()))
    .map((tag) => ({ name: tag, description: tagDescriptions[tag] || '' }));

  // Add/remove context tags
  const addContextTag = (tag: string) => {
    const trimmedTag = tag.trim();
    if (trimmedTag && !formData.contextTags.includes(trimmedTag)) {
      setFormData((prev) => ({ ...prev, contextTags: [...prev.contextTags, trimmedTag] }));
    }
    setContextTagInput('');
    setShowContextTagSuggestions(false);
  };

  const removeContextTag = (tag: string) => {
    setFormData((prev) => ({
      ...prev,
      contextTags: prev.contextTags.filter((t) => t !== tag),
    }));
  };

  // === Level Type Helpers ===
  const isLevelTypeZone = useCallback((levelType: string): boolean => {
    if (isPresetZoneType(levelType)) return true;
    if (isPresetLineType(levelType)) return false;
    const pref = levelTypePrefs.find(p => p.levelType === levelType);
    return pref?.isZone ?? false;
  }, [levelTypePrefs]);

  const shouldShowZoneToggle = (levelType: string): boolean => {
    return levelType !== '' && !isKnownLevelType(levelType);
  };

  const allLevelTypes = useMemo(() => {
    const combined = new Set(ALL_PRESET_TYPES);
    previousLevelTypes.forEach(lt => combined.add(lt));
    return Array.from(combined);
  }, [previousLevelTypes]);

  const getFilteredLevelTypes = (index: number, currentValue: string): string[] => {
    const inputValue = levelTypeInputs[index] ?? currentValue;
    return allLevelTypes
      .filter(lt => lt.toLowerCase().includes(inputValue.toLowerCase()))
      .slice(0, 10);
  };

  const allLevelTimeframes = [...PRESET_LEVEL_TIMEFRAMES, ...previousLevelTimeframes.filter(tf => !PRESET_LEVEL_TIMEFRAMES.includes(tf))];

  const getFilteredLevelTimeframes = (index: number, currentValue: string): string[] => {
    const inputValue = levelTfInputs[index] ?? currentValue;
    if (!inputValue) return allLevelTimeframes;
    return allLevelTimeframes
      .filter(tf => tf.toLowerCase().includes(inputValue.toLowerCase()))
      .slice(0, 10);
  };

  const selectLevelTimeframe = (index: number, timeframe: string) => {
    setFormData((prev) => ({
      ...prev,
      levelSequence: prev.levelSequence.map((l, i) =>
        i === index ? { ...l, timeframe } : l
      ),
    }));
    setLevelTfInputs(prev => ({ ...prev, [index]: timeframe }));
    setShowLevelTfSuggestions(prev => ({ ...prev, [index]: false }));
  };

  const allLevelDetails = [...PRESET_FIB_DETAILS, ...previousLevelDetails.filter(d => !PRESET_FIB_DETAILS.includes(d as typeof PRESET_FIB_DETAILS[number]))];

  const getFilteredLevelDetails = (index: number, currentValue: string): string[] => {
    const inputValue = levelDetailInputs[index] ?? currentValue;
    if (!inputValue) return allLevelDetails;
    return allLevelDetails
      .filter(d => d.toLowerCase().includes(inputValue.toLowerCase()))
      .slice(0, 10);
  };

  const selectLevelDetail = (index: number, detail: string) => {
    setFormData((prev) => ({
      ...prev,
      levelSequence: prev.levelSequence.map((l, i) =>
        i === index ? { ...l, levelDetail: detail } : l
      ),
    }));
    setLevelDetailInputs(prev => ({ ...prev, [index]: detail }));
    setShowLevelDetailSuggestions(prev => ({ ...prev, [index]: false }));
  };

  const getFilteredConfirmationTFs = (): string[] => {
    const inputValue = confirmationTfInput || formData.confirmationTF;
    if (!inputValue) return PRESET_CONFIRMATION_TIMEFRAMES;
    return PRESET_CONFIRMATION_TIMEFRAMES
      .filter(tf => tf.toLowerCase().includes(inputValue.toLowerCase()))
      .slice(0, 10);
  };

  const selectConfirmationTF = (tf: string) => {
    handleChange('confirmationTF', tf);
    setConfirmationTfInput('');
    setShowConfirmationTfSuggestions(false);
  };

  // All event types = presets + custom previously used ones
  const allEventTypes = [...EVENT_TYPE_PRESETS, ...previousEventTypes.filter(et => !EVENT_TYPE_PRESETS.includes(et as typeof EVENT_TYPE_PRESETS[number]))];

  const getFilteredEventTypes = (): string[] => {
    const inputValue = eventTypeInput || newEventType;
    if (!inputValue) return allEventTypes;
    return allEventTypes
      .filter(et => et.toLowerCase().includes(inputValue.toLowerCase()))
      .slice(0, 10);
  };

  // Filtered event types for inline editing
  const getInlineFilteredEventTypes = (currentType: string): string[] => {
    const inputValue = inlineEventTypeInput || currentType;
    if (!inputValue) return allEventTypes;
    return allEventTypes
      .filter(et => et.toLowerCase().includes(inputValue.toLowerCase()))
      .slice(0, 10);
  };

  // Start inline editing of an event type
  const startEditingEventType = (eventId: string, currentType: string) => {
    setEditingEventTypeId(eventId);
    setInlineEventTypeInput(currentType);
    setShowInlineEventTypeSuggestions(true);
  };

  // Finish inline editing and save the new event type
  const finishEditingEventType = (eventId: string, newType: string) => {
    if (newType.trim()) {
      updateTimelineEvent(eventId, 'eventType', newType.trim());
    }
    setEditingEventTypeId(null);
    setInlineEventTypeInput('');
    setShowInlineEventTypeSuggestions(false);
  };

  // Cancel inline editing
  const cancelEditingEventType = () => {
    setEditingEventTypeId(null);
    setInlineEventTypeInput('');
    setShowInlineEventTypeSuggestions(false);
  };

  const saveLevelTypeZonePref = async (levelType: string, isZone: boolean) => {
    if (isKnownLevelType(levelType)) return;

    const existingPref = levelTypePrefs.find(p => p.levelType === levelType);
    if (existingPref) {
      await db.levelTypePrefs.update(existingPref.id!, { isZone });
      setLevelTypePrefs(prev => prev.map(p =>
        p.id === existingPref.id ? { ...p, isZone } : p
      ));
    } else {
      const newPref: LevelTypePref = { levelType, isZone };
      const newId = await db.levelTypePrefs.add(newPref);
      setLevelTypePrefs(prev => [...prev, { ...newPref, id: newId as string }]);
    }
  };

  const selectLevelType = (index: number, levelType: string) => {
    const isZone = isLevelTypeZone(levelType);
    setFormData((prev) => ({
      ...prev,
      levelSequence: prev.levelSequence.map((l, i) =>
        i === index ? {
          ...l,
          levelType,
          priceFar: isZone ? l.priceFar : null,
          deepestPrice: isZone ? l.deepestPrice : null,
          penetrationPercent: isZone ? l.penetrationPercent : null,
        } : l
      ),
    }));
    setLevelTypeInputs(prev => ({ ...prev, [index]: '' }));
    setShowLevelTypeSuggestions(prev => ({ ...prev, [index]: false }));
  };

  const handleZoneToggle = (index: number, levelType: string, isZone: boolean) => {
    saveLevelTypeZonePref(levelType, isZone);
    setFormData((prev) => ({
      ...prev,
      levelSequence: prev.levelSequence.map((l, i) =>
        i === index ? {
          ...l,
          priceFar: isZone ? l.priceFar : null,
          deepestPrice: isZone ? l.deepestPrice : null,
          penetrationPercent: isZone ? l.penetrationPercent : null,
        } : l
      ),
    }));
  };

  // Format event type for display (simple underscore replacement)
  const formatEventTypeLabel = (eventType: string): string => {
    return eventType.replace(/_/g, ' ');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-4">
      {/* Header with Trade Taken toggle */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">{isEditMode ? 'Edit Trade' : 'New Trade'}</h1>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-sm text-gray-400">Trade Taken</span>
          <button
            type="button"
            onClick={() => handleChange('tradeTaken', !formData.tradeTaken)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              formData.tradeTaken ? 'bg-green-600' : 'bg-orange-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                formData.tradeTaken ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </label>
      </div>

      {/* Missed trade banner */}
      {!formData.tradeTaken && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-orange-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-orange-400 font-medium">Logging missed/paper trade</p>
              <p className="text-orange-400/70 text-sm">This trade will be excluded from live stats and used for selectivity analysis only.</p>
            </div>
          </div>
        </div>
      )}

      {/* Section 1: Instrument & Direction */}
      <FormSection title="Instrument & Direction">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Pair with autocomplete */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Pair <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.pair}
              onChange={(e) => {
                handleChange('pair', e.target.value.toUpperCase());
                setShowPairSuggestions(true);
              }}
              onFocus={() => setShowPairSuggestions(true)}
              onBlur={() => setTimeout(() => setShowPairSuggestions(false), 200)}
              className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.pair ? 'border-red-500' : 'border-gray-600'
              }`}
              placeholder="EUR/USD"
            />
            {showPairSuggestions && filteredPairs.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredPairs.map((pair) => (
                  <button
                    key={pair}
                    type="button"
                    onClick={() => {
                      handleChange('pair', pair);
                      setShowPairSuggestions(false);
                    }}
                    className="w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-600"
                  >
                    {pair}
                  </button>
                ))}
              </div>
            )}
            {errors.pair && <p className="text-red-400 text-xs mt-1">{errors.pair}</p>}
          </div>

          {/* Asset Class */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Asset Class</label>
            <select
              value={formData.assetClass}
              onChange={(e) => handleChange('assetClass', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ASSET_CLASSES.map((ac) => (
                <option key={ac.value} value={ac.value}>
                  {ac.label}
                </option>
              ))}
            </select>
          </div>

          {/* Direction Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Direction</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleChange('direction', 'long')}
                className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                  formData.direction === 'long'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                Long
              </button>
              <button
                type="button"
                onClick={() => handleChange('direction', 'short')}
                className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                  formData.direction === 'short'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                Short
              </button>
            </div>
          </div>
        </div>

        {/* Account & Strategy Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-700">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Account</label>
            <select
              value={formData.accountId}
              onChange={(e) => handleChange('accountId', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {account.broker ? ` (${account.broker})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Strategy</label>
            <div className="flex gap-2">
              <select
                value={formData.strategyId}
                onChange={(e) => handleChange('strategyId', e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {strategies.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowAddStrategy(true)}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg text-gray-300 hover:text-white transition-colors"
                title="Add new strategy"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Reason Not Taken (only shown when tradeTaken is false) */}
        {!formData.tradeTaken && (
          <div className="mt-4 pt-4 border-t border-gray-700">
            <label className="block text-sm font-medium text-orange-400 mb-1">
              Reason Not Taken <span className="text-red-400">*</span>
            </label>
            <select
              value={formData.notTakenReason}
              onChange={(e) => handleChange('notTakenReason', e.target.value)}
              className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                errors.notTakenReason ? 'border-red-500' : 'border-orange-500/50'
              }`}
            >
              <option value="">Select a reason...</option>
              {NOT_TAKEN_REASON_PRESETS.map((reason) => (
                <option key={reason} value={reason}>
                  {NOT_TAKEN_REASON_LABELS[reason] || reason.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            {errors.notTakenReason && <p className="text-red-400 text-xs mt-1">{errors.notTakenReason}</p>}

            {/* Front-run turn price input (only shown when reason is front_run) */}
            {formData.notTakenReason === 'front_run' && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-orange-400 mb-1">
                  Turn Price <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  step="any"
                  value={formData.frontRunTurnPrice}
                  onChange={(e) => handleChange('frontRunTurnPrice', e.target.value)}
                  placeholder="Where price turned"
                  className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                    errors.frontRunTurnPrice ? 'border-red-500' : 'border-orange-500/50'
                  }`}
                />
                <p className="text-xs text-gray-400 mt-1">Where price turned, short of your planned entry</p>
                {errors.frontRunTurnPrice && <p className="text-red-400 text-xs mt-1">{errors.frontRunTurnPrice}</p>}

                {/* Sanity warning: turn price on wrong side of entry */}
                {formData.frontRunTurnPrice && formData.entryPrice && (() => {
                  const turnPrice = parseFloat(formData.frontRunTurnPrice);
                  const entryPrice = parseFloat(formData.entryPrice);
                  const direction = formData.direction;
                  if (!isNaN(turnPrice) && !isNaN(entryPrice)) {
                    // For a long, price should turn above entry (short of entry means higher)
                    // For a short, price should turn below entry (short of entry means lower)
                    const wrongSide = direction === 'long'
                      ? turnPrice < entryPrice  // Long: turn price should be >= entry
                      : turnPrice > entryPrice; // Short: turn price should be <= entry
                    if (wrongSide) {
                      return (
                        <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                          <p className="text-xs text-amber-400">
                            Turn price is on the wrong side of entry for a {direction} trade.
                            For front-runs, price should turn <em>before</em> reaching your entry level.
                          </p>
                        </div>
                      );
                    }
                  }
                  return null;
                })()}
              </div>
            )}
          </div>
        )}
      </FormSection>

      {/* Section 2: Entry */}
      <FormSection title="Entry">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="col-span-2 md:col-span-1">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Entry Time <span className="text-red-400">*</span>
            </label>
            <input
              type="datetime-local"
              value={formData.entryTime}
              onChange={(e) => handleChange('entryTime', e.target.value)}
              className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.entryTime ? 'border-red-500' : 'border-gray-600'
              }`}
            />
            {errors.entryTime && <p className="text-red-400 text-xs mt-1">{errors.entryTime}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Entry Price <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              step="any"
              value={formData.entryPrice}
              onChange={(e) => handleChange('entryPrice', e.target.value)}
              className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.entryPrice ? 'border-red-500' : 'border-gray-600'
              }`}
            />
            {errors.entryPrice && <p className="text-red-400 text-xs mt-1">{errors.entryPrice}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Stop Loss <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              step="any"
              value={formData.stopLoss}
              onChange={(e) => handleChange('stopLoss', e.target.value)}
              className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.stopLoss ? 'border-red-500' : warnings.stopLoss ? 'border-yellow-500' : 'border-gray-600'
              }`}
            />
            {errors.stopLoss && <p className="text-red-400 text-xs mt-1">{errors.stopLoss}</p>}
            {!errors.stopLoss && warnings.stopLoss && <p className="text-yellow-400 text-xs mt-1">{warnings.stopLoss}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Target Price</label>
            <input
              type="number"
              step="any"
              value={formData.targetPrice}
              onChange={(e) => handleChange('targetPrice', e.target.value)}
              placeholder="Primary profit target"
              className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                warnings.targetPrice ? 'border-yellow-500' : 'border-gray-600'
              }`}
            />
            {warnings.targetPrice && <p className="text-yellow-400 text-xs mt-1">{warnings.targetPrice}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Position Size</label>
            <input
              type="number"
              step="any"
              value={formData.positionSize}
              onChange={(e) => handleChange('positionSize', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., 0.1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Risk Amount ($)</label>
            <input
              type="number"
              step="any"
              value={formData.riskAmount}
              onChange={(e) => handleChange('riskAmount', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Risk %</label>
            <input
              type="number"
              step="any"
              value={formData.riskPercent}
              onChange={(e) => handleChange('riskPercent', e.target.value)}
              className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                warnings.riskPercent ? 'border-yellow-500' : 'border-gray-600'
              }`}
            />
            {warnings.riskPercent && <p className="text-yellow-400 text-xs mt-1">{warnings.riskPercent}</p>}
          </div>
        </div>

        {/* Auto-calculated: Session, Stop Distance, Planned R:R */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-gray-750 rounded-lg">
          <div>
            <span className="text-xs text-gray-400">Session</span>
            <div className="text-sm text-gray-200">
              {calculated.session.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
            </div>
          </div>
          <div>
            <span className="text-xs text-gray-400">Stop Distance</span>
            <div className="text-sm text-gray-200">
              {calculated.stopDistance?.toFixed(5) ?? '-'}
            </div>
          </div>
          <div>
            <span className="text-xs text-gray-400">Planned R:R</span>
            <div className="text-sm text-gray-200">{calculated.plannedRR ?? '-'}</div>
          </div>
          {calculated.holdDuration !== undefined && (
            <div>
              <span className="text-xs text-gray-400">Duration</span>
              <div className="text-sm text-gray-200">{formatDuration(calculated.holdDuration)}</div>
            </div>
          )}
        </div>
      </FormSection>

      {/* Section 3: Setup */}
      <FormSection title="Setup" defaultOpen={false}>
        <div className="space-y-4">
          {/* Level Sequence */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-300">Level Sequence</label>
              <button
                type="button"
                onClick={() => {
                  const newLevel: LevelEntry = {
                    id: uuidv4(),
                    levelType: '',
                    levelDetail: '',
                    timeframe: '',
                    price: 0,
                    priceFar: null,
                    deepestPrice: null,
                    penetrationPercent: null,
                    turnPrice: null,
                    reaction: null,
                  };
                  setFormData((prev) => ({
                    ...prev,
                    levelSequence: [...prev.levelSequence, newLevel],
                  }));
                }}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg"
              >
                + Add Level
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Levels in your zone, ordered shallowest to deepest
            </p>

            {formData.levelSequence.length > 0 && (
              <div className="space-y-2">
                {formData.levelSequence.map((level, index) => {
                  const isZone = isLevelTypeZone(level.levelType);
                  const showZoneToggle = shouldShowZoneToggle(level.levelType);
                  const penetration = isZone && level.priceFar
                    ? calculatePenetrationPercent(level.price, level.priceFar, level.deepestPrice)
                    : null;
                  const filteredTypes = getFilteredLevelTypes(index, level.levelType);
                  const inputValue = levelTypeInputs[index] ?? '';

                  return (
                    <div key={level.id} className="p-2 bg-gray-750 rounded-lg">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-5 text-center shrink-0">{index + 1}</span>

                          {/* Level Type */}
                          <div className="relative flex-1 md:flex-none">
                            <input
                              type="text"
                              value={showLevelTypeSuggestions[index] ? inputValue : level.levelType}
                              onChange={(e) => {
                                const newValue = e.target.value;
                                setLevelTypeInputs(prev => ({ ...prev, [index]: newValue }));
                                const nowZone = isLevelTypeZone(newValue);
                                setFormData((prev) => ({
                                  ...prev,
                                  levelSequence: prev.levelSequence.map((l, i) =>
                                    i === index ? {
                                      ...l,
                                      levelType: newValue,
                                      priceFar: nowZone ? l.priceFar : null,
                                      deepestPrice: nowZone ? l.deepestPrice : null,
                                      penetrationPercent: nowZone ? l.penetrationPercent : null,
                                    } : l
                                  ),
                                }));
                                setShowLevelTypeSuggestions(prev => ({ ...prev, [index]: true }));
                              }}
                              onFocus={() => {
                                setLevelTypeInputs(prev => ({ ...prev, [index]: level.levelType }));
                                setShowLevelTypeSuggestions(prev => ({ ...prev, [index]: true }));
                              }}
                              onBlur={() => setTimeout(() => setShowLevelTypeSuggestions(prev => ({ ...prev, [index]: false })), 200)}
                              placeholder="Type"
                              className="w-full md:w-20 px-2 py-1.5 md:py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            {showLevelTypeSuggestions[index] && filteredTypes.length > 0 && (
                              <div className="absolute z-20 w-full md:w-40 mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                {filteredTypes.map((lt) => (
                                  <button
                                    key={lt}
                                    type="button"
                                    onClick={() => selectLevelType(index, lt)}
                                    className="w-full px-3 py-2 md:py-1.5 text-left text-gray-200 hover:bg-gray-600 text-sm flex items-center gap-2"
                                  >
                                    <span>{lt}</span>
                                    {isPresetZoneType(lt) && <span className="text-xs text-gray-500">zone</span>}
                                    {isPresetLineType(lt) && <span className="text-xs text-gray-500">line</span>}
                                    {!isKnownLevelType(lt) && <span className="text-xs text-blue-400">custom</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Timeframe */}
                          <div className="relative shrink-0">
                            <input
                              type="text"
                              value={showLevelTfSuggestions[index] ? (levelTfInputs[index] ?? level.timeframe) : level.timeframe}
                              onChange={(e) => {
                                const newValue = e.target.value;
                                setLevelTfInputs(prev => ({ ...prev, [index]: newValue }));
                                setFormData((prev) => ({
                                  ...prev,
                                  levelSequence: prev.levelSequence.map((l, i) =>
                                    i === index ? { ...l, timeframe: newValue } : l
                                  ),
                                }));
                                setShowLevelTfSuggestions(prev => ({ ...prev, [index]: true }));
                              }}
                              onFocus={() => {
                                setLevelTfInputs(prev => ({ ...prev, [index]: level.timeframe }));
                                setShowLevelTfSuggestions(prev => ({ ...prev, [index]: true }));
                              }}
                              onBlur={() => {
                                const normalized = normalizeLevelTimeframe(level.timeframe);
                                if (normalized !== level.timeframe) {
                                  setFormData((prev) => ({
                                    ...prev,
                                    levelSequence: prev.levelSequence.map((l, i) =>
                                      i === index ? { ...l, timeframe: normalized } : l
                                    ),
                                  }));
                                }
                                setTimeout(() => setShowLevelTfSuggestions(prev => ({ ...prev, [index]: false })), 200);
                              }}
                              placeholder="TF"
                              className="w-16 px-2 py-1.5 md:py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            {showLevelTfSuggestions[index] && getFilteredLevelTimeframes(index, level.timeframe).length > 0 && (
                              <div className="absolute z-20 w-20 mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                {getFilteredLevelTimeframes(index, level.timeframe).map((tf) => (
                                  <button
                                    key={tf}
                                    type="button"
                                    onClick={() => selectLevelTimeframe(index, tf)}
                                    className="w-full px-2 py-2 md:py-1.5 text-left text-gray-200 hover:bg-gray-600 text-sm"
                                  >
                                    {tf}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Level detail for fib types */}
                          {isDetailLevelType(level.levelType) && (
                            <div className="relative shrink-0">
                              <input
                                type="text"
                                value={showLevelDetailSuggestions[index] ? (levelDetailInputs[index] ?? level.levelDetail) : level.levelDetail}
                                onChange={(e) => {
                                  const newValue = e.target.value;
                                  setLevelDetailInputs(prev => ({ ...prev, [index]: newValue }));
                                  setFormData((prev) => ({
                                    ...prev,
                                    levelSequence: prev.levelSequence.map((l, i) =>
                                      i === index ? { ...l, levelDetail: newValue } : l
                                    ),
                                  }));
                                  setShowLevelDetailSuggestions(prev => ({ ...prev, [index]: true }));
                                }}
                                onFocus={() => {
                                  setLevelDetailInputs(prev => ({ ...prev, [index]: level.levelDetail }));
                                  setShowLevelDetailSuggestions(prev => ({ ...prev, [index]: true }));
                                }}
                                onBlur={() => {
                                  const normalized = normalizeLevelDetail(level.levelDetail);
                                  if (normalized !== level.levelDetail) {
                                    setFormData((prev) => ({
                                      ...prev,
                                      levelSequence: prev.levelSequence.map((l, i) =>
                                        i === index ? { ...l, levelDetail: normalized } : l
                                      ),
                                    }));
                                  }
                                  setTimeout(() => setShowLevelDetailSuggestions(prev => ({ ...prev, [index]: false })), 200);
                                }}
                                placeholder="Level"
                                className="w-16 px-2 py-1.5 md:py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              {showLevelDetailSuggestions[index] && getFilteredLevelDetails(index, level.levelDetail).length > 0 && (
                                <div className="absolute z-20 w-20 mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                  {getFilteredLevelDetails(index, level.levelDetail).map((detail) => (
                                    <button
                                      key={detail}
                                      type="button"
                                      onClick={() => selectLevelDetail(index, detail)}
                                      className="w-full px-2 py-2 md:py-1.5 text-left text-gray-200 hover:bg-gray-600 text-sm"
                                    >
                                      {detail}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Zone toggle for custom types */}
                          {showZoneToggle && (
                            <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer shrink-0">
                              <input
                                type="checkbox"
                                checked={isZone}
                                onChange={(e) => handleZoneToggle(index, level.levelType, e.target.checked)}
                                className="w-4 h-4 md:w-3 md:h-3 rounded border-gray-500 bg-gray-600 text-blue-500 focus:ring-blue-500"
                              />
                              <span className="hidden md:inline">Zone</span>
                            </label>
                          )}

                          {/* Reorder & Remove */}
                          <div className="flex items-center gap-1 ml-auto md:ml-0">
                            <div className="flex flex-col">
                              <button
                                type="button"
                                onClick={() => {
                                  if (index === 0) return;
                                  setFormData((prev) => {
                                    const newSeq = [...prev.levelSequence];
                                    [newSeq[index - 1], newSeq[index]] = [newSeq[index], newSeq[index - 1]];
                                    return { ...prev, levelSequence: newSeq };
                                  });
                                }}
                                disabled={index === 0}
                                className={`p-1 md:p-0.5 rounded ${index === 0 ? 'text-gray-600' : 'text-gray-400 hover:text-white hover:bg-gray-600'}`}
                              >
                                <svg className="w-4 h-4 md:w-3 md:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (index === formData.levelSequence.length - 1) return;
                                  setFormData((prev) => {
                                    const newSeq = [...prev.levelSequence];
                                    [newSeq[index], newSeq[index + 1]] = [newSeq[index + 1], newSeq[index]];
                                    return { ...prev, levelSequence: newSeq };
                                  });
                                }}
                                disabled={index === formData.levelSequence.length - 1}
                                className={`p-1 md:p-0.5 rounded ${index === formData.levelSequence.length - 1 ? 'text-gray-600' : 'text-gray-400 hover:text-white hover:bg-gray-600'}`}
                              >
                                <svg className="w-4 h-4 md:w-3 md:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setFormData((prev) => ({
                                  ...prev,
                                  levelSequence: prev.levelSequence.filter((_, i) => i !== index),
                                }));
                              }}
                              className="p-1.5 md:p-1 text-gray-400 hover:text-red-400 hover:bg-gray-600 rounded"
                            >
                              <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Price inputs */}
                        <div className="flex items-center gap-2 ml-7 md:ml-0">
                          {isZone ? (
                            <>
                              {/* For high_low zones (ATR_Range): price = High, priceFar = Low */}
                              {/* For near_far zones: price = Near, priceFar = Far */}
                              {(() => {
                                const isHighLow = isHighLowZoneType(level.levelType);
                                const edgeLabels = isHighLow
                                  ? { first: 'High', second: 'Low', firstTitle: 'High edge', secondTitle: 'Low edge' }
                                  : { first: 'Near', second: 'Far', firstTitle: 'Near edge', secondTitle: 'Far edge' };
                                const edgesReversed = isHighLow && level.price > 0 && level.priceFar !== null && level.priceFar > 0 && level.price < level.priceFar;
                                return (
                                  <>
                                    <input
                                      type="number"
                                      step="any"
                                      value={level.price || ''}
                                      onChange={(e) => {
                                        setFormData((prev) => ({
                                          ...prev,
                                          levelSequence: prev.levelSequence.map((l, i) =>
                                            i === index ? { ...l, price: parseFloat(e.target.value) || 0 } : l
                                          ),
                                        }));
                                      }}
                                      placeholder={edgeLabels.first}
                                      title={edgeLabels.firstTitle}
                                      className={`flex-1 md:flex-none md:w-24 px-2 py-1.5 md:py-1 bg-gray-700 border rounded text-white text-sm ${
                                        edgesReversed ? 'border-amber-500' : 'border-gray-600'
                                      }`}
                                    />
                                    <span className="text-gray-500 text-xs shrink-0">-</span>
                                    <input
                                      type="number"
                                      step="any"
                                      value={level.priceFar || ''}
                                      onChange={(e) => {
                                        setFormData((prev) => ({
                                          ...prev,
                                          levelSequence: prev.levelSequence.map((l, i) =>
                                            i === index ? { ...l, priceFar: parseFloat(e.target.value) || null } : l
                                          ),
                                        }));
                                      }}
                                      placeholder={edgeLabels.second}
                                      title={edgeLabels.secondTitle}
                                      className={`flex-1 md:flex-none md:w-24 px-2 py-1.5 md:py-1 bg-gray-700 border rounded text-white text-sm ${
                                        edgesReversed ? 'border-amber-500' : 'border-gray-600'
                                      }`}
                                    />
                                    {edgesReversed && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setFormData((prev) => ({
                                            ...prev,
                                            levelSequence: prev.levelSequence.map((l, i) =>
                                              i === index ? { ...l, price: l.priceFar!, priceFar: l.price } : l
                                            ),
                                          }));
                                        }}
                                        className="text-xs text-amber-400 hover:text-amber-300 shrink-0"
                                        title="High should be greater than Low - click to swap"
                                      >
                                        ↔ swap
                                      </button>
                                    )}
                                  </>
                                );
                              })()}
                            </>
                          ) : (
                            <input
                              type="number"
                              step="any"
                              value={level.price || ''}
                              onChange={(e) => {
                                setFormData((prev) => ({
                                  ...prev,
                                  levelSequence: prev.levelSequence.map((l, i) =>
                                    i === index ? { ...l, price: parseFloat(e.target.value) || 0 } : l
                                  ),
                                }));
                              }}
                              placeholder="Price"
                              className="flex-1 md:flex-none md:w-28 px-2 py-1.5 md:py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                            />
                          )}

                          {/* Reaction select */}
                          <select
                            value={level.reaction || ''}
                            onChange={(e) => {
                              setFormData((prev) => ({
                                ...prev,
                                levelSequence: prev.levelSequence.map((l, i) =>
                                  i === index ? { ...l, reaction: (e.target.value || null) as LevelReaction } : l
                                ),
                              }));
                            }}
                            className="flex-1 md:flex-none md:min-w-[90px] px-2 py-1.5 md:py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                          >
                            <option value="">Reaction</option>
                            <option value="bounced">Bounced</option>
                            <option value="front_run">Front-run</option>
                            <option value="swept_then_bounced">Swept+bounced</option>
                            <option value="broken">Broken</option>
                          </select>
                        </div>
                      </div>

                      {/* Zone-only: Deepest price row */}
                      {isZone && level.priceFar && (
                        <div className="flex items-center gap-2 mt-2 ml-7 pl-2 border-l-2 border-gray-600">
                          <span className="text-xs text-gray-400 w-20">Deepest price:</span>
                          <input
                            type="number"
                            step="any"
                            value={level.deepestPrice || ''}
                            onChange={(e) => {
                              const deepest = parseFloat(e.target.value) || null;
                              // For high_low zones, use rangeConsumedPercent; for near_far zones, use penetrationPercent
                              const updatedLevel = { ...level, deepestPrice: deepest };
                              const newPenetration = isHighLowZoneType(level.levelType)
                                ? getRangeConsumedPercent(updatedLevel)
                                : calculatePenetrationPercent(level.price, level.priceFar!, deepest);
                              setFormData((prev) => ({
                                ...prev,
                                levelSequence: prev.levelSequence.map((l, i) =>
                                  i === index ? {
                                    ...l,
                                    deepestPrice: deepest,
                                    penetrationPercent: newPenetration,
                                  } : l
                                ),
                              }));
                            }}
                            placeholder="Deepest in zone"
                            className="w-28 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                          />
                          {penetration !== null && (
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              penetration >= 75 ? 'bg-red-500/20 text-red-400' :
                              penetration >= 50 ? 'bg-orange-500/20 text-orange-400' :
                              penetration >= 25 ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-green-500/20 text-green-400'
                            }`}>
                              {penetration}% {isHighLowZoneType(level.levelType) ? 'consumed' : 'penetrated'}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Turn price row - shown for front_run or swept_then_bounced on line levels */}
                      {(level.reaction === 'front_run' || (level.reaction === 'swept_then_bounced' && !isZone)) && (
                        <div className="flex items-center gap-2 mt-2 ml-7 pl-2 border-l-2 border-amber-600/50">
                          <span className="text-xs text-amber-400 w-20">Turn price:</span>
                          <input
                            type="number"
                            step="any"
                            value={level.turnPrice || ''}
                            onChange={(e) => {
                              const turnPrice = parseFloat(e.target.value) || null;
                              setFormData((prev) => ({
                                ...prev,
                                levelSequence: prev.levelSequence.map((l, i) =>
                                  i === index ? { ...l, turnPrice } : l
                                ),
                              }));
                            }}
                            placeholder={level.reaction === 'front_run' ? 'Where price turned' : 'Sweep extreme'}
                            className="w-28 px-2 py-1 bg-gray-700 border border-amber-600/50 rounded text-white text-sm"
                          />
                          <span className="text-xs text-gray-500">
                            {level.reaction === 'front_run'
                              ? 'Where price actually turned, short of this level'
                              : 'How far through the level price swept before turning'}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {formData.levelSequence.length === 0 && (
              <div className="text-center py-4 text-gray-500 text-sm border border-dashed border-gray-700 rounded-lg">
                No levels added. Click "Add Level" to track price interaction at key levels.
              </div>
            )}
          </div>

          {/* Context Tags */}
          <div className="relative border-t border-gray-700 pt-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">Context Tags</label>
            <div className="flex flex-wrap gap-1.5 p-2 bg-gray-700 border border-gray-600 rounded-lg min-h-[42px]">
              {formData.contextTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-sm"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeContextTag(tag)}
                    className="hover:text-blue-200"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={contextTagInput}
                onChange={(e) => {
                  setContextTagInput(e.target.value);
                  setShowContextTagSuggestions(true);
                }}
                onFocus={() => setShowContextTagSuggestions(true)}
                onBlur={() => setTimeout(() => setShowContextTagSuggestions(false), 200)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addContextTag(contextTagInput);
                  }
                }}
                className="flex-1 min-w-[150px] bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                placeholder={formData.contextTags.length === 0 ? 'Type to search or add tags...' : ''}
              />
            </div>
            {showContextTagSuggestions && filteredContextTags.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filteredContextTags.slice(0, 15).map((tag) => (
                  <button
                    key={tag.name}
                    type="button"
                    onClick={() => addContextTag(tag.name)}
                    className="w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-600 text-sm flex items-center gap-2"
                  >
                    <span>{tag.name}</span>
                    {tag.description && (
                      <span className="text-gray-400 text-xs truncate">- {tag.description}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">Tag every technical factor present at entry</p>
          </div>

          {/* Entry TF & Confirmation */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 border-t border-gray-700 pt-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Entry TF</label>
              <select
                value={formData.entryTF}
                onChange={(e) => handleChange('entryTF', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select...</option>
                {TIMEFRAMES.map((tf) => (
                  <option key={tf.value} value={tf.value}>
                    {tf.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Entry Confirmation</label>
              <select
                value={formData.entryConfirmation}
                onChange={(e) => handleChange('entryConfirmation', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ENTRY_CONFIRMATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {(formData.entryConfirmation === 'structural' || formData.entryConfirmation === 'partial_confirmation') && (
              <div className="relative">
                <label className="block text-sm font-medium text-gray-300 mb-1">Confirmation TF</label>
                <input
                  type="text"
                  value={showConfirmationTfSuggestions ? (confirmationTfInput || formData.confirmationTF) : formData.confirmationTF}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setConfirmationTfInput(newValue);
                    handleChange('confirmationTF', newValue);
                    setShowConfirmationTfSuggestions(true);
                  }}
                  onFocus={() => {
                    setConfirmationTfInput(formData.confirmationTF);
                    setShowConfirmationTfSuggestions(true);
                  }}
                  onBlur={() => {
                    const normalized = normalizeLevelTimeframe(formData.confirmationTF);
                    if (normalized !== formData.confirmationTF) {
                      handleChange('confirmationTF', normalized);
                    }
                    setTimeout(() => setShowConfirmationTfSuggestions(false), 200);
                  }}
                  placeholder="e.g. M5, H1"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {showConfirmationTfSuggestions && getFilteredConfirmationTFs().length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {getFilteredConfirmationTFs().map((tf) => (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => selectConfirmationTF(tf)}
                        className="w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-600 text-sm"
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Entry Notes */}
          <div className="border-t border-gray-700 pt-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">Entry Notes</label>
            <textarea
              value={formData.entryNotes}
              onChange={(e) => handleChange('entryNotes', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Thesis and plan as you execute - why this trade, what's the plan?"
            />
          </div>
        </div>
      </FormSection>

      {/* Section 4: Timeline */}
      <FormSection title="Timeline" defaultOpen={formData.timeline.length > 0}>
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Unified timeline for price events during the trade: worst/best price, stop moves, liquidity sweeps, etc.
          </p>

          {/* Quick-add buttons for timeline events */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-gray-500 self-center">Quick add:</span>
            <button
              type="button"
              onClick={() => {
                setNewEventType('trade_low');
                setEventTypeInput('');
              }}
              className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded"
            >
              Trade Low
            </button>
            <button
              type="button"
              onClick={() => {
                setNewEventType('trade_high');
                setEventTypeInput('');
              }}
              className="px-2 py-1 text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded"
            >
              Trade High
            </button>
            <button
              type="button"
              onClick={() => {
                setNewEventType('stop_moved');
                setEventTypeInput('');
              }}
              className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded"
            >
              Stop Moved
            </button>
          </div>

          {/* Timeline events list */}
          {formData.timeline.length > 0 && (
            <div className="space-y-2">
              {formData.timeline.map((event, index) => (
                <div key={event.id} className="flex items-center gap-2 p-2 bg-gray-750 rounded-lg">
                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => reorderTimelineEvent(index, 'up')}
                      className={`p-0.5 rounded ${index === 0 ? 'text-gray-600' : 'text-gray-400 hover:text-white hover:bg-gray-600'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      disabled={index === formData.timeline.length - 1}
                      onClick={() => reorderTimelineEvent(index, 'down')}
                      className={`p-0.5 rounded ${index === formData.timeline.length - 1 ? 'text-gray-600' : 'text-gray-400 hover:text-white hover:bg-gray-600'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  <span className="text-xs text-gray-500 w-4">{event.order}</span>

                  {/* Event type badge - clickable for inline editing */}
                  {editingEventTypeId === event.id ? (
                    <div className="relative w-32">
                      <input
                        type="text"
                        autoFocus
                        value={inlineEventTypeInput}
                        onChange={(e) => {
                          setInlineEventTypeInput(e.target.value);
                          setShowInlineEventTypeSuggestions(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            finishEditingEventType(event.id, inlineEventTypeInput);
                          } else if (e.key === 'Escape') {
                            cancelEditingEventType();
                          }
                        }}
                        onBlur={() => setTimeout(() => {
                          if (editingEventTypeId === event.id) {
                            finishEditingEventType(event.id, inlineEventTypeInput);
                          }
                        }, 200)}
                        className="w-full px-2 py-0.5 bg-gray-700 border border-blue-500 rounded text-white text-xs"
                      />
                      {showInlineEventTypeSuggestions && getInlineFilteredEventTypes(event.eventType).length > 0 && (
                        <div className="absolute z-30 w-48 mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {getInlineFilteredEventTypes(event.eventType).map((et) => (
                            <button
                              key={et}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                finishEditingEventType(event.id, et);
                              }}
                              className="w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-600 text-sm"
                            >
                              {formatEventTypeLabel(et)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditingEventType(event.id, event.eventType)}
                      className={`px-2 py-0.5 text-xs rounded cursor-pointer hover:ring-1 hover:ring-blue-400 transition-all ${
                        event.eventType === 'trade_low' || event.eventType === 'post_exit_low' ? 'bg-red-500/20 text-red-400' :
                        event.eventType === 'trade_high' || event.eventType === 'post_exit_high' ? 'bg-green-500/20 text-green-400' :
                        event.eventType === 'stop_moved' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-gray-600 text-gray-300'
                      }`}
                      title="Click to edit event type"
                    >
                      {formatEventTypeLabel(event.eventType)}
                    </button>
                  )}

                  {/* Price */}
                  <input
                    type="number"
                    step="any"
                    value={event.price ?? ''}
                    onChange={(e) => updateTimelineEvent(event.id, 'price', e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="Price"
                    className="w-24 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />

                  {/* Time (optional) */}
                  <input
                    type="datetime-local"
                    value={event.time || ''}
                    onChange={(e) => updateTimelineEvent(event.id, 'time', e.target.value || null)}
                    className="w-40 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />

                  {/* Description */}
                  <input
                    type="text"
                    value={event.description}
                    onChange={(e) => updateTimelineEvent(event.id, 'description', e.target.value)}
                    placeholder="Note"
                    className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => removeTimelineEvent(event.id)}
                    className="p-1 text-gray-400 hover:text-red-400"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new event row */}
          <div className="border-t border-gray-700 pt-4">
            <p className="text-sm font-medium text-gray-300 mb-2">Add Event</p>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {/* Event type */}
              <div className="relative md:col-span-1">
                <input
                  type="text"
                  value={showEventTypeSuggestions ? eventTypeInput : newEventType}
                  onChange={(e) => {
                    setEventTypeInput(e.target.value);
                    setNewEventType(e.target.value);
                    setShowEventTypeSuggestions(true);
                  }}
                  onFocus={() => {
                    setEventTypeInput(newEventType);
                    setShowEventTypeSuggestions(true);
                  }}
                  onBlur={() => setTimeout(() => setShowEventTypeSuggestions(false), 200)}
                  placeholder="Event type"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                />
                {showEventTypeSuggestions && getFilteredEventTypes().length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {getFilteredEventTypes().map((et) => (
                      <button
                        key={et}
                        type="button"
                        onClick={() => {
                          setNewEventType(et);
                          setEventTypeInput('');
                          setShowEventTypeSuggestions(false);
                        }}
                        className="w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-600 text-sm"
                      >
                        {et.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Price */}
              <input
                type="number"
                step="any"
                value={newEventPrice}
                onChange={(e) => setNewEventPrice(e.target.value)}
                placeholder="Price"
                className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
              />

              {/* Time (optional) */}
              <input
                type="datetime-local"
                value={newEventTime}
                onChange={(e) => setNewEventTime(e.target.value)}
                className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
              />

              {/* Description */}
              <input
                type="text"
                value={newEventDescription}
                onChange={(e) => setNewEventDescription(e.target.value)}
                placeholder="Description (optional)"
                className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
              />

              {/* Add button */}
              <button
                type="button"
                onClick={addTimelineEvent}
                disabled={!newEventType.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-400 text-white text-sm rounded-lg"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </FormSection>

      {/* Section 5: Exits */}
      <FormSection title="Exits" defaultOpen={formData.exits.length > 0}>
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-300">Exit Records</label>
            <button
              type="button"
              onClick={addExit}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              + Add Exit
            </button>
          </div>

          {formData.exits.length > 0 ? (
            <div className="space-y-3">
              {formData.exits.map((exit, exitIndex) => {
                const isLastExit = exitIndex === formData.exits.length - 1;
                const showDrawdownAfter = formData.exits.length > 1 && !isLastExit;

                // Sanity check for drawdownAfter - should be against trade direction
                const drawdownAfterWarning = (() => {
                  if (!showDrawdownAfter || exit.drawdownAfter == null || !exit.price) return null;
                  const direction = formData.direction;
                  // For a long, drawdown after partial exit means price went DOWN (below exit price)
                  // For a short, drawdown after partial exit means price went UP (above exit price)
                  if (direction === 'long' && exit.drawdownAfter > exit.price) {
                    return 'For a long, drawdown should be below this exit price';
                  }
                  if (direction === 'short' && exit.drawdownAfter < exit.price) {
                    return 'For a short, drawdown should be above this exit price';
                  }
                  return null;
                })();

                return (
                  <div key={exit.id} className="p-3 bg-gray-750 rounded-lg">
                    <div className="grid grid-cols-2 gap-2 md:flex md:gap-2 md:items-start md:flex-wrap">
                      <div className="col-span-1 md:w-28">
                        <label className="block text-xs text-gray-400 mb-1">Price</label>
                        <input
                          type="number"
                          step="any"
                          value={exit.price || ''}
                          onChange={(e) => updateExit(exit.id, 'price', parseFloat(e.target.value) || 0)}
                          placeholder="Exit price"
                          className={`w-full px-2 py-2 md:py-1.5 bg-gray-700 border rounded text-white text-sm ${
                            warnings.exitWarnings?.[exit.id] ? 'border-yellow-500' : 'border-gray-600'
                          }`}
                        />
                        {warnings.exitWarnings?.[exit.id] && (
                          <p className="text-yellow-400 text-xs mt-1">{warnings.exitWarnings[exit.id]}</p>
                        )}
                      </div>
                      <div className="col-span-1 md:w-24">
                        <label className="block text-xs text-gray-400 mb-1">Size</label>
                        <input
                          type="number"
                          step="any"
                          value={exit.size || ''}
                          onChange={(e) => updateExit(exit.id, 'size', parseFloat(e.target.value) || 0)}
                          placeholder="Lots"
                          className="w-full px-2 py-2 md:py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                        />
                      </div>
                      <div className="col-span-2 md:w-44">
                        <label className="block text-xs text-gray-400 mb-1">Time</label>
                        <input
                          type="datetime-local"
                          value={exit.time instanceof Date ? toLocalDateTimeString(exit.time) : ''}
                          onChange={(e) => updateExit(exit.id, 'time', new Date(e.target.value))}
                          className="w-full px-2 py-2 md:py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                        />
                      </div>
                      <div className="col-span-1 md:w-36">
                        <label className="block text-xs text-gray-400 mb-1">Type</label>
                        <select
                          value={exit.type}
                          onChange={(e) => updateExit(exit.id, 'type', e.target.value)}
                          className="w-full px-2 py-2 md:py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                        >
                          {EXIT_TYPES.map((et) => (
                            <option key={et.value} value={et.value}>
                              {et.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-1 md:flex-1 md:min-w-[120px] flex items-end gap-2">
                        <div className="flex-1">
                          <label className="block text-xs text-gray-400 mb-1">Reason</label>
                          <input
                            type="text"
                            value={exit.reason || ''}
                            onChange={(e) => updateExit(exit.id, 'reason', e.target.value)}
                            placeholder="Optional"
                            className="w-full px-2 py-2 md:py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeExit(exit.id)}
                          className="p-2 md:p-1.5 text-red-400 hover:text-red-300 shrink-0"
                        >
                          <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Drawdown After - only shown on non-final exits when multiple exits exist */}
                    {showDrawdownAfter && (
                      <div className="mt-2 pt-2 border-t border-gray-700">
                        <div className="flex items-center gap-2">
                          <div className="w-32">
                            <label className="block text-xs text-gray-400 mb-1">Drawdown After</label>
                            <input
                              type="number"
                              step="any"
                              value={exit.drawdownAfter ?? ''}
                              onChange={(e) => updateExit(exit.id, 'drawdownAfter', e.target.value ? parseFloat(e.target.value) : null)}
                              placeholder="Worst price"
                              className={`w-full px-2 py-1.5 bg-gray-700 border rounded text-white text-sm ${
                                drawdownAfterWarning ? 'border-yellow-500' : 'border-gray-600'
                              }`}
                            />
                          </div>
                          <p className="text-xs text-gray-500 flex-1">
                            Worst price between this exit and the next
                          </p>
                        </div>
                        {drawdownAfterWarning && (
                          <p className="text-yellow-400 text-xs mt-1">{drawdownAfterWarning}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No exits recorded - trade is open</p>
          )}

          {/* Exit Summary */}
          {formData.exits.length > 0 && (
            <div className="p-3 bg-gray-750 rounded-lg">
              <h4 className="text-sm font-medium text-gray-300 mb-2">Exit Summary</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-400">Avg Exit Price:</span>
                  <div className="text-white">{calculated.exitPrice?.toFixed(5) ?? '-'}</div>
                </div>
                <div>
                  <span className="text-gray-400">Total Size Exited:</span>
                  <div className={`${
                    calculated.totalExitSize !== parseFloat(formData.positionSize)
                      ? 'text-amber-400'
                      : 'text-white'
                  }`}>
                    {calculated.totalExitSize}
                    {calculated.totalExitSize !== parseFloat(formData.positionSize) && (
                      <span className="text-xs ml-1">(position: {formData.positionSize})</span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-gray-400">Gross P&L:</span>
                  <div className={calculated.pnl !== undefined ? (calculated.pnl >= 0 ? 'text-green-400' : 'text-red-400') : 'text-white'}>
                    {calculated.pnl !== undefined ? `$${calculated.pnl.toFixed(2)}` : '-'}
                  </div>
                </div>
                <div>
                  <span className="text-gray-400">R-Multiple:</span>
                  <div className={calculated.rMultiple !== undefined ? (calculated.rMultiple >= 0 ? 'text-green-400' : 'text-red-400') : 'text-white'}>
                    {calculated.rMultiple !== undefined ? `${calculated.rMultiple >= 0 ? '+' : ''}${calculated.rMultiple}R` : '-'}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Status: <span className={`font-medium ${
                  calculated.status === 'closed' ? 'text-green-400' :
                  calculated.status === 'partial' ? 'text-amber-400' : 'text-gray-400'
                }`}>{calculated.status}</span>
              </div>
            </div>
          )}

          {/* Close Notes */}
          <div className="border-t border-gray-700 pt-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">Close Notes</label>
            <textarea
              value={formData.closeNotes}
              onChange={(e) => handleChange('closeNotes', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Immediate review as the trade closes - how did it play out, how did you manage it?"
            />
          </div>
        </div>
      </FormSection>

      {/* Section 6: Screenshots */}
      <FormSection title="Screenshots" defaultOpen={formData.screenshots.length > 0}>
        <div className="space-y-4">
          {/* URL Input */}
          <div className="flex gap-2">
            <input
              type="url"
              value={screenshotUrlInput}
              onChange={(e) => setScreenshotUrlInput(e.target.value)}
              placeholder="https://www.tradingview.com/x/..."
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={addScreenshotUrl}
              disabled={!screenshotUrlInput.trim() || (!screenshotUrlInput.startsWith('http://') && !screenshotUrlInput.startsWith('https://'))}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
            >
              Add
            </button>
          </div>
          <input
            type="text"
            value={screenshotCaptionInput}
            onChange={(e) => setScreenshotCaptionInput(e.target.value)}
            placeholder="Optional caption..."
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500">
            Paste TradingView snapshot URLs or any image URL
          </p>

          {/* Screenshot previews */}
          {formData.screenshots.length > 0 && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
              {formData.screenshots.filter(s => s.url).map((screenshot) => (
                <div key={screenshot.id} className="relative group">
                  <img
                    src={screenshot.url}
                    alt={screenshot.caption || 'Screenshot'}
                    className="w-full h-32 object-cover rounded-lg bg-gray-700"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const fallback = target.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <div className="hidden w-full h-32 bg-gray-700 rounded-lg items-center justify-center text-gray-400 text-xs p-2 text-center">
                    <a href={screenshot.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 underline break-all">
                      {screenshot.url.length > 50 ? screenshot.url.substring(0, 50) + '...' : screenshot.url}
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeScreenshot(screenshot.id)}
                    className="absolute top-2 right-2 p-1 bg-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <input
                    type="text"
                    value={screenshot.caption}
                    onChange={(e) => updateScreenshotCaption(screenshot.id, e.target.value)}
                    placeholder="Add caption..."
                    className="mt-2 w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </FormSection>

      {/* Section 7: Post-Exit Review - Only for editing closed trades */}
      {isEditMode && calculated.status === 'closed' && (
        <FormSection title="Post-Exit Review" defaultOpen={!existingReviewedAt}>
          <div className="space-y-4">
            {!existingReviewedAt && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
                <p className="text-blue-400 text-sm">
                  Review your trade 3 days after closing. Did price reach your target? What would you do differently?
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Did price reach your target after you exited?
              </label>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => handleChange('reachedTargetPostExit', true)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    formData.reachedTargetPostExit === true
                      ? 'bg-red-500/30 text-red-400 ring-2 ring-red-500'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => handleChange('reachedTargetPostExit', false)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    formData.reachedTargetPostExit === false
                      ? 'bg-green-500/30 text-green-400 ring-2 ring-green-500'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  No
                </button>
                {formData.reachedTargetPostExit !== null && (
                  <button
                    type="button"
                    onClick={() => handleChange('reachedTargetPostExit', null)}
                    className="px-4 py-2 rounded-lg font-medium bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Post-Exit Reflection
              </label>
              <textarea
                value={formData.postExitNotes}
                onChange={(e) => handleChange('postExitNotes', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Review this trade 3 days after closing. What happened? What would you do differently?"
              />
            </div>

            {existingReviewedAt && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                First reviewed on {new Date(existingReviewedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </div>
            )}
          </div>
        </FormSection>
      )}

      {/* Form Actions */}
      <div className="flex gap-4 pt-4">
        <button
          type="button"
          onClick={() => navigate(isEditMode ? `/trades/${id}` : '/trades')}
          className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
        >
          {isSubmitting ? 'Saving...' : isEditMode ? 'Update Trade' : 'Save Trade'}
        </button>
      </div>

      {/* Add Strategy Modal */}
      {showAddStrategy && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-medium text-white mb-4">Add New Strategy</h3>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Strategy Name</label>
              <input
                type="text"
                value={newStrategyName}
                onChange={(e) => setNewStrategyName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddStrategy();
                  }
                }}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Breakout Scalp"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                You can add description and rules later in Settings.
              </p>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowAddStrategy(false);
                  setNewStrategyName('');
                }}
                disabled={isAddingStrategy}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddStrategy}
                disabled={isAddingStrategy || !newStrategyName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
              >
                {isAddingStrategy ? 'Adding...' : 'Add Strategy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
