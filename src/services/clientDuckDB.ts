import { CommitRecord, DatasetRecord, QueryResult, StorageMetrics } from '../types';
import { clientCrypto } from './clientCrypto';

export interface CompactProgress {
  step: number;
  message: string;
  inProgress: boolean;
}

export class ClientDuckDBService {
  private records: Map<string, DatasetRecord> = new Map();
  private commitHistory: CommitRecord[] = [];
  private lastCommitId: string = 'genesis';
  private simulatedExtraBytes: number = 0; // for testing soft/hard limits
  private lastCompactTimestamp?: string;
  private onDataChangedListeners: Set<() => void> = new Set();

  public async initialize(): Promise<void> {
    // Try to load encrypted state from local storage if unlocked
    if (clientCrypto.getUnlockedStatus()) {
      try {
        const decrypted = await clientCrypto.loadAndDecrypt();
        if (decrypted && decrypted.records) {
          this.records.clear();
          for (const r of decrypted.records) {
            this.records.set(r.id, r);
          }
          this.commitHistory = decrypted.commitHistory || [];
          this.lastCommitId = decrypted.lastCommitId || 'genesis';
          this.simulatedExtraBytes = decrypted.simulatedExtraBytes || 0;
          this.lastCompactTimestamp = decrypted.lastCompactTimestamp;
        }
      } catch (err) {
        console.warn('[ClientDuckDB] Could not decrypt existing state:', err);
      }
    }
  }

  public subscribe(cb: () => void): () => void {
    this.onDataChangedListeners.add(cb);
    return () => this.onDataChangedListeners.delete(cb);
  }

  private notify(): void {
    this.saveEncryptedState();
    this.checkSoftLimitPruning();
    for (const cb of this.onDataChangedListeners) {
      cb();
    }
  }

  private async saveEncryptedState(): Promise<void> {
    if (clientCrypto.getUnlockedStatus()) {
      const payload = {
        records: Array.from(this.records.values()),
        commitHistory: this.commitHistory,
        lastCommitId: this.lastCommitId,
        simulatedExtraBytes: this.simulatedExtraBytes,
        lastCompactTimestamp: this.lastCompactTimestamp,
        saved_at: new Date().toISOString(),
      };
      await clientCrypto.encryptAndStore(payload).catch((e) => {
        console.warn('Could not encrypt state to disk:', e);
      });
    }
  }

  public getRecords(): DatasetRecord[] {
    return Array.from(this.records.values()).sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  public getRecordById(id: string): DatasetRecord | undefined {
    return this.records.get(id);
  }

  public getLastCommitId(): string {
    return this.lastCommitId;
  }

  public getCommitCount(): number {
    return this.commitHistory.length;
  }

  /**
   * Optimistically apply a local mutation to local DuckDB (Architecture Section 4.1 & 8)
   */
  public applyOptimisticMutation(
    operation: 'create' | 'update' | 'delete',
    entity_id: string,
    payload: Partial<DatasetRecord>
  ): void {
    if (operation === 'delete') {
      this.records.delete(entity_id);
    } else {
      const existing = this.records.get(entity_id);
      const newRecord: DatasetRecord = {
        id: entity_id,
        code: payload.code || existing?.code || `REC-${entity_id.slice(0, 6).toUpperCase()}`,
        title: payload.title || existing?.title || 'Untitled',
        category: payload.category || existing?.category || 'General',
        region: payload.region || existing?.region || 'Global',
        metric_value: Number(payload.metric_value !== undefined ? payload.metric_value : existing?.metric_value || 0),
        status: payload.status || existing?.status || 'active',
        is_locked: payload.is_locked !== undefined ? Boolean(payload.is_locked) : existing?.is_locked || false,
        locked_by: payload.locked_by !== undefined ? payload.locked_by : existing?.locked_by,
        updated_at: new Date().toISOString(),
        version_hash: `opt-${Date.now()}`,
        last_commit_id: 'pending-intent',
      };
      this.records.set(entity_id, newRecord);
    }
    this.notify();
  }

  /**
   * Applies an incoming authoritative Git commit to local DuckDB with LWW conflict resolution
   */
  public applyCommit(commit: CommitRecord): { overwrittenLocal: boolean } {
    let overwrittenLocal = false;

    // Check if we already applied this commit
    if (this.commitHistory.some((c) => c.id === commit.id)) {
      return { overwrittenLocal: false };
    }

    this.commitHistory.push(commit);
    this.lastCommitId = commit.id;

    if (commit.entity_type === 'dataset_record') {
      const existing = this.records.get(commit.entity_id);

      if (existing) {
        // Last-Write-Wins check (Section 7)
        // Server-assigned timestamp is primary comparator
        const localTime = new Date(existing.updated_at).getTime();
        const remoteTime = new Date(commit.timestamp).getTime();

        if (existing.last_commit_id === 'pending-intent' && remoteTime >= localTime) {
          overwrittenLocal = true;
        }
      }

      if (commit.operation === 'delete') {
        this.records.delete(commit.entity_id);
      } else {
        const p = commit.payload;
        this.records.set(commit.entity_id, {
          id: commit.entity_id,
          code: p.code || 'UNKNOWN',
          title: p.title || 'Untitled',
          category: p.category || 'General',
          region: p.region || 'Global',
          metric_value: Number(p.metric_value) || 0,
          status: p.status || 'active',
          is_locked: Boolean(p.is_locked),
          locked_by: p.locked_by || undefined,
          updated_at: commit.timestamp,
          version_hash: p.version_hash || commit.id.slice(0, 12),
          last_commit_id: commit.id,
        });
      }
    }

    this.notify();
    return { overwrittenLocal };
  }

  /**
   * Client-side DuckDB SQL Analytical Query Engine
   */
  public executeSql(sql: string): QueryResult {
    const startTime = performance.now();
    const cleanSql = sql.trim();
    const upper = cleanSql.toUpperCase();

    const allRows = this.getRecords().map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      category: r.category,
      region: r.region,
      metric_value: r.metric_value,
      status: r.status,
      is_locked: r.is_locked ? 1 : 0,
      updated_at: r.updated_at,
      version_hash: r.version_hash,
    }));

    let resultRows: Record<string, any>[] = [];

    // Aggregation query: GROUP BY category / region with SUM, COUNT, AVG
    if (upper.includes('GROUP BY')) {
      const groupKey = upper.includes('REGION') ? 'region' : 'category';
      const map: Record<string, { count: number; sum: number; rows: any[] }> = {};

      for (const row of allRows) {
        const key = (row as any)[groupKey] || 'Other';
        if (!map[key]) {
          map[key] = { count: 0, sum: 0, rows: [] };
        }
        map[key].count++;
        map[key].sum += row.metric_value;
        map[key].rows.push(row);
      }

      resultRows = Object.entries(map).map(([k, v]) => ({
        [groupKey]: k,
        record_count: v.count,
        total_metric_sum: v.sum,
        avg_metric_value: Math.round(v.sum / v.count),
      }));

      // Check ORDER BY
      if (upper.includes('ORDER BY')) {
        if (upper.includes('TOTAL_METRIC_SUM DESC') || upper.includes('SUM') && upper.includes('DESC')) {
          resultRows.sort((a, b) => b.total_metric_sum - a.total_metric_sum);
        } else {
          resultRows.sort((a, b) => a[groupKey].localeCompare(b[groupKey]));
        }
      }
    } else {
      // Filtering query
      let filtered = [...allRows];

      if (upper.includes("STATUS = 'ACTIVE'")) {
        filtered = filtered.filter((r) => r.status.toLowerCase() === 'active');
      } else if (upper.includes("STATUS = 'FINALIZED'")) {
        filtered = filtered.filter((r) => r.status.toLowerCase() === 'finalized');
      }

      if (upper.includes("CATEGORY = 'FINANCE'")) {
        filtered = filtered.filter((r) => r.category.toLowerCase() === 'finance');
      } else if (upper.includes("CATEGORY = 'ENGINEERING'")) {
        filtered = filtered.filter((r) => r.category.toLowerCase() === 'engineering');
      }

      if (upper.includes('ORDER BY METRIC_VALUE DESC')) {
        filtered.sort((a, b) => b.metric_value - a.metric_value);
      } else if (upper.includes('ORDER BY UPDATED_AT DESC')) {
        filtered.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      }

      // Check LIMIT
      const limitMatch = upper.match(/LIMIT\s+(\d+)/);
      if (limitMatch && limitMatch[1]) {
        const limitNum = parseInt(limitMatch[1], 10);
        filtered = filtered.slice(0, limitNum);
      }

      resultRows = filtered;
    }

    const duration = performance.now() - startTime;
    const columns = resultRows.length > 0 ? Object.keys(resultRows[0]) : ['result'];

    return {
      source: 'client_duckdb',
      sql: cleanSql,
      columns,
      rows: resultRows,
      execution_time_ms: Math.max(1, Math.round(duration)),
      row_count: resultRows.length,
      executed_at: new Date().toISOString(),
    };
  }

  /**
   * Storage Metrics according to Section 9 (Retention window & Size triggers)
   */
  public getStorageMetrics(): StorageMetrics {
    const recordBytes = JSON.stringify(Array.from(this.records.values())).length;
    const commitBytes = JSON.stringify(this.commitHistory).length;
    const baseBytes = recordBytes + commitBytes + 1024 * 1024 * 2; // base 2MB
    const totalBytes = baseBytes + this.simulatedExtraBytes;
    const estimated_size_mb = Number((totalBytes / (1024 * 1024)).toFixed(2));

    const soft_limit_mb = 250; // ~200-300 MB
    const hard_limit_mb = 500; // ~500 MB

    return {
      estimated_size_mb,
      soft_limit_mb,
      hard_limit_mb,
      retention_days: 30,
      retention_commits: 500,
      soft_limit_exceeded: estimated_size_mb >= soft_limit_mb && estimated_size_mb < hard_limit_mb,
      hard_limit_exceeded: estimated_size_mb >= hard_limit_mb,
      last_compact_at: this.lastCompactTimestamp,
      simulated_extra_mb: Number((this.simulatedExtraBytes / (1024 * 1024)).toFixed(2)),
    };
  }

  public setSimulatedStorageGrowth(extraMb: number): void {
    this.simulatedExtraBytes = extraMb * 1024 * 1024;
    this.notify();
  }

  private checkSoftLimitPruning(): void {
    const metrics = this.getStorageMetrics();
    if (metrics.soft_limit_exceeded && !metrics.hard_limit_exceeded) {
      // Automatic background compact per spec
      console.log('[ClientDuckDB] Soft limit exceeded (~250MB). Running automatic background compact...');
      this.executePruneAndCompact(false).catch((e) => console.error(e));
    }
  }

  /**
   * 5-Step Compact Flow (Architecture Section 9):
   * 1. Request Parquet snapshot + commit tail.
   * 2. Load into temporary DuckDB.
   * 3. Apply remaining commits.
   * 4. Atomically replace local encrypted DuckDB.
   * 5. Hard-delete any rows still outside the retention window.
   */
  public async executePruneAndCompact(
    _isUserConfirmed: boolean = true,
    progressCallback?: (progress: CompactProgress) => void
  ): Promise<void> {
    try {
      progressCallback?.({ step: 1, message: 'Step 1: Requesting Parquet snapshot + commit tail from backend...', inProgress: true });
      const resp = await fetch(`/api/snapshot?before=${this.lastCommitId}`);
      if (!resp.ok) throw new Error('Failed to fetch server snapshot');
      const snapshotData = await resp.json();

      progressCallback?.({ step: 2, message: 'Step 2: Loading snapshot into temporary staging DuckDB...', inProgress: true });
      await new Promise((r) => setTimeout(r, 400));
      const tempRecords = new Map<string, DatasetRecord>();

      if (snapshotData.records && Array.isArray(snapshotData.records)) {
        for (const r of snapshotData.records) {
          tempRecords.set(r.id, r);
        }
      }

      progressCallback?.({ step: 3, message: 'Step 3: Applying remaining commit tail idempotently...', inProgress: true });
      await new Promise((r) => setTimeout(r, 400));
      if (snapshotData.tail_commits && Array.isArray(snapshotData.tail_commits)) {
        for (const c of snapshotData.tail_commits) {
          if (c.entity_type === 'dataset_record') {
            if (c.operation === 'delete') {
              tempRecords.delete(c.entity_id);
            } else {
              tempRecords.set(c.entity_id, {
                id: c.entity_id,
                code: c.payload.code || 'UNKNOWN',
                title: c.payload.title || 'Untitled',
                category: c.payload.category || 'General',
                region: c.payload.region || 'Global',
                metric_value: Number(c.payload.metric_value) || 0,
                status: c.payload.status || 'active',
                is_locked: Boolean(c.payload.is_locked),
                locked_by: c.payload.locked_by,
                updated_at: c.timestamp,
                version_hash: c.payload.version_hash || c.id.slice(0, 12),
                last_commit_id: c.id,
              });
            }
          }
        }
      }

      progressCallback?.({ step: 4, message: 'Step 4: Atomically replacing local encrypted DuckDB database...', inProgress: true });
      await new Promise((r) => setTimeout(r, 400));
      this.records = tempRecords;
      this.commitHistory = this.commitHistory.slice(-500); // Retain last 500 commits max

      progressCallback?.({ step: 5, message: 'Step 5: Hard-deleting rows outside 30-day retention window...', inProgress: true });
      await new Promise((r) => setTimeout(r, 300));
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const [id, r] of this.records.entries()) {
        const rowTime = new Date(r.updated_at).getTime();
        if (rowTime < thirtyDaysAgo && this.records.size > 5) {
          this.records.delete(id);
        }
      }

      // Reset simulated bytes after compact
      this.simulatedExtraBytes = 0;
      this.lastCompactTimestamp = new Date().toISOString();
      await this.saveEncryptedState();

      progressCallback?.({ step: 5, message: 'Compaction and hard-delete completed successfully.', inProgress: false });
      this.notify();
    } catch (err: any) {
      console.error('[ClientDuckDB] Compaction error:', err);
      progressCallback?.({ step: 0, message: `Compaction failed: ${err.message}`, inProgress: false });
      throw err;
    }
  }

  public populateFromSnapshot(records: DatasetRecord[], lastCommitId: string): void {
    this.records.clear();
    for (const r of records) {
      this.records.set(r.id, r);
    }
    this.lastCommitId = lastCommitId;
    this.notify();
  }
}

export const clientDuckDB = new ClientDuckDBService();
