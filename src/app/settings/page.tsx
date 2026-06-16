'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useVault } from '@/context/VaultContext';
import { saveVaultVersion, getLatestPointer } from '@/lib/gdrive';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Import Encrypted Backup (.vault file)
  const handleImportBackup = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setStatusMessage({ type: 'info', text: 'Reading file contents...' });

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const fileContent = event.target?.result as string;
        const importedVault = JSON.parse(fileContent);

        // 1. Basic Format Validation
        if (!importedVault.header || !importedVault.payload) {
          throw new Error('Invalid vault format. File is missing header or payload.');
        }

        // 2. Decrypt verification using active Master Key
        setStatusMessage({ type: 'info', text: 'Decrypting backup using your active key...' });

        const header = importedVault.header;
        const encryption = header.encryption || {};
        const kdf = header.kdf || {};

        if (kdf.algorithm !== 'Argon2id') {
          throw new Error(`Unsupported KDF algorithm in backup: ${kdf.algorithm}`);
        }

        const nonce = await fromBase64(encryption.nonce);
        const ciphertext = await fromBase64(importedVault.payload.ciphertext);

        // Try decrypting with our current master key
        const decryptedBytes = await decryptData(ciphertext, nonce, masterKey!);
        const decryptedStr = new TextDecoder().decode(decryptedBytes);
        const payloadData = JSON.parse(decryptedStr);
        const importedRecords = payloadData.records || [];

        // 3. Upload to Google Drive as new version
        setStatusMessage({ type: 'info', text: 'Uploading verified backup to Google Drive...' });

        const { version, fileId } = await saveVaultVersion(
          accessToken!,
          folderId!,
          accountName,
          importedVault,
          existingPointer
        );

        // 4. Update memory structures
        setRecords(importedRecords.map((r: any) => ({ ...r, row_status: 'unchanged' })));
        updateVaultVersionInfo(version, fileId, {
          fileId,
          content: {
            latest_file_id: fileId,
            latest_version: version,
            updated_at: new Date().toISOString()
          }
        });

        setStatusMessage({ type: 'success', text: `Backup imported successfully! Loaded ${importedRecords.length} records. Created version v${version}.` });
      } catch (err: any) {
        console.error(err);
        setStatusMessage({
          type: 'error',
          text: err.message || 'Import failed. The file is either corrupted or encrypted with a different master password.'
        });
      } finally {
        setIsLoading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };

    reader.onerror = () => {
      setIsLoading(false);
      setStatusMessage({ type: 'error', text: 'Failed to read file.' });
    };

    reader.readAsText(file);
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
                <a
                  href="https://drive.google.com/drive/folders/1cr021U7ziXOvacYn3GbN5_U9B3lta2Zu"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cyber-mono text-[#90e0ef] hover:underline"
                >
                  /folders/1cr021U7...
                </a>
              </div>

              {folderId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', borderBottom: '1px solid rgba(0, 180, 216, 0.1)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>GDrive Folder ID:</span>
                  <span className="cyber-mono text-xs" style={{ wordBreak: 'break-all' }}>{folderId}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(0, 180, 216, 0.1)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Permissions:</span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>drive.file (App-created files only)</span>
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

            <button
              onClick={handleImportBackup}
              className="cyber-button"
              disabled={isLoading}
              style={{ flex: 1, minWidth: '200px' }}
            >
              <Upload className="w-4 h-4 mr-2" />
              Import Encrypted Backup
            </button>
            
            {/* Hidden File Input for Import */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              style={{ display: 'none' }}
              accept=".vault,.json"
            />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,209,102,0.05)', border: '1px dashed rgba(255,209,102,0.3)', borderRadius: '6px', padding: '1rem', marginTop: '1.5rem' }}>
            <AlertTriangle className="w-5 h-5 text-[#ffd166] flex-shrink-0" />
            <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
              <strong>Caution during import:</strong> Importing a backup overwrites the pointer file. If you import a backup file that contains different or older password lists, your current lists will be replaced by the records in the backup.
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
