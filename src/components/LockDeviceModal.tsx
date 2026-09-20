import React, { useState } from 'react';
import { Lock, KeyRound, ShieldAlert, CheckCircle2, ArrowRight } from 'lucide-react';

interface LockDeviceModalProps {
  onUnlock: (passphrase: string) => Promise<boolean>;
}

export const LockDeviceModal: React.FC<LockDeviceModalProps> = ({ onUnlock }) => {
  const [passphrase, setPassphrase] = useState('enterprise-secure-master-key-2026');
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) return;

    setIsVerifying(true);
    setErrorMessage(null);

    try {
      const ok = await onUnlock(passphrase.trim());
      if (!ok) {
        setErrorMessage('Failed to derive AES-256 key or decrypt payload.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Decryption failed.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-neutral-200 max-w-md w-full p-6 space-y-5 text-neutral-900">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-neutral-900 border border-neutral-300">
            <Lock className="w-6 h-6 text-neutral-800" />
          </div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Local DuckDB Database Locked
          </h2>
          <p className="text-xs text-neutral-600">
            Architecture Specification Section 10: In-memory encryption key was wiped on device lock. The local database is encrypted at rest using AES-GCM 256-bit.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-neutral-700 mb-1">
              Enter Enterprise Master Passphrase / KDF Seed
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="unlock-passphrase-input"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                required
                placeholder="Enter passphrase..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-neutral-50 border border-neutral-300 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-neutral-900 font-mono"
              />
            </div>
            <p className="text-[11px] text-neutral-500 mt-1">
              Demo Seed: <code className="font-mono text-neutral-800">enterprise-secure-master-key-2026</code>
            </p>
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded bg-red-50 text-red-800 border border-red-200 text-xs flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="p-3 rounded bg-neutral-50 border border-neutral-200 text-[11px] text-neutral-600 space-y-1">
            <div className="font-semibold text-neutral-800">Security Invariant:</div>
            <div>• Derives 256-bit AES key via PBKDF2 (100,000 rounds)</div>
            <div>• Key will be retained strictly in memory during active session</div>
          </div>

          <button
            id="submit-unlock-device-btn"
            type="submit"
            disabled={isVerifying}
            className="w-full py-2 px-4 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-semibold text-xs flex items-center justify-center space-x-2 shadow-xs transition-colors disabled:opacity-50"
          >
            <span>{isVerifying ? 'Deriving Key & Decrypting...' : 'Derive Key & Unlock Database'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
