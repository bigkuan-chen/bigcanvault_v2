'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useVault } from '@/context/VaultContext';
import { Shield, Lock, Settings, Database, Cloud, CloudOff } from 'lucide-react';

export const Header: React.FC = () => {
  const pathname = usePathname();
  const { isUnlocked, accountName, isConnectedToGDrive, lockVault, currentVersion } = useVault();

  return (
    <header className="cyber-header">
      <nav className="cyber-nav">
        <Link href={isUnlocked ? '/vault' : '/'} className="cyber-logo">
          <Shield className="w-5 h-5 text-[#00b4d8]" />
          <span>BigCanVault <span className="text-xs text-[#7209b7] font-mono">v2</span></span>
        </Link>

        {isUnlocked && (
          <div className="cyber-nav-links">
            <span className="cyber-mono text-xs text-[#90e0ef] border border-[#00b4d8]/30 px-2 py-0.5 rounded bg-[#0d111c]">
              USER: {accountName}
            </span>

            <Link
              href="/vault"
              className={`cyber-nav-link ${pathname === '/vault' ? 'active' : ''}`}
            >
              Vault
            </Link>

            <Link
              href="/settings"
              className={`cyber-nav-link ${pathname === '/settings' ? 'active' : ''}`}
            >
              <Settings className="w-4 h-4 inline-block mr-1" />
              Settings
            </Link>

            <div className="status-indicator">
              {isConnectedToGDrive ? (
                <span className="text-[#06d6a0] flex items-center gap-1" title="Google Drive Connected">
                  <Cloud className="w-4 h-4" />
                  <span className="status-dot status-dot-active" />
                </span>
              ) : (
                <span className="text-[#ef476f] flex items-center gap-1" title="Google Drive Disconnected">
                  <CloudOff className="w-4 h-4" />
                  <span className="status-dot status-dot-inactive" />
                </span>
              )}
            </div>

            <button
              onClick={() => lockVault()}
              className="cyber-button px-3 py-1 text-xs border-[#ef476f] text-[#ef476f] hover:bg-[#ef476f]/10"
              title="Lock Vault"
            >
              <Lock className="w-3 h-3" />
              Lock
            </button>
          </div>
        )}
      </nav>
    </header>
  );
};
