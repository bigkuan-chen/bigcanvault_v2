# Development Log

## 2026-06-16

### 1. Migrated Legacy PySide6 to Next.js (v2 Web App)
- Moved old PyQt/PySide6 files (`crypto.py`, `main.py`, `tests/`, desktop screenshots/icons) into `desktop/` to clean the workspace root.
- Created combined `.gitignore` file to ignore both python cache/scratch files and node_modules/Next.js files.
- Initialized Next.js project with App Router, TypeScript, and ESLint.

### 2. Client-Side Encryption
- Created `src/lib/crypto.ts` for browser-based, zero-knowledge encryption and decryption.
- Implemented Argon2id key derivation using `crypto_pwhash`.
- Implemented XChaCha20-Poly1305 AEAD symmetric encryption/decryption.
- Configured owner identification utilizing SHA-256 account name hashes.

### 3. Google Drive REST Client & Versioning Strategy
- Created `src/lib/gdrive.ts` using fetch-based REST requests to bypass heavy client libraries.
- Implemented an append-only versioning strategy: saving new versions with filename format `vault_{account}_{timestamp}.vault` and keeping a pointer file `vault_{account}_latest.json` referencing the latest active version ID.

### 4. Custom Storage Folder Configuration
- Updated `src/lib/gdrive.ts` and `src/app/settings/page.tsx` to save and load all vault data within the user's specific Google Drive folder ID: `1cr021U7ziXOvacYn3GbN5_U9B3lta2Zu` (accessible at `https://drive.google.com/drive/folders/1cr021U7ziXOvacYn3GbN5_U9B3lta2Zu`).

### 5. Dependency Hotfix for Argon2id (`crypto_pwhash`)
- **Issue:** Standard `libsodium-wrappers` package threw `crypto_pwhash is not a function` because standard WASM builds omit password-hashing symbols for size reduction.
- **Fix:** Switched package to `libsodium-wrappers-sumo` (the sumo version including all symbols) and updated imports in `src/lib/crypto.ts`.

### 6. Security State Context & Auto-Lock
- Created `src/context/VaultContext.tsx` to handle in-memory storage of credentials and decrypted entries.
- Integrated background idle activity timers to trigger auto-locks after `autoLockTimeout` minutes (persisted in localStorage).

### 7. Interface Polish & Build Verification
- Styled pages with high-end cyberpunk glassmorphism layout, tables, alerts, inputs, and card grids in `src/app/globals.css`.
- Verified production build successfully compiles: `npm run build`.

### 8. Google OAuth2 Client ID Hybrid Configuration
- Implemented environment variable loading alongside browser storage.
- The application automatically pre-fills the Client ID input using the `NEXT_PUBLIC_GOOGLE_CLIENT_ID` server/deployment environment variable (read from `.env` file).
- The user can still manually override this value by typing into the input box on the Unlock screen, which is persisted locally in the browser's `localStorage` and takes priority over the fallback environment variable.
