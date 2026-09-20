import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CommitRecord, Intent, User } from '../src/types';

const execFileAsync = promisify(execFile);

// Secret for signing commits
const SERVER_HMAC_SECRET = process.env.SERVER_HMAC_SECRET || 'dual-duckdb-enterprise-secret-key-2026';

export class GitAuthoritativeLog {
  private repoDir: string;
  private initialized = false;
  private currentHeadId: string | null = null;
  private commitCache: CommitRecord[] = [];

  constructor() {
    this.repoDir = path.resolve(process.cwd(), '.git_authoritative_log');
  }

  private async runGit(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.repoDir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Dual DuckDB Service',
          GIT_AUTHOR_EMAIL: 'git-service@enterprise.internal',
          GIT_COMMITTER_NAME: 'Dual DuckDB Service',
          GIT_COMMITTER_EMAIL: 'git-service@enterprise.internal',
        },
      });
      return stdout.trim();
    } catch (err: any) {
      throw new Error(`Git command 'git ${args.join(' ')}' failed: ${err.message}`);
    }
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!fs.existsSync(this.repoDir)) {
      fs.mkdirSync(this.repoDir, { recursive: true });
    }

    const isGitRepo = fs.existsSync(path.join(this.repoDir, '.git'));
    if (!isGitRepo) {
      await this.runGit(['init', '-b', 'main']);
      await this.runGit(['config', 'user.name', 'Dual DuckDB Service']);
      await this.runGit(['config', 'user.email', 'git-service@enterprise.internal']);

      // Initial genesis commit
      const genesisPayload: CommitRecord = {
        id: 'genesis-0000000000000000000000000000000000000000000000000000000000000000',
        parent_ids: [],
        timestamp: new Date('2026-09-20T00:00:00Z').toISOString(),
        actor: {
          user_id: 'system',
          display_name: 'Dual DuckDB Genesis Engine',
        },
        operation: 'create',
        entity_type: 'system_root',
        entity_id: 'system-root-genesis',
        payload: {
          description: 'Initial genesis commit for Dual DuckDB append-only log',
          branch: 'main',
          linear_mode: true,
        },
        previous_version: 'none',
        signature: this.signPayload('genesis-0000000000000000000000000000000000000000000000000000000000000000', '2026-09-20T00:00:00Z'),
      };

      const commitsDir = path.join(this.repoDir, 'commits');
      if (!fs.existsSync(commitsDir)) {
        fs.mkdirSync(commitsDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(commitsDir, `${genesisPayload.id}.json`),
        JSON.stringify(genesisPayload, null, 2),
        'utf8'
      );

      await this.runGit(['add', '.']);
      await this.runGit(['commit', '-m', `[dual-duckdb] Genesis commit: ${genesisPayload.id}`]);
      this.currentHeadId = genesisPayload.id;
      this.commitCache.push(genesisPayload);
    } else {
      await this.loadAllCommitsFromRepo();
    }

    this.initialized = true;
  }

  private signPayload(id: string, timestamp: string): string {
    return crypto
      .createHmac('sha256', SERVER_HMAC_SECRET)
      .update(`${id}:${timestamp}`)
      .digest('hex');
  }

  public verifySignature(commit: CommitRecord): boolean {
    const expected = this.signPayload(commit.id, commit.timestamp);
    return commit.signature === expected;
  }

  public async appendIntentAsCommit(intent: Intent, user: User): Promise<CommitRecord> {
    await this.initialize();

    const parentId = this.currentHeadId || 'genesis';
    const serverTimestamp = new Date().toISOString();

    // Compute content-addressable hash
    const rawContent = JSON.stringify({
      parent_ids: [parentId],
      timestamp: serverTimestamp,
      actor_id: user.user_id,
      operation: intent.operation,
      entity_type: intent.entity_type,
      entity_id: intent.entity_id,
      payload: intent.payload,
      previous_version: intent.previous_version,
    });

    const commitId = crypto.createHash('sha256').update(rawContent).digest('hex');
    const signature = this.signPayload(commitId, serverTimestamp);

    const commitRecord: CommitRecord = {
      id: commitId,
      parent_ids: [parentId],
      timestamp: serverTimestamp,
      actor: {
        user_id: user.user_id,
        display_name: user.display_name,
      },
      operation: intent.operation,
      entity_type: intent.entity_type,
      entity_id: intent.entity_id,
      payload: intent.payload,
      previous_version: intent.previous_version,
      signature,
    };

    const commitsDir = path.join(this.repoDir, 'commits');
    if (!fs.existsSync(commitsDir)) {
      fs.mkdirSync(commitsDir, { recursive: true });
    }

    const commitFilePath = path.join(commitsDir, `${commitId}.json`);
    fs.writeFileSync(commitFilePath, JSON.stringify(commitRecord, null, 2), 'utf8');

    // Also update linear state file
    fs.writeFileSync(path.join(this.repoDir, 'LATEST_COMMIT'), commitId, 'utf8');

    // Real Git commit execution
    await this.runGit(['add', '.']);
    await this.runGit([
      'commit',
      '-m',
      `[dual-duckdb] ${intent.operation.toUpperCase()} ${intent.entity_type} ${intent.entity_id}\n\nCommit-ID: ${commitId}\nActor: ${user.user_id} (${user.role})\nTimestamp: ${serverTimestamp}\nSignature: ${signature}`,
    ]);

    this.currentHeadId = commitId;
    this.commitCache.push(commitRecord);

    return commitRecord;
  }

  public async getCommitsSince(lastCommitId?: string): Promise<CommitRecord[]> {
    await this.initialize();
    if (!lastCommitId) {
      return [...this.commitCache];
    }
    const index = this.commitCache.findIndex((c) => c.id === lastCommitId);
    if (index === -1) {
      // If the client's last commit is not found, return full list
      return [...this.commitCache];
    }
    return this.commitCache.slice(index + 1);
  }

  public async getLatestCommit(): Promise<CommitRecord | null> {
    await this.initialize();
    if (this.commitCache.length === 0) return null;
    return this.commitCache[this.commitCache.length - 1];
  }

  public async getGitRawLog(maxCount: number = 30): Promise<string> {
    await this.initialize();
    return await this.runGit([
      'log',
      `-n`,
      `${maxCount}`,
      `--pretty=format:%h | %cd | %an | %s`,
      `--date=iso-strict`,
    ]);
  }

  public async getGitBranchStatus(): Promise<{ branch: string; headSha: string; commitCount: number }> {
    await this.initialize();
    const branch = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    const headSha = await this.runGit(['rev-parse', 'HEAD']);
    return {
      branch,
      headSha,
      commitCount: this.commitCache.length,
    };
  }

  private async loadAllCommitsFromRepo(): Promise<void> {
    const commitsDir = path.join(this.repoDir, 'commits');
    if (!fs.existsSync(commitsDir)) {
      this.commitCache = [];
      return;
    }

    const files = fs.readdirSync(commitsDir).filter((f) => f.endsWith('.json'));
    const records: CommitRecord[] = [];

    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(commitsDir, f), 'utf8');
        const parsed = JSON.parse(raw);
        records.push(parsed);
      } catch (err) {
        console.error(`Failed to read commit file ${f}:`, err);
      }
    }

    // Sort by timestamp and enforce linear sequence
    records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    this.commitCache = records;
    if (records.length > 0) {
      this.currentHeadId = records[records.length - 1].id;
    }
  }
}

export const gitLog = new GitAuthoritativeLog();
