import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { FormSection } from '../../components/FormSection';
import { db } from '../../db';
import { useAppStore } from '../../stores/appStore';
import { createScreenshotUrl } from '../../utils/screenshotHelpers';
import type {
  TradeFormData,
  TradeRecord,
  AssetClass,
  Timeframe,
  HTFBias,
  MarketCondition,
  ConfidenceLevel,
  ExitType,
  EmotionalState,
  TradeExit,
  StopAdjustment,
  Screenshot,
  Account,
  Strategy,
} from '../../types';
import {
  deriveSession,
  calculateStopDistance,
  calculatePlannedRR,
  calculateActualRR,
  calculateRMultiple,
  calculateTotalExitsPnl,
  calculateNetPnl,
  calculateHoldDuration,
  formatDuration,
  validateStopLoss,
  parseLocalDateTime,
  getCurrentDateTimeString,
  toLocalDateTimeString,
  isPostExitReviewComplete,
} from '../../utils';

// Initial form state
const getInitialFormData = (): TradeFormData => ({
  pair: '',
  assetClass: 'forex',
  direction: 'long',
  entryTime: getCurrentDateTimeString(),
  exitTime: '',
  entryPrice: '',
  stopLoss: '',
  targetPrice: '',
  maePrice: '',
  mfePrice: '',
  positionSize: '',
  riskAmount: '',
  riskPercent: '',
  exits: [],
  stopAdjustments: [],
  setupTags: [],
  analysisTF: '',
  entryTF: '',
  htfBias: '',
  marketCondition: '',
  tradeTaken: true,
  notTakenReason: '',
  emotionalState: null,
  confidenceLevel: '',
  followedPlan: true,
  planDeviation: '',
  isRevengeTrade: false,
  isOverTrade: false,
  preTradeNotes: '',
  postTradeNotes: '',
  screenshots: [],
  tags: [],
  commissions: '',
  swap: '',
  accountId: '', // Will be set to default account's ID on load
  strategyId: '', // Will be set to default strategy's ID on load
  postExitBestPrice: '',
  postExitWorstPrice: '',
  reachedTargetPostExit: null,
  postExitNotes: '',
});

// Pre-seeded reasons for not taking a trade (autocomplete suggestions)
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
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1H', label: '1H' },
  { value: '4H', label: '4H' },
  { value: 'D1', label: 'D1' },
  { value: 'W1', label: 'W1' },
  { value: 'M1', label: 'M1' },
];

const HTF_BIASES: { value: HTFBias; label: string }[] = [
  { value: 'bullish', label: 'Bullish' },
  { value: 'bearish', label: 'Bearish' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'ranging', label: 'Ranging' },
];

const MARKET_CONDITIONS: { value: MarketCondition; label: string }[] = [
  { value: 'trending', label: 'Trending' },
  { value: 'ranging', label: 'Ranging' },
  { value: 'volatile', label: 'Volatile' },
  { value: 'choppy', label: 'Choppy' },
  { value: 'breakout', label: 'Breakout' },
  { value: 'reversal', label: 'Reversal' },
];

const EXIT_TYPES: { value: ExitType; label: string }[] = [
  { value: 'tp_hit', label: 'TP Hit' },
  { value: 'sl_hit', label: 'SL Hit' },
  { value: 'manual_close', label: 'Manual Close' },
  { value: 'trail_stop_hit', label: 'Trail Stop Hit' },
  { value: 'be_stop_hit', label: 'BE Stop Hit' },
  { value: 'time_exit', label: 'Time Exit' },
];

const EMOTIONAL_STATES: { value: EmotionalState; emoji: string; label: string }[] = [
  { value: 1, emoji: '😰', label: 'Very Anxious' },
  { value: 2, emoji: '😟', label: 'Anxious' },
  { value: 3, emoji: '😐', label: 'Neutral' },
  { value: 4, emoji: '😊', label: 'Confident' },
  { value: 5, emoji: '🤩', label: 'Very Confident' },
];

const CONFIDENCE_LEVELS: { value: ConfidenceLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

// Default setup tag suggestions (shown if no prior tags exist)
// Tags will be learned from previous trades - no hardcoded defaults
const DEFAULT_SETUP_TAGS: string[] = [];

interface ValidationErrors {
  pair?: string;
  direction?: string;
  entryPrice?: string;
  stopLoss?: string;
  entryTime?: string;
}

interface ValidationWarnings {
  riskPercent?: string;
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
  const [quickLogMode, setQuickLogMode] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [warnings, setWarnings] = useState<ValidationWarnings>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(isEditMode);
  const [previousPairs, setPreviousPairs] = useState<string[]>([]);
  const [previousSetupTags, setPreviousSetupTags] = useState<string[]>([]);
  const [tagDescriptions, setTagDescriptions] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState('');
  const [setupTagInput, setSetupTagInput] = useState('');
  const [showPairSuggestions, setShowPairSuggestions] = useState(false);
  const [showSetupTagSuggestions, setShowSetupTagSuggestions] = useState(false);

  // Accounts and strategies
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);

  // Add strategy modal
  const [showAddStrategy, setShowAddStrategy] = useState(false);
  const [newStrategyName, setNewStrategyName] = useState('');
  const [isAddingStrategy, setIsAddingStrategy] = useState(false);

  // Screenshot blob URLs for display (created from stored Blobs)
  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({});

  // Create blob URLs for screenshots and clean up on unmount
  useEffect(() => {
    const newUrls: Record<string, string> = {};

    for (const screenshot of formData.screenshots) {
      // Skip if we already have a URL for this screenshot
      if (screenshotUrls[screenshot.id]) {
        newUrls[screenshot.id] = screenshotUrls[screenshot.id];
        continue;
      }

      // Use utility function to safely create URL (handles Blob, Uint8Array, ArrayBuffer, base64)
      const url = createScreenshotUrl(screenshot);
      if (url) {
        newUrls[screenshot.id] = url;
      }
    }

    // Revoke URLs for removed screenshots (only blob: URLs, not base64)
    for (const [id, url] of Object.entries(screenshotUrls)) {
      if (!newUrls[id] && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }

    setScreenshotUrls(newUrls);

    // Cleanup all blob URLs on unmount
    return () => {
      for (const url of Object.values(newUrls)) {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.screenshots]);

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
            exitTime: trade.exitTime ? toLocalDateTimeString(new Date(trade.exitTime)) : '',
            entryPrice: String(trade.entryPrice),
            stopLoss: String(trade.stopLoss),
            targetPrice: trade.targetPrice ? String(trade.targetPrice) : '',
            maePrice: trade.maePrice != null ? String(trade.maePrice) : '',
            mfePrice: trade.mfePrice != null ? String(trade.mfePrice) : '',
            positionSize: String(trade.positionSize),
            riskAmount: trade.riskAmount ? String(trade.riskAmount) : '',
            riskPercent: trade.riskPercent ? String(trade.riskPercent) : '',
            exits: trade.exits || [],
            stopAdjustments: trade.stopAdjustments || [],
            setupTags: trade.setupTags || [],
            analysisTF: trade.analysisTF || '',
            entryTF: trade.entryTF || '',
            htfBias: trade.htfBias || '',
            marketCondition: trade.marketCondition || '',
            tradeTaken: trade.tradeTaken ?? true,
            notTakenReason: trade.notTakenReason || '',
            emotionalState: trade.emotionalState ?? null,
            confidenceLevel: trade.confidenceLevel || '',
            followedPlan: trade.followedPlan ?? true,
            planDeviation: trade.planDeviation || '',
            isRevengeTrade: trade.isRevengeTrade ?? false,
            isOverTrade: trade.isOverTrade ?? false,
            preTradeNotes: trade.preTradeNotes || '',
            postTradeNotes: trade.postTradeNotes || '',
            screenshots: trade.screenshots || [],
            tags: trade.tags || [],
            commissions: trade.commissions ? String(trade.commissions) : '',
            swap: trade.swap ? String(trade.swap) : '',
            accountId: trade.accountId,
            strategyId: trade.strategyId,
            postExitBestPrice: trade.postExitBestPrice != null ? String(trade.postExitBestPrice) : '',
            postExitWorstPrice: trade.postExitWorstPrice != null ? String(trade.postExitWorstPrice) : '',
            reachedTargetPostExit: trade.reachedTargetPostExit ?? null,
            postExitNotes: trade.postExitNotes || '',
          });
          setOriginalStopLoss(trade.originalStopLoss);
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

  // Load previously used pairs, setups, accounts and strategies
  useEffect(() => {
    const loadSuggestions = async () => {
      const trades = await db.trades.toArray();
      const pairs = [...new Set(trades.map((t) => t.pair))].filter(Boolean);
      // Collect all unique setup tags from all trades
      const allTags = trades.flatMap((t) => t.setupTags || []);
      const uniqueTags = [...new Set(allTags)].filter(Boolean);
      setPreviousPairs(pairs);
      setPreviousSetupTags(uniqueTags);

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

  // Auto-calculated values derived from exits
  const calculated = useMemo(() => {
    const entryPrice = parseFloat(formData.entryPrice) || 0;
    const stopLoss = parseFloat(formData.stopLoss) || 0;
    const targetPrice = formData.targetPrice ? parseFloat(formData.targetPrice) : undefined;
    const positionSize = parseFloat(formData.positionSize) || 0;
    const commissions = parseFloat(formData.commissions) || 0;
    const swap = parseFloat(formData.swap) || 0;
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

    // Derive exitType
    let exitType: string | undefined;
    if (exits.length === 1) {
      exitType = exits[0].type;
    } else if (exits.length > 1) {
      exitType = 'partial';
    }

    const session = entryTime ? deriveSession(entryTime) : 'other';
    const stopDistance = entryPrice && stopLoss ? calculateStopDistance(entryPrice, stopLoss) : undefined;
    const plannedRR = entryPrice && stopLoss ? calculatePlannedRR(entryPrice, stopLoss, targetPrice) : undefined;
    const actualRR = entryPrice && stopLoss ? calculateActualRR(entryPrice, stopLoss, exitPrice) : undefined;
    const rMultiple = entryPrice && stopLoss ? calculateRMultiple(entryPrice, stopLoss, exitPrice, formData.direction) : undefined;

    // Calculate P&L using R-based method (instrument-agnostic)
    const riskAmount = parseFloat(formData.riskAmount) || 0;
    let pnl: number | undefined;
    if (entryPrice && stopLoss && riskAmount && positionSize && exits.length > 0) {
      pnl = calculateTotalExitsPnl(
        entryPrice,
        stopLoss,
        riskAmount,
        positionSize,
        formData.direction,
        exits.map(e => ({ price: e.price, size: e.size }))
      );
    }
    const netPnl = calculateNetPnl(pnl, commissions, swap);
    const holdDuration = entryTime ? calculateHoldDuration(entryTime, exitTime) : undefined;

    return {
      session,
      status,
      exitType,
      exitPrice,
      exitTime,
      totalExitSize,
      stopDistance,
      plannedRR,
      actualRR,
      rMultiple,
      pnl,
      netPnl,
      holdDuration,
    };
  }, [formData]);

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

    // Stop loss validation
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

  // Handle stop adjustments
  const addStopAdjustment = () => {
    const newAdjustment: StopAdjustment = {
      id: uuidv4(),
      time: new Date(),
      newStop: 0,
      reason: '',
      trigger: '',
    };
    setFormData((prev) => ({
      ...prev,
      stopAdjustments: [...prev.stopAdjustments, newAdjustment],
    }));
  };

  const updateStopAdjustment = (id: string, field: keyof StopAdjustment, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      stopAdjustments: prev.stopAdjustments.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
    }));
  };

  const removeStopAdjustment = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      stopAdjustments: prev.stopAdjustments.filter((s) => s.id !== id),
    }));
  };

  // Pre-seeded autocomplete options for stop adjustments
  const STOP_ADJUSTMENT_REASONS = [
    'moved to BE',
    'below last support',
    'above last resistance',
    'trail behind structure',
    'trail behind EMA',
    'trail behind last swing',
  ];

  const STOP_ADJUSTMENT_TRIGGERS = [
    'TP1 hit',
    'new HH formed',
    'new HL formed',
    'time-based',
    'momentum shift',
  ];

  // Handle tags
  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !formData.tags.includes(tag)) {
      setFormData((prev) => ({ ...prev, tags: [...prev.tags, tag] }));
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  };

  // Handle screenshot paste - store Blob directly for Dexie persistence
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          // Store the Blob directly - Dexie handles binary data natively
          const newScreenshot: Screenshot = {
            id: uuidv4(),
            blob: file,
            caption: '',
            createdAt: new Date(),
          };
          setFormData((prev) => ({
            ...prev,
            screenshots: [...prev.screenshots, newScreenshot],
          }));
        }
      }
    }
  }, []);

  // Handle screenshot drop - store Blob directly for Dexie persistence
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        // Store the Blob directly - Dexie handles binary data natively
        const newScreenshot: Screenshot = {
          id: uuidv4(),
          blob: file,
          caption: '',
          createdAt: new Date(),
        };
        setFormData((prev) => ({
          ...prev,
          screenshots: [...prev.screenshots, newScreenshot],
        }));
      }
    }
  }, []);

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

  // Add paste listener
  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

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

      const id = await db.strategies.add(newStrategy as Strategy);
      // Reload strategies and select the new one
      const allStrategies = await db.strategies.toArray();
      setStrategies(allStrategies);
      handleChange('strategyId', id as string);
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

      // Parse MAE/MFE price levels
      const maePrice = formData.maePrice ? parseFloat(formData.maePrice) : null;
      const mfePrice = formData.mfePrice ? parseFloat(formData.mfePrice) : null;

      // Calculate MAE/MFE distances and R-multiples from price levels
      const stopDistance = calculated.stopDistance;
      let maeR: number | undefined;
      let mfeR: number | undefined;

      if (maePrice !== null && stopDistance) {
        const maeDistance = Math.abs(entryPrice - maePrice);
        maeR = maeDistance / stopDistance;
      }
      if (mfePrice !== null && stopDistance) {
        const mfeDistance = Math.abs(entryPrice - mfePrice);
        mfeR = mfeDistance / stopDistance;
      }

      // Build trade data without id for new trades (Dexie Cloud generates @id)
      const tradeData = {
        accountId: formData.accountId,
        strategyId: formData.strategyId,
        pair: formData.pair.trim().toUpperCase(),
        assetClass: formData.assetClass,
        direction: formData.direction,
        entryTime,
        exitTime: calculated.exitTime,
        status: calculated.status,
        entryPrice,
        stopLoss,
        targetPrice: formData.targetPrice ? parseFloat(formData.targetPrice) : undefined,
        exitPrice: calculated.exitPrice,
        positionSize: parseFloat(formData.positionSize) || 0,
        riskAmount: formData.riskAmount ? parseFloat(formData.riskAmount) : undefined,
        riskPercent: formData.riskPercent ? parseFloat(formData.riskPercent) : undefined,
        exits: formData.exits,
        exitType: calculated.exitType,
        stopAdjustments: formData.stopAdjustments,
        setupTags: formData.setupTags,
        analysisTF: formData.analysisTF || undefined,
        entryTF: formData.entryTF || undefined,
        htfBias: formData.htfBias || undefined,
        marketCondition: formData.marketCondition || undefined,
        tradeTaken: formData.tradeTaken,
        notTakenReason: !formData.tradeTaken ? formData.notTakenReason.trim() : '',
        emotionalState: formData.emotionalState ?? undefined,
        confidenceLevel: formData.confidenceLevel || undefined,
        followedPlan: formData.followedPlan,
        planDeviation: !formData.followedPlan ? formData.planDeviation.trim() : undefined,
        isRevengeTrade: formData.isRevengeTrade,
        isOverTrade: formData.isOverTrade,
        preTradeNotes: formData.preTradeNotes.trim() || undefined,
        postTradeNotes: formData.postTradeNotes.trim() || undefined,
        screenshots: formData.screenshots,
        tags: formData.tags,
        maePrice,
        mfePrice,
        maeR,
        mfeR,
        session: calculated.session,
        plannedRR: calculated.plannedRR,
        actualRR: calculated.actualRR,
        rMultiple: calculated.rMultiple,
        stopDistance: calculated.stopDistance,
        pnl: calculated.pnl,
        commissions: formData.commissions ? parseFloat(formData.commissions) : undefined,
        swap: formData.swap ? parseFloat(formData.swap) : undefined,
        netPnl: calculated.netPnl,
        holdDuration: calculated.holdDuration,
        // Preserve original stop loss on edit, set on first save for new trades
        originalStopLoss: isEditMode ? originalStopLoss : stopLoss,
        // Post-exit tracking fields
        postExitBestPrice: formData.postExitBestPrice ? parseFloat(formData.postExitBestPrice) : null,
        postExitWorstPrice: formData.postExitWorstPrice ? parseFloat(formData.postExitWorstPrice) : null,
        reachedTargetPostExit: formData.reachedTargetPostExit,
        postExitNotes: formData.postExitNotes.trim(),
        // Only set reviewedAt when ALL four post-exit fields are complete
        // If editing and fields are cleared, unset reviewedAt so trade reappears in review queue
        reviewedAt: isPostExitReviewComplete(
          formData.postExitBestPrice ? parseFloat(formData.postExitBestPrice) : null,
          formData.postExitWorstPrice ? parseFloat(formData.postExitWorstPrice) : null,
          formData.reachedTargetPostExit,
          formData.postExitNotes
        )
          ? (existingReviewedAt || now.toISOString())
          : null,
        createdAt: isEditMode ? createdAt! : now,
        updatedAt: now,
      };

      if (isEditMode) {
        // For edits, include the existing id
        await db.trades.put({ ...tradeData, id: id! } as TradeRecord);
        navigate(`/trades/${id}`);
      } else {
        // For new trades, let Dexie Cloud generate the id
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

  // Setup tag suggestions: use previous tags if available, otherwise defaults
  const availableSetupTags = previousSetupTags.length > 0 ? previousSetupTags : DEFAULT_SETUP_TAGS;
  const filteredSetupTags = availableSetupTags
    .filter((tag) => !formData.setupTags.includes(tag)) // Exclude already selected
    .filter((tag) => tag.toLowerCase().includes(setupTagInput.toLowerCase()))
    .map((tag) => ({ name: tag, description: tagDescriptions[tag] || '' }));

  // Add/remove setup tags
  const addSetupTag = (tag: string) => {
    const trimmedTag = tag.trim();
    if (trimmedTag && !formData.setupTags.includes(trimmedTag)) {
      setFormData((prev) => ({ ...prev, setupTags: [...prev.setupTags, trimmedTag] }));
    }
    setSetupTagInput('');
    setShowSetupTagSuggestions(false);
  };

  const removeSetupTag = (tag: string) => {
    setFormData((prev) => ({
      ...prev,
      setupTags: prev.setupTags.filter((t) => t !== tag),
    }));
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
      {/* Header with toggles */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">{isEditMode ? 'Edit Trade' : 'New Trade'}</h1>
        <div className="flex items-center gap-6">
          {/* Trade Taken toggle */}
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
          {/* Quick Log toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-gray-400">Quick Log</span>
            <button
              type="button"
              onClick={() => setQuickLogMode(!quickLogMode)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                quickLogMode ? 'bg-blue-600' : 'bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  quickLogMode ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </label>
        </div>
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

      {quickLogMode ? (
        /* Quick Log Mode - Minimal fields */
        <div className="space-y-4 bg-gray-800 rounded-lg p-6">
          <div className="grid grid-cols-2 gap-4">
            {/* Pair */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Pair <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.pair}
                onChange={(e) => handleChange('pair', e.target.value.toUpperCase())}
                className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.pair ? 'border-red-500' : 'border-gray-600'
                }`}
                placeholder="EUR/USD"
              />
              {errors.pair && <p className="text-red-400 text-xs mt-1">{errors.pair}</p>}
            </div>

            {/* Direction */}
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

          <div className="grid grid-cols-2 gap-4">
            {/* Entry Price */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Entry Price <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                step="any"
                value={formData.entryPrice}
                onChange={(e) => handleChange('entryPrice', e.target.value)}
                className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.entryPrice ? 'border-red-500' : 'border-gray-600'
                }`}
              />
              {errors.entryPrice && <p className="text-red-400 text-xs mt-1">{errors.entryPrice}</p>}
            </div>

            {/* Stop Loss */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Stop Loss <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                step="any"
                value={formData.stopLoss}
                onChange={(e) => handleChange('stopLoss', e.target.value)}
                className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.stopLoss ? 'border-red-500' : 'border-gray-600'
                }`}
              />
              {errors.stopLoss && <p className="text-red-400 text-xs mt-1">{errors.stopLoss}</p>}
            </div>
          </div>

          {/* Target Price and MAE/MFE */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Target</label>
              <input
                type="number"
                step="any"
                value={formData.targetPrice}
                onChange={(e) => handleChange('targetPrice', e.target.value)}
                placeholder="Target price"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1" title="Lowest price reached (longs) / highest price reached (shorts)">Worst Price</label>
              <input
                type="number"
                step="any"
                value={formData.maePrice}
                onChange={(e) => handleChange('maePrice', e.target.value)}
                placeholder="Worst price"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1" title="Best price reached in your favour">Best Price</label>
              <input
                type="number"
                step="any"
                value={formData.mfePrice}
                onChange={(e) => handleChange('mfePrice', e.target.value)}
                placeholder="Best price"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">P&L</label>
              <div
                className={`px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg ${
                  calculated.pnl !== undefined
                    ? calculated.pnl >= 0
                      ? 'text-green-400'
                      : 'text-red-400'
                    : 'text-gray-500'
                }`}
              >
                {calculated.pnl !== undefined ? calculated.pnl.toFixed(2) : '-'}
              </div>
            </div>
          </div>

          {/* Exits (collapsed by default) */}
          <details className="bg-gray-750 rounded-lg">
            <summary className="px-3 py-2 cursor-pointer text-sm font-medium text-gray-300 hover:text-white">
              Exits ({formData.exits.length}) {calculated.status !== 'open' && `- ${calculated.status}`}
            </summary>
            <div className="px-3 pb-3 space-y-2">
              {formData.exits.map((exit, index) => {
                const isLastExit = index === formData.exits.length - 1;
                const showDrawdownAfter = formData.exits.length > 1 && !isLastExit;

                return (
                  <div key={exit.id} className="space-y-1">
                    <div className="flex gap-2 items-center flex-wrap">
                      <input
                        type="number"
                        step="any"
                        value={exit.price || ''}
                        onChange={(e) => updateExit(exit.id, 'price', parseFloat(e.target.value) || 0)}
                        placeholder="Price"
                        className="w-24 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                      />
                      <input
                        type="number"
                        step="any"
                        value={exit.size || ''}
                        onChange={(e) => updateExit(exit.id, 'size', parseFloat(e.target.value) || 0)}
                        placeholder="Size"
                        className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                      />
                      <input
                        type="datetime-local"
                        value={exit.time instanceof Date ? toLocalDateTimeString(exit.time) : ''}
                        onChange={(e) => updateExit(exit.id, 'time', new Date(e.target.value))}
                        className="w-36 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                      />
                      <select
                        value={exit.type}
                        onChange={(e) => updateExit(exit.id, 'type', e.target.value)}
                        className="w-28 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                      >
                        {EXIT_TYPES.map((et) => (
                          <option key={et.value} value={et.value}>{et.label}</option>
                        ))}
                      </select>
                      {showDrawdownAfter && (
                        <input
                          type="number"
                          step="any"
                          value={exit.drawdownAfter ?? ''}
                          onChange={(e) => updateExit(exit.id, 'drawdownAfter', e.target.value ? parseFloat(e.target.value) : null)}
                          placeholder="DD After"
                          title="Worst price after this exit"
                          className="w-24 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => removeExit(exit.id)}
                        className="p-1 text-red-400 hover:text-red-300"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addExit}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                + Add Exit
              </button>
            </div>
          </details>

          {/* Setup Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Setup Tags</label>
            <div className="relative">
              <div className="flex flex-wrap gap-1 p-2 bg-gray-700 border border-gray-600 rounded-lg min-h-[42px]">
                {formData.setupTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-sm"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeSetupTag(tag)}
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
                  value={setupTagInput}
                  onChange={(e) => {
                    setSetupTagInput(e.target.value);
                    setShowSetupTagSuggestions(true);
                  }}
                  onFocus={() => setShowSetupTagSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSetupTagSuggestions(false), 200)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSetupTag(setupTagInput);
                    }
                  }}
                  className="flex-1 min-w-[120px] bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                  placeholder={formData.setupTags.length === 0 ? 'Add tags...' : ''}
                />
              </div>
              {showSetupTagSuggestions && filteredSetupTags.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {filteredSetupTags.slice(0, 10).map((tag) => (
                    <button
                      key={tag.name}
                      type="button"
                      onClick={() => addSetupTag(tag.name)}
                      className="w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-600 text-sm flex items-center gap-2"
                    >
                      <span>{tag.name}</span>
                      {tag.description && (
                        <span className="text-gray-400 text-xs truncate">— {tag.description}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">Tag every technical factor present at entry</p>
          </div>

          {/* Timeframes */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Analysis TF</label>
              <select
                value={formData.analysisTF}
                onChange={(e) => handleChange('analysisTF', e.target.value)}
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
          </div>

          {/* Account & Strategy */}
          <div className="grid grid-cols-2 gap-4">
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

          {/* Stop Adjustments (collapsed by default) */}
          <details className="bg-gray-750 rounded-lg">
            <summary className="px-3 py-2 cursor-pointer text-sm font-medium text-gray-300 hover:text-white">
              Stop Adjustments ({formData.stopAdjustments.length})
            </summary>
            <div className="px-3 pb-3 space-y-2">
              {formData.stopAdjustments.map((adj) => (
                <div key={adj.id} className="flex gap-2 items-start flex-wrap">
                  <input
                    type="datetime-local"
                    value={adj.time instanceof Date ? toLocalDateTimeString(adj.time) : ''}
                    onChange={(e) => updateStopAdjustment(adj.id, 'time', new Date(e.target.value))}
                    className="w-36 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                  />
                  <input
                    type="number"
                    step="any"
                    value={adj.newStop || ''}
                    onChange={(e) => updateStopAdjustment(adj.id, 'newStop', parseFloat(e.target.value) || 0)}
                    placeholder="New Stop"
                    className="w-24 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                  />
                  <input
                    type="text"
                    value={adj.reason}
                    onChange={(e) => updateStopAdjustment(adj.id, 'reason', e.target.value)}
                    placeholder="Reason"
                    list={`quick-reason-${adj.id}`}
                    className="flex-1 min-w-[100px] px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                  />
                  <datalist id={`quick-reason-${adj.id}`}>
                    {STOP_ADJUSTMENT_REASONS.map((r) => <option key={r} value={r} />)}
                  </datalist>
                  <button
                    type="button"
                    onClick={() => removeStopAdjustment(adj.id)}
                    className="p-1 text-red-400 hover:text-red-300"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addStopAdjustment}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                + Add Stop Adjustment
              </button>
            </div>
          </details>

          {/* Reason Not Taken (only shown when tradeTaken is false) */}
          {!formData.tradeTaken && (
            <div>
              <label className="block text-sm font-medium text-orange-400 mb-1">
                Reason Not Taken
              </label>
              <input
                type="text"
                value={formData.notTakenReason}
                onChange={(e) => handleChange('notTakenReason', e.target.value)}
                list="not-taken-reasons-quick"
                className="w-full px-3 py-2 bg-gray-700 border border-orange-500/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Why wasn't this trade taken?"
              />
              <datalist id="not-taken-reasons-quick">
                {NOT_TAKEN_REASONS.map((reason) => (
                  <option key={reason} value={reason} />
                ))}
              </datalist>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Notes</label>
            <textarea
              value={formData.postTradeNotes}
              onChange={(e) => handleChange('postTradeNotes', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Quick notes about this trade..."
            />
          </div>
        </div>
      ) : (
        /* Full Form Mode */
        <div className="space-y-4">
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
              {/* Account */}
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

              {/* Strategy */}
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
          </FormSection>

          {/* Section 2: Entry & Exit */}
          <FormSection title="Entry & Exit">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
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
                <label className="block text-sm font-medium text-gray-300 mb-1">Exit Time</label>
                <input
                  type="datetime-local"
                  value={formData.exitTime}
                  onChange={(e) => handleChange('exitTime', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Status</label>
                <div
                  className={`px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg ${
                    calculated.status === 'open' ? 'text-yellow-400' : 'text-green-400'
                  }`}
                >
                  {calculated.status.charAt(0).toUpperCase() + calculated.status.slice(1)}
                </div>
              </div>
            </div>

            {/* Auto-calculated: Session */}
            <div className="mt-4 flex items-center gap-4">
              <span className="text-sm text-gray-400">Session:</span>
              <span className="px-2 py-1 bg-gray-700 rounded text-sm text-gray-200">
                {calculated.session.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              </span>
              {calculated.holdDuration !== undefined && (
                <>
                  <span className="text-sm text-gray-400">Duration:</span>
                  <span className="px-2 py-1 bg-gray-700 rounded text-sm text-gray-200">
                    {formatDuration(calculated.holdDuration)}
                  </span>
                </>
              )}
            </div>
          </FormSection>

          {/* Section 3: Price Levels */}
          <FormSection title="Price Levels">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
                    errors.stopLoss ? 'border-red-500' : 'border-gray-600'
                  }`}
                />
                {errors.stopLoss && <p className="text-red-400 text-xs mt-1">{errors.stopLoss}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Target Price</label>
                <input
                  type="number"
                  step="any"
                  value={formData.targetPrice}
                  onChange={(e) => handleChange('targetPrice', e.target.value)}
                  placeholder="Primary profit target"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Primary profit target for planned R:R</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Worst Price</label>
                <input
                  type="number"
                  step="any"
                  value={formData.maePrice}
                  onChange={(e) => handleChange('maePrice', e.target.value)}
                  placeholder="Worst price reached"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Lowest price reached (longs) / highest price reached (shorts)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Best Price</label>
                <input
                  type="number"
                  step="any"
                  value={formData.mfePrice}
                  onChange={(e) => handleChange('mfePrice', e.target.value)}
                  placeholder="Best price reached"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Best price reached in your favour</p>
              </div>

              {/* Auto-derived exit price (read-only) */}
              {calculated.exitPrice !== undefined && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Avg Exit Price</label>
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300">
                    {calculated.exitPrice.toFixed(5)}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Derived from exits</p>
                </div>
              )}
            </div>

            {/* Auto-calculated fields */}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
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
              <div>
                <span className="text-xs text-gray-400">Actual R:R</span>
                <div className="text-sm text-gray-200">{calculated.actualRR ?? '-'}</div>
              </div>
              <div>
                <span className="text-xs text-gray-400">R-Multiple</span>
                <div
                  className={`text-sm ${
                    calculated.rMultiple !== undefined
                      ? calculated.rMultiple >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                      : 'text-gray-200'
                  }`}
                >
                  {calculated.rMultiple !== undefined ? `${calculated.rMultiple >= 0 ? '+' : ''}${calculated.rMultiple}R` : '-'}
                </div>
              </div>
            </div>
          </FormSection>

          {/* Section 4: Position Sizing */}
          <FormSection title="Position Sizing">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                {warnings.riskPercent && (
                  <p className="text-yellow-400 text-xs mt-1">{warnings.riskPercent}</p>
                )}
              </div>
            </div>

            {/* P&L calculations */}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Commissions</label>
                <input
                  type="number"
                  step="any"
                  value={formData.commissions}
                  onChange={(e) => handleChange('commissions', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Swap</label>
                <input
                  type="number"
                  step="any"
                  value={formData.swap}
                  onChange={(e) => handleChange('swap', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <span className="block text-sm font-medium text-gray-300 mb-1">Gross P&L</span>
                <div
                  className={`px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg ${
                    calculated.pnl !== undefined
                      ? calculated.pnl >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                      : 'text-gray-500'
                  }`}
                >
                  {calculated.pnl !== undefined ? `$${calculated.pnl.toFixed(2)}` : '-'}
                </div>
              </div>

              <div>
                <span className="block text-sm font-medium text-gray-300 mb-1">Net P&L</span>
                <div
                  className={`px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg ${
                    calculated.netPnl !== undefined
                      ? calculated.netPnl >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                      : 'text-gray-500'
                  }`}
                >
                  {calculated.netPnl !== undefined ? `$${calculated.netPnl.toFixed(2)}` : '-'}
                </div>
              </div>
            </div>
          </FormSection>

          {/* Section 5: Exits */}
          <FormSection title="Exits" defaultOpen={formData.exits.length > 0}>
            <div className="space-y-4">
              {/* Exits List */}
              <div>
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
                    {formData.exits.map((exit, index) => {
                      const isLastExit = index === formData.exits.length - 1;
                      const showDrawdownAfter = formData.exits.length > 1 && !isLastExit;

                      return (
                        <div key={exit.id} className="p-3 bg-gray-750 rounded-lg space-y-2">
                          <div className="flex gap-2 items-start flex-wrap">
                            <div className="w-28">
                              <label className="block text-xs text-gray-400 mb-1">Price</label>
                              <input
                                type="number"
                                step="any"
                                value={exit.price || ''}
                                onChange={(e) => updateExit(exit.id, 'price', parseFloat(e.target.value) || 0)}
                                placeholder="Exit price"
                                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                              />
                            </div>
                            <div className="w-24">
                              <label className="block text-xs text-gray-400 mb-1">Size</label>
                              <input
                                type="number"
                                step="any"
                                value={exit.size || ''}
                                onChange={(e) => updateExit(exit.id, 'size', parseFloat(e.target.value) || 0)}
                                placeholder="Lots"
                                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                              />
                            </div>
                            <div className="w-44">
                              <label className="block text-xs text-gray-400 mb-1">Time</label>
                              <input
                                type="datetime-local"
                                value={exit.time instanceof Date ? toLocalDateTimeString(exit.time) : ''}
                                onChange={(e) => updateExit(exit.id, 'time', new Date(e.target.value))}
                                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                              />
                            </div>
                            <div className="w-36">
                              <label className="block text-xs text-gray-400 mb-1">Type</label>
                              <select
                                value={exit.type}
                                onChange={(e) => updateExit(exit.id, 'type', e.target.value)}
                                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                              >
                                {EXIT_TYPES.map((et) => (
                                  <option key={et.value} value={et.value}>
                                    {et.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex-1 min-w-[120px]">
                              <label className="block text-xs text-gray-400 mb-1">Reason (optional)</label>
                              <input
                                type="text"
                                value={exit.reason || ''}
                                onChange={(e) => updateExit(exit.id, 'reason', e.target.value)}
                                placeholder="e.g., TP at S/R"
                                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeExit(exit.id)}
                              className="mt-5 p-1.5 text-red-400 hover:text-red-300"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                          {/* Drawdown After - only for non-final exits */}
                          {showDrawdownAfter && (
                            <div className="flex gap-2 items-end flex-wrap pt-1 border-t border-gray-700">
                              <div className="w-28">
                                <label className="block text-xs text-gray-400 mb-1">Drawdown After</label>
                                <input
                                  type="number"
                                  step="any"
                                  value={exit.drawdownAfter ?? ''}
                                  onChange={(e) => updateExit(exit.id, 'drawdownAfter', e.target.value ? parseFloat(e.target.value) : null)}
                                  placeholder="Worst price"
                                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                                />
                              </div>
                              <p className="text-xs text-gray-500 pb-1.5">Worst price after this exit before next</p>
                              {/* Auto-calculated drawdown metrics */}
                              {exit.drawdownAfter != null && exit.price && (
                                <div className="flex gap-4 text-xs text-gray-400 pb-1.5 ml-auto">
                                  <span>
                                    Drawdown: {Math.abs(exit.price - exit.drawdownAfter).toFixed(5)}
                                  </span>
                                  {parseFloat(formData.entryPrice) > 0 && (
                                    <>
                                      <span className={
                                        (formData.direction === 'long' && exit.drawdownAfter <= parseFloat(formData.entryPrice)) ||
                                        (formData.direction === 'short' && exit.drawdownAfter >= parseFloat(formData.entryPrice))
                                          ? 'text-amber-400' : ''
                                      }>
                                        {(formData.direction === 'long' && exit.drawdownAfter <= parseFloat(formData.entryPrice)) ||
                                         (formData.direction === 'short' && exit.drawdownAfter >= parseFloat(formData.entryPrice))
                                          ? '⚠ Reached Entry' : '✓ Above Entry'}
                                      </span>
                                      {exit.price !== parseFloat(formData.entryPrice) && (
                                        <span>
                                          {(Math.abs(exit.price - exit.drawdownAfter) / Math.abs(exit.price - parseFloat(formData.entryPrice)) * 100).toFixed(0)}% of leg
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No exits recorded — trade is open</p>
                )}
              </div>

              {/* Exit Summary (auto-calculated) */}
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
            </div>
          </FormSection>

          {/* Section 5b: Stop Adjustments */}
          <FormSection title="Stop Adjustments" defaultOpen={formData.stopAdjustments.length > 0}>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-300">Stop Management History</label>
                <button
                  type="button"
                  onClick={addStopAdjustment}
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  + Add Stop Adjustment
                </button>
              </div>

              {formData.stopAdjustments.length > 0 ? (
                <div className="space-y-2">
                  {formData.stopAdjustments.map((adj) => (
                    <div key={adj.id} className="flex gap-2 items-start flex-wrap">
                      <input
                        type="datetime-local"
                        value={adj.time instanceof Date ? toLocalDateTimeString(adj.time) : ''}
                        onChange={(e) => updateStopAdjustment(adj.id, 'time', new Date(e.target.value))}
                        className="w-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                      />
                      <input
                        type="number"
                        step="any"
                        value={adj.newStop || ''}
                        onChange={(e) => updateStopAdjustment(adj.id, 'newStop', parseFloat(e.target.value) || 0)}
                        placeholder="New Stop Price"
                        className="w-32 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                      />
                      <div className="relative flex-1 min-w-[150px]">
                        <input
                          type="text"
                          value={adj.reason}
                          onChange={(e) => updateStopAdjustment(adj.id, 'reason', e.target.value)}
                          placeholder="Reason (e.g., moved to BE)"
                          list={`reason-suggestions-${adj.id}`}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                        />
                        <datalist id={`reason-suggestions-${adj.id}`}>
                          {STOP_ADJUSTMENT_REASONS.map((r) => (
                            <option key={r} value={r} />
                          ))}
                        </datalist>
                      </div>
                      <div className="relative flex-1 min-w-[120px]">
                        <input
                          type="text"
                          value={adj.trigger || ''}
                          onChange={(e) => updateStopAdjustment(adj.id, 'trigger', e.target.value)}
                          placeholder="Trigger (e.g., TP hit)"
                          list={`trigger-suggestions-${adj.id}`}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                        />
                        <datalist id={`trigger-suggestions-${adj.id}`}>
                          {STOP_ADJUSTMENT_TRIGGERS.map((t) => (
                            <option key={t} value={t} />
                          ))}
                        </datalist>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeStopAdjustment(adj.id)}
                        className="p-2 text-red-400 hover:text-red-300"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No stop adjustments recorded</p>
              )}
            </div>
          </FormSection>

          {/* Section 6: Setup & Market Context */}
          <FormSection title="Setup & Market Context" defaultOpen={false}>
            <div className="space-y-4">
              {/* Setup Tags - full width multi-tag input */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-300 mb-1">Setup Tags</label>
                <div className="flex flex-wrap gap-1.5 p-2 bg-gray-700 border border-gray-600 rounded-lg min-h-[42px]">
                  {formData.setupTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-sm"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeSetupTag(tag)}
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
                    value={setupTagInput}
                    onChange={(e) => {
                      setSetupTagInput(e.target.value);
                      setShowSetupTagSuggestions(true);
                    }}
                    onFocus={() => setShowSetupTagSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSetupTagSuggestions(false), 200)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addSetupTag(setupTagInput);
                      }
                    }}
                    className="flex-1 min-w-[150px] bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                    placeholder={formData.setupTags.length === 0 ? 'Type to search or add tags...' : ''}
                  />
                </div>
                {showSetupTagSuggestions && filteredSetupTags.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredSetupTags.slice(0, 15).map((tag) => (
                      <button
                        key={tag.name}
                        type="button"
                        onClick={() => addSetupTag(tag.name)}
                        className="w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-600 text-sm flex items-center gap-2"
                      >
                        <span>{tag.name}</span>
                        {tag.description && (
                          <span className="text-gray-400 text-xs truncate">— {tag.description}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-1">Tag every technical factor present at entry</p>
              </div>

              {/* Timeframe fields side by side */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Analysis TF</label>
                  <select
                    value={formData.analysisTF}
                    onChange={(e) => handleChange('analysisTF', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select...</option>
                    {TIMEFRAMES.map((tf) => (
                      <option key={tf.value} value={tf.value}>
                        {tf.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Setup identified on</p>
                </div>

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
                  <p className="text-xs text-gray-500 mt-1">Entry executed on</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">HTF Bias</label>
                  <select
                    value={formData.htfBias}
                    onChange={(e) => handleChange('htfBias', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select...</option>
                    {HTF_BIASES.map((bias) => (
                      <option key={bias.value} value={bias.value}>
                        {bias.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">HTF Market Condition</label>
                  <select
                    value={formData.marketCondition}
                    onChange={(e) => handleChange('marketCondition', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select...</option>
                    {MARKET_CONDITIONS.map((mc) => (
                      <option key={mc.value} value={mc.value}>
                        {mc.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Overall HTF conditions</p>
                </div>
              </div>
            </div>
          </FormSection>

          {/* Section 7: Psychology */}
          <FormSection title="Psychology" defaultOpen={false}>
            <div className="space-y-4">
              {/* Reason Not Taken (only shown when tradeTaken is false) */}
              {!formData.tradeTaken && (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
                  <label className="block text-sm font-medium text-orange-400 mb-2">
                    Reason Not Taken
                  </label>
                  <input
                    type="text"
                    value={formData.notTakenReason}
                    onChange={(e) => handleChange('notTakenReason', e.target.value)}
                    list="not-taken-reasons-full"
                    className="w-full px-3 py-2 bg-gray-700 border border-orange-500/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Why wasn't this trade taken?"
                  />
                  <datalist id="not-taken-reasons-full">
                    {NOT_TAKEN_REASONS.map((reason) => (
                      <option key={reason} value={reason} />
                    ))}
                  </datalist>
                  <p className="text-xs text-orange-400/70 mt-2">
                    Common reasons: hesitation, missed entry window, away from desk, etc.
                  </p>
                </div>
              )}

              {/* Emotional State - Visual selector */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Emotional State</label>
                <div className="flex gap-2">
                  {EMOTIONAL_STATES.map((state) => (
                    <button
                      key={state.value}
                      type="button"
                      onClick={() => handleChange('emotionalState', state.value)}
                      className={`flex-1 py-3 rounded-lg text-center transition-colors ${
                        formData.emotionalState === state.value
                          ? 'bg-blue-600 ring-2 ring-blue-400'
                          : 'bg-gray-700 hover:bg-gray-600'
                      }`}
                    >
                      <div className="text-2xl">{state.emoji}</div>
                      <div className="text-xs text-gray-300 mt-1">{state.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Confidence Level */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Confidence Level</label>
                  <div className="flex gap-2">
                    {CONFIDENCE_LEVELS.map((cl) => (
                      <button
                        key={cl.value}
                        type="button"
                        onClick={() => handleChange('confidenceLevel', cl.value)}
                        className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                          formData.confidenceLevel === cl.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                        }`}
                      >
                        {cl.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Followed Plan Toggle */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Followed Plan</label>
                  <button
                    type="button"
                    onClick={() => handleChange('followedPlan', !formData.followedPlan)}
                    className={`w-full py-2 rounded-lg font-medium transition-colors ${
                      formData.followedPlan
                        ? 'bg-green-600 text-white'
                        : 'bg-red-600 text-white'
                    }`}
                  >
                    {formData.followedPlan ? 'Yes' : 'No'}
                  </button>
                </div>

                {/* Warning toggles */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isRevengeTrade}
                      onChange={(e) => handleChange('isRevengeTrade', e.target.checked)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-red-500 focus:ring-red-500"
                    />
                    <span className="text-sm text-gray-300">Revenge Trade</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isOverTrade}
                      onChange={(e) => handleChange('isOverTrade', e.target.checked)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-yellow-500 focus:ring-yellow-500"
                    />
                    <span className="text-sm text-gray-300">Over Trade</span>
                  </label>
                </div>
              </div>

              {/* Plan Deviation - shown only if followedPlan is false */}
              {!formData.followedPlan && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Plan Deviation (What did you do differently?)
                  </label>
                  <textarea
                    value={formData.planDeviation}
                    onChange={(e) => handleChange('planDeviation', e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              )}
            </div>
          </FormSection>

          {/* Section 8: Notes & Screenshots */}
          <FormSection title="Notes & Screenshots" defaultOpen={false}>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Pre-Trade Notes</label>
                  <textarea
                    value={formData.preTradeNotes}
                    onChange={(e) => handleChange('preTradeNotes', e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Analysis before entering the trade..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Post-Trade Notes</label>
                  <textarea
                    value={formData.postTradeNotes}
                    onChange={(e) => handleChange('postTradeNotes', e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Review after closing the trade..."
                  />
                </div>
              </div>

              {/* Screenshots */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Screenshots</label>
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  className="border-2 border-dashed border-gray-600 rounded-lg p-6 text-center hover:border-gray-500 transition-colors"
                >
                  <svg className="w-10 h-10 mx-auto text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="mt-2 text-sm text-gray-400">
                    Drag & drop images here, or paste from clipboard (Ctrl+V)
                  </p>
                </div>

                {/* Screenshot previews */}
                {formData.screenshots.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                    {formData.screenshots.filter(s => s.blob || (s.data && s.data.length > 0)).map((screenshot) => (
                      <div key={screenshot.id} className="relative group">
                        {screenshotUrls[screenshot.id] && (
                          <img
                            src={screenshotUrls[screenshot.id]}
                            alt="Screenshot"
                            className="w-full h-32 object-cover rounded-lg"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
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

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Tags</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Add a tag and press Enter..."
                  />
                  <button
                    type="button"
                    onClick={addTag}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white transition-colors"
                  >
                    Add
                  </button>
                </div>
                {formData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-gray-700 rounded-full text-sm text-gray-200"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="text-gray-400 hover:text-white"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </FormSection>

          {/* Post-Exit Review Section - Only for editing closed trades */}
          {isEditMode && calculated.status === 'closed' && (
            <FormSection title="Post-Exit Review" defaultOpen={!existingReviewedAt}>
              <div className="space-y-4">
                {!existingReviewedAt && (
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
                    <p className="text-blue-400 text-sm">
                      Record what happened after you exited this trade. This data helps you analyze whether your exits were optimal.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Post-Exit Best Price
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={formData.postExitBestPrice}
                      onChange={(e) => handleChange('postExitBestPrice', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Best price in your favour after exit"
                    />
                    <p className="text-xs text-gray-500 mt-1">Best price in your favour after you exited</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Post-Exit Worst Price
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={formData.postExitWorstPrice}
                      onChange={(e) => handleChange('postExitWorstPrice', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Worst price against you after exit"
                    />
                    <p className="text-xs text-gray-500 mt-1">Worst price against you after exit (validates your exit if this went far against)</p>
                  </div>
                </div>

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
                    Post-Exit Notes
                  </label>
                  <textarea
                    value={formData.postExitNotes}
                    onChange={(e) => handleChange('postExitNotes', e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="What happened after you exited? What would you do differently?"
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
        </div>
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
