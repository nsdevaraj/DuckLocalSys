import React, { useState, useEffect } from 'react';
import {
  GitBranch,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Terminal,
  Clock,
  UserCheck,
  ArrowRight,
  CheckCircle2,
  Lock,
  RefreshCw,
  FileCode,
} from 'lucide-react';
import { CommitRecord, User } from '../types';
import { ENTERPRISE_USERS } from '../services/ssoAuth';

interface GitAuthoritativeLogViewProps {
  currentUser: User;
  onSwitchToAdmin: (adminUser: User) => void;
}

export const GitAuthoritativeLogView: React.FC<GitAuthoritativeLogViewProps> = ({
  currentUser,
  onSwitchToAdmin,
}) => {
  const [gitData, setGitData] = useState<{
    branch: string;
    head_sha: string;
    total_commits: number;
    raw_log: string;
    commits: (CommitRecord & { signature_valid: boolean })[];
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<CommitRecord | null>(null);

  const isAdmin = currentUser.role === 'workspace_admin';

  const fetchAdminGitLog = async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/admin/git-log', {
        headers: {
          'x-user-id': currentUser.user_id,
          'x-user-role': currentUser.role,
        },
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Failed to fetch admin git log');
      }

      const data = await resp.json();
      setGitData(data);
      if (data.commits && data.commits.length > 0 && !selectedCommit) {
        setSelectedCommit(data.commits[data.commits.length - 1]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchAdminGitLog();
    }
  }, [isAdmin, currentUser.user_id]);

  // Access Restriction Gate for non-admin users (Architecture Section 4.3 & 10)
  if (!isAdmin) {
    const adminUser = ENTERPRISE_USERS.find((u) => u.role === 'workspace_admin') || ENTERPRISE_USERS[0];
    return (
      <div className="bg-white rounded-lg border border-neutral-200 p-8 shadow-xs max-w-2xl mx-auto text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-neutral-700">
          <Lock className="w-6 h-6 text-neutral-800" />
        </div>

        <div>
          <h3 className="text-base font-semibold text-neutral-900">
            Git Repository Access Restricted (Admin-Only)
          </h3>
          <p className="text-xs sm:text-sm text-neutral-600 mt-2 max-w-md mx-auto">
            According to <strong>Architecture Specification Section 4.3 & 10</strong>, the authoritative Git repository is accessible only to Workspace Administrators and the backend service account.
          </p>
        </div>

        <div className="p-4 bg-neutral-50 rounded-md border border-neutral-200 text-left text-xs text-neutral-700 space-y-1">
          <div className="font-semibold text-neutral-900">Security Isolation Policy:</div>
          <div>• Network & filesystem isolation prevents standard clients from receiving raw Git objects.</div>
          <div>• Current active role: <span className="font-mono font-semibold">{currentUser.role}</span> ({currentUser.display_name})</div>
          <div>• Required role: <span className="font-mono font-semibold text-sky-700">workspace_admin</span></div>
        </div>

        <div>
          <button
            id="switch-admin-gate-btn"
            onClick={() => onSwitchToAdmin(adminUser)}
            className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-md text-xs font-semibold shadow-xs transition-colors"
          >
            Authenticate as Sarah Chen (Workspace Admin)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Admin Verification Header */}
      <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <GitBranch className="w-5 h-5 text-sky-600" />
            <h2 className="text-base font-semibold text-neutral-900">
              Authoritative Append-Only Git Repository
            </h2>
            <span className="text-xs px-2 py-0.5 rounded bg-sky-100 text-sky-800 font-semibold">
              Admin Inspection Active
            </span>
          </div>
          <p className="text-xs text-neutral-600 mt-1">
            Single linear branch (<code className="font-mono font-bold">main</code>). Every mutation creates one signed Git commit with content-addressable SHA-256 hash.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {gitData && (
            <div className="text-right text-xs">
              <div className="text-neutral-500 font-mono">Branch: {gitData.branch}</div>
              <div className="font-mono font-semibold text-neutral-800">
                {gitData.total_commits} Total Commits
              </div>
            </div>
          )}

          <button
            id="refresh-git-log-btn"
            onClick={fetchAdminGitLog}
            disabled={isLoading}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Git</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">
          {error}
        </div>
      )}

      {/* Main Two-Column View: Commit List & Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Linear Commit Chain */}
        <div className="lg:col-span-7 bg-white rounded-lg border border-neutral-200 shadow-xs overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-800 uppercase tracking-wider">
              Linear Commit Log (Source of Truth)
            </span>
            <span className="text-xs text-neutral-500">Strictly Linear • No Merges</span>
          </div>

          <div className="divide-y divide-neutral-200 max-h-[500px] overflow-y-auto">
            {gitData && gitData.commits.length > 0 ? (
              [...gitData.commits].reverse().map((commit, idx) => {
                const isSelected = selectedCommit?.id === commit.id;
                const isGenesis = commit.id.startsWith('genesis');

                return (
                  <div
                    key={commit.id}
                    onClick={() => setSelectedCommit(commit)}
                    className={`p-3.5 cursor-pointer transition-colors ${
                      isSelected ? 'bg-sky-50/60 border-l-4 border-sky-600' : 'hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            isGenesis
                              ? 'bg-neutral-200 text-neutral-700'
                              : commit.operation === 'create'
                              ? 'bg-emerald-100 text-emerald-800'
                              : commit.operation === 'update'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {commit.operation}
                        </span>
                        <span className="font-mono text-xs font-semibold text-neutral-900">
                          {commit.id.slice(0, 14)}...
                        </span>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        {commit.signature_valid ? (
                          <span className="flex items-center text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            <ShieldCheck className="w-3 h-3 mr-1 text-emerald-600" />
                            HMAC Valid
                          </span>
                        ) : (
                          <span className="flex items-center text-[11px] text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                            <ShieldAlert className="w-3 h-3 mr-1 text-red-600" />
                            Invalid Sig
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-1 text-xs text-neutral-700 font-medium">
                      {commit.entity_type} • <span className="font-mono">{commit.entity_id}</span>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500 font-mono">
                      <span>Actor: {commit.actor.display_name || commit.actor.user_id}</span>
                      <span>{new Date(commit.timestamp).toLocaleTimeString()}</span>
                    </div>

                    {commit.parent_ids.length > 0 && (
                      <div className="mt-1 text-[10px] text-neutral-400 font-mono">
                        Parent: {commit.parent_ids[0].slice(0, 16)}...
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-xs text-neutral-400">Loading commit chain...</div>
            )}
          </div>
        </div>

        {/* Right Column: Structured Payload & Raw Git CLI Output */}
        <div className="lg:col-span-5 space-y-6">
          {/* Commit Inspector */}
          <div className="bg-white rounded-lg border border-neutral-200 shadow-xs p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
              <span className="text-xs font-semibold text-neutral-800 uppercase tracking-wider flex items-center gap-1.5">
                <FileCode className="w-4 h-4 text-sky-600" />
                <span>Commit Payload Inspector</span>
              </span>
              {selectedCommit && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">
                  {selectedCommit.id.slice(0, 10)}
                </span>
              )}
            </div>

            {selectedCommit ? (
              <div className="space-y-3 text-xs">
                <div className="p-2.5 rounded bg-neutral-50 border border-neutral-200 font-mono text-[11px] space-y-1">
                  <div><span className="text-neutral-500">Commit ID:</span> {selectedCommit.id}</div>
                  <div><span className="text-neutral-500">Timestamp:</span> {selectedCommit.timestamp}</div>
                  <div><span className="text-neutral-500">Actor:</span> {selectedCommit.actor.user_id}</div>
                  <div><span className="text-neutral-500">Signature:</span> <span className="text-emerald-700">{selectedCommit.signature.slice(0, 24)}...</span></div>
                </div>

                <div>
                  <div className="text-[11px] font-medium text-neutral-600 mb-1">Payload JSON:</div>
                  <pre className="p-3 bg-neutral-950 text-neutral-200 rounded text-[11px] font-mono max-h-48 overflow-y-auto">
                    {JSON.stringify(selectedCommit.payload, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="text-xs text-neutral-400 text-center py-8">Select a commit to inspect payload.</div>
            )}
          </div>

          {/* Real Git CLI Terminal Output */}
          <div className="bg-neutral-950 rounded-lg border border-neutral-800 text-neutral-300 p-4 shadow-xs space-y-2">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2 text-xs">
              <div className="flex items-center space-x-1.5 text-neutral-400 font-mono">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>Real Git CLI Output (`git log`)</span>
              </div>
              <span className="text-[10px] font-mono text-neutral-500">.git_authoritative_log</span>
            </div>

            <div className="font-mono text-[11px] text-emerald-400 max-h-44 overflow-y-auto leading-relaxed whitespace-pre-wrap">
              {gitData?.raw_log || '$ git log --pretty=format:"%h | %cd | %an | %s"'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
