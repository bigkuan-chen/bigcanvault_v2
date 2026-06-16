import type { Metadata } from 'next';
import './globals.css';
import { VaultProvider } from '@/context/VaultContext';
import { Header } from '@/components/Header';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'BigCanVault - Secure Password Vault',
  description: 'Zero-knowledge browser-encrypted password manager backed by Google Drive',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Script src="https://accounts.google.com/gsi/client" strategy="beforeInteractive" />
        <VaultProvider>
          <Header />
          <main className="flex-1">
            {children}
          </main>
        </VaultProvider>
      </body>
    </html>
  );
}
