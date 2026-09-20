import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { CollaborativeLedger } from './components/CollaborativeLedger';
import { DualDuckDBStudio } from './components/DualDuckDBStudio';
import { GitAuthoritativeLogView } from './components/GitAuthoritativeLogView';
import { StoragePruningManager } from './components/StoragePruningManager';
import { SecurityRolesConsole } from './components/SecurityRolesConsole';
import { LockDeviceModal } from './components/LockDeviceModal';

import { ssoAuth, ENTERPRISE_USERS } from './services/ssoAuth';
import { clientDuckDB } from './services/clientDuckDB';
import { intentQueue } from './services/intentQueue';
import { syncClient } from './services/syncClient';
import { DatasetRecord, Intent, User } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'ledger' | 'studio' | 'git' | 'storage' | 'security'>('ledger');
  const [currentUser, setCurrentUser] = useState<User>(ssoAuth.getCurrentUser());
  const [isDeviceLocked, setIsDeviceLocked] = useState<boolean>(ssoAuth.isLocked());
  const [records, setRecords] = useState<DatasetRecord[]>(clientDuckDB.getRecords());
  const [queue, setQueue] = useState<Intent[]>(intentQueue.getQueue());
  const [lastRejectedIntent, setLastRejectedIntent] = useState<Intent | null>(intentQueue.getLastRejectedIntent());
  const [syncState, setSyncState] = useState(syncClient.getSyncState());
  const [isOffline, setIsOffline] = useState(syncClient.isOfflineMode());
  const [viewFreeze, setViewFreeze] = useState(syncClient.getViewFreezeState());
  const [granularLocks, setGranularLocks] = useState(syncClient.getGranularLocks());
  const [conflictNotifications, setConflictNotifications] = useState(syncClient.getConflictNotifications());
  const [storageMetrics, setStorageMetrics] = useState(clientDuckDB.getStorageMetrics());

  // Initialization & Service Subscriptions
  useEffect(() => {
    // 1. Initialize client services
    const initApp = async () => {
      await clientDuckDB.initialize();
      syncClient.initialize(currentUser);
      await syncClient.performCatchUp();
      setRecords(clientDuckDB.getRecords());
      setStorageMetrics(clientDuckDB.getStorageMetrics());
    };

    initApp();

    // 2. Subscriptions
    const unsubAuth = ssoAuth.subscribe(() => {
      setCurrentUser(ssoAuth.getCurrentUser());
      setIsDeviceLocked(ssoAuth.isLocked());
    });

    const unsubDB = clientDuckDB.subscribe(() => {
      setRecords(clientDuckDB.getRecords());
      setStorageMetrics(clientDuckDB.getStorageMetrics());
    });

    const unsubQueue = intentQueue.subscribe((newQueue) => {
      setQueue(newQueue);
      setLastRejectedIntent(intentQueue.getLastRejectedIntent());
    });

    const unsubSync = syncClient.subscribe(() => {
      setSyncState(syncClient.getSyncState());
      setIsOffline(syncClient.isOfflineMode());
      setViewFreeze(syncClient.getViewFreezeState());
      setGranularLocks(syncClient.getGranularLocks());
      setConflictNotifications(syncClient.getConflictNotifications());
    });

    return () => {
      unsubAuth();
      unsubDB();
      unsubQueue();
      unsubSync();
    };
  }, []);

  // Handlers
  const handleUserChange = (newUser: User) => {
    ssoAuth.switchUser(newUser);
    syncClient.setUser(newUser);
  };

  const handleToggleOffline = () => {
    syncClient.toggleOfflineMode();
  };

  const handleManualSync = async () => {
    await syncClient.performCatchUp();
    await intentQueue.drainQueue(currentUser, !isOffline);
    setStorageMetrics(clientDuckDB.getStorageMetrics());
  };

  const handleLockDevice = () => {
    ssoAuth.lockDevice();
  };

  const handleUnlockDevice = async (passphrase: string): Promise<boolean> => {
    const success = await ssoAuth.unlockDevice(passphrase);
    if (success) {
      setRecords(clientDuckDB.getRecords());
      setStorageMetrics(clientDuckDB.getStorageMetrics());
    }
    return success;
  };

  const handleSubmitIntent = (
    operation: 'create' | 'update' | 'delete',
    entity_id: string,
    payload: Record<string, any>
  ) => {
    intentQueue.enqueueIntent(operation, entity_id, payload, currentUser);
    // If online, immediately try to drain
    if (!isOffline) {
      intentQueue.drainQueue(currentUser, true);
    }
  };

  const handleToggleGranularLock = async (entity_id: string, locked: boolean) => {
    if (isOffline) {
      alert('Granular lock operations require connection to the authoritative backend.');
      return;
    }
    try {
      const resp = await fetch('/api/curator/toggle-lock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.user_id,
          'x-user-role': currentUser.role,
        },
        body: JSON.stringify({ entity_id, locked }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Failed to update lock');
      }
      await syncClient.refreshSystemOverview();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleToggleViewFreeze = async (freeze: boolean, reason?: string) => {
    const resp = await fetch('/api/admin/toggle-view-freeze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser.user_id,
        'x-user-role': currentUser.role,
      },
      body: JSON.stringify({ freeze, reason }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Failed to toggle view freeze');
    }
    await syncClient.refreshSystemOverview();
  };

  const handleDrainQueue = async () => {
    await intentQueue.drainQueue(currentUser, !isOffline);
  };

  return (
    <div className="min-h-screen bg-neutral-100/60 text-neutral-900 flex flex-col font-sans antialiased">
      {/* Navigation & Status Header */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        currentUser={currentUser}
        onUserChange={handleUserChange}
        syncState={syncState}
        isOffline={isOffline}
        onToggleOffline={handleToggleOffline}
        onManualSync={handleManualSync}
        isDeviceLocked={isDeviceLocked}
        onLockDevice={handleLockDevice}
        isViewFrozen={viewFreeze.frozen}
        uncommittedIntentsCount={queue.filter((i) => i.status !== 'committed').length}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'ledger' && (
          <CollaborativeLedger
            records={records}
            currentUser={currentUser}
            viewFreeze={viewFreeze}
            granularLocks={granularLocks}
            queue={queue}
            conflictNotifications={conflictNotifications}
            onDismissConflict={(id) => syncClient.dismissConflict(id)}
            lastRejectedIntent={lastRejectedIntent}
            onClearRejectedIntent={() => intentQueue.clearRejectedIntent()}
            onSubmitIntent={handleSubmitIntent}
            onToggleGranularLock={handleToggleGranularLock}
            onDrainQueue={handleDrainQueue}
            isOffline={isOffline}
          />
        )}

        {activeTab === 'studio' && (
          <DualDuckDBStudio isOffline={isOffline} />
        )}

        {activeTab === 'git' && (
          <GitAuthoritativeLogView
            currentUser={currentUser}
            onSwitchToAdmin={(admin) => handleUserChange(admin)}
          />
        )}

        {activeTab === 'storage' && (
          <StoragePruningManager
            metrics={storageMetrics}
            onRefreshMetrics={() => setStorageMetrics(clientDuckDB.getStorageMetrics())}
            recordsCount={records.length}
            commitCount={clientDuckDB.getCommitCount()}
          />
        )}

        {activeTab === 'security' && (
          <SecurityRolesConsole
            currentUser={currentUser}
            viewFreeze={viewFreeze}
            granularLocks={granularLocks}
            onToggleViewFreeze={handleToggleViewFreeze}
            onLockDevice={handleLockDevice}
            isDeviceLocked={isDeviceLocked}
          />
        )}
      </main>

      {/* Device Locked Modal (AES-256 Key Decryption) */}
      {isDeviceLocked && (
        <LockDeviceModal onUnlock={handleUnlockDevice} />
      )}

      {/* Footer / System Status Bar */}
      <footer className="border-t border-neutral-200 bg-white text-xs text-neutral-500 py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Dual DuckDB Engine Active</span>
            <span>•</span>
            <span>Git Log: Linear Branch `main`</span>
            <span>•</span>
            <span>Conflict Resolution: Last-Write-Wins (LWW)</span>
          </div>

          <div className="font-mono text-[11px]">
            Active User: {currentUser.display_name} ({currentUser.role})
          </div>
        </div>
      </footer>
    </div>
  );
}
