import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AlertSettings, AlertType } from '../types';

interface DashboardFilters {
  dateFrom: string;
  dateTo: string;
  accountId: string;
  strategyId: string;
  setupTags: string[]; // Multi-select: filter trades matching ANY selected tag
}

const defaultAlertSettings: AlertSettings = {
  dailyTradeLimit: 5,
  drawdownWarningThreshold: 5,
  revengeTradeWindowMinutes: 30,
  enabledAlerts: {
    revenge_trade: true,
    overtrade: true,
    sizing_spike: true,
    edge_decay: true,
    drawdown: true,
    losing_streak: true,
    plan_deviation_streak: true,
  },
};

interface AppState {
  // Sidebar state
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Selected account for filtering
  selectedAccountId: string | null;
  setSelectedAccountId: (accountId: string | null) => void;

  // Database initialization status
  isDbInitialized: boolean;
  setDbInitialized: (initialized: boolean) => void;

  // Dashboard filters
  dashboardFilters: DashboardFilters;
  setDashboardFilters: (filters: Partial<DashboardFilters>) => void;
  clearDashboardFilters: () => void;

  // Selected calendar date for filtering
  selectedCalendarDate: string | null;
  setSelectedCalendarDate: (date: string | null) => void;

  // Alert settings
  alertSettings: AlertSettings;
  setAlertSettings: (settings: Partial<AlertSettings>) => void;
  toggleAlertType: (alertType: AlertType, enabled: boolean) => void;

  // Dismissed alerts (hash of alert to prevent re-showing)
  dismissedAlertHashes: Set<string>;
  dismissAlert: (hash: string) => void;
  clearDismissedAlerts: () => void;
}

const initialDashboardFilters: DashboardFilters = {
  dateFrom: '',
  dateTo: '',
  accountId: '',
  strategyId: '',
  setupTags: [],
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Sidebar state
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      // Selected account
      selectedAccountId: null,
      setSelectedAccountId: (accountId) => set({ selectedAccountId: accountId }),

      // Database initialization
      isDbInitialized: false,
      setDbInitialized: (initialized) => set({ isDbInitialized: initialized }),

      // Dashboard filters
      dashboardFilters: initialDashboardFilters,
      setDashboardFilters: (filters) =>
        set((state) => ({
          dashboardFilters: { ...state.dashboardFilters, ...filters },
        })),
      clearDashboardFilters: () =>
        set({ dashboardFilters: initialDashboardFilters, selectedCalendarDate: null }),

      // Selected calendar date
      selectedCalendarDate: null,
      setSelectedCalendarDate: (date) => set({ selectedCalendarDate: date }),

      // Alert settings
      alertSettings: defaultAlertSettings,
      setAlertSettings: (settings) =>
        set((state) => ({
          alertSettings: { ...state.alertSettings, ...settings },
        })),
      toggleAlertType: (alertType, enabled) =>
        set((state) => ({
          alertSettings: {
            ...state.alertSettings,
            enabledAlerts: {
              ...state.alertSettings.enabledAlerts,
              [alertType]: enabled,
            },
          },
        })),

      // Dismissed alerts
      dismissedAlertHashes: new Set<string>(),
      dismissAlert: (hash) =>
        set((state) => ({
          dismissedAlertHashes: new Set([...state.dismissedAlertHashes, hash]),
        })),
      clearDismissedAlerts: () => set({ dismissedAlertHashes: new Set<string>() }),
    }),
    {
      name: 'trading-diary-settings',
      partialize: (state) => ({
        alertSettings: state.alertSettings,
        dismissedAlertHashes: Array.from(state.dismissedAlertHashes),
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as {
          alertSettings?: AlertSettings;
          dismissedAlertHashes?: string[];
        };
        return {
          ...current,
          alertSettings: persistedState?.alertSettings ?? current.alertSettings,
          dismissedAlertHashes: new Set(persistedState?.dismissedAlertHashes ?? []),
        };
      },
    }
  )
);
