import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db';
import { useAppStore } from '../../stores/appStore';
import { generateAlerts, filterDismissedAlerts } from '../../utils';
import type { TradeRecord, Alert } from '../../types';

const SEVERITY_STYLES = {
  warning: {
    border: 'border-l-yellow-500',
    bg: 'bg-yellow-500/10',
    icon: 'text-yellow-500',
  },
  danger: {
    border: 'border-l-red-500',
    bg: 'bg-red-500/10',
    icon: 'text-red-500',
  },
};

const ALERT_ICONS: Record<string, string> = {
  revenge_trade: 'Revenge',
  overtrade: 'Overtrade',
  sizing_spike: 'Size',
  edge_decay: 'Edge',
  drawdown: 'Drawdown',
  losing_streak: 'Streak',
  plan_deviation_streak: 'Plan',
};

export function AlertsPanel() {
  const navigate = useNavigate();
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const [isCollapsed, setIsCollapsed] = useState(false);

  const { alertSettings, dismissedAlertHashes, dismissAlert } = useAppStore();

  // Load trades
  useEffect(() => {
    const loadTrades = async () => {
      const allTrades = await db.trades.toArray();
      setTrades(allTrades);
    };
    loadTrades();
  }, []);

  // Generate and filter alerts (only from taken trades)
  const activeAlerts = useMemo(() => {
    const takenTrades = trades.filter((t) => t.tradeTaken !== false);
    const allAlerts = generateAlerts(takenTrades, alertSettings);
    return filterDismissedAlerts(allAlerts, dismissedAlertHashes);
  }, [trades, alertSettings, dismissedAlertHashes]);

  // Don't render if no alerts
  if (activeAlerts.length === 0) {
    return null;
  }

  const toggleExpanded = (alertId: string) => {
    setExpandedAlerts(prev => {
      const next = new Set(prev);
      if (next.has(alertId)) {
        next.delete(alertId);
      } else {
        next.add(alertId);
      }
      return next;
    });
  };

  const handleDismiss = (alert: Alert) => {
    dismissAlert(alert.id);
  };

  const dangerCount = activeAlerts.filter(a => a.severity === 'danger').length;
  const warningCount = activeAlerts.filter(a => a.severity === 'warning').length;

  return (
    <div className="mb-6">
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between p-4 bg-gray-800 rounded-t-lg hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">!</span>
          <span className="text-white font-medium">
            {activeAlerts.length} Active Alert{activeAlerts.length !== 1 ? 's' : ''}
          </span>
          {dangerCount > 0 && (
            <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">
              {dangerCount} critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded">
              {warningCount} warning
            </span>
          )}
        </div>
        <span className="text-gray-400">
          {isCollapsed ? '+' : '-'}
        </span>
      </button>

      {/* Alerts List */}
      {!isCollapsed && (
        <div className="bg-gray-800 rounded-b-lg border-t border-gray-700">
          {activeAlerts.map((alert) => {
            const styles = SEVERITY_STYLES[alert.severity];
            const isExpanded = expandedAlerts.has(alert.id);

            return (
              <div
                key={alert.id}
                className={`border-l-4 ${styles.border} ${styles.bg}`}
              >
                <div
                  className="p-4 cursor-pointer"
                  onClick={() => toggleExpanded(alert.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${styles.bg} ${styles.icon}`}>
                        {ALERT_ICONS[alert.type] || 'Alert'}
                      </span>
                      <div>
                        <h4 className="text-white font-medium">{alert.title}</h4>
                        <p className="text-gray-400 text-sm mt-1">{alert.message}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDismiss(alert);
                      }}
                      className="text-gray-500 hover:text-gray-300 text-sm shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && alert.relatedTradeIds.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-700/50">
                      <p className="text-xs text-gray-500 mb-2">Related Trades:</p>
                      <div className="flex flex-wrap gap-2">
                        {alert.relatedTradeIds.slice(0, 5).map(tradeId => {
                          const trade = trades.find(t => t.id === tradeId);
                          if (!trade) return null;
                          return (
                            <button
                              key={tradeId}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/trades/${tradeId}`);
                              }}
                              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300 transition-colors"
                            >
                              {trade.pair}
                              <span className={`ml-2 ${(trade.rMultiple ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {(trade.rMultiple ?? 0) >= 0 ? '+' : ''}{(trade.rMultiple ?? 0).toFixed(1)}R
                              </span>
                            </button>
                          );
                        })}
                        {alert.relatedTradeIds.length > 5 && (
                          <span className="px-2 py-1 text-sm text-gray-500">
                            +{alert.relatedTradeIds.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Export a hook to get alert count for the sidebar badge
export function useAlertCount(): number {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const { alertSettings, dismissedAlertHashes } = useAppStore();

  useEffect(() => {
    const loadTrades = async () => {
      const allTrades = await db.trades.toArray();
      setTrades(allTrades);
    };
    loadTrades();

    // Refresh every 30 seconds
    const interval = setInterval(loadTrades, 30000);
    return () => clearInterval(interval);
  }, []);

  return useMemo(() => {
    const allAlerts = generateAlerts(trades, alertSettings);
    const activeAlerts = filterDismissedAlerts(allAlerts, dismissedAlertHashes);
    return activeAlerts.length;
  }, [trades, alertSettings, dismissedAlertHashes]);
}
