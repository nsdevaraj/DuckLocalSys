import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import express, { Request, Response } from 'express';
import { gitLog } from './gitRepo';
import { backendDuckDB } from './backendDuckDB';
import { authenticateUser } from './auth';
import { validateIntent } from './intentValidator';
import { CommitRecord, Intent } from '../src/types';

export class SyncGateway {
  private wss: WebSocketServer | null = null;
  private connectedClients: Set<WebSocket> = new Set();
  private cronInterval: NodeJS.Timeout | null = null;

  public attach(httpServer: HttpServer, app: express.Express): void {
    // 1. Initialize WebSocket Server attached to HTTP server
    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws',
    });

    this.wss.on('connection', (ws: WebSocket, req) => {
      this.connectedClients.add(ws);
      console.log(`[WebSocket] Client connected. Total active clients: ${this.connectedClients.size}`);

      // Send initial welcome & system state
      this.sendToClient(ws, {
        type: 'CONNECTED',
        server_timestamp: new Date().toISOString(),
        view_freeze: backendDuckDB.getViewFreezeState(),
        locks: backendDuckDB.getGranularLocks(),
      });

      ws.on('message', (data: string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'PING') {
            this.sendToClient(ws, { type: 'PONG', timestamp: Date.now() });
          }
        } catch (e) {
          // ignore invalid websocket message
        }
      });

      ws.on('close', () => {
        this.connectedClients.delete(ws);
        console.log(`[WebSocket] Client disconnected. Total active: ${this.connectedClients.size}`);
      });

      ws.on('error', (err) => {
        console.error('[WebSocket] Client error:', err);
        this.connectedClients.delete(ws);
      });
    });

    // 2. Setup Background Cron for Backend DuckDB Materialization (5-15 sec as per spec)
    this.cronInterval = setInterval(async () => {
      try {
        // Sync any commits that might have been pushed directly or via batch
        const commits = await gitLog.getCommitsSince();
        for (const c of commits) {
          await backendDuckDB.applyCommit(c);
        }
      } catch (err) {
        console.error('[Backend DuckDB Cron] Materialization error:', err);
      }
    }, 10000);

    // 3. Register HTTP API Routes
    this.registerRoutes(app);
  }

  public broadcast(payload: Record<string, any>): void {
    const raw = JSON.stringify(payload);
    for (const client of this.connectedClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  }

  private sendToClient(ws: WebSocket, payload: Record<string, any>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  private registerRoutes(app: express.Express): void {
    // Middleware to parse JSON
    app.use(express.json());

    // GET /api/state - Overview of system state
    app.get('/api/state', async (req: Request, res: Response) => {
      try {
        const latestCommit = await gitLog.getLatestCommit();
        const commits = await gitLog.getCommitsSince();
        const records = await backendDuckDB.getAllRecords();
        const viewFreeze = backendDuckDB.getViewFreezeState();
        const locks = backendDuckDB.getGranularLocks();

        res.json({
          latest_commit_id: latestCommit ? latestCommit.id : 'genesis',
          commit_count: commits.length,
          records_count: records.length,
          records,
          view_freeze: viewFreeze,
          locks,
          server_timestamp: new Date().toISOString(),
          backend_duckdb_ready: true,
          git_repo_ready: true,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/intents - Architecture Spec Section 12 & 4.2
    // Accepts intents, validates them, and turns them into signed Git commits
    app.post('/api/intents', async (req: Request, res: Response) => {
      try {
        const userHeader = req.headers['x-user-id'] || req.headers['x-user-role'];
        const user = authenticateUser(userHeader);
        const intent: Intent = req.body;

        if (!intent || !intent.entity_id || !intent.operation) {
          return res.status(400).json({
            status: 'rejected',
            reject_reason: 'MALFORMED_INTENT',
            error_details: 'Missing intent_id, entity_id, or operation.',
          });
        }

        // Validate intent authorization + business rules
        const validation = validateIntent(intent, user);
        if (!validation.valid) {
          return res.status(403).json({
            status: 'rejected',
            reject_reason: validation.reject_reason,
            error_details: validation.error_details,
          });
        }

        // Create signed Git commit in authoritative Git log
        const commitRecord = await gitLog.appendIntentAsCommit(intent, user);

        // Immediate post-commit hook: apply into backend materialized DuckDB
        await backendDuckDB.applyCommit(commitRecord);

        // Real-time WebSocket fan-out to all connected clients
        this.broadcast({
          type: 'NEW_COMMIT',
          commit: commitRecord,
        });

        res.status(201).json({
          status: 'committed',
          commit: commitRecord,
        });
      } catch (err: any) {
        console.error('Error processing intent:', err);
        res.status(500).json({
          status: 'rejected',
          reject_reason: 'SERVER_ERROR',
          error_details: err.message,
        });
      }
    });

    // GET /api/commits?since=<commit> - Architecture Spec Section 12 & 6.2
    app.get('/api/commits', async (req: Request, res: Response) => {
      try {
        const since = (req.query.since as string) || undefined;
        const commits = await gitLog.getCommitsSince(since);
        res.json({
          commits,
          count: commits.length,
          since: since || 'genesis',
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/snapshot?before=<commit>&format=parquet - Architecture Spec Section 12 & 6.3
    app.get('/api/snapshot', async (req: Request, res: Response) => {
      try {
        const before = (req.query.before as string) || (await gitLog.getLatestCommit())?.id || 'genesis';
        const snapshot = await backendDuckDB.generateParquetSnapshot(before);
        const commitsTail = await gitLog.getCommitsSince(before);
        const records = await backendDuckDB.getAllRecords();

        res.json({
          snapshot_id: snapshot.snapshotId,
          commit_id: before,
          download_url: snapshot.filePath,
          record_count: snapshot.recordCount,
          size_bytes: snapshot.sizeBytes,
          created_at: new Date().toISOString(),
          format: 'parquet',
          tail_commits: commitsTail,
          records,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/backend/query - Dual DuckDB: Run SQL directly on backend DuckDB
    app.post('/api/backend/query', async (req: Request, res: Response) => {
      try {
        const { sql } = req.body;
        if (!sql || typeof sql !== 'string') {
          return res.status(400).json({ error: 'SQL query string required' });
        }

        const start = Date.now();
        const rows = await backendDuckDB.query(sql);
        const execution_time_ms = Date.now() - start;
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

        res.json({
          source: 'backend_duckdb',
          sql,
          columns,
          rows,
          row_count: rows.length,
          execution_time_ms,
          executed_at: new Date().toISOString(),
        });
      } catch (err: any) {
        res.status(400).json({
          source: 'backend_duckdb',
          error: err.message,
        });
      }
    });

    // POST /api/admin/toggle-view-freeze - Workspace Administrator Role Action
    app.post('/api/admin/toggle-view-freeze', async (req: Request, res: Response) => {
      try {
        const user = authenticateUser(req.headers['x-user-id'] || req.headers['x-user-role']);
        if (user.role !== 'workspace_admin') {
          return res.status(403).json({ error: 'Only Workspace Administrators can freeze or unfreeze the analytical view.' });
        }

        const { freeze, reason } = req.body;
        const latestCommit = await gitLog.getLatestCommit();
        const snapshot = freeze ? await backendDuckDB.generateParquetSnapshot(latestCommit ? latestCommit.id : 'genesis') : null;

        const updatedState = backendDuckDB.setViewFreeze(
          Boolean(freeze),
          user.display_name,
          reason,
          snapshot?.snapshotId
        );

        // Notify all clients
        this.broadcast({
          type: 'VIEW_FREEZE_UPDATED',
          view_freeze: updatedState,
        });

        res.json({
          success: true,
          view_freeze: updatedState,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/curator/toggle-lock - Release Manager (Curator) Role Action
    app.post('/api/curator/toggle-lock', async (req: Request, res: Response) => {
      try {
        const user = authenticateUser(req.headers['x-user-id'] || req.headers['x-user-role']);
        if (user.role !== 'release_manager' && user.role !== 'workspace_admin') {
          return res.status(403).json({ error: 'Only Release Managers or Workspace Admins can lock/unlock data edits.' });
        }

        const { entity_id, locked } = req.body;
        if (!entity_id) {
          return res.status(400).json({ error: 'entity_id is required' });
        }

        const lock = backendDuckDB.setGranularLock(entity_id, Boolean(locked), user.display_name);

        this.broadcast({
          type: 'GRANULAR_LOCK_UPDATED',
          lock,
        });

        res.json({
          success: true,
          lock,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/admin/git-log - Admin-only Git repository inspection
    app.get('/api/admin/git-log', async (req: Request, res: Response) => {
      try {
        const user = authenticateUser(req.headers['x-user-id'] || req.headers['x-user-role']);
        if (user.role !== 'workspace_admin') {
          return res.status(403).json({ error: 'Git repository inspection is strictly admin-only.' });
        }

        const rawLog = await gitLog.getGitRawLog(50);
        const branchStatus = await gitLog.getGitBranchStatus();
        const commits = await gitLog.getCommitsSince();

        // Verify cryptographic signatures for all commits
        const verifiedCommits = commits.map((c) => ({
          ...c,
          signature_valid: gitLog.verifySignature(c),
        }));

        res.json({
          access: 'admin_granted',
          branch: branchStatus.branch,
          head_sha: branchStatus.headSha,
          total_commits: branchStatus.commitCount,
          raw_log: rawLog,
          commits: verifiedCommits,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  public cleanup(): void {
    if (this.cronInterval) {
      clearInterval(this.cronInterval);
    }
  }
}

export const syncGateway = new SyncGateway();
