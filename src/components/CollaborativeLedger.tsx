import React, { useState } from 'react';
import {
  Plus,
  Lock,
  Unlock,
  Trash2,
  Edit2,
  FileDown,
  Search,
  Filter,
  AlertCircle,
  Clock,
  Send,
  X,
  CheckCircle2,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { DatasetRecord, GranularLock, Intent, User, ViewFreezeState } from '../types';
import { exportDatasetAsParquet, exportDatasetAsCsv } from '../services/parquetExporter';
import { ConflictNotification } from '../services/syncClient';

interface CollaborativeLedgerProps {
  records: DatasetRecord[];
  currentUser: User;
  viewFreeze: ViewFreezeState;
  granularLocks: Record<string, GranularLock>;
  queue: Intent[];
  conflictNotifications: ConflictNotification[];
  onDismissConflict: (id: string) => void;
  lastRejectedIntent: Intent | null;
  onClearRejectedIntent: () => void;
  onSubmitIntent: (operation: 'create' | 'update' | 'delete', entity_id: string, payload: Record<string, any>) => void;
  onToggleGranularLock: (entity_id: string, locked: boolean) => void;
  onDrainQueue: () => void;
  isOffline: boolean;
}

export const CollaborativeLedger: React.FC<CollaborativeLedgerProps> = ({
  records,
  currentUser,
  viewFreeze,
  granularLocks,
  queue,
  conflictNotifications,
  onDismissConflict,
  lastRejectedIntent,
  onClearRejectedIntent,
  onSubmitIntent,
  onToggleGranularLock,
  onDrainQueue,
  isOffline,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DatasetRecord | null>(null);

  // Form states
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Finance');
  const [region, setRegion] = useState('North America');
  const [metricValue, setMetricValue] = useState('100000');
  const [status, setStatus] = useState<'active' | 'in_review' | 'finalized'>('active');

  const isReadOnly = currentUser.role === 'typical_user';
  const isFrozen = viewFreeze.frozen;

  const categories = ['ALL', 'Finance', 'Operations', 'Engineering', 'Research', 'Sustainability'];

  const filteredRecords = records.filter((r) => {
    const matchesSearch =
      r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.region.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'ALL' || r.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const openCreateModal = () => {
    setEditingRecord(null);
    setCode(`CORP-${Math.floor(1000 + Math.random() * 9000)}`);
    setTitle('');
    setCategory('Finance');
    setRegion('North America');
    setMetricValue('250000');
    setStatus('active');
    setIsModalOpen(true);
  };

  const openEditModal = (rec: DatasetRecord) => {
    setEditingRecord(rec);
    setCode(rec.code);
    setTitle(rec.title);
    setCategory(rec.category);
    setRegion(rec.region);
    setMetricValue(rec.metric_value.toString());
    setStatus(rec.status);
    setIsModalOpen(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const payload = {
      code,
      title: title.trim(),
      category,
      region,
      metric_value: Number(metricValue) || 0,
      status,
      is_locked: editingRecord ? editingRecord.is_locked : false,
      locked_by: editingRecord?.locked_by,
      updated_at: new Date().toISOString(),
    };

    if (editingRecord) {
      onSubmitIntent('update', editingRecord.id, payload);
    } else {
      const newId = `rec-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
      onSubmitIntent('create', newId, payload);
    }

    setIsModalOpen(false);
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this record? This creates an append-only delete commit in Git log.')) {
      onSubmitIntent('delete', id, {});
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. View Freeze Alert Banner (Architecture Section 10) */}
      {isFrozen && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 flex items-start space-x-3 text-amber-900 shadow-xs">
          <Lock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-amber-950 flex items-center gap-2">
              <span>Analytical View Frozen by Workspace Administrator</span>
              <span className="text-xs font-mono font-normal bg-amber-200 text-amber-900 px-2 py-0.5 rounded">
                Frozen by: {viewFreeze.frozen_by || 'Admin'}
              </span>
            </div>
            <p className="mt-1 text-amber-800">
              Reason: &ldquo;{viewFreeze.reason || 'Enterprise Reporting'}&rdquo;. All mutations are suspended to freeze the dataset for consistent financial reporting and audit.
            </p>
          </div>
        </div>
      )}

      {/* 2. Last-Write-Wins Conflict Notifications (Architecture Section 7) */}
      {conflictNotifications.map((conflict) => (
        <div
          key={conflict.id}
          className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-between text-blue-900 text-sm shadow-xs"
        >
          <div className="flex items-center space-x-2.5">
            <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              <strong>LWW Conflict Resolution:</strong> {conflict.message}
            </span>
          </div>
          <button
            onClick={() => onDismissConflict(conflict.id)}
            className="text-xs font-medium text-blue-700 hover:text-blue-900 px-2 py-1 rounded bg-blue-100"
          >
            Dismiss
          </button>
        </div>
      ))}

      {/* 3. Rejected Intent Notice (Architecture Section 8) */}
      {lastRejectedIntent && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-300 flex items-start justify-between text-red-900 shadow-xs">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-red-950">
                Intent Rejected by Backend Validator ({lastRejectedIntent.reject_reason})
              </div>
              <p className="mt-1 text-xs sm:text-sm text-red-800">
                {lastRejectedIntent.error_details || 'The mutation was rejected due to permission or state constraint.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClearRejectedIntent}
            className="text-red-700 hover:text-red-900 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4. Controls, Filters & Actions Bar */}
      <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search & Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="search-input"
              type="text"
              placeholder="Search code, title, region..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm bg-neutral-50 border border-neutral-300 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-neutral-900 w-56 sm:w-64"
            />
          </div>

          <div className="flex items-center space-x-1.5 text-xs text-neutral-600">
            <Filter className="w-3.5 h-3.5 text-neutral-500" />
            <select
              id="category-filter"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="py-1.5 px-2 bg-neutral-50 border border-neutral-300 rounded-md text-xs font-medium text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === 'ALL' ? 'All Categories' : c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          {/* Parquet Export */}
          <button
            id="export-parquet-btn"
            onClick={() => exportDatasetAsParquet(filteredRecords, 'duckdb_enterprise_dataset')}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 transition-colors"
            title="Export current dataset as Parquet format (Architecture Section 9)"
          >
            <FileDown className="w-3.5 h-3.5 text-indigo-600" />
            <span>Export Parquet</span>
          </button>

          <button
            id="export-csv-btn"
            onClick={() => exportDatasetAsCsv(filteredRecords, 'duckdb_enterprise_dataset')}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-300 transition-colors"
            title="Export current dataset as CSV"
          >
            <span>CSV</span>
          </button>

          {/* Add Record Button */}
          <button
            id="add-record-btn"
            onClick={openCreateModal}
            disabled={isReadOnly || isFrozen}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              isReadOnly || isFrozen
                ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed border border-neutral-300'
                : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-xs'
            }`}
            title={
              isReadOnly
                ? 'Read-only access: Typical User cannot submit mutations'
                : isFrozen
                ? 'Cannot add record: Materialized view is frozen by Admin'
                : 'Create new dataset record (optimistic write + intent queue)'
            }
          >
            <Plus className="w-4 h-4" />
            <span>Add Record</span>
          </button>
        </div>
      </div>

      {/* 5. Offline Queue Drawer if intents pending */}
      {queue.length > 0 && (
        <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-300 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 font-medium text-neutral-800">
              <Clock className="w-4 h-4 text-amber-600" />
              <span>Offline Intent Queue ({queue.length} pending mutations)</span>
            </div>
            <button
              id="drain-queue-btn"
              onClick={onDrainQueue}
              disabled={isOffline}
              className="flex items-center space-x-1 px-2.5 py-1 rounded bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 text-xs font-medium transition-colors"
            >
              <Send className="w-3 h-3" />
              <span>Drain & Submit Queue</span>
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {queue.map((item) => (
              <div
                key={item.intent_id}
                className="p-2 bg-white rounded border border-neutral-200 flex items-center justify-between"
              >
                <div>
                  <span className="uppercase font-semibold text-[10px] px-1 py-0.5 rounded bg-neutral-100 text-neutral-700 mr-1.5">
                    {item.operation}
                  </span>
                  <span className="font-mono text-neutral-900">{item.entity_id}</span>
                </div>
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    item.status === 'committed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : item.status === 'rejected'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Main Collaborative Table */}
      <div className="bg-white rounded-lg border border-neutral-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-medium text-xs">
              <tr>
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Title & Scope</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Region</th>
                <th className="py-3 px-4 text-right">Metric Value</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Lock State</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-neutral-600 text-sm">
                    No records found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r) => {
                  const lockInfo = granularLocks[r.id];
                  const isRecordLocked = Boolean(r.is_locked || (lockInfo && lockInfo.locked));
                  const canToggleLock =
                    currentUser.role === 'release_manager' || currentUser.role === 'workspace_admin';
                  const canEditRecord =
                    !isReadOnly && !isFrozen && (!isRecordLocked || canToggleLock);

                  return (
                    <tr key={r.id} className="hover:bg-neutral-50 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-neutral-800">
                        {r.code}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-neutral-900">{r.title}</div>
                        <div className="text-[11px] text-neutral-500 font-mono">
                          ID: {r.id} • Hash: {r.version_hash}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 border border-neutral-200">
                          {r.category}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-neutral-700 text-xs">{r.region}</td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-medium text-neutral-900">
                        ${r.metric_value.toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-medium ${
                            r.status === 'finalized'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : r.status === 'in_review'
                              ? 'bg-sky-50 text-sky-800 border border-sky-200'
                              : 'bg-neutral-100 text-neutral-800 border border-neutral-200'
                          }`}
                        >
                          {r.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {isRecordLocked ? (
                          <div className="flex items-center space-x-1 text-amber-700 text-xs font-medium">
                            <Lock className="w-3.5 h-3.5" />
                            <span>Locked</span>
                            <span className="text-[10px] text-neutral-500">
                              ({lockInfo?.locked_by || r.locked_by || 'Curator'})
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1 text-emerald-700 text-xs">
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Unlocked</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          {/* Granular Lock Button (Release Manager) */}
                          {canToggleLock && (
                            <button
                              id={`toggle-lock-${r.id}`}
                              onClick={() => onToggleGranularLock(r.id, !isRecordLocked)}
                              className={`p-1.5 rounded transition-colors ${
                                isRecordLocked
                                  ? 'text-amber-700 hover:bg-amber-100'
                                  : 'text-neutral-500 hover:bg-neutral-100'
                              }`}
                              title={
                                isRecordLocked
                                  ? 'Unlock record (Release Manager permission)'
                                  : 'Lock record from further contributor edits (Release Manager permission)'
                              }
                            >
                              {isRecordLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                            </button>
                          )}

                          {/* Edit button */}
                          <button
                            id={`edit-record-${r.id}`}
                            onClick={() => openEditModal(r)}
                            disabled={!canEditRecord}
                            className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded disabled:opacity-40 disabled:hover:bg-transparent"
                            title={
                              !canEditRecord
                                ? isRecordLocked
                                  ? 'Record is locked by Release Manager'
                                  : 'Editing disabled'
                                : 'Edit record'
                            }
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete button */}
                          <button
                            id={`delete-record-${r.id}`}
                            onClick={() => handleDelete(r.id)}
                            disabled={!canEditRecord}
                            className="p-1.5 text-neutral-400 hover:text-red-700 hover:bg-red-50 rounded disabled:opacity-40 disabled:hover:bg-transparent"
                            title="Delete record (appends delete commit to Git log)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7. Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-neutral-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <h3 className="text-base font-semibold text-neutral-900">
                {editingRecord ? 'Edit Collaborative Record' : 'Create New Collaborative Record'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    System Code
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-neutral-900 font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-neutral-900 text-xs"
                  >
                    {categories
                      .filter((c) => c !== 'ALL')
                      .map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Title / Initiative Description
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Asia-Pacific Renewable Logistics Grid"
                  required
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-neutral-900 text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Region
                  </label>
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="w-full px-2 py-2 bg-neutral-50 border border-neutral-300 rounded-md text-xs focus:bg-white focus:outline-none"
                  >
                    <option value="North America">North America</option>
                    <option value="EMEA">EMEA</option>
                    <option value="APAC">APAC</option>
                    <option value="LATAM">LATAM</option>
                    <option value="Global">Global</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Metric Value ($)
                  </label>
                  <input
                    type="number"
                    value={metricValue}
                    onChange={(e) => setMetricValue(e.target.value)}
                    required
                    className="w-full px-2 py-2 bg-neutral-50 border border-neutral-300 rounded-md text-xs font-mono focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full px-2 py-2 bg-neutral-50 border border-neutral-300 rounded-md text-xs focus:bg-white focus:outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="in_review">In Review</option>
                    <option value="finalized">Finalized</option>
                  </select>
                </div>
              </div>

              <div className="p-3 rounded-md bg-neutral-100 text-neutral-600 text-xs space-y-1">
                <div className="font-semibold text-neutral-800">
                  Local-First Append-Only Mutation Flow:
                </div>
                <div>
                  • Writes immediately to client DuckDB (optimistic preview)
                </div>
                <div>
                  • Generates intent in offline queue (auto-drained to Git authoritative log)
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-neutral-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-md border border-neutral-300 hover:bg-neutral-100 text-neutral-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium rounded-md bg-neutral-900 text-white hover:bg-neutral-800 shadow-xs"
                >
                  {editingRecord ? 'Save Changes' : 'Submit Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
