'use client';

import React, { useState, useEffect } from 'react';
import { useVault } from '@/context/VaultContext';
import { getOrCreateRootFolder, getVaultFile, downloadVaultFile, saveVaultFile } from '@/lib/gdrive';
import { deserializeVault, generateRandomSalt, deriveKey, serializeVault, sha256 } from '@/lib/crypto';
import { Shield, Key, User, Cloud, HelpCircle, Eye, EyeOff, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function UnlockPage() {
  const {
    googleClientId,
    accessToken,
    setAccessToken,
    isConnectedToGDrive,
    unlockVault,
    lockVault,
  } = useVault();

  // Mode: 'unlock' or 'create'
  const [mode, setMode] = useState<'unlock' | 'create'>('unlock');

  // Input fields
  const [accountName, setAccountName] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success' | 'info' | 'warning'; text: string } | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [pendingCreateData, setPendingCreateData] = useState<any>(null);

  // Pending import backup state
  const [pendingUploadData, setPendingUploadData] = useState<any>(null);
  const [pendingUploadFilename, setPendingUploadFilename] = useState<string>('');

  // Load pending upload data from sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const dataStr = sessionStorage.getItem('uploaded_vault_data');
      const filename = sessionStorage.getItem('uploaded_vault_filename');
      if (dataStr && filename) {
        try {
          const parsed = JSON.parse(dataStr);
          setPendingUploadData(parsed);
          setPendingUploadFilename(filename);
          setMode('unlock');
        } catch (e) {
          console.error("Failed to parse uploaded vault data from sessionStorage:", e);
          sessionStorage.removeItem('uploaded_vault_data');
          sessionStorage.removeItem('uploaded_vault_filename');
        }
      }
    }
  }, []);

  const handleCancelImport = () => {
    sessionStorage.removeItem('uploaded_vault_data');
    sessionStorage.removeItem('uploaded_vault_filename');
    setPendingUploadData(null);
    setPendingUploadFilename('');
    setStatusMessage({ type: 'info', text: 'Import cancelled. Restored normal login.' });
  };

  // Handle URL locked params (e.g. from logout or idle timeout)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const isLocked = urlParams.get('locked');
      const reason = urlParams.get('reason');
      if (isLocked) {
        setStatusMessage({
          type: reason ? 'info' : 'success',
          text: reason ? `Vault locked: ${reason}` : 'Vault locked successfully.',
        });
        // Clear url params
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, []);

  // Normalize account name according to design rules
  const getNormalizedAccount = (name: string): string => {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_\-.]/g, '');
  };

  // Google OAuth triggers
  const handleConnectGoogle = () => {
    const activeClientId = googleClientId || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    
    if (!activeClientId) {
      setStatusMessage({ 
        type: 'error', 
        text: 'Google Client ID is not configured. Please set NEXT_PUBLIC_GOOGLE_CLIENT_ID in your environment variables.' 
      });
      return;
    }

    const google = (window as any).google;
    if (!google || !google.accounts || !google.accounts.oauth2) {
      setStatusMessage({
        type: 'error',
        text: 'Google Identity Services script not loaded. Please refresh or check your internet connection.',
      });
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage({ type: 'info', text: 'Opening Google Login window...' });
      
      const client = google.accounts.oauth2.initTokenClient({
        client_id: activeClientId,
        scope: 'https://www.googleapis.com/auth/drive.appdata',
        callback: (response: any) => {
          setIsLoading(false);
          if (response && response.access_token) {
            setAccessToken(response.access_token);
            setStatusMessage({ type: 'success', text: 'Google Drive connected successfully!' });
          } else {
            setStatusMessage({ type: 'error', text: 'Google login failed or was cancelled.' });
          }
        },
        error_callback: (err: any) => {
          setIsLoading(false);
          setStatusMessage({ type: 'error', text: `OAuth error: ${err.message || 'Unknown error'}` });
        }
      });
      client.requestAccessToken();
    } catch (err: any) {
      setIsLoading(false);
      setStatusMessage({ type: 'error', text: `Failed to initialize Google login: ${err.message}` });
    }
  };

  // Unlock existing vault logic
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnectedToGDrive || !accessToken) {
      setStatusMessage({ type: 'error', text: 'Google Drive is not connected.' });
      return;
    }

    const normalizedName = getNormalizedAccount(accountName);
    if (normalizedName.length < 3 || normalizedName.length > 64) {
      setStatusMessage({
        type: 'error',
        text: 'Account name must be between 3 and 64 characters and contain only letters, numbers, dots, hyphens, and underscores.',
      });
      return;
    }

    if (!masterPassword) {
      setStatusMessage({ type: 'error', text: 'Master password is required.' });
      return;
    }

    if (pendingUploadData) {
      setIsLoading(true);
      setStatusMessage({ type: 'info', text: 'Deriving encryption key using Argon2id (please wait)...' });

      // Allow UI thread to update before CPU intensive Argon2id
      await new Promise((resolve) => setTimeout(resolve, 100));

      try {
        // 1. Decrypt uploaded backup data
        const { records, key, salt, opslimit, memlimit } = await deserializeVault(pendingUploadData, masterPassword);

        // 2. Validate that the account name matches the owner hash in the vault header
        const enteredHash = await sha256(normalizedName);
        const ownerHashInVault = pendingUploadData.header?.owner?.account_name_hash;
        if (ownerHashInVault && ownerHashInVault !== enteredHash) {
          throw new Error('Account name does not match the vault owner hash.');
        }

        setStatusMessage({ type: 'success', text: 'Vault decrypted successfully!' });

        // 3. Check filename matches rules: `bigkuanvault_${normalizedAccountName}.vault`
        const expectedFilename = `bigkuanvault_${normalizedName}.vault`;
        let actualFilename = pendingUploadFilename;
        if (actualFilename !== expectedFilename) {
          actualFilename = expectedFilename;
          setStatusMessage({
            type: 'warning',
            text: `Filename adjusted to match system rules: ${expectedFilename}`
          });
          // Wait a bit to let user see notice
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        setStatusMessage({ type: 'info', text: 'Uploading to Google Drive personal hidden folder...' });

        // 4. Get root folder and check if a file already exists with this name on Google Drive
        const folderId = await getOrCreateRootFolder(accessToken);
        const fileId = await getVaultFile(accessToken, folderId, normalizedName);

        // 5. Upload/save file to GDrive (updates existing or uploads as new)
        const finalFileId = await saveVaultFile(
          accessToken,
          folderId,
          normalizedName,
          pendingUploadData,
          fileId
        );

        // Clear import state
        sessionStorage.removeItem('uploaded_vault_data');
        sessionStorage.removeItem('uploaded_vault_filename');
        setPendingUploadData(null);
        setPendingUploadFilename('');

        setStatusMessage({ type: 'success', text: 'Vault imported and synced to cloud!' });

        // 6. Unlock context and redirect
        unlockVault(
          normalizedName,
          key,
          records,
          folderId,
          1, // version placeholder
          finalFileId,
          null, // pointer details placeholder
          salt,
          opslimit,
          memlimit
        );
      } catch (err: any) {
        setIsLoading(false);
        console.error(err);
        setStatusMessage({
          type: 'error',
          text: err.message || 'Incorrect password or account name hash mismatch. Unable to decrypt.',
        });
      }
      return;
    }

    setIsLoading(true);
    setStatusMessage({ type: 'info', text: 'Connecting to Google Drive...' });

    try {
      // 1. Get or create root folder
      const folderId = await getOrCreateRootFolder(accessToken);
      
      // 2. Search for the vault file
      setStatusMessage({ type: 'info', text: 'Searching for your vault...' });
      const fileId = await getVaultFile(accessToken, folderId, normalizedName);

      if (!fileId) {
        setIsLoading(false);
        setStatusMessage({
          type: 'error',
          text: `No vault file found for account "${normalizedName}". Please check the spelling, or switch to the "Create New" tab.`,
        });
        return;
      }

      // 3. Download vault file
      setStatusMessage({ type: 'info', text: 'Downloading vault...' });
      const vaultData = await downloadVaultFile(accessToken, fileId);

      // 4. Derive key and decrypt payload
      setStatusMessage({ type: 'info', text: 'Deriving encryption key using Argon2id (please wait)...' });
      
      // Allow UI thread to update before CPU intensive Argon2id
      await new Promise((resolve) => setTimeout(resolve, 100));

      const { records, key, salt, opslimit, memlimit } = await deserializeVault(vaultData, masterPassword);

      setStatusMessage({ type: 'success', text: 'Vault unlocked!' });
      
      // Unlock context
      unlockVault(
        normalizedName,
        key,
        records,
        folderId,
        1, // version placeholder
        fileId,
        null, // pointer details placeholder
        salt,
        opslimit,
        memlimit
      );
    } catch (err: any) {
      setIsLoading(false);
      console.error(err);
      setStatusMessage({
        type: 'error',
        text: err.message || 'Wrong account name or master password. Unable to decrypt.',
      });
    }
  };

  // Start creation of new vault (validates first)
  const handleCreatePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnectedToGDrive || !accessToken) {
      setStatusMessage({ type: 'error', text: 'Google Drive is not connected.' });
      return;
    }

    const normalizedName = getNormalizedAccount(accountName);
    if (normalizedName.length < 3 || normalizedName.length > 64) {
      setStatusMessage({
        type: 'error',
        text: 'Account name must be between 3 and 64 characters and contain only valid characters.',
      });
      return;
    }

    if (!masterPassword || masterPassword.length < 6) {
      setStatusMessage({ type: 'error', text: 'Master password must be at least 6 characters long.' });
      return;
    }

    if (masterPassword !== confirmPassword) {
      setStatusMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setIsLoading(true);
    setStatusMessage({ type: 'info', text: 'Checking if account already exists...' });

    try {
      const folderId = await getOrCreateRootFolder(accessToken);
      const fileId = await getVaultFile(accessToken, folderId, normalizedName);

      if (fileId) {
        // Vault already exists! Download and verify decryption first.
        setStatusMessage({ type: 'info', text: 'Vault exists. Downloading to verify password...' });
        const existingVaultData = await downloadVaultFile(accessToken, fileId);

        setStatusMessage({ type: 'info', text: 'Verifying password against existing vault...' });
        try {
          await deserializeVault(existingVaultData, masterPassword);
        } catch (decryptErr) {
          setIsLoading(false);
          setStatusMessage({
            type: 'error',
            text: 'Verification failed: The entered master password cannot decrypt the existing vault. You must provide the correct password to overwrite it.',
          });
          return;
        }

        // Decryption verified! Now ask for confirmation.
        setIsLoading(false);
        setNeedsConfirmation(true);
        setPendingCreateData({ folderId, normalizedName, fileId });
        setStatusMessage({
          type: 'warning',
          text: `Decryption verified. A vault already exists for "${normalizedName}". Creating a new vault will overwrite the existing entries under this account name.`,
        });
      } else {
        // Vault does not exist, go ahead and create
        await executeCreateVault(folderId, normalizedName, null);
      }
    } catch (err: any) {
      setIsLoading(false);
      setStatusMessage({ type: 'error', text: err.message || 'An error occurred.' });
    }
  };

  // Perform the actual KDF + Encryption + Upload for a new vault
  const executeCreateVault = async (
    folderId: string,
    normalizedName: string,
    existingFileId: string | null
  ) => {
    setIsLoading(true);

    try {
      if (existingFileId) {
        setStatusMessage({ type: 'info', text: 'Downloading existing vault to verify decryption...' });
        const existingVaultData = await downloadVaultFile(accessToken!, existingFileId);

        setStatusMessage({ type: 'info', text: 'Verifying password against existing vault...' });
        try {
          await deserializeVault(existingVaultData, masterPassword);
        } catch (decryptErr) {
          throw new Error('Verification failed: The entered master password cannot decrypt the existing vault. You must be able to decrypt the existing vault to overwrite it.');
        }
      }

      setStatusMessage({ type: 'info', text: 'Generating safe cryptographic salt...' });
      // 1. Generate salt and derive key
      const salt = await generateRandomSalt();
      
      setStatusMessage({ type: 'info', text: 'Deriving master key using Argon2id (please wait)...' });
      await new Promise((resolve) => setTimeout(resolve, 100)); // refresh UI thread

      // Standard KDF limits: opslimit=2, memlimit=67108864 (64MB)
      const opslimit = 2;
      const memlimit = 67108864;
      const key = await deriveKey(masterPassword, salt, opslimit, memlimit);

      // 2. Hash account name for owner ID
      const nameHash = await sha256(normalizedName);

      // 3. Serialize empty records array
      const emptyRecords: any[] = [];
      const vaultData = await serializeVault(emptyRecords, key, salt, opslimit, memlimit, nameHash);

      // 4. Save to Google Drive
      setStatusMessage({ type: 'info', text: 'Uploading new vault structure...' });
      const newFileId = await saveVaultFile(
        accessToken!,
        folderId,
        normalizedName,
        vaultData,
        existingFileId
      );

      setStatusMessage({ type: 'success', text: 'Vault created successfully!' });

      unlockVault(
        normalizedName,
        key,
        emptyRecords,
        folderId,
        1, // version placeholder
        newFileId,
        null, // pointer details placeholder
        salt,
        opslimit,
        memlimit
      );
    } catch (err: any) {
      setIsLoading(false);
      setStatusMessage({ type: 'error', text: err.message || 'Failed to create vault.' });
    } finally {
      setNeedsConfirmation(false);
      setPendingCreateData(null);
    }
  };

  return (
    <div className="cyber-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
      <div className="cyber-panel" style={{ width: '100%', maxWidth: '480px' }}>
        
        {/* Screen Title */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 className="cyber-title">Security Gateway</h1>
          <p className="cyber-subtitle" style={{ marginBottom: 0 }}>Decrypt your secrets or spawn a new database</p>
        </div>

        {/* Global Notifications */}
        {statusMessage && (
          <div className={`cyber-alert cyber-alert-${statusMessage.type}`}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
              {statusMessage.type === 'error' && <AlertTriangle style={{ flexShrink: 0, width: '1.25rem', height: '1.25rem' }} />}
              {statusMessage.type === 'success' && <CheckCircle2 style={{ flexShrink: 0, width: '1.25rem', height: '1.25rem' }} />}
              {statusMessage.type === 'info' && <Cloud style={{ flexShrink: 0, width: '1.25rem', height: '1.25rem' }} />}
              {statusMessage.type === 'warning' && <AlertTriangle style={{ flexShrink: 0, width: '1.25rem', height: '1.25rem', color: 'var(--warning)' }} />}
              <span>{statusMessage.text}</span>
            </div>
          </div>
        )}

        {/* STEP 1: Connect Google Drive */}
        {!isConnectedToGDrive ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <p className="cyber-subtitle" style={{ marginBottom: '2rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              使用您的google帳號登入操作
            </p>
            <button
              onClick={handleConnectGoogle}
              disabled={isLoading}
              className="cyber-button cyber-button-solid"
              style={{ 
                width: '100%', 
                padding: '1rem', 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center', 
                gap: '0.75rem', 
                fontSize: '1.05rem' 
              }}
            >
              <Cloud className="w-5 h-5" />
              登入 Google 帳號
            </button>
          </div>
        ) : (
          /* STEP 2: Authenticated forms (Unlock or Create) */
          <div>
            {pendingUploadData ? (
              <div className="cyber-alert cyber-alert-warning" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle className="w-5 h-5 text-[#ffd166]" />
                  <span>Pending Backup Import</span>
                </div>
                <p style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
                  File: <strong>{pendingUploadFilename}</strong>
                  <br />
                  Please input the Account Name and Master Password to decrypt and import this vault database.
                </p>
                <button
                  type="button"
                  onClick={handleCancelImport}
                  className="cyber-button"
                  disabled={isLoading}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', alignSelf: 'flex-start' }}
                >
                  Cancel Import
                </button>
              </div>
            ) : (
              /* Toggle Modes */
              !needsConfirmation && (
                <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '6px', marginBottom: '1.5rem', overflow: 'hidden' }}>
                  <button
                    onClick={() => { setMode('unlock'); setStatusMessage(null); }}
                    className={`cyber-mono`}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      background: mode === 'unlock' ? 'var(--primary)' : 'transparent',
                      color: mode === 'unlock' ? 'var(--bg-dark)' : 'var(--text-secondary)',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                    }}
                    disabled={isLoading}
                  >
                    UNLOCK VAULT
                  </button>
                  <button
                    onClick={() => { setMode('create'); setStatusMessage(null); }}
                    className={`cyber-mono`}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      background: mode === 'create' ? 'var(--primary)' : 'transparent',
                      color: mode === 'create' ? 'var(--bg-dark)' : 'var(--text-secondary)',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                    }}
                    disabled={isLoading}
                  >
                    CREATE NEW
                  </button>
                </div>
              )
            )}

            {/* Overwrite Confirmation view */}
            {needsConfirmation && pendingCreateData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--warning)', fontWeight: 600, fontSize: '0.95rem' }}>
                  <AlertTriangle className="w-5 h-5" />
                  Overwrite existing file?
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                  There is already a password vault associated with the account name <strong>{pendingCreateData.normalizedName}</strong>. 
                  If you overwrite it:
                </p>
                <ul style={{ paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <li>You will lose direct access to the passwords in the old vault.</li>
                  <li>A brand new empty vault file will be initialized.</li>
                </ul>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                  <button
                    onClick={() => {
                      setNeedsConfirmation(false);
                      setPendingCreateData(null);
                      setStatusMessage(null);
                    }}
                    className="cyber-button"
                    style={{ flex: 1 }}
                    disabled={isLoading}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => executeCreateVault(pendingCreateData.folderId, pendingCreateData.normalizedName, pendingCreateData.fileId)}
                    className="cyber-button cyber-button-danger"
                    style={{ flex: 1 }}
                    disabled={isLoading}
                  >
                    Yes, Overwrite
                  </button>
                </div>
              </div>
            ) : (
              /* Unlock/Create Form */
              <form onSubmit={mode === 'unlock' ? handleUnlock : handleCreatePrompt}>
                {/* Account Name */}
                <div className="cyber-form-group">
                  <label className="cyber-label" htmlFor="accountName">
                    <User className="w-3 h-3 inline-block mr-1" />
                    Account Name
                  </label>
                  <input
                    id="accountName"
                    type="text"
                    className="cyber-input cyber-mono"
                    placeholder="e.g. kuanchen"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    Vault file name will resolve to:{' '}
                    <code>bigkuanvault_{getNormalizedAccount(accountName) || '...'}.vault</code>
                  </span>
                </div>

                {/* Master Password */}
                <div className="cyber-form-group">
                  <label className="cyber-label" htmlFor="masterPassword">
                    <Key className="w-3 h-3 inline-block mr-1" />
                    Master Password
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="masterPassword"
                      type={showPassword ? 'text' : 'password'}
                      className="cyber-input"
                      placeholder="Enter master password"
                      value={masterPassword}
                      onChange={(e) => setMasterPassword(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
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
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password (only in Create mode) */}
                {mode === 'create' && (
                  <div className="cyber-form-group">
                    <label className="cyber-label" htmlFor="confirmPassword">
                      Confirm Master Password
                    </label>
                    <input
                      id="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      className="cyber-input"
                      placeholder="Confirm master password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                  </div>
                )}

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={isLoading || !accountName || !masterPassword}
                  className="cyber-button cyber-button-solid"
                  style={{ width: '100%', marginTop: '1rem', padding: '0.85rem' }}
                >
                  {isLoading ? (
                    <span className="cyber-mono">PROCESSING...</span>
                  ) : pendingUploadData ? (
                    <span className="cyber-mono">DECRYPT & IMPORT VAULT</span>
                  ) : mode === 'unlock' ? (
                    <span className="cyber-mono">DECRYPT VAULT</span>
                  ) : (
                    <span className="cyber-mono">GENERATE VAULT</span>
                  )}
                </button>

                {/* Disconnect Google Account */}
                <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                  <button
                    type="button"
                    onClick={() => lockVault()}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      fontSize: '0.75rem',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      backgroundClip: 'padding-box',
                    }}
                    disabled={isLoading}
                  >
                    Disconnect Google Account
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
