/**
 * Shared chart styling constants for Recharts components
 * Used across all analytics pages for consistent dark theme appearance
 */

/**
 * Standard tooltip styles for dark theme
 * Use these as the contentStyle, itemStyle, and labelStyle props on Recharts Tooltip components
 */
export const CHART_TOOLTIP_STYLES = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
  },
  itemStyle: {
    color: '#e5e7eb',
  },
  labelStyle: {
    color: '#e5e7eb',
  },
} as const;

/**
 * Grid styling for CartesianGrid components
 */
export const CHART_GRID_STYLES = {
  stroke: '#374151',
  strokeDasharray: '3 3',
} as const;

/**
 * Axis styling for XAxis and YAxis components
 */
export const CHART_AXIS_STYLES = {
  stroke: '#6b7280',
  fontSize: 12,
} as const;
