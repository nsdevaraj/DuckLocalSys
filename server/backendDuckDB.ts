import duckdb from 'duckdb';
import path from 'path';
import fs from 'fs';
import { CommitRecord, DatasetRecord, GranularLock, ViewFreezeState } from '../src/types';

export class BackendDuckDB {
  private db: duckdb.Database | null = null;
  private conn: duckdb.Connection | null = null;
  private dbPath: string;
  private snapshotsDir: string;
  private isInitialized = false;
  private viewFreeze: ViewFreezeState = {
    frozen: false,
  };
  private locks: Map<string, GranularLock> = new Map();

  constructor() {
    this.dbPath = path.resolve(process.cwd(), '.duckdb_backend.db');
    this.snapshotsDir = path.resolve(process.cwd(), 'public', 'snapshots');
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }

    this.db = new duckdb.Database(this.dbPath);
    this.conn = this.db.connect();

    await this.runSql(`
      CREATE TABLE IF NOT EXISTS dataset_records (
        id VARCHAR PRIMARY KEY,
        code VARCHAR,
        title VARCHAR,
        category VARCHAR,
        region VARCHAR,
        metric_value DOUBLE,
        status VARCHAR,
        is_locked BOOLEAN,
        locked_by VARCHAR,
        updated_at TIMESTAMP,
        version_hash VARCHAR,
        last_commit_id VARCHAR
      );
    `);

    await this.runSql(`
      CREATE TABLE IF NOT EXISTS materialized_audit_commits (
        commit_id VARCHAR PRIMARY KEY,
        parent_id VARCHAR,
        timestamp TIMESTAMP,
        actor_id VARCHAR,
        operation VARCHAR,
        entity_id VARCHAR,
        signature VARCHAR
      );
    `);

    // Seed initial demo collaborative records if empty
    const countResult = await this.query('SELECT COUNT(*) as cnt FROM dataset_records');
    const count = Number(countResult[0]?.cnt || 0);

    if (count === 0) {
      await this.seedInitialRecords();
    }

    this.isInitialized = true;
    console.log('[Backend DuckDB] Initialized successfully at', this.dbPath);
  }

  private async seedInitialRecords(): Promise<void> {
    const initialRecords: DatasetRecord[] = [
      {
        id: 'rec-001',
        code: 'FIN-Q1-GLOBAL',
        title: 'Global Enterprise Q1 Margin Allocation',
        category: 'Finance',
        region: 'North America',
        metric_value: 2450000,
        status: 'active',
        is_locked: false,
        updated_at: new Date('2026-09-18T10:00:00Z').toISOString(),
        version_hash: 'v1-init-001',
      },
      {
        id: 'rec-002',
        code: 'OPS-EU-SUPPLY',
        title: 'Central European Distribution Hub Logistics',
        category: 'Operations',
        region: 'EMEA',
        metric_value: 1820000,
        status: 'active',
        is_locked: false,
        updated_at: new Date('2026-09-19T14:30:00Z').toISOString(),
        version_hash: 'v1-init-002',
      },
      {
        id: 'rec-003',
        code: 'TECH-APAC-INFRA',
        title: 'Asia-Pacific Multi-Region Cloud Compute Infrastructure',
        category: 'Engineering',
        region: 'APAC',
        metric_value: 3910000,
        status: 'in_review',
        is_locked: false,
        updated_at: new Date('2026-09-20T02:15:00Z').toISOString(),
        version_hash: 'v1-init-003',
      },
      {
        id: 'rec-004',
        code: 'RND-QUANT-MODEL',
        title: 'Autonomous Portfolio Risk Simulation Grid',
        category: 'Research',
        region: 'Global',
        metric_value: 940000,
        status: 'active',
        is_locked: false,
        updated_at: new Date('2026-09-20T04:00:00Z').toISOString(),
        version_hash: 'v1-init-004',
      },
      {
        id: 'rec-005',
        code: 'ESG-ENERGY-EFF',
        title: 'Carbon Neutrality & Renewable Offsets Program',
        category: 'Sustainability',
        region: 'LATAM',
        metric_value: 650000,
        status: 'finalized',
        is_locked: false,
        updated_at: new Date('2026-09-20T04:30:00Z').toISOString(),
        version_hash: 'v1-init-005',
      },
    ];

    for (const r of initialRecords) {
      await this.runSql(`
        INSERT INTO dataset_records VALUES (
          '${r.id}',
          '${r.code}',
          '${r.title.replace(/'/g, "''")}',
          '${r.category}',
          '${r.region}',
          ${r.metric_value},
          '${r.status}',
          ${r.is_locked},
          ${r.locked_by ? `'${r.locked_by}'` : 'NULL'},
          '${r.updated_at}',
          '${r.version_hash}',
          'genesis'
        );
      `);
    }
  }

  public async runSql(sql: string): Promise<void> {
    if (!this.conn) await this.initialize();
    return new Promise((resolve, reject) => {
      this.conn!.run(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async query(sql: string): Promise<Record<string, any>[]> {
    if (!this.conn) await this.initialize();
    const start = Date.now();
    return new Promise((resolve, reject) => {
      this.conn!.all(sql, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as Record<string, any>[]);
        }
      });
    });
  }

  public async applyCommit(commit: CommitRecord): Promise<void> {
    await this.initialize();

    if (commit.entity_type === 'dataset_record') {
      const { operation, entity_id, payload, timestamp, id } = commit;

      if (operation === 'delete') {
        await this.runSql(`DELETE FROM dataset_records WHERE id = '${entity_id}'`);
      } else {
        // create or update
        const code = (payload.code || 'UNKNOWN').replace(/'/g, "''");
        const title = (payload.title || 'Untitled').replace(/'/g, "''");
        const category = (payload.category || 'General').replace(/'/g, "''");
        const region = (payload.region || 'Global').replace(/'/g, "''");
        const metric_value = Number(payload.metric_value) || 0;
        const status = (payload.status || 'active').replace(/'/g, "''");
        const is_locked = payload.is_locked ? true : false;
        const locked_by = payload.locked_by ? `'${payload.locked_by}'` : 'NULL';
        const version_hash = (payload.version_hash || id.slice(0, 12)).replace(/'/g, "''");

        // Delete existing and insert for clean idempotent UPSERT in DuckDB
        await this.runSql(`DELETE FROM dataset_records WHERE id = '${entity_id}'`);
        await this.runSql(`
          INSERT INTO dataset_records VALUES (
            '${entity_id}',
            '${code}',
            '${title}',
            '${category}',
            '${region}',
            ${metric_value},
            '${status}',
            ${is_locked},
            ${locked_by},
            '${timestamp}',
            '${version_hash}',
            '${id}'
          );
        `);
      }
    }

    // Record in audit table
    await this.runSql(`
      INSERT OR REPLACE INTO materialized_audit_commits VALUES (
        '${commit.id}',
        '${commit.parent_ids[0] || 'none'}',
        '${commit.timestamp}',
        '${commit.actor.user_id}',
        '${commit.operation}',
        '${commit.entity_id}',
        '${commit.signature}'
      );
    `);
  }

  public async getAllRecords(): Promise<DatasetRecord[]> {
    await this.initialize();
    const rows = await this.query(`
      SELECT 
        id, code, title, category, region, metric_value, status,
        is_locked, locked_by, strftime(updated_at, '%Y-%m-%dT%H:%M:%SZ') as updated_at,
        version_hash, last_commit_id
      FROM dataset_records
      ORDER BY updated_at DESC;
    `);

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      category: r.category,
      region: r.region,
      metric_value: Number(r.metric_value),
      status: r.status,
      is_locked: Boolean(r.is_locked),
      locked_by: r.locked_by || undefined,
      updated_at: r.updated_at,
      version_hash: r.version_hash,
      last_commit_id: r.last_commit_id,
    }));
  }

  /**
   * Generates a Parquet snapshot file of current records using DuckDB COPY ... (FORMAT PARQUET)
   */
  public async generateParquetSnapshot(commitId: string): Promise<{ snapshotId: string; filePath: string; recordCount: number; sizeBytes: number }> {
    await this.initialize();
    const snapshotId = `snapshot_${commitId.slice(0, 12)}_${Date.now()}`;
    const filename = `${snapshotId}.parquet`;
    const fullPath = path.join(this.snapshotsDir, filename);

    try {
      // DuckDB parquet output
      await this.runSql(`COPY dataset_records TO '${fullPath}' (FORMAT PARQUET);`);
    } catch (err: any) {
      // If native parquet extension needs fallback, write structured data snapshot
      console.warn('Native parquet copy fallback:', err.message);
      const rows = await this.getAllRecords();
      fs.writeFileSync(fullPath, JSON.stringify({ format: 'parquet_simulation', commitId, generated_at: new Date().toISOString(), rows }, null, 2));
    }

    const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : { size: 1024 };
    const recordCount = (await this.getAllRecords()).length;

    return {
      snapshotId,
      filePath: `/snapshots/${filename}`,
      recordCount,
      sizeBytes: stat.size,
    };
  }

  public getViewFreezeState(): ViewFreezeState {
    return { ...this.viewFreeze };
  }

  public setViewFreeze(freeze: boolean, actorId: string, reason?: string, snapshotId?: string): ViewFreezeState {
    if (freeze) {
      this.viewFreeze = {
        frozen: true,
        frozen_by: actorId,
        frozen_at: new Date().toISOString(),
        reason: reason || 'Enterprise Financial Year-End Reporting Freeze',
        locked_snapshot_id: snapshotId,
      };
    } else {
      this.viewFreeze = {
        frozen: false,
      };
    }
    return this.getViewFreezeState();
  }

  public getGranularLocks(): Record<string, GranularLock> {
    const obj: Record<string, GranularLock> = {};
    for (const [k, v] of this.locks.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  public setGranularLock(entityId: string, locked: boolean, lockedBy: string): GranularLock {
    const lock: GranularLock = {
      entity_id: entityId,
      locked,
      locked_by: lockedBy,
      locked_at: new Date().toISOString(),
    };
    if (locked) {
      this.locks.set(entityId, lock);
    } else {
      this.locks.delete(entityId);
    }
    return lock;
  }
}

export const backendDuckDB = new BackendDuckDB();
