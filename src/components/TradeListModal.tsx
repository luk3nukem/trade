import { useNavigate } from 'react-router-dom';
import type { TradeRecord } from '../types';

interface Props {
  title: string;
  trades: TradeRecord[];
  onClose: () => void;
}

export function TradeListModal({ title, trades, onClose }: Props) {
  const navigate = useNavigate();

  const handleTradeClick = (tradeId: string) => {
    onClose();
    navigate(`/trades/${tradeId}`);
  };

  const formatDate = (date: Date | undefined) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-medium text-white">{title}</h2>
            <p className="text-sm text-gray-400">{trades.length} trade{trades.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Trade List */}
        <div className="overflow-y-auto flex-1 p-2">
          {trades.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No trades in this bucket
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-gray-800">
                <tr className="text-xs text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 px-3">Pair</th>
                  <th className="text-left py-2 px-3">Date</th>
                  <th className="text-center py-2 px-3">Dir</th>
                  <th className="text-right py-2 px-3">R</th>
                  <th className="text-right py-2 px-3">MAE</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr
                    key={trade.id}
                    onClick={() => trade.id && handleTradeClick(trade.id)}
                    className="border-b border-gray-700/50 hover:bg-gray-750 cursor-pointer transition-colors"
                  >
                    <td className="py-2 px-3 text-sm font-medium text-white">
                      {trade.pair}
                    </td>
                    <td className="py-2 px-3 text-sm text-gray-300">
                      {formatDate(trade.entryTime)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        trade.direction === 'long'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {trade.direction === 'long' ? 'L' : 'S'}
                      </span>
                    </td>
                    <td className={`py-2 px-3 text-sm text-right font-medium ${
                      (trade.rMultiple ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {trade.rMultiple !== undefined ? `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R` : '—'}
                    </td>
                    <td className="py-2 px-3 text-sm text-right text-gray-300">
                      {trade.maeR !== undefined ? `${trade.maeR.toFixed(2)}R` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
