import { useState, useEffect, useMemo } from 'react';
import { db } from '../../db';
import { useAppStore } from '../../stores/appStore';
import { filterTrades } from '../../utils';
import type { TradeRecord, Account, Strategy } from '../../types';
import { PairPerformance } from './PairPerformance';
import { SetupPerformance } from './SetupPerformance';
import { TimeAnalysis } from './TimeAnalysis';
import { RiskDistribution } from './RiskDistribution';
import { StopPlacement } from './StopPlacement';
import { ExitManagement } from './ExitManagement';
import { BehaviouralAnalysis } from './BehaviouralAnalysis';
import { MarketContext } from './MarketContext';
import { SelectivityAnalysis } from './SelectivityAnalysis';

type AnalyticsTab = 'pairs' | 'setups' | 'time' | 'stops' | 'exits' | 'risk' | 'behavioural' | 'context' | 'selectivity';

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'pairs', label: 'Pairs' },
  { id: 'setups', label: 'Setups' },
  { id: 'time', label: 'Time & Session' },
  { id: 'stops', label: 'Stop Placement' },
  { id: 'exits', label: 'Exit Management' },
  { id: 'risk', label: 'Risk & Distribution' },
  { id: 'behavioural', label: 'Behavioural' },
  { id: 'context', label: 'Market Context' },
  { id: 'selectivity', label: 'Selectivity' },
];

export function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('pairs');
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);

  const {
    dashboardFilters,
    setDashboardFilters,
    clearDashboardFilters,
  } = useAppStore();

  // Load data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [allTrades, allAccounts, allStrategies] = await Promise.all([
          db.trades.toArray(),
          db.accounts.toArray(),
          db.strategies.toArray(),
        ]);
        setTrades(allTrades);
        setAccounts(allAccounts);
        setStrategies(allStrategies);
      } catch (error) {
        console.error('Failed to load analytics data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Filter trades based on global filters
  const filteredTrades = useMemo(() => {
    return filterTrades(trades, {
      dateFrom: dashboardFilters.dateFrom ? new Date(dashboardFilters.dateFrom) : undefined,
      dateTo: dashboardFilters.dateTo ? new Date(dashboardFilters.dateTo) : undefined,
      accountId: dashboardFilters.accountId || undefined,
      strategyId: dashboardFilters.strategyId || undefined,
    });
  }, [trades, dashboardFilters]);

  const hasActiveFilters = Object.values(dashboardFilters).some((v) => v !== '');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'pairs':
        return <PairPerformance trades={filteredTrades} />;
      case 'setups':
        return <SetupPerformance trades={filteredTrades} />;
      case 'time':
        return <TimeAnalysis trades={filteredTrades} />;
      case 'stops':
        return <StopPlacement trades={filteredTrades} />;
      case 'exits':
        return <ExitManagement trades={filteredTrades} />;
      case 'risk':
        return <RiskDistribution trades={filteredTrades} />;
      case 'behavioural':
        return <BehaviouralAnalysis trades={filteredTrades} />;
      case 'context':
        return <MarketContext trades={filteredTrades} />;
      case 'selectivity':
        return <SelectivityAnalysis trades={filteredTrades} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="mt-1 text-gray-400">Analyze your trading patterns and performance</p>
      </div>

      {/* Global Filters */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">From Date</label>
            <input
              type="date"
              value={dashboardFilters.dateFrom}
              onChange={(e) => setDashboardFilters({ dateFrom: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To Date</label>
            <input
              type="date"
              value={dashboardFilters.dateTo}
              onChange={(e) => setDashboardFilters({ dateTo: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Account</label>
            <select
              value={dashboardFilters.accountId}
              onChange={(e) => setDashboardFilters({ accountId: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Accounts</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Strategy</label>
            <select
              value={dashboardFilters.strategyId}
              onChange={(e) => setDashboardFilters({ strategyId: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Strategies</option>
              {strategies.map((strat) => (
                <option key={strat.id} value={strat.id}>{strat.name}</option>
              ))}
            </select>
          </div>
        </div>
        {hasActiveFilters && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={clearDashboardFilters}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-700">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Trade Count */}
      <div className="text-sm text-gray-400">
        Analyzing {filteredTrades.filter(t => t.status === 'closed').length} closed trades
        {filteredTrades.filter(t => t.status === 'open').length > 0 &&
          ` (${filteredTrades.filter(t => t.status === 'open').length} open)`
        }
      </div>

      {/* Tab Content */}
      {renderTabContent()}
    </div>
  );
}
