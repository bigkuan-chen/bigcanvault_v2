'use client';

import React, { useState, useEffect } from 'react';
import { useVault } from '@/context/VaultContext';
import { saveVaultFile } from '@/lib/gdrive';
import { serializeVault, deserializeVault, decryptData, fromBase64, sha256 } from '@/lib/crypto';
import { 
  Cloud, Shield, Clock, Download, Upload, ShieldCheck, 
  HelpCircle, Settings, LogOut, CheckCircle2, AlertTriangle, ArrowLeft
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const router = useRouter();
  const {
    isUnlocked,
    accountName,
    records,
    setRecords,
    folderId,
    currentVersion,
    latestFileId,
    existingPointer,
    accessToken,
    masterKey,
    kdfParams,
    autoLockTimeout,
    setAutoLockTimeout,
    updateVaultVersionInfo,
    lockVault
  } = useVault();

  // Redirect if locked
  useEffect(() => {
    if (!isUnlocked) {
      router.push('/');
    }
  }, [isUnlocked, router]);

  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);

  // Auto-hide alert
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  if (!isUnlocked) {
    return null;
  }

  // Export Encrypted Backup (.vault file)
  const handleExportBackup = async () => {
    if (!masterKey || !kdfParams) return;
    setIsLoading(true);
    setStatusMessage({ type: 'info', text: 'Preparing encrypted backup file...' });

    try {
      const accountHash = await sha256(accountName);
      
      // Serialize current state (includes unsaved changes if any)
      const vaultData = await serializeVault(
        records,
        masterKey,
        kdfParams.salt,
        kdfParams.opslimit,
        kdfParams.memlimit,
        accountHash
      );

      // Trigger download
      const jsonStr = JSON.stringify(vaultData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vault_${accountName}_backup_${new Date().toISOString().split('T')[0]}.vault`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatusMessage({ type: 'success', text: 'Encrypted backup downloaded to your device.' });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to export backup.' });
    } finally {
      setIsLoading(false);
    }
  };



  return (
    <div className="cyber-container">
      {/* Back button and page title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <Link href="/vault" className="cyber-button" style={{ padding: '0.5rem 1rem' }}>
          <ArrowLeft className="w-4 h-4" />
          Back to Vault
        </Link>
        <h1 className="cyber-title" style={{ margin: 0, fontSize: '1.75rem' }}>System Settings</h1>
      </div>

      {statusMessage && (
        <div className={`cyber-alert cyber-alert-${statusMessage.type}`} style={{ marginBottom: '1.5rem' }}>
          <span>{statusMessage.text}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
        {/* Row 1: GDrive & Security */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
          
          {/* Google Drive Status Panel */}
          <div className="cyber-panel">
            <h2 className="cyber-title" style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <Cloud className="text-[#00b4d8] w-5 h-5" />
              Cloud Storage Connection
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(0, 180, 216, 0.1)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                <span className="status-indicator">
                  <span className="status-dot status-dot-active" />
                  <strong style={{ color: 'var(--success)' }}>CONNECTED</strong>
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(0, 180, 216, 0.1)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Target Directory:</span>
                <span className="cyber-mono text-[#90e0ef]">
                  Hidden App Data Folder
                </span>
              </div>

              {folderId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', borderBottom: '1px solid rgba(0, 180, 216, 0.1)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>GDrive Space ID:</span>
                  <span className="cyber-mono text-xs" style={{ wordBreak: 'break-all' }}>{folderId}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(0, 180, 216, 0.1)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Permissions:</span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>drive.appdata (Secure Hidden App Data Folder)</span>
              </div>
            </div>
          </div>

          {/* Security & Access Policies Panel */}
          <div className="cyber-panel">
            <h2 className="cyber-title" style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <Clock className="text-[#00b4d8] w-5 h-5" />
              Access Control
            </h2>

            {/* Auto Lock Form */}
            <div className="cyber-form-group">
              <label className="cyber-label" htmlFor="timeoutSelect">Inactivity Auto-Lock Timeout</label>
              <select
                id="timeoutSelect"
                className="cyber-input"
                value={autoLockTimeout}
                onChange={(e) => setAutoLockTimeout(parseInt(e.target.value, 10))}
                style={{ background: 'var(--bg-input)' }}
              >
                <option value={1}>1 Minute</option>
                <option value={5}>5 Minutes (Default)</option>
                <option value={15}>15 Minutes</option>
                <option value={30}>30 Minutes</option>
                <option value={60}>1 Hour</option>
              </select>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Automatically clears master key from memory and locks the app when idle.
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(0, 180, 216, 0.1)', paddingTop: '1rem', marginTop: '1rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Force lock vault:</span>
              <button
                onClick={() => lockVault()}
                className="cyber-button cyber-button-danger"
                style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
              >
                <LogOut className="w-3.5 h-3.5 mr-1" />
                Lock Now
              </button>
            </div>
          </div>

        </div>

        {/* Row 2: Backup and Import */}
        <div className="cyber-panel">
          <h2 className="cyber-title" style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <ShieldCheck className="text-[#00b4d8] w-5 h-5" />
            Backup and Disaster Recovery
          </h2>
          
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
            Because this application uses Zero-Knowledge architecture, we recommend exporting copies of your encrypted database to save locally. 
            All files exported remain strictly encrypted and can only be decrypted by providing the master password associated with this vault.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
            <button
              onClick={handleExportBackup}
              className="cyber-button"
              disabled={isLoading}
              style={{ flex: 1, minWidth: '200px' }}
            >
              <Download className="w-4 h-4 mr-2" />
              Export Encrypted Backup
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
