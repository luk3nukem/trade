import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  children: ReactNode;
  fallbackPath?: string;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const { fallbackPath = '/trades', fallbackLabel = 'Back to Trades' } = this.props;

      return (
        <div className="p-6">
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-6 max-w-lg">
            <h2 className="text-lg font-semibold text-red-400 mb-2">
              Something went wrong
            </h2>
            <p className="text-gray-400 text-sm mb-4">
              An error occurred while loading this page. This may be due to
              corrupted data or a temporary issue.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <pre className="bg-gray-900 p-3 rounded text-xs text-red-300 overflow-auto mb-4 max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3">
              <Link
                to={fallbackPath}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
              >
                {fallbackLabel}
              </Link>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
