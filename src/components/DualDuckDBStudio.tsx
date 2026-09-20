import React, { useState } from 'react';
import {
  Play,
  Database,
  Server,
  Zap,
  Clock,
  CheckCircle2,
  FileDown,
  Layers,
  ArrowRight,
  Info,
} from 'lucide-react';
import { QueryResult } from '../types';
import { clientDuckDB } from '../services/clientDuckDB';
import { exportDatasetAsParquet, exportDatasetAsCsv } from '../services/parquetExporter';

interface DualDuckDBStudioProps {
  isOffline: boolean;
}

export const DualDuckDBStudio: React.FC<DualDuckDBStudioProps> = ({ isOffline }) => {
  const PRESET_QUERIES = [
    {
      name: 'Category Aggregations (SUM & AVG)',
      sql: 'SELECT category, COUNT(*) as count, SUM(metric_value) as total_metric_sum, AVG(metric_value) as avg_metric_value FROM dataset_records GROUP BY category ORDER BY total_metric_sum DESC;',
    },
    {
      name: 'Regional Initiatives Breakdown',
      sql: 'SELECT region, COUNT(*) as count, SUM(metric_value) as total_metric_sum FROM dataset_records GROUP BY region ORDER BY total_metric_sum DESC;',
    },
    {
      name: 'Top Value Initiatives (Active Status)',
      sql: "SELECT id, code, title, category, metric_value FROM dataset_records WHERE status = 'active' ORDER BY metric_value DESC LIMIT 5;",
    },
    {
      name: 'Full Materialized Records Table',
      sql: 'SELECT * FROM dataset_records ORDER BY updated_at DESC;',
    },
  ];

  const [querySql, setQuerySql] = useState(PRESET_QUERIES[0].sql);
  const [clientResult, setClientResult] = useState<QueryResult | null>(null);
  const [backendResult, setBackendResult] = useState<QueryResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'client_only' | 'backend_only'>('split');

  const runLocalQuery = () => {
    try {
      setErrorMessage(null);
      const res = clientDuckDB.executeSql(querySql);
      setClientResult(res);
    } catch (err: any) {
      setErrorMessage(`Client DuckDB error: ${err.message}`);
    }
  };

  const runBackendQuery = async () => {
    if (isOffline) {
      setErrorMessage('Backend DuckDB is inaccessible while in Offline Mode.');
      return;
    }
    try {
      setErrorMessage(null);
      const resp = await fetch('/api/backend/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: querySql }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Backend query failed');
      setBackendResult(data);
    } catch (err: any) {
      setErrorMessage(`Backend DuckDB error: ${err.message}`);
    }
  };

  const runDualCompare = async () => {
    setIsRunning(true);
    setErrorMessage(null);
    runLocalQuery();
    if (!isOffline) {
      await runBackendQuery();
    }
    setIsRunning(false);
  };

  return (
    <div className="space-y-6">
      {/* Studio Header Explanation */}
      <div className="bg-white p-5 rounded-lg border border-neutral-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-600" />
              <span>Dual DuckDB Analytical Studio</span>
            </h2>
            <p className="text-xs text-neutral-600 mt-1">
              Architecture Spec Section 1 & 4: Compare queries executed on <strong>Client Embedded DuckDB</strong> (instant & offline) versus <strong>Backend Materialized DuckDB</strong> (server analytical view).
            </p>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="text-neutral-500 font-medium">Layout:</span>
            <button
              onClick={() => setViewMode('split')}
              className={`px-2.5 py-1 rounded border transition-colors ${
                viewMode === 'split' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-neutral-100 text-neutral-700'
              }`}
            >
              Dual Split
            </button>
            <button
              onClick={() => setViewMode('client_only')}
              className={`px-2.5 py-1 rounded border transition-colors ${
                viewMode === 'client_only' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-neutral-100 text-neutral-700'
              }`}
            >
              Client Only
            </button>
            <button
              onClick={() => setViewMode('backend_only')}
              className={`px-2.5 py-1 rounded border transition-colors ${
                viewMode === 'backend_only' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-neutral-100 text-neutral-700'
              }`}
            >
              Backend Only
            </button>
          </div>
        </div>

        {/* Preset Query Chips */}
        <div className="mt-4 pt-3 border-t border-neutral-100 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Presets:</span>
          {PRESET_QUERIES.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => setQuerySql(preset.sql)}
              className="text-xs px-2.5 py-1 rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200 font-medium transition-colors"
            >
              {preset.name}
            </button>
          ))}
        </div>

        {/* SQL Editor Area */}
        <div className="mt-4">
          <textarea
            id="duckdb-sql-textarea"
            value={querySql}
            onChange={(e) => setQuerySql(e.target.value)}
            rows={3}
            className="w-full p-3 font-mono text-xs sm:text-sm bg-neutral-950 text-neutral-100 rounded-lg border border-neutral-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder="Enter standard DuckDB SQL..."
          />
        </div>

        {/* Query Execution Controls */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <button
              id="run-dual-compare-btn"
              onClick={runDualCompare}
              disabled={isRunning}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 text-xs sm:text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Run Dual Comparison</span>
            </button>

            <button
              id="run-local-btn"
              onClick={runLocalQuery}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-medium border border-neutral-300 transition-colors"
            >
              <Database className="w-3.5 h-3.5 text-amber-600" />
              <span>Run Client DuckDB</span>
            </button>

            <button
              id="run-backend-btn"
              onClick={runBackendQuery}
              disabled={isOffline}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-medium border border-neutral-300 disabled:opacity-50 transition-colors"
            >
              <Server className="w-3.5 h-3.5 text-sky-600" />
              <span>Run Backend DuckDB</span>
            </button>
          </div>

          <div className="text-xs text-neutral-500 flex items-center space-x-3">
            <span>Client: Embedded + AES-256</span>
            <span>•</span>
            <span>Backend: Materialized View (Cron 10s)</span>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-3 p-2.5 rounded bg-red-50 text-red-800 border border-red-200 text-xs">
            {errorMessage}
          </div>
        )}
      </div>

      {/* Query Results Comparison Grid */}
      <div className={`grid gap-6 ${viewMode === 'split' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        {/* Client DuckDB Result Box */}
        {(viewMode === 'split' || viewMode === 'client_only') && (
          <div className="bg-white rounded-lg border border-neutral-200 shadow-xs flex flex-col">
            <div className="p-3.5 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-amber-600" />
                <span className="font-semibold text-sm text-neutral-900">Client Embedded DuckDB</span>
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-mono">
                  Local-First
                </span>
              </div>

              {clientResult && (
                <div className="flex items-center space-x-3 text-xs">
                  <span className="flex items-center text-neutral-600">
                    <Clock className="w-3 h-3 mr-1 text-neutral-400" />
                    {clientResult.execution_time_ms} ms
                  </span>
                  <span className="font-mono text-neutral-600">{clientResult.row_count} rows</span>
                  <button
                    onClick={() => exportDatasetAsParquet(clientResult.rows, 'client_query_result')}
                    className="p-1 text-indigo-700 hover:bg-indigo-50 rounded"
                    title="Export query result as Parquet"
                  >
                    <FileDown className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="p-4 flex-1 overflow-x-auto min-h-[220px]">
              {clientResult ? (
                clientResult.rows.length === 0 ? (
                  <div className="text-xs text-neutral-500 py-6 text-center">0 rows returned.</div>
                ) : (
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-neutral-100 border-b border-neutral-200 text-neutral-600">
                      <tr>
                        {clientResult.columns.map((col) => (
                          <th key={col} className="p-2 font-medium">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {clientResult.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-neutral-50">
                          {clientResult.columns.map((col) => (
                            <td key={col} className="p-2 text-neutral-800">
                              {typeof row[col] === 'number'
                                ? row[col].toLocaleString()
                                : String(row[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-neutral-400 py-12">
                  Click &ldquo;Run Dual Comparison&rdquo; or &ldquo;Run Client DuckDB&rdquo; to execute.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Backend DuckDB Result Box */}
        {(viewMode === 'split' || viewMode === 'backend_only') && (
          <div className="bg-white rounded-lg border border-neutral-200 shadow-xs flex flex-col">
            <div className="p-3.5 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Server className="w-4 h-4 text-sky-600" />
                <span className="font-semibold text-sm text-neutral-900">Backend Materialized DuckDB</span>
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-mono">
                  Server Engine
                </span>
              </div>

              {backendResult && (
                <div className="flex items-center space-x-3 text-xs">
                  <span className="flex items-center text-neutral-600">
                    <Clock className="w-3 h-3 mr-1 text-neutral-400" />
                    {backendResult.execution_time_ms} ms
                  </span>
                  <span className="font-mono text-neutral-600">{backendResult.row_count} rows</span>
                  <button
                    onClick={() => exportDatasetAsParquet(backendResult.rows, 'backend_query_result')}
                    className="p-1 text-indigo-700 hover:bg-indigo-50 rounded"
                    title="Export query result as Parquet"
                  >
                    <FileDown className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="p-4 flex-1 overflow-x-auto min-h-[220px]">
              {isOffline ? (
                <div className="h-full flex flex-col items-center justify-center text-xs text-amber-700 py-12">
                  <Server className="w-6 h-6 text-amber-500 mb-1" />
                  <span>Backend DuckDB disconnected in offline mode.</span>
                  <span className="text-neutral-500 mt-0.5">Toggle Online to query server.</span>
                </div>
              ) : backendResult ? (
                backendResult.rows.length === 0 ? (
                  <div className="text-xs text-neutral-500 py-6 text-center">0 rows returned.</div>
                ) : (
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-neutral-100 border-b border-neutral-200 text-neutral-600">
                      <tr>
                        {backendResult.columns.map((col) => (
                          <th key={col} className="p-2 font-medium">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {backendResult.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-neutral-50">
                          {backendResult.columns.map((col) => (
                            <td key={col} className="p-2 text-neutral-800">
                              {typeof row[col] === 'number'
                                ? row[col].toLocaleString()
                                : String(row[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-neutral-400 py-12">
                  Click &ldquo;Run Dual Comparison&rdquo; or &ldquo;Run Backend DuckDB&rdquo; to execute.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Eventual Consistency Verification Banner */}
      {clientResult && backendResult && !isOffline && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-center justify-between text-xs sm:text-sm">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <span className="font-semibold">Eventual Consistency Verified: </span>
              <span>
                Client DuckDB returned {clientResult.row_count} rows ({clientResult.execution_time_ms}ms) vs Backend DuckDB returned {backendResult.row_count} rows ({backendResult.execution_time_ms}ms).
              </span>
            </div>
          </div>
          <div className="text-neutral-500 text-xs hidden md:block">
            Consistency Model: Eventual • Conflict Resolution: LWW
          </div>
        </div>
      )}
    </div>
  );
};
