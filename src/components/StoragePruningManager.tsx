import React, { useState } from 'react';
import {
  HardDrive,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  FileDown,
  RefreshCw,
  ArrowRight,
  Database,
  Layers,
  Sparkles,
} from 'lucide-react';
import { StorageMetrics } from '../types';
import { CompactProgress, clientDuckDB } from '../services/clientDuckDB';
import { exportDatasetAsParquet } from '../services/parquetExporter';

interface StoragePruningManagerProps {
  metrics: StorageMetrics;
  onRefreshMetrics: () => void;
  recordsCount: number;
  commitCount: number;
}

export const StoragePruningManager: React.FC<StoragePruningManagerProps> = ({
  metrics,
  onRefreshMetrics,
  recordsCount,
  commitCount,
}) => {
  const [compactProgress, setCompactProgress] = useState<CompactProgress | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [showHardLimitPrompt, setShowHardLimitPrompt] = useState(false);

  const handleStartCompact = async (confirmed: boolean = false) => {
    if (metrics.hard_limit_exceeded && !confirmed) {
      setShowHardLimitPrompt(true);
      return;
    }

    setShowHardLimitPrompt(false);
    setIsCompacting(true);

    try {
      await clientDuckDB.executePruneAndCompact(true, (progress) => {
        setCompactProgress(progress);
      });
      onRefreshMetrics();
    } catch (err) {
      console.error('Compact execution failed:', err);
    } finally {
      setIsCompacting(false);
    }
  };

  const simulateGrowth = (megabytes: number) => {
    clientDuckDB.setSimulatedStorageGrowth(megabytes);
    onRefreshMetrics();
  };

  const percentToHardLimit = Math.min(100, Math.round((metrics.estimated_size_mb / metrics.hard_limit_mb) * 100));

  return (
    <div className="space-y-6">
      {/* Header & Retention Rules */}
      <div className="bg-white p-5 rounded-lg border border-neutral-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <HardDrive className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-neutral-900">
              Local Storage Growth & Pruning Engine
            </h2>
          </div>
          <p className="text-xs text-neutral-600 mt-1">
            Architecture Specification Section 9: Manages local client storage via Parquet snapshots and hard-delete pruning.
          </p>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <button
            id="simulate-soft-btn"
            onClick={() => simulateGrowth(260)}
            className="px-2.5 py-1.5 rounded bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 font-medium transition-colors"
            title="Simulate 260 MB growth (triggers soft limit background compact)"
          >
            Simulate 260 MB (Soft)
          </button>
          <button
            id="simulate-hard-btn"
            onClick={() => simulateGrowth(520)}
            className="px-2.5 py-1.5 rounded bg-red-50 text-red-800 border border-red-300 hover:bg-red-100 font-medium transition-colors"
            title="Simulate 520 MB growth (triggers hard limit confirmation message)"
          >
            Simulate 520 MB (Hard)
          </button>
          <button
            id="reset-simulation-btn"
            onClick={() => simulateGrowth(0)}
            className="px-2.5 py-1.5 rounded bg-neutral-100 text-neutral-700 border border-neutral-300 hover:bg-neutral-200 font-medium transition-colors"
          >
            Reset Size
          </button>
        </div>
      </div>

      {/* Hard Limit Trigger Banner (Architecture Section 9) */}
      {metrics.hard_limit_exceeded && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-300 text-red-900 shadow-xs space-y-3">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-red-950 text-sm">
                Local Storage Hard Limit Exceeded ({metrics.estimated_size_mb} MB &gt; {metrics.hard_limit_mb} MB)
              </div>
              <p className="text-xs text-red-800 mt-1">
                Architecture Spec Rule: When local encrypted DuckDB storage exceeds ~500 MB, the system requires explicit user confirmation before initiating the Parquet snapshot compaction flow to preserve device space.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3 pt-1">
            <button
              id="confirm-hard-compact-btn"
              onClick={() => handleStartCompact(true)}
              disabled={isCompacting}
              className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-md text-xs font-semibold shadow-xs transition-colors"
            >
              Confirm & Execute Compaction Now
            </button>
          </div>
        </div>
      )}

      {/* Soft Limit Notice */}
      {metrics.soft_limit_exceeded && !metrics.hard_limit_exceeded && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs sm:text-sm flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              <strong>Soft Limit Warning:</strong> Estimated size is {metrics.estimated_size_mb} MB (Soft limit: ~250 MB). Automatic background compact active.
            </span>
          </div>
        </div>
      )}

      {/* Storage Gauge & Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-500 font-medium">Estimated Client Size</span>
            <span className="font-mono font-bold text-neutral-900">{metrics.estimated_size_mb} MB</span>
          </div>

          <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                metrics.hard_limit_exceeded
                  ? 'bg-red-600'
                  : metrics.soft_limit_exceeded
                  ? 'bg-amber-500'
                  : 'bg-indigo-600'
              }`}
              style={{ width: `${percentToHardLimit}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-neutral-500">
            <span>Soft: 250 MB</span>
            <span>Hard: 500 MB</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-xs space-y-1">
          <div className="text-xs text-neutral-500 font-medium">Retention Window Policy</div>
          <div className="text-base font-semibold text-neutral-900">
            Last 30 Days <span className="text-xs text-neutral-500 font-normal">or</span> 500 Commits
          </div>
          <div className="text-xs text-neutral-600 pt-1">
            Whichever is larger. Strict hard-delete on compaction.
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-xs text-neutral-500 font-medium">Current Retention Status</div>
            <div className="text-sm font-semibold text-neutral-900 mt-1">
              {recordsCount} Active Records • {commitCount} Commits in Window
            </div>
          </div>
          <div className="pt-2">
            <button
              id="manual-compact-flow-btn"
              onClick={() => handleStartCompact(false)}
              disabled={isCompacting}
              className="w-full py-2 px-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-md text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCompacting ? 'animate-spin' : ''}`} />
              <span>{isCompacting ? 'Compacting...' : 'Execute Manual Compact Flow'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 5-Step Compact Flow Progress Card */}
      <div className="bg-white rounded-lg border border-neutral-200 shadow-xs p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <span>Architecture Spec Section 9: The 5-Step Compaction Flow</span>
          </h3>
          {metrics.last_compact_at && (
            <span className="text-xs text-neutral-500">
              Last compact: {new Date(metrics.last_compact_at).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
          {[
            { step: 1, label: 'Request Parquet Snapshot', desc: 'Pull snapshot at safe commit + commit tail' },
            { step: 2, label: 'Load Temporary DuckDB', desc: 'Isolate in temporary staging database' },
            { step: 3, label: 'Apply Remaining Tail', desc: 'Replay short commit tail idempotently' },
            { step: 4, label: 'Replace Local DB', desc: 'Atomically swap local encrypted DuckDB' },
            { step: 5, label: 'Hard-Delete Stale Rows', desc: 'Hard delete any rows outside 30-day window' },
          ].map((s) => {
            const isDone = compactProgress && compactProgress.step > s.step;
            const isCurrent = compactProgress && compactProgress.step === s.step;

            return (
              <div
                key={s.step}
                className={`p-3 rounded-lg border transition-all ${
                  isCurrent
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-950 ring-1 ring-indigo-400'
                    : isDone
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-neutral-50 border-neutral-200 text-neutral-600'
                }`}
              >
                <div className="flex items-center justify-between font-semibold mb-1">
                  <span>Step {s.step}</span>
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  ) : isCurrent ? (
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                  ) : (
                    <span className="text-[10px] text-neutral-400 font-mono">Pending</span>
                  )}
                </div>
                <div className="font-medium text-neutral-900">{s.label}</div>
                <div className="text-[11px] text-neutral-500 mt-1">{s.desc}</div>
              </div>
            );
          })}
        </div>

        {compactProgress && (
          <div className="p-3 bg-neutral-100 rounded text-xs font-mono text-neutral-800">
            Status: {compactProgress.message}
          </div>
        )}
      </div>
    </div>
  );
};
