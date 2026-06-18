'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export interface PasswordRecord {
  id: string;
  website_name: string;
  account: string;
  password: string;
  description: string;
  row_status: 'unchanged' | 'new' | 'modified' | 'deleted';
  created_at: string;
  updated_at: string;
}

interface VaultContextType {
  // Google Auth
  googleClientId: string;
  setGoogleClientId: (clientId: string) => void;
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
  isConnectedToGDrive: boolean;

  // Vault Status
  accountName: string;
  isUnlocked: boolean;
  records: PasswordRecord[];
  setRecords: React.Dispatch<React.SetStateAction<PasswordRecord[]>>;
  folderId: string | null;
  currentVersion: number;
  latestFileId: string | null;
  existingPointer: any | null;
  unsavedChanges: boolean;
  setUnsavedChanges: (hasChanges: boolean) => void;

  // Security Params
  masterKey: Uint8Array | null;
  kdfParams: { salt: Uint8Array; opslimit: number; memlimit: number } | null;

  // Configuration
  autoLockTimeout: number; // in minutes
  setAutoLockTimeout: (timeout: number) => void;

  // Actions
  unlockVault: (
    accountName: string,
    key: Uint8Array,
    records: PasswordRecord[],
    folderId: string,
    version: number,
    fileId: string | null,
    pointer: any | null,
    salt: Uint8Array,
    opslimit: number,
    memlimit: number
  ) => void;
  lockVault: (reason?: string) => void;
  updateKdfParams: (salt: Uint8Array, opslimit: number, memlimit: number) => void;
  updateMasterKey: (key: Uint8Array) => void;
  updateVaultVersionInfo: (version: number, fileId: string, pointer: any) => void;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();

  // Configuration (Persisted in localStorage)
  const [googleClientId, setGoogleClientIdState] = useState<string>('');
  const [autoLockTimeout, setAutoLockTimeoutState] = useState<number>(5);

  // Sensitive security states (in-memory only, backed by sessionStorage for page refresh persistence)
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string>('');
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(null);
  const [kdfParams, setKdfParams] = useState<{ salt: Uint8Array; opslimit: number; memlimit: number } | null>(null);
  const [records, setRecords] = useState<PasswordRecord[]>([]);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [unsavedChanges, setUnsavedChanges] = useState<boolean>(false);

  // Google Drive info
  const [folderId, setFolderId] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number>(0);
  const [latestFileId, setLatestFileId] = useState<string | null>(null);
  const [existingPointer, setExistingPointer] = useState<any | null>(null);

  // Activity tracking for auto-lock
  const [lastActivity, setLastActivity] = useState<number>(Date.now());
  const activityTimerRef = useRef<NodeJS.Timeout | null>(null);

  // AccessToken wrapper to sync to sessionStorage
  const setAccessToken = (token: string | null) => {
    setAccessTokenState(token);
    if (typeof window !== 'undefined') {
      if (token) {
        sessionStorage.setItem('session_accessToken', token);
      } else {
        sessionStorage.removeItem('session_accessToken');
      }
    }
  };

  const saveSessionStorage = (
    token: string,
    name: string,
    key: Uint8Array,
    decryptedRecords: PasswordRecord[],
    gdriveFolderId: string,
    version: number,
    fileId: string | null,
    salt: Uint8Array,
    opslimit: number,
    memlimit: number
  ) => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem('session_accessToken', token);
    sessionStorage.setItem('session_accountName', name);
    sessionStorage.setItem('session_masterKey', JSON.stringify(Array.from(key)));
    sessionStorage.setItem('session_kdfParams', JSON.stringify({
      salt: Array.from(salt),
      opslimit,
      memlimit
    }));
    sessionStorage.setItem('session_records', JSON.stringify(decryptedRecords));
    sessionStorage.setItem('session_folderId', gdriveFolderId);
    sessionStorage.setItem('session_latestFileId', fileId || '');
    sessionStorage.setItem('session_currentVersion', version.toString());
    sessionStorage.setItem('session_isUnlocked', 'true');
  };

  const clearSessionStorage = () => {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem('session_accessToken');
    sessionStorage.removeItem('session_accountName');
    sessionStorage.removeItem('session_masterKey');
    sessionStorage.removeItem('session_kdfParams');
    sessionStorage.removeItem('session_records');
    sessionStorage.removeItem('session_folderId');
    sessionStorage.removeItem('session_latestFileId');
    sessionStorage.removeItem('session_currentVersion');
    sessionStorage.removeItem('session_isUnlocked');
  };

  // Keep records synchronized to sessionStorage when changes occur
  useEffect(() => {
    if (isUnlocked && typeof window !== 'undefined') {
      sessionStorage.setItem('session_records', JSON.stringify(records));
    }
  }, [records, isUnlocked]);

  // Load configuration from local storage client-side
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedClientId = localStorage.getItem('vault_google_client_id');
      const envClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
      setGoogleClientIdState(storedClientId || envClientId);

      const storedTimeout = localStorage.getItem('vault_auto_lock_timeout');
      if (storedTimeout) {
        setAutoLockTimeoutState(parseInt(storedTimeout, 10));
      }

      // Restore session from sessionStorage if it exists
      const sessAccessToken = sessionStorage.getItem('session_accessToken');
      const sessAccountName = sessionStorage.getItem('session_accountName');
      const sessMasterKey = sessionStorage.getItem('session_masterKey');
      const sessKdfParams = sessionStorage.getItem('session_kdfParams');
      const sessRecords = sessionStorage.getItem('session_records');
      const sessFolderId = sessionStorage.getItem('session_folderId');
      const sessLatestFileId = sessionStorage.getItem('session_latestFileId');
      const sessCurrentVersion = sessionStorage.getItem('session_currentVersion');
      const sessIsUnlocked = sessionStorage.getItem('session_isUnlocked');

      if (sessIsUnlocked === 'true' && sessAccessToken && sessAccountName && sessMasterKey && sessKdfParams && sessRecords) {
        try {
          const keyArr = JSON.parse(sessMasterKey);
          const kdfObj = JSON.parse(sessKdfParams);
          const recsArr = JSON.parse(sessRecords);

          setAccessTokenState(sessAccessToken);
          setAccountName(sessAccountName);
          setMasterKey(new Uint8Array(keyArr));
          setKdfParams({
            salt: new Uint8Array(kdfObj.salt),
            opslimit: kdfObj.opslimit,
            memlimit: kdfObj.memlimit
          });
          setRecords(recsArr);
          setFolderId(sessFolderId);
          setLatestFileId(sessLatestFileId);
          setCurrentVersion(sessCurrentVersion ? parseInt(sessCurrentVersion, 10) : 1);
          setIsUnlocked(true);
          setUnsavedChanges(false);
          setLastActivity(Date.now());
        } catch (e) {
          console.error("Failed to restore session from sessionStorage:", e);
          clearSessionStorage();
        }
      } else if (sessAccessToken) {
        setAccessTokenState(sessAccessToken);
      }
    }
  }, []);

  const setGoogleClientId = (clientId: string) => {
    setGoogleClientIdState(clientId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('vault_google_client_id', clientId);
    }
  };

  const setAutoLockTimeout = (timeout: number) => {
    setAutoLockTimeoutState(timeout);
    if (typeof window !== 'undefined') {
      localStorage.setItem('vault_auto_lock_timeout', timeout.toString());
    }
  };

  // Lock the vault, clear all memory variables, and redirect
  const lockVault = (reason?: string) => {
    // Zero out the key in memory if possible
    if (masterKey) {
      masterKey.fill(0);
    }

    setAccountName('');
    setMasterKey(null);
    setKdfParams(null);
    setRecords([]);
    setIsUnlocked(false);
    setUnsavedChanges(false);
    setFolderId(null);
    setCurrentVersion(0);
    setLatestFileId(null);
    setExistingPointer(null);

    // Clear session storage
    clearSessionStorage();

    // Redirect to unlock page
    router.push(`/?locked=true${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`);
  };

  // Unlock the vault and initialize data
  const unlockVault = (
    name: string,
    key: Uint8Array,
    decryptedRecords: PasswordRecord[],
    gdriveFolderId: string,
    version: number,
    fileId: string | null,
    pointer: any | null,
    salt: Uint8Array,
    opslimit: number,
    memlimit: number
  ) => {
    setAccountName(name);
    setMasterKey(key);
    setKdfParams({ salt, opslimit, memlimit });
    // Map records to include row_status 'unchanged' if not present
    const mappedRecords = decryptedRecords.map(r => ({
      ...r,
      row_status: r.row_status || 'unchanged',
    }));
    setRecords(mappedRecords);
    setFolderId(gdriveFolderId);
    setCurrentVersion(version);
    setLatestFileId(fileId);
    setExistingPointer(pointer);
    setIsUnlocked(true);
    setUnsavedChanges(false);
    setLastActivity(Date.now());

    // Save configuration states to sessionStorage
    if (accessToken) {
      saveSessionStorage(
        accessToken,
        name,
        key,
        mappedRecords,
        gdriveFolderId,
        version,
        fileId,
        salt,
        opslimit,
        memlimit
      );
    }

    router.push('/vault');
  };

  const updateKdfParams = (salt: Uint8Array, opslimit: number, memlimit: number) => {
    setKdfParams({ salt, opslimit, memlimit });
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('session_kdfParams', JSON.stringify({
        salt: Array.from(salt),
        opslimit,
        memlimit
      }));
    }
  };

  const updateMasterKey = (key: Uint8Array) => {
    // Zero out old master key
    if (masterKey) {
      masterKey.fill(0);
    }
    setMasterKey(key);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('session_masterKey', JSON.stringify(Array.from(key)));
    }
  };

  const updateVaultVersionInfo = (version: number, fileId: string, pointer: any) => {
    setCurrentVersion(version);
    setLatestFileId(fileId);
    setExistingPointer(pointer);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('session_latestFileId', fileId);
      sessionStorage.setItem('session_currentVersion', version.toString());
    }
  };

  // Redirect to root if not unlocked and trying to access internal routes
  useEffect(() => {
    if (!isUnlocked && pathname !== '/' && pathname !== '') {
      router.push('/');
    }
  }, [isUnlocked, pathname, router]);

  // Track user activity to prevent idle lock
  useEffect(() => {
    if (!isUnlocked) return;

    const updateActivity = () => {
      setLastActivity(Date.now());
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'click', 'scroll'];
    events.forEach(e => window.addEventListener(e, updateActivity, { passive: true }));

    return () => {
      events.forEach(e => window.removeEventListener(e, updateActivity));
    };
  }, [isUnlocked]);

  // Auto-lock timer effect
  useEffect(() => {
    if (!isUnlocked) {
      if (activityTimerRef.current) {
        clearInterval(activityTimerRef.current);
        activityTimerRef.current = null;
      }
      return;
    }

    activityTimerRef.current = setInterval(() => {
      const idleTime = Date.now() - lastActivity;
      if (idleTime >= autoLockTimeout * 60 * 1000) {
        lockVault('Inactivity timeout');
      }
    }, 10000); // Check every 10 seconds

    return () => {
      if (activityTimerRef.current) {
        clearInterval(activityTimerRef.current);
      }
    };
  }, [isUnlocked, lastActivity, autoLockTimeout]);

  // Best effort lock on tab close / window unload
  useEffect(() => {
    const handleUnload = () => {
      if (masterKey) {
        masterKey.fill(0);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [masterKey]);

  const isConnectedToGDrive = accessToken !== null;

  return (
    <VaultContext.Provider
      value={{
        googleClientId,
        setGoogleClientId,
        accessToken,
        setAccessToken,
        isConnectedToGDrive,
        accountName,
        isUnlocked,
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
        autoLockTimeout,
        setAutoLockTimeout,
        unlockVault,
        lockVault,
        updateKdfParams,
        updateMasterKey,
        updateVaultVersionInfo,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
};

export const useVault = () => {
  const context = useContext(VaultContext);
  if (context === undefined) {
    throw new Error('useVault must be used within a VaultProvider');
  }
  return context;
};
