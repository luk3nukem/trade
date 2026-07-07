import { useObservable } from 'dexie-react-hooks';
import { db } from '../db';

export function SyncStatus() {
  let syncState;
  let currentUser;

  try {
    syncState = useObservable(db.cloud?.syncState);
    currentUser = useObservable(db.cloud?.currentUser);
  } catch (e) {
    // Cloud not available
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
        <span className="w-2 h-2 rounded-full bg-gray-600" />
        <span>Local</span>
      </div>
    );
  }

  // If cloud is not configured or no sync state yet
  if (!syncState) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
        <span className="w-2 h-2 rounded-full bg-gray-600" />
        <span>Local only</span>
      </div>
    );
  }

  const { phase, error } = syncState;
  const isAuthenticated = currentUser?.isLoggedIn;

  // Handle unauthenticated state - show login button
  if (!isAuthenticated && (phase === 'initial' || phase === 'not-in-sync' || phase === 'offline')) {
    const handleLogin = async () => {
      try {
        console.log('Attempting Dexie Cloud login...');
        await db.cloud.login();
        console.log('Login successful');
      } catch (err) {
        console.error('Login failed:', err);
        // Show more details in console
        if (err instanceof Error) {
          console.error('Error message:', err.message);
          console.error('Error stack:', err.stack);
        }
      }
    };

    return (
      <div className="px-3 py-2">
        <button
          onClick={handleLogin}
          className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-yellow-500" />
          <span>Sign in to sync</span>
        </button>
      </div>
    );
  }

  // Determine status display
  let dotColor = 'bg-gray-500';
  let statusText = 'Unknown';

  // Type-safe phase handling
  const phaseStr = phase as string;

  if (phaseStr === 'in-sync') {
    dotColor = 'bg-green-500';
    statusText = 'Synced';
  } else if (phaseStr === 'pushing') {
    dotColor = 'bg-blue-500 animate-pulse';
    statusText = 'Pushing...';
  } else if (phaseStr === 'pulling') {
    dotColor = 'bg-blue-500 animate-pulse';
    statusText = 'Pulling...';
  } else if (phaseStr === 'connecting') {
    dotColor = 'bg-yellow-500 animate-pulse';
    statusText = 'Connecting...';
  } else if (phaseStr === 'offline') {
    dotColor = 'bg-gray-500';
    statusText = 'Offline';
  } else if (phaseStr === 'error') {
    dotColor = 'bg-red-500';
    statusText = 'Error';
  } else if (phaseStr === 'not-in-sync') {
    dotColor = 'bg-yellow-500';
    statusText = 'Pending';
  } else {
    dotColor = 'bg-gray-500';
    statusText = phaseStr || 'Connecting...';
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span>{statusText}</span>
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-400 truncate" title={error.message}>
          {error.message}
        </p>
      )}
    </div>
  );
}
