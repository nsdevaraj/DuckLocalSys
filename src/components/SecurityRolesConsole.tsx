import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Unlock,
  Key,
  UserCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileCheck,
  RefreshCw,
} from 'lucide-react';
import { GranularLock, User, ViewFreezeState } from '../types';
import { clientCrypto } from '../services/clientCrypto';

interface SecurityRolesConsoleProps {
  currentUser: User;
  viewFreeze: ViewFreezeState;
  granularLocks: Record<string, GranularLock>;
  onToggleViewFreeze: (freeze: boolean, reason?: string) => Promise<void>;
  onLockDevice: () => void;
  isDeviceLocked: boolean;
}

export const SecurityRolesConsole: React.FC<SecurityRolesConsoleProps> = ({
  currentUser,
  viewFreeze,
  granularLocks,
  onToggleViewFreeze,
  onLockDevice,
  isDeviceLocked,
}) => {
  const [freezeReason, setFreezeReason] = useState('FY2026 Enterprise Q3 Financial Audit Freeze');
  const [isUpdatingFreeze, setIsUpdatingFreeze] = useState(false);

  const isAdmin = currentUser.role === 'workspace_admin';
  const isCurator = currentUser.role === 'release_manager' || isAdmin;

  const handleFreezeToggle = async () => {
    if (!isAdmin) {
      alert('Only Workspace Administrators can freeze or unfreeze the analytical view.');
      return;
    }
    setIsUpdatingFreeze(true);
    try {
      await onToggleViewFreeze(!viewFreeze.frozen, freezeReason);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsUpdatingFreeze(false);
    }
  };

  const rolesMatrix = [
    {
      role: 'Workspace Administrator',
      code: 'workspace_admin',
      viewFreeze: true,
      gitAccess: true,
      granularLock: true,
      editUnlocked: true,
      readOnly: false,
      desc: 'Controls project configuration, freezes entire materialized views for enterprise audits, and inspects authoritative Git log.',
    },
    {
      role: 'Release Manager (Curator)',
      code: 'release_manager',
      viewFreeze: false,
      gitAccess: false,
      granularLock: true,
      editUnlocked: true,
      readOnly: false,
      desc: 'Locks and unlocks granular record modifications for data governance and curation.',
    },
    {
      role: 'Contributor',
      code: 'contributor',
      viewFreeze: false,
      gitAccess: false,
      granularLock: false,
      editUnlocked: true,
      readOnly: false,
      desc: 'Can edit, create, and submit mutations to unlocked entities.',
    },
    {
      role: 'Typical User (Consumer)',
      code: 'typical_user',
      viewFreeze: false,
      gitAccess: false,
      granularLock: false,
      editUnlocked: false,
      readOnly: true,
      desc: 'Consumer role. Read-only access to local and backend DuckDB queries.',
    },
  ];

  const payloadMeta = clientCrypto.getEncryptedPayloadMetadata();

  return (
    <div className="space-y-6">
      {/* 1. Client-Side Encryption at Rest Card (Section 10) */}
      <div className="bg-white rounded-lg border border-neutral-200 shadow-xs p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 pb-3">
          <div className="flex items-center space-x-2.5">
            <Key className="w-5 h-5 text-emerald-600" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Client-Side Encryption of Local DuckDB (At Rest)
              </h3>
              <p className="text-xs text-neutral-600">
                Architecture Spec Section 10: AES-GCM 256-bit with PBKDF2 (100,000 iterations). Key held only in volatile memory while application is unlocked.
              </p>
            </div>
          </div>

          <div>
            <button
              id="lock-device-wipe-key-btn"
              onClick={onLockDevice}
              className="px-3.5 py-1.5 rounded-md text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white flex items-center space-x-1.5 transition-colors shadow-xs"
            >
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span>Lock Device & Wipe In-Memory Key</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs font-mono">
          <div className="p-3 bg-neutral-50 rounded-md border border-neutral-200">
            <span className="text-neutral-500 block text-[11px]">Encryption Standard</span>
            <span className="font-semibold text-neutral-900">AES-GCM 256-bit</span>
          </div>

          <div className="p-3 bg-neutral-50 rounded-md border border-neutral-200">
            <span className="text-neutral-500 block text-[11px]">Key Derivation Function</span>
            <span className="font-semibold text-neutral-900">PBKDF2 (100k rounds)</span>
          </div>

          <div className="p-3 bg-neutral-50 rounded-md border border-neutral-200">
            <span className="text-neutral-500 block text-[11px]">Volatile Memory Status</span>
            <span className="font-semibold text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Key In Memory
            </span>
          </div>

          <div className="p-3 bg-neutral-50 rounded-md border border-neutral-200">
            <span className="text-neutral-500 block text-[11px]">Stored Ciphertext</span>
            <span className="font-semibold text-neutral-900">
              {payloadMeta ? `${payloadMeta.sizeBytes} bytes` : 'Initialized'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Workspace Administrator View Freeze Control (Section 10) */}
      <div className="bg-white rounded-lg border border-neutral-200 shadow-xs p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div className="flex items-center space-x-2.5">
            <Shield className="w-5 h-5 text-sky-600" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Workspace Administrator: View Freeze & Snapshot Governance
              </h3>
              <p className="text-xs text-neutral-600">
                This role can lock entire materialized views or specific Parquet snapshots to freeze a dataset for final enterprise reporting, preventing any new WebSocket pushes from altering the locked analytical state.
              </p>
            </div>
          </div>

          <span className={`text-xs px-2.5 py-1 rounded font-semibold ${
            viewFreeze.frozen ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-neutral-100 text-neutral-700'
          }`}>
            {viewFreeze.frozen ? 'Status: FROZEN' : 'Status: ACTIVE'}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <input
            type="text"
            value={freezeReason}
            onChange={(e) => setFreezeReason(e.target.value)}
            disabled={!isAdmin || viewFreeze.frozen}
            placeholder="Audit or Reporting Freeze Reason..."
            className="flex-1 px-3 py-2 text-xs bg-neutral-50 border border-neutral-300 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:opacity-60"
          />

          <button
            id="toggle-view-freeze-btn"
            onClick={handleFreezeToggle}
            disabled={!isAdmin || isUpdatingFreeze}
            className={`px-4 py-2 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-xs ${
              viewFreeze.frozen
                ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                : 'bg-amber-700 hover:bg-amber-800 text-white'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {isUpdatingFreeze ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : viewFreeze.frozen ? (
              <Unlock className="w-3.5 h-3.5" />
            ) : (
              <Lock className="w-3.5 h-3.5" />
            )}
            <span>
              {viewFreeze.frozen ? 'Unfreeze Materialized View' : 'Freeze Materialized View'}
            </span>
          </button>
        </div>

        {!isAdmin && (
          <div className="text-xs text-neutral-500">
            Note: You are currently signed in as <strong>{currentUser.display_name}</strong> ({currentUser.role}). Only <strong>Sarah Chen (Workspace Administrator)</strong> can toggle view freeze.
          </div>
        )}
      </div>

      {/* 3. Role-Based Access Control Matrix (Section 10) */}
      <div className="bg-white rounded-lg border border-neutral-200 shadow-xs overflow-hidden">
        <div className="p-3.5 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between">
          <span className="text-xs font-semibold text-neutral-800 uppercase tracking-wider">
            Architecture Specification Section 10: RBAC Governance Matrix
          </span>
          <span className="text-xs text-neutral-500">Dual DuckDB Permission Mapping</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-100 border-b border-neutral-200 text-neutral-700 font-semibold">
              <tr>
                <th className="py-2.5 px-4">Role Archetype</th>
                <th className="py-2.5 px-3 text-center">Freeze View</th>
                <th className="py-2.5 px-3 text-center">Inspect Git</th>
                <th className="py-2.5 px-3 text-center">Granular Locks</th>
                <th className="py-2.5 px-3 text-center">Edit Data</th>
                <th className="py-2.5 px-4">Architectural Mandate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {rolesMatrix.map((r) => {
                const isCurrent = currentUser.role === r.code;
                return (
                  <tr key={r.code} className={isCurrent ? 'bg-sky-50/50' : 'hover:bg-neutral-50'}>
                    <td className="py-3 px-4 font-semibold text-neutral-900">
                      <div className="flex items-center space-x-2">
                        <span>{r.role}</span>
                        {isCurrent && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-200 text-sky-900 font-mono">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-neutral-500">{r.code}</div>
                    </td>

                    <td className="py-3 px-3 text-center">
                      {r.viewFreeze ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <XCircle className="w-4 h-4 text-neutral-300 mx-auto" />
                      )}
                    </td>

                    <td className="py-3 px-3 text-center">
                      {r.gitAccess ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <XCircle className="w-4 h-4 text-neutral-300 mx-auto" />
                      )}
                    </td>

                    <td className="py-3 px-3 text-center">
                      {r.granularLock ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <XCircle className="w-4 h-4 text-neutral-300 mx-auto" />
                      )}
                    </td>

                    <td className="py-3 px-3 text-center">
                      {r.editUnlocked ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <XCircle className="w-4 h-4 text-neutral-300 mx-auto" />
                      )}
                    </td>

                    <td className="py-3 px-4 text-neutral-600 leading-relaxed">{r.desc}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
