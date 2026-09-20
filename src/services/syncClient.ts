import { CommitRecord, GranularLock, SystemOverview, ViewFreezeState, User } from '../types';
import { clientDuckDB } from './clientDuckDB';
import { intentQueue } from './intentQueue';

export type SyncState = 'connected' | 'disconnected' | 'syncing' | 'reconnecting';

export interface ConflictNotification {
  id: string;
  entity_id: string;
  message: string;
  server_timestamp: string;
  commit_id: string;
  dismissed: boolean;
}

export class SyncClientService {
  private ws: WebSocket | null = null;
  private isSimulatedOffline: boolean = false;
  private syncState: SyncState = 'disconnected';
  private reconnectTimer: any = null;
  private currentUser: User | null = null;
  private conflictNotifications: ConflictNotification[] = [];
  private viewFreezeState: ViewFreezeState = { frozen: false };
  private granularLocks: Record<string, GranularLock> = {};
  private listeners: Set<() => void> = new Set();

  public initialize(user: User): void {
    this.currentUser = user;
    if (!this.isSimulatedOffline) {
      this.connectWebSocket();
    }
  }

  public setUser(user: User): void {
    this.currentUser = user;
    this.notify();
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) {
      cb();
    }
  }

  public getSyncState(): SyncState {
    if (this.isSimulatedOffline) return 'disconnected';
    return this.syncState;
  }

  public isOfflineMode(): boolean {
    return this.isSimulatedOffline;
  }

  public getViewFreezeState(): ViewFreezeState {
    return this.viewFreezeState;
  }

  public getGranularLocks(): Record<string, GranularLock> {
    return this.granularLocks;
  }

  public getConflictNotifications(): ConflictNotification[] {
    return this.conflictNotifications.filter((c) => !c.dismissed);
  }

  public dismissConflict(id: string): void {
    this.conflictNotifications = this.conflictNotifications.map((c) =>
      c.id === id ? { ...c, dismissed: true } : c
    );
    this.notify();
  }

  /**
   * Toggle Simulated Offline Mode (Architecture Section 1 & 8)
   */
  public toggleOfflineMode(): void {
    this.isSimulatedOffline = !this.isSimulatedOffline;
    if (this.isSimulatedOffline) {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.syncState = 'disconnected';
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    } else {
      // Re-connecting: trigger catch-up sync & drain intent queue
      this.connectWebSocket();
      this.catchUpAndDrainQueue();
    }
    this.notify();
  }

  private connectWebSocket(): void {
    if (this.isSimulatedOffline || typeof window === 'undefined') return;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.syncState = 'reconnecting';
    this.notify();

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.syncState = 'connected';
        console.log('[WebSocket] Connected to authoritative gateway.');
        this.notify();
        this.catchUpAndDrainQueue();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleWebSocketMessage(msg);
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (!this.isSimulatedOffline) {
          this.syncState = 'reconnecting';
          this.notify();
          this.scheduleReconnect();
        } else {
          this.syncState = 'disconnected';
          this.notify();
        }
      };

      this.ws.onerror = () => {
        if (this.ws) this.ws.close();
      };
    } catch (err) {
      console.error('[WebSocket] Connection creation error:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (!this.isSimulatedOffline) {
      this.reconnectTimer = setTimeout(() => {
        this.connectWebSocket();
      }, 3000);
    }
  }

  private handleWebSocketMessage(msg: any): void {
    if (msg.type === 'CONNECTED') {
      if (msg.view_freeze) this.viewFreezeState = msg.view_freeze;
      if (msg.locks) this.granularLocks = msg.locks;
      this.notify();
    } else if (msg.type === 'NEW_COMMIT') {
      const commit: CommitRecord = msg.commit;
      const { overwrittenLocal } = clientDuckDB.applyCommit(commit);

      if (overwrittenLocal) {
        // Architecture Section 7: Optional lightweight notification when local change overwritten
        this.conflictNotifications.push({
          id: `conflict-${Date.now()}`,
          entity_id: commit.entity_id,
          message: `Local update for ${commit.entity_id} was overwritten by server commit (${commit.id.slice(0, 8)}) via Last-Write-Wins rule.`,
          server_timestamp: commit.timestamp,
          commit_id: commit.id,
          dismissed: false,
        });
      }
      this.notify();
    } else if (msg.type === 'VIEW_FREEZE_UPDATED') {
      this.viewFreezeState = msg.view_freeze;
      this.notify();
    } else if (msg.type === 'GRANULAR_LOCK_UPDATED') {
      const lock: GranularLock = msg.lock;
      this.granularLocks[lock.entity_id] = lock;
      this.notify();
    }
  }

  /**
   * Manual or post-reconnection Catch-Up Path (Section 6.2):
   * GET /commits?since=<last-commit>
   */
  public async performCatchUp(): Promise<number> {
    if (this.isSimulatedOffline) return 0;

    this.syncState = 'syncing';
    this.notify();

    try {
      const lastCommit = clientDuckDB.getLastCommitId();
      const resp = await fetch(`/api/commits?since=${lastCommit}`);
      if (!resp.ok) throw new Error('Catch-up request failed');

      const data = await resp.json();
      let appliedCount = 0;

      if (data.commits && Array.isArray(data.commits)) {
        for (const commit of data.commits) {
          const { overwrittenLocal } = clientDuckDB.applyCommit(commit);
          if (overwrittenLocal) {
            this.conflictNotifications.push({
              id: `conflict-${Date.now()}`,
              entity_id: commit.entity_id,
              message: `Local update for ${commit.entity_id} was superseded by catch-up commit (${commit.id.slice(0, 8)}).`,
              server_timestamp: commit.timestamp,
              commit_id: commit.id,
              dismissed: false,
            });
          }
          appliedCount++;
        }
      }

      // Also refresh system overview
      await this.refreshSystemOverview();

      this.syncState = 'connected';
      this.notify();
      return appliedCount;
    } catch (err) {
      console.error('[SyncClient] Catch-up error:', err);
      this.syncState = this.ws ? 'connected' : 'disconnected';
      this.notify();
      return 0;
    }
  }

  public async catchUpAndDrainQueue(): Promise<void> {
    if (this.isSimulatedOffline || !this.currentUser) return;
    await this.performCatchUp();
    await intentQueue.drainQueue(this.currentUser, !this.isSimulatedOffline);
  }

  public async refreshSystemOverview(): Promise<SystemOverview | null> {
    if (this.isSimulatedOffline) return null;
    try {
      const resp = await fetch('/api/state');
      if (!resp.ok) return null;
      const data = await resp.json();
      this.viewFreezeState = data.view_freeze || { frozen: false };
      this.granularLocks = data.locks || {};
      this.notify();
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Section 6.3 Large-Gap / Long-Offline Path:
   * Requests Parquet snapshot + commit tail and replaces local DuckDB state
   */
  public async loadParquetSnapshotAndTail(): Promise<void> {
    if (this.isSimulatedOffline) throw new Error('Cannot load snapshot while in offline mode');
    await clientDuckDB.executePruneAndCompact(true);
    await this.refreshSystemOverview();
  }
}

export const syncClient = new SyncClientService();
