import React from 'react';
import {
  Database,
  GitBranch,
  Shield,
  HardDrive,
  Wifi,
  WifiOff,
  RefreshCw,
  Lock,
  Unlock,
  UserCheck,
  Table,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { User } from '../types';
import { ENTERPRISE_USERS } from '../services/ssoAuth';
import { SyncState } from '../services/syncClient';

interface NavbarProps {
  activeTab: 'ledger' | 'studio' | 'git' | 'storage' | 'security';
  onTabChange: (tab: 'ledger' | 'studio' | 'git' | 'storage' | 'security') => void;
  currentUser: User;
  onUserChange: (user: User) => void;
  syncState: SyncState;
  isOffline: boolean;
  onToggleOffline: () => void;
  onManualSync: () => void;
  isDeviceLocked: boolean;
  onLockDevice: () => void;
  isViewFrozen: boolean;
  uncommittedIntentsCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  currentUser,
  onUserChange,
  syncState,
  isOffline,
  onToggleOffline,
  onManualSync,
  isDeviceLocked,
  onLockDevice,
  isViewFrozen,
  uncommittedIntentsCount,
}) => {
  return (
    <header className="border-b border-neutral-200 bg-white text-neutral-900 sticky top-0 z-40">
      {/* Top tier: System Identity & Global Sync Controls */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Architecture Tag */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-neutral-900 flex items-center justify-center text-white shadow-sm">
              <Database className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-lg text-neutral-900 tracking-tight">
                  Dual DuckDB
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-mono font-medium bg-neutral-100 text-neutral-700 border border-neutral-200">
                  Local-First
                </span>
                {isViewFrozen && (
                  <span className="text-xs px-2 py-0.5 rounded font-medium bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                    <Lock className="w-3 h-3 text-amber-800" /> View Frozen
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-600 hidden sm:block">
                Git-Backed Log • Client AES-256 • WebSocket Push
              </p>
            </div>
          </div>

          {/* Right Status Controls */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* Offline Simulation Toggle */}
            <button
              id="toggle-offline-btn"
              onClick={onToggleOffline}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                isOffline
                  ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                  : 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
              }`}
              title={isOffline ? 'Simulating Offline: Writes go to local queue' : 'Online: Connected to backend sync gateway'}
            >
              {isOffline ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-700" />
                  <span>Offline Mode</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Online (WS)</span>
                </>
              )}
            </button>

            {/* Uncommitted Intents Indicator */}
            {uncommittedIntentsCount > 0 && (
              <div
                className="flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-900 border border-amber-200"
                title={`${uncommittedIntentsCount} intents in offline queue`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                <span>{uncommittedIntentsCount} Queued</span>
              </div>
            )}

            {/* Manual Catch-Up Sync Button */}
            <button
              id="manual-sync-btn"
              onClick={onManualSync}
              disabled={isOffline || syncState === 'syncing'}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 disabled:opacity-50 transition-colors"
              title="Pull ordered commits for catch-up (GET /api/commits)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncState === 'syncing' ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Manual Sync</span>
            </button>

            {/* Local DB Encryption / Lock Button */}
            <button
              id="lock-device-btn"
              onClick={onLockDevice}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 transition-colors"
              title="Lock device & wipe encryption key from memory"
            >
              {isDeviceLocked ? (
                <>
                  <Lock className="w-3.5 h-3.5 text-red-600" />
                  <span className="hidden md:inline">Locked</span>
                </>
              ) : (
                <>
                  <Shield className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="hidden md:inline">Encrypted</span>
                </>
              )}
            </button>

            {/* SSO User Switcher */}
            <div className="relative">
              <select
                id="sso-user-select"
                value={currentUser.user_id}
                onChange={(e) => {
                  const target = ENTERPRISE_USERS.find((u) => u.user_id === e.target.value);
                  if (target) onUserChange(target);
                }}
                className="text-xs bg-neutral-100 border border-neutral-300 rounded-md py-1.5 pl-2.5 pr-7 font-medium text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900"
              >
                {ENTERPRISE_USERS.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.display_name} ({u.role.replace('_', ' ')})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="border-t border-neutral-200 bg-neutral-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-1 sm:space-x-4 overflow-x-auto py-2">
            <button
              id="nav-tab-ledger"
              onClick={() => onTabChange('ledger')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'ledger'
                  ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              <Table className="w-4 h-4 text-neutral-600" />
              <span>Collaborative Data</span>
            </button>

            <button
              id="nav-tab-studio"
              onClick={() => onTabChange('studio')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'studio'
                  ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              <Database className="w-4 h-4 text-amber-600" />
              <span>Dual DuckDB SQL Studio</span>
            </button>

            <button
              id="nav-tab-git"
              onClick={() => onTabChange('git')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'git'
                  ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              <GitBranch className="w-4 h-4 text-sky-600" />
              <span>Git Authoritative Log</span>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.2 rounded bg-neutral-200 text-neutral-700 font-semibold">
                Admin
              </span>
            </button>

            <button
              id="nav-tab-storage"
              onClick={() => onTabChange('storage')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'storage'
                  ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              <HardDrive className="w-4 h-4 text-indigo-600" />
              <span>Storage & Pruning</span>
            </button>

            <button
              id="nav-tab-security"
              onClick={() => onTabChange('security')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'security'
                  ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              <Shield className="w-4 h-4 text-emerald-600" />
              <span>Security & Roles</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};
