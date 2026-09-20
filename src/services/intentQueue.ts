import { Intent, User } from '../types';
import { clientDuckDB } from './clientDuckDB';

export interface IntentQueueListener {
  (queue: Intent[]): void;
}

export class IntentQueueService {
  private queue: Intent[] = [];
  private isProcessing: boolean = false;
  private listeners: Set<IntentQueueListener> = new Set();
  private lastRejectedIntent: Intent | null = null;

  constructor() {
    this.loadPersistedQueue();
  }

  private loadPersistedQueue(): void {
    const raw = localStorage.getItem('dual_duckdb_intent_queue');
    if (raw) {
      try {
        this.queue = JSON.parse(raw);
      } catch {
        this.queue = [];
      }
    }
  }

  private persistQueue(): void {
    localStorage.setItem('dual_duckdb_intent_queue', JSON.stringify(this.queue));
    this.notify();
  }

  public subscribe(cb: IntentQueueListener): () => void {
    this.listeners.add(cb);
    cb(this.queue);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) {
      cb([...this.queue]);
    }
  }

  public getQueue(): Intent[] {
    return [...this.queue];
  }

  public getLastRejectedIntent(): Intent | null {
    return this.lastRejectedIntent;
  }

  public clearRejectedIntent(): void {
    this.lastRejectedIntent = null;
    this.notify();
  }

  /**
   * Enqueues a new mutation intent and optimistically updates local DuckDB
   */
  public enqueueIntent(
    operation: 'create' | 'update' | 'delete',
    entity_id: string,
    payload: Record<string, any>,
    currentUser: User
  ): Intent {
    const existing = clientDuckDB.getRecordById(entity_id);
    const intent: Intent = {
      intent_id: `intent-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      entity_type: 'dataset_record',
      entity_id,
      operation,
      payload,
      previous_version: existing?.version_hash || 'genesis',
      client_timestamp: new Date().toISOString(),
      status: 'queued',
    };

    // Optimistic local update
    clientDuckDB.applyOptimisticMutation(operation, entity_id, payload);

    this.queue.push(intent);
    this.persistQueue();

    return intent;
  }

  /**
   * Processes all queued intents against the backend API
   */
  public async drainQueue(currentUser: User, isOnline: boolean): Promise<{ processed: number; rejected: number }> {
    if (this.isProcessing || !isOnline || this.queue.length === 0) {
      return { processed: 0, rejected: 0 };
    }

    this.isProcessing = true;
    let processed = 0;
    let rejected = 0;

    const remainingQueue: Intent[] = [];

    for (const intent of this.queue) {
      if (intent.status === 'committed') continue;

      intent.status = 'syncing';
      this.notify();

      try {
        const response = await fetch('/api/intents', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUser.user_id,
            'x-user-role': currentUser.role,
          },
          body: JSON.stringify(intent),
        });

        const result = await response.json();

        if (response.ok && result.status === 'committed') {
          intent.status = 'committed';
          // Commit will also be fanned out over WebSocket or applied directly
          clientDuckDB.applyCommit(result.commit);
          processed++;
        } else {
          // Intent rejected by backend validator
          intent.status = 'rejected';
          intent.reject_reason = result.reject_reason || 'Rejected by server';
          intent.error_details = result.error_details || 'Validation or authorization failure';
          this.lastRejectedIntent = { ...intent };
          rejected++;
          remainingQueue.push(intent);
        }
      } catch (err: any) {
        // Network error during submission, re-queue for next sync
        intent.status = 'queued';
        remainingQueue.push(intent);
      }
    }

    this.queue = remainingQueue;
    this.persistQueue();
    this.isProcessing = false;

    return { processed, rejected };
  }

  public removeIntent(intent_id: string): void {
    this.queue = this.queue.filter((i) => i.intent_id !== intent_id);
    this.persistQueue();
  }

  public clearQueue(): void {
    this.queue = [];
    this.persistQueue();
  }
}

export const intentQueue = new IntentQueueService();
