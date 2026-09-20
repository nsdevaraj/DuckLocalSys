/**
 * Types and interfaces for the Local-First Collaborative System
 * with Git-Backed Log & Dual DuckDB Architecture.
 */

export type UserRole =
  | 'workspace_admin'
  | 'release_manager'
  | 'contributor'
  | 'typical_user';

export interface User {
  user_id: string;
  email: string;
  display_name: string;
  role: UserRole;
  avatar_initials: string;
}

export type MutationOperation = 'create' | 'update' | 'delete';

export interface CommitActor {
  user_id: string;
  display_name?: string;
}

/**
 * Structured Git-backed commit payload according to Architecture spec Section 5.
 */
export interface CommitRecord {
  id: string; // Content-addressable SHA-256 hash
  parent_ids: string[]; // Parent commit hashes
  timestamp: string; // Server-assigned ISO 8601 timestamp (primary LWW comparator)
  actor: CommitActor;
  operation: MutationOperation;
  entity_type: string;
  entity_id: string;
  payload: Record<string, any>;
  previous_version: string;
  signature: string; // Cryptographic backend HMAC-SHA256 signature
}

/**
 * Client intent in the offline/local intent queue before server acceptance.
 */
export interface Intent {
  intent_id: string;
  entity_type: string;
  entity_id: string;
  operation: MutationOperation;
  payload: Record<string, any>;
  previous_version: string;
  client_timestamp: string;
  status: 'queued' | 'syncing' | 'committed' | 'rejected';
  reject_reason?: string;
  error_details?: string;
}

/**
 * Business entity record managed in both DuckDB instances.
 */
export interface DatasetRecord {
  id: string;
  code: string;
  title: string;
  category: string;
  region: string;
  metric_value: number;
  status: 'active' | 'in_review' | 'finalized';
  is_locked: boolean;
  locked_by?: string;
  updated_at: string;
  version_hash: string;
  last_commit_id?: string;
}

export interface GranularLock {
  entity_id: string;
  locked: boolean;
  locked_by: string;
  locked_at: string;
}

export interface ViewFreezeState {
  frozen: boolean;
  frozen_by?: string;
  frozen_at?: string;
  reason?: string;
  locked_snapshot_id?: string;
}

export interface SystemOverview {
  latest_commit_id: string;
  commit_count: number;
  records_count: number;
  view_freeze: ViewFreezeState;
  locks: Record<string, GranularLock>;
  server_timestamp: string;
  backend_duckdb_ready: boolean;
  git_repo_ready: boolean;
}

export interface QueryResult {
  source: 'client_duckdb' | 'backend_duckdb';
  sql: string;
  columns: string[];
  rows: Record<string, any>[];
  execution_time_ms: number;
  row_count: number;
  executed_at: string;
}

export interface ParquetSnapshotMeta {
  snapshot_id: string;
  created_at: string;
  commit_id: string;
  record_count: number;
  size_bytes: number;
  download_url: string;
}

export interface StorageMetrics {
  estimated_size_mb: number;
  soft_limit_mb: number;
  hard_limit_mb: number;
  retention_days: number;
  retention_commits: number;
  soft_limit_exceeded: boolean;
  hard_limit_exceeded: boolean;
  last_compact_at?: string;
  simulated_extra_mb: number;
}
