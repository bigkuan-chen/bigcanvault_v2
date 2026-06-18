'use client';

import React, { useState, useEffect } from 'react';
import { useVault, PasswordRecord } from '@/context/VaultContext';
import { saveVaultFile } from '@/lib/gdrive';
import { serializeVault, deriveKey, generateRandomSalt, sha256 } from '@/lib/crypto';
import { 
  Plus, Save, Lock, Edit3, Key, Copy, Check, Eye, EyeOff, Search, Undo, Trash2, 
  RefreshCw, CheckCircle, ShieldAlert, AlertCircle, Info, Database
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function VaultPage() {
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
    unsavedChanges,
    setUnsavedChanges,
    masterKey,
    kdfParams,
    accessToken,
    updateMasterKey,
    updateKdfParams,
    updateVaultVersionInfo,
    lockVault
  } = useVault();

  // Redirect if locked
  useEffect(() => {
    if (!isUnlocked) {
      router.push('/');
    }
  }, [isUnlocked, router]);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  
  // UI states
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<{ [id: string]: boolean }>({});

  // Change Password Dialog state
  const [isChangePwdOpen, setIsChangePwdOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [pwdStrength, setPwdStrength] = useState<{ score: number; label: string; color: string }>({ score: 0, label: 'Weak', color: '#ef476f' });
  const [modalStatus, setModalStatus] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Reset modal status when modal is closed
  useEffect(() => {
    if (!isChangePwdOpen) {
      setModalStatus(null);
    }
  }, [isChangePwdOpen]);

  // Mobile Edit Modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<PasswordRecord | null>(null);

  // Auto-hide alerts after 5 seconds
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  // Handle password strength check
  useEffect(() => {
    if (!newPassword) {
      setPwdStrength({ score: 0, label: 'Weak', color: '#ef476f' });
      return;
    }
    let score = 0;
    if (newPassword.length >= 8) score++;
    if (/[A-Z]/.test(newPassword)) score++;
    if (/[a-z]/.test(newPassword)) score++;
    if (/[0-9]/.test(newPassword)) score++;
    if (/[^A-Za-z0-9]/.test(newPassword)) score++;

    let label = 'Weak';
    let color = '#ef476f';
    if (score >= 4) {
      label = 'Strong';
      color = 'var(--success)';
    } else if (score >= 2) {
      label = 'Medium';
      color = 'var(--warning)';
    }
    setPwdStrength({ score, label, color });
  }, [newPassword]);

  if (!isUnlocked) {
    return <div className="cyber-container"><p className="cyber-mono text-center">ACCESS RESTRICTED: Authenticaton required...</p></div>;
  }

  // Filter records based on search query, ignoring deleted ones unless they are unsaved
  const filteredRecords = records.filter((r) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = 
      r.website_name.toLowerCase().includes(query) ||
      r.account.toLowerCase().includes(query) ||
      r.description.toLowerCase().includes(query);
    
    return matchesSearch;
  });

  // Generate a random high-entropy password
  const generatePassword = (): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let pwd = '';
    const array = new Uint32Array(16);
    crypto.getRandomValues(array);
    for (let i = 0; i < 16; i++) {
      pwd += chars[array[i] % chars.length];
    }
    return pwd;
  };

  // Add Record
  const handleAddRecord = () => {
    const newRecord: PasswordRecord = {
      id: crypto.randomUUID(),
      website_name: '',
      account: '',
      password: '',
      description: '',
      row_status: 'new',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setRecords((prev) => [newRecord, ...prev]);
    setUnsavedChanges(true);
    setStatusMessage({ type: 'info', text: 'New blank item created at the top.' });
  };

  // Update record fields
  const handleUpdateField = (id: string, field: keyof PasswordRecord, value: string) => {
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          const updatedStatus = r.row_status === 'new' ? 'new' : 'modified';
          return {
            ...r,
            [field]: value,
            row_status: updatedStatus,
            updated_at: new Date().toISOString(),
          };
        }
        return r;
      })
    );
    setUnsavedChanges(true);
  };

  // Delete Record logic
  const handleDeleteRecord = (id: string) => {
    setRecords((prev) =>
      prev.reduce((acc: PasswordRecord[], r) => {
        if (r.id === id) {
          if (r.row_status === 'new') {
            // Unsaved new row, remove completely
            return acc;
          } else {
            // Already saved row, mark as deleted
            acc.push({
              ...r,
              row_status: 'deleted',
              updated_at: new Date().toISOString(),
            });
          }
        } else {
          acc.push(r);
        }
        return acc;
      }, [])
    );
    setUnsavedChanges(true);
  };

  // Undo Delete Record
  const handleUndoDelete = (id: string) => {
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          return {
            ...r,
            row_status: 'modified', // reset to modified so it is retained
            updated_at: new Date().toISOString(),
          };
        }
        return r;
      })
    );
    setUnsavedChanges(true);
  };

  // Copy Password Safe Timer
  const handleCopyPassword = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setStatusMessage({ type: 'success', text: 'Password copied to clipboard. Secure auto-clear active.' });

    // Clear copy status icon in UI after 2.5s
    setTimeout(() => {
      setCopiedId(null);
    }, 2500);

    // Clear clipboard content after 30 seconds for security
    setTimeout(() => {
      navigator.clipboard.writeText('');
    }, 30000);
  };

  // Save vault to Google Drive
  const handleSaveVault = async () => {
    if (!accessToken || !folderId || !masterKey || !kdfParams) {
      setStatusMessage({ type: 'error', text: 'Encryption credentials or Google Drive session lost.' });
      return;
    }

    // Filter out rows marked as deleted
    const recordsToSave = records.filter(r => r.row_status !== 'deleted');

    setIsLoading(true);
    setStatusMessage({ type: 'info', text: 'Serializing and encrypting secrets...' });

    try {
      const accountHash = await sha256(accountName);

      // Serialize and Encrypt
      const encryptedVault = await serializeVault(
        recordsToSave,
        masterKey,
        kdfParams.salt,
        kdfParams.opslimit,
        kdfParams.memlimit,
        accountHash
      );

      setStatusMessage({ type: 'info', text: 'Uploading to Google Drive...' });

      // Save file
      const fileId = await saveVaultFile(
        accessToken,
        folderId,
        accountName,
        encryptedVault,
        latestFileId
      );

      // Update state
      setRecords(recordsToSave.map(r => ({ ...r, row_status: 'unchanged' })));
      setUnsavedChanges(false);
      updateVaultVersionInfo(1, fileId, null);
      setStatusMessage({ type: 'success', text: 'Vault changes saved successfully!' });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: err.message || 'Failed to save vault changes.' });
    } finally {
      setIsLoading(false);
    }
  };

  // Change Master Password Logic
  const handleChangeMasterPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !folderId || !masterKey || !kdfParams) {
      setStatusMessage({ type: 'error', text: 'Encryption context not initialized.' });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setModalStatus({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    setIsLoading(true);
    setModalStatus(null); // Clear previous errors if any

    try {
      // 1. Verify old password matches current masterKey byte-by-byte
      const oldDerived = await deriveKey(oldPassword, kdfParams.salt, kdfParams.opslimit, kdfParams.memlimit);
      const isCorrect = oldDerived.every((val, i) => val === masterKey[i]);

      if (!isCorrect) {
        setIsLoading(false);
        setModalStatus({ type: 'error', text: 'Incorrect current master password.' });
        return;
      }

      // 2. Generate new salt and derive new masterKey
      const newSalt = await generateRandomSalt();
      const newOpslimit = 2;
      const newMemlimit = 67108864; // 64MB
      const newDerivedKey = await deriveKey(newPassword, newSalt, newOpslimit, newMemlimit);

      // 3. Encrypt and save current records (excluding deleted rows)
      const recordsToSave = records.filter(r => r.row_status !== 'deleted');
      const accountHash = await sha256(accountName);

      const encryptedVault = await serializeVault(
        recordsToSave,
        newDerivedKey,
        newSalt,
        newOpslimit,
        newMemlimit,
        accountHash
      );

      // Save new version to Drive
      const fileId = await saveVaultFile(
        accessToken,
        folderId,
        accountName,
        encryptedVault,
        latestFileId
      );

      // Update contexts
      updateMasterKey(newDerivedKey);
      updateKdfParams(newSalt, newOpslimit, newMemlimit);
      updateVaultVersionInfo(1, fileId, null);
      
      setRecords(recordsToSave.map(r => ({ ...r, row_status: 'unchanged' })));
      setUnsavedChanges(false);

      // Close modal
      setIsChangePwdOpen(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setStatusMessage({ type: 'success', text: 'Master password updated successfully.' });
    } catch (err: any) {
      console.error(err);
      setModalStatus({ type: 'error', text: err.message || 'Failed to update master password.' });
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle visible password state
  const toggleShowPassword = (id: string) => {
    setVisiblePasswords((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Open mobile edit modal
  const openMobileEdit = (record: PasswordRecord) => {
    setSelectedRecord({ ...record });
    setIsEditModalOpen(true);
  };

  // Save mobile record edit back to records state
  const saveMobileEdit = () => {
    if (!selectedRecord) return;
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id === selectedRecord.id) {
          const updatedStatus = r.row_status === 'new' ? 'new' : 'modified';
          return {
            ...selectedRecord,
            row_status: updatedStatus,
            updated_at: new Date().toISOString(),
          };
        }
        return r;
      })
    );
    setUnsavedChanges(true);
    setIsEditModalOpen(false);
    setSelectedRecord(null);
  };

  return (
    <div className="cyber-container">
      {/* Top Banner Dashboard */}
      <div className="cyber-panel" style={{ marginBottom: '1.5rem', padding: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <div>
            <h1 className="cyber-title" style={{ fontSize: '1.5rem' }}>Password Vault</h1>
            <p className="cyber-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
              LOCAL MASTER KEY: ACTIVATED | ALGORITHM: XCHACHA20-POLY1305 + ARGON2ID
            </p>
          </div>

          {/* Action Toolbar */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button onClick={handleAddRecord} className="cyber-button" disabled={isLoading}>
              <Plus className="w-4 h-4" />
              Add Item
            </button>

            <button
              onClick={handleSaveVault}
              disabled={isLoading || !unsavedChanges}
              className={`cyber-button cyber-button-solid`}
              style={
                unsavedChanges
                  ? {
                      animation: 'pulse-glow 2s infinite',
                      borderColor: 'var(--success)',
                      boxShadow: '0 0 10px var(--success-glow)',
                    }
                  : {}
              }
            >
              <Save className="w-4 h-4" />
              Save Vault
            </button>

            <button onClick={() => setIsChangePwdOpen(true)} className="cyber-button" disabled={isLoading}>
              <Key className="w-4 h-4" />
              Change Key
            </button>
          </div>
        </div>

        {/* Global status alerts */}
        {statusMessage && (
          <div className={`cyber-alert cyber-alert-${statusMessage.type}`} style={{ marginTop: '1rem', marginBottom: 0 }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <Info className="w-4 h-4" />
              <span>{statusMessage.text}</span>
            </div>
          </div>
        )}
      </div>

      {/* Control panel: search and stats */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, position: 'relative', minWidth: '250px' }}>
          <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '1.1rem', height: '1.1rem', color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="cyber-input"
            style={{ paddingLeft: '2.5rem' }}
            placeholder="Search entries by website, account, or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="cyber-mono" style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0 1rem', background: 'var(--bg-panel)' }}>
          <span>TOTAL: {records.filter(r => r.row_status !== 'deleted').length}</span>
          <span>NEW: {records.filter(r => r.row_status === 'new').length}</span>
          <span>MODIFIED: {records.filter(r => r.row_status === 'modified').length}</span>
          {records.some(r => r.row_status === 'deleted') && (
            <span style={{ color: 'var(--danger)' }}>DELETED: {records.filter(r => r.row_status === 'deleted').length}</span>
          )}
        </div>
      </div>

      {/* Desktop Grid Layout */}
      <div className="cyber-table-container">
        <table className="cyber-table">
          <thead>
            <tr>
              <th style={{ width: '100px' }}>Status</th>
              <th style={{ width: '220px' }}>Website Name</th>
              <th style={{ width: '200px' }}>Account</th>
              <th>Password</th>
              <th>Description</th>
              <th style={{ width: '100px', textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }} className="cyber-mono">
                  No secrets found. Click "Add Item" to begin inserting data.
                </td>
              </tr>
            ) : (
              filteredRecords.map((r) => (
                <tr
                  key={r.id}
                  className={`
                    ${r.row_status === 'new' ? 'row-status-new' : ''}
                    ${r.row_status === 'modified' ? 'row-status-modified' : ''}
                    ${r.row_status === 'deleted' ? 'row-status-deleted' : ''}
                  `}
                >
                  {/* Status Badge */}
                  <td>
                    {r.row_status === 'new' && <span className="badge badge-new">New</span>}
                    {r.row_status === 'modified' && <span className="badge badge-modified">Mod</span>}
                    {r.row_status === 'deleted' && <span className="badge badge-deleted">Del</span>}
                    {r.row_status === 'unchanged' && <span style={{ color: 'var(--text-muted)' }} className="cyber-mono text-xs">-</span>}
                  </td>

                  {/* Website Name */}
                  <td>
                    <input
                      type="text"
                      className="cyber-input"
                      style={{ background: 'transparent', border: 'none', padding: '4px 8px', fontSize: '0.95rem' }}
                      value={r.website_name}
                      onChange={(e) => handleUpdateField(r.id, 'website_name', e.target.value)}
                      disabled={isLoading || r.row_status === 'deleted'}
                      placeholder="e.g. Google"
                    />
                  </td>

                  {/* Account */}
                  <td>
                    <input
                      type="text"
                      className="cyber-input cyber-mono"
                      style={{ background: 'transparent', border: 'none', padding: '4px 8px', fontSize: '0.95rem' }}
                      value={r.account}
                      onChange={(e) => handleUpdateField(r.id, 'account', e.target.value)}
                      disabled={isLoading || r.row_status === 'deleted'}
                      placeholder="e.g. user@gmail.com"
                    />
                  </td>

                  {/* Password + Action Controls */}
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                      <input
                        type={visiblePasswords[r.id] ? 'text' : 'password'}
                        className="cyber-input cyber-mono"
                        style={{ background: 'transparent', border: 'none', padding: '4px 8px', fontSize: '0.95rem', flex: 1 }}
                        value={r.password}
                        onChange={(e) => handleUpdateField(r.id, 'password', e.target.value)}
                        disabled={isLoading || r.row_status === 'deleted'}
                        placeholder="Password"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowPassword(r.id)}
                        className="cyber-button"
                        style={{ padding: '4px 8px', border: 'none' }}
                        disabled={r.row_status === 'deleted'}
                      >
                        {visiblePasswords[r.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyPassword(r.id, r.password)}
                        className="cyber-button"
                        style={{ padding: '4px 8px', border: 'none' }}
                        disabled={r.row_status === 'deleted'}
                      >
                        {copiedId === r.id ? <Check className="w-4 h-4 text-[#06d6a0]" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>

                  {/* Description */}
                  <td>
                    <input
                      type="text"
                      className="cyber-input"
                      style={{ background: 'transparent', border: 'none', padding: '4px 8px', fontSize: '0.95rem' }}
                      value={r.description}
                      onChange={(e) => handleUpdateField(r.id, 'description', e.target.value)}
                      disabled={isLoading || r.row_status === 'deleted'}
                      placeholder="Add notes..."
                    />
                  </td>

                  {/* Row Actions */}
                  <td style={{ textAlign: 'center' }}>
                    {r.row_status === 'deleted' ? (
                      <button
                        onClick={() => handleUndoDelete(r.id)}
                        className="cyber-button px-2 py-1 text-xs"
                        style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
                        disabled={isLoading}
                      >
                        <Undo className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDeleteRecord(r.id)}
                        className="cyber-button cyber-button-danger px-2 py-1 text-xs"
                        disabled={isLoading}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List View */}
      <div className="cyber-cards-grid">
        {filteredRecords.length === 0 ? (
          <div className="cyber-panel text-center cyber-mono" style={{ color: 'var(--text-muted)' }}>
            No secrets found. Click "Add Item" to begin inserting data.
          </div>
        ) : (
          filteredRecords.map((r) => (
            <div
              key={r.id}
              className={`cyber-card 
                ${r.row_status === 'new' ? 'row-status-new' : ''}
                ${r.row_status === 'modified' ? 'row-status-modified' : ''}
                ${r.row_status === 'deleted' ? 'row-status-deleted' : ''}
              `}
            >
              <div className="cyber-card-header">
                <span className="cyber-card-title">{r.website_name || 'Unnamed Website'}</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {r.row_status === 'new' && <span className="badge badge-new">New</span>}
                  {r.row_status === 'modified' && <span className="badge badge-modified">Mod</span>}
                  {r.row_status === 'deleted' && <span className="badge badge-deleted">Del</span>}
                  
                  {r.row_status === 'deleted' ? (
                    <button
                      onClick={() => handleUndoDelete(r.id)}
                      className="cyber-button px-2 py-1 text-xs"
                      style={{ borderColor: 'var(--success)', color: 'var(--success)', padding: '2px 6px' }}
                    >
                      <Undo className="w-3 h-3" />
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => openMobileEdit(r)}
                        className="cyber-button px-2 py-1 text-xs"
                        style={{ padding: '2px 6px' }}
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDeleteRecord(r.id)}
                        className="cyber-button cyber-button-danger px-2 py-1 text-xs"
                        style={{ padding: '2px 6px' }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="cyber-card-row">
                <span className="cyber-card-label">Account</span>
                <span className="cyber-card-value cyber-mono">{r.account}</span>
              </div>

              <div className="cyber-card-row">
                <span className="cyber-card-label">Password</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className="cyber-card-value cyber-mono" style={{ flex: 1 }}>
                    {visiblePasswords[r.id] ? r.password : '••••••••••••••••'}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleShowPassword(r.id)}
                    className="cyber-button"
                    style={{ padding: '2px 6px', border: 'none' }}
                    disabled={r.row_status === 'deleted'}
                  >
                    {visiblePasswords[r.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyPassword(r.id, r.password)}
                    className="cyber-button"
                    style={{ padding: '2px 6px', border: 'none' }}
                    disabled={r.row_status === 'deleted'}
                  >
                    {copiedId === r.id ? <Check className="w-3.5 h-3.5 text-[#06d6a0]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {r.description && (
                <div className="cyber-card-row">
                  <span className="cyber-card-label">Notes</span>
                  <span className="cyber-card-value" style={{ color: 'var(--text-secondary)' }}>{r.description}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Change Master Password Dialog */}
      {isChangePwdOpen && (
        <div className="dialog-backdrop">
          <div className="dialog-modal">
            <h2 className="cyber-title" style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Change Master Password</h2>
            
            {modalStatus && (
              <div className={`cyber-alert cyber-alert-${modalStatus.type}`} style={{ marginBottom: '1.5rem' }}>
                {modalStatus.text}
              </div>
            )}
            
            <form onSubmit={handleChangeMasterPassword}>
              <div className="cyber-form-group">
                <label className="cyber-label" htmlFor="oldPassword">Current Master Password</label>
                <input
                  id="oldPassword"
                  type="password"
                  className="cyber-input"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>

              <div className="cyber-form-group">
                <label className="cyber-label" htmlFor="newPassword">New Master Password</label>
                <input
                  id="newPassword"
                  type="password"
                  className="cyber-input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
                {newPassword && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    <span>Strength: <strong style={{ color: pwdStrength.color }}>{pwdStrength.label}</strong></span>
                  </div>
                )}
              </div>

              <div className="cyber-form-group">
                <label className="cyber-label" htmlFor="confirmNewPassword">Confirm New Password</label>
                <input
                  id="confirmNewPassword"
                  type="password"
                  className="cyber-input"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    setIsChangePwdOpen(false);
                    setOldPassword('');
                    setNewPassword('');
                    setConfirmNewPassword('');
                  }}
                  className="cyber-button"
                  style={{ flex: 1 }}
                  disabled={isLoading}
                >
                  Cancel
                </button>
                
                <button
                  type="submit"
                  className="cyber-button cyber-button-solid"
                  style={{ flex: 1 }}
                  disabled={isLoading || !oldPassword || !newPassword || newPassword !== confirmNewPassword}
                >
                  {isLoading ? 'UPDATING...' : 'RE-ENCRYPT'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mobile Card Edit Modal */}
      {isEditModalOpen && selectedRecord && (
        <div className="dialog-backdrop">
          <div className="dialog-modal">
            <h2 className="cyber-title" style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Edit Secret</h2>
            
            <div className="cyber-form-group">
              <label className="cyber-label" htmlFor="mobileWebName">Website Name</label>
              <input
                id="mobileWebName"
                type="text"
                className="cyber-input"
                value={selectedRecord.website_name}
                onChange={(e) => setSelectedRecord({ ...selectedRecord, website_name: e.target.value })}
                placeholder="e.g. Google"
              />
            </div>

            <div className="cyber-form-group">
              <label className="cyber-label" htmlFor="mobileAccount">Account / Email</label>
              <input
                id="mobileAccount"
                type="text"
                className="cyber-input cyber-mono"
                value={selectedRecord.account}
                onChange={(e) => setSelectedRecord({ ...selectedRecord, account: e.target.value })}
                placeholder="e.g. user@gmail.com"
              />
            </div>

            <div className="cyber-form-group">
              <label className="cyber-label" htmlFor="mobilePassword">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="mobilePassword"
                  type={visiblePasswords[selectedRecord.id] ? 'text' : 'password'}
                  className="cyber-input cyber-mono"
                  value={selectedRecord.password}
                  onChange={(e) => setSelectedRecord({ ...selectedRecord, password: e.target.value })}
                  placeholder="Password"
                />
                <button
                  type="button"
                  onClick={() => toggleShowPassword(selectedRecord.id)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {visiblePasswords[selectedRecord.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord({ ...selectedRecord, password: generatePassword() })}
                className="cyber-button text-xs"
                style={{ alignSelf: 'flex-end', marginTop: '0.25rem', padding: '2px 6px' }}
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Generate Strong
              </button>
            </div>

            <div className="cyber-form-group">
              <label className="cyber-label" htmlFor="mobileDescription">Notes</label>
              <input
                id="mobileDescription"
                type="text"
                className="cyber-input"
                value={selectedRecord.description}
                onChange={(e) => setSelectedRecord({ ...selectedRecord, description: e.target.value })}
                placeholder="E.g., backup codes, security questions"
              />
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setSelectedRecord(null);
                }}
                className="cyber-button"
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              
              <button
                type="button"
                onClick={saveMobileEdit}
                className="cyber-button cyber-button-solid"
                style={{ flex: 1 }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info panel showing crypto details */}
      {kdfParams && (
        <div className="cyber-panel cyber-mono text-xs" style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(13, 17, 28, 0.2)', borderColor: 'rgba(0, 180, 216, 0.1)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', color: 'var(--text-muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Database className="w-3 h-3 text-[#00b4d8]" />
              VAULT ID: {accountName}
            </span>
            <span>KDF: Argon2id (Opslimit: {kdfParams.opslimit}, Memlimit: {(kdfParams.memlimit / (1024 * 1024)).toFixed(0)}MB)</span>
            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '300px' }}>
              SALT: {Array.from(kdfParams.salt).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')}...
            </span>
            {latestFileId && (
              <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                GOOGLE DRIVE FILE ID: {latestFileId}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
