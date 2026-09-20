import { User } from '../types';
import { clientCrypto } from './clientCrypto';
import { clientDuckDB } from './clientDuckDB';

export const ENTERPRISE_USERS: User[] = [
  {
    user_id: 'usr-admin-01',
    email: 'sarah.chen@enterprise.corp',
    display_name: 'Sarah Chen',
    role: 'workspace_admin',
    avatar_initials: 'SC',
  },
  {
    user_id: 'usr-curator-02',
    email: 'marcus.vance@enterprise.corp',
    display_name: 'Marcus Vance',
    role: 'release_manager',
    avatar_initials: 'MV',
  },
  {
    user_id: 'usr-contrib-03',
    email: 'alex.rivera@enterprise.corp',
    display_name: 'Alex Rivera',
    role: 'contributor',
    avatar_initials: 'AR',
  },
  {
    user_id: 'usr-viewer-04',
    email: 'david.kim@enterprise.corp',
    display_name: 'David Kim',
    role: 'typical_user',
    avatar_initials: 'DK',
  },
];

export class SSOAuthService {
  private currentUser: User = ENTERPRISE_USERS[2]; // Default to Contributor for editing
  private isDeviceLocked: boolean = false;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.initSession();
  }

  private async initSession(): Promise<void> {
    const savedUserId = localStorage.getItem('dual_duckdb_active_user');
    if (savedUserId) {
      const found = ENTERPRISE_USERS.find((u) => u.user_id === savedUserId);
      if (found) this.currentUser = found;
    }
    // Auto unlock with default enterprise passphrase on initial load
    await this.unlockDevice('enterprise-secure-master-key-2026');
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

  public getCurrentUser(): User {
    return this.currentUser;
  }

  public switchUser(user: User): void {
    this.currentUser = user;
    localStorage.setItem('dual_duckdb_active_user', user.user_id);
    this.notify();
  }

  public isLocked(): boolean {
    return this.isDeviceLocked || !clientCrypto.getUnlockedStatus();
  }

  public lockDevice(): void {
    clientCrypto.lock();
    this.isDeviceLocked = true;
    this.notify();
  }

  public async unlockDevice(passphrase: string): Promise<boolean> {
    const ok = await clientCrypto.unlock(passphrase);
    if (ok) {
      this.isDeviceLocked = false;
      await clientDuckDB.initialize();
      this.notify();
      return true;
    }
    return false;
  }
}

export const ssoAuth = new SSOAuthService();
