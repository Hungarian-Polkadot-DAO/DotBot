import React from 'react';

interface Transaction {
  id: string;
  type: 'transfer' | 'swap' | 'stake' | 'vote';
  amount?: string;
  token?: string;
  status: 'pending' | 'completed' | 'failed';
  timestamp: number;
  hash?: string;
}

interface TransactionHistoryProps {
  transactions?: Transaction[];
}

const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  transactions = []
}) => {
  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'transfer': return '📤';
      case 'swap': return '🔄';
      case 'stake': return '🔒';
      case 'vote': return '🗳️';
      default: return '📋';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-400';
      case 'pending': return 'text-yellow-400';
      case 'failed': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Recent Transactions</h3>
      
      {transactions.length === 0 ? (
        <div className="text-center text-gray-500 py-4">
          <p className="text-sm">No transactions yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {transactions.slice(0, 5).map((tx) => (
            <div
              key={tx.id}
              className="flex items-center space-x-3 p-2 rounded hover:bg-gray-800 transition-colors"
            >
              <span className="text-lg">{getTransactionIcon(tx.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-300 capitalize">{tx.type}</p>
                {tx.amount && tx.token && (
                  <p className="text-xs text-gray-500">{tx.amount} {tx.token}</p>
                )}
              </div>
              <div className={`text-xs ${getStatusColor(tx.status)}`}>
                {tx.status}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TransactionHistory;
