import libsodium from 'libsodium-wrappers-sumo';

// Wait for sodium to load
let sodiumInitialized = false;
export async function ensureSodiumReady() {
  if (!sodiumInitialized) {
    await libsodium.ready;
    sodiumInitialized = true;
  }
}

// Convert base64 string to Uint8Array
export async function fromBase64(base64Str: string): Promise<Uint8Array> {
  await ensureSodiumReady();
  return libsodium.from_base64(base64Str, libsodium.base64_variants.ORIGINAL);
}

// Convert Uint8Array to base64 string
export async function toBase64(bytes: Uint8Array): Promise<string> {
  await ensureSodiumReady();
  return libsodium.to_base64(bytes, libsodium.base64_variants.ORIGINAL);
}

// SHA-256 for account name hashing
export async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// Derive a 32-byte key from password using Argon2id
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  opslimit: number,
  memlimit: number
): Promise<Uint8Array> {
  await ensureSodiumReady();
  const passwordBytes = new TextEncoder().encode(password);
  
  return libsodium.crypto_pwhash(
    32, // key length
    passwordBytes,
    salt,
    opslimit,
    memlimit,
    libsodium.crypto_pwhash_ALG_ARGON2ID13
  );
}

// Encrypt plaintext bytes using XChaCha20-Poly1305 AEAD
export async function encryptData(
  plaintext: Uint8Array,
  key: Uint8Array
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  await ensureSodiumReady();
  
  // XChaCha20-Poly1305 nonce size is 24 bytes
  const nonce = libsodium.randombytes_buf(24);
  const additionalData = new Uint8Array(0); // Empty AAD
  
  const ciphertext = libsodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    additionalData,
    null,
    nonce,
    key
  );
  
  return { ciphertext, nonce };
}

// Decrypt ciphertext bytes using XChaCha20-Poly1305 AEAD
export async function decryptData(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  await ensureSodiumReady();
  const additionalData = new Uint8Array(0);
  
  try {
    return libsodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      additionalData,
      nonce,
      key
    );
  } catch (error) {
    throw new Error('Decryption failed. Wrong password or corrupted file.');
  }
}

// Serialize vault data structure for saving
export async function serializeVault(
  records: any[],
  key: Uint8Array,
  salt: Uint8Array,
  opslimit: number,
  memlimit: number,
  accountNameHash: string
): Promise<any> {
  await ensureSodiumReady();
  
  // Clean records (remove UI-only fields like row_status)
  const cleanedRecords = records.map(r => ({
    id: r.id,
    website_name: r.website_name,
    account: r.account,
    password: r.password,
    description: r.description || '',
    created_at: r.created_at,
    updated_at: r.updated_at
  }));
  
  const payloadDict = { records: cleanedRecords };
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payloadDict));
  
  const { ciphertext, nonce } = await encryptData(plaintextBytes, key);
  
  const vaultDict = {
    version: 1,
    header: {
      app_name: 'PasswordVaultApp',
      vault_version: 1,
      owner: {
        account_name_hash: accountNameHash
      },
      kdf: {
        algorithm: 'Argon2id',
        salt: await toBase64(salt),
        opslimit: opslimit,
        memlimit: memlimit,
        key_length: 32
      },
      encryption: {
        algorithm: 'XChaCha20-Poly1305',
        nonce: await toBase64(nonce)
      }
    },
    payload: {
      ciphertext: await toBase64(ciphertext)
    }
  };
  
  return vaultDict;
}

// Deserialize and decrypt vault file content
export async function deserializeVault(
  vaultDict: any,
  password: string
): Promise<{
  records: any[];
  key: Uint8Array;
  salt: Uint8Array;
  opslimit: number;
  memlimit: number;
}> {
  await ensureSodiumReady();
  
  if (!vaultDict || typeof vaultDict !== 'object') {
    throw new Error('Invalid vault file structure.');
  }
  
  const header = vaultDict.header;
  const payload = vaultDict.payload;
  
  if (!header || !payload) {
    throw new Error('Missing header or payload in vault structure.');
  }
  
  const kdf = header.kdf || {};
  const encryption = header.encryption || {};
  
  if (kdf.algorithm !== 'Argon2id') {
    throw new Error(`Unsupported KDF algorithm: ${kdf.algorithm}`);
  }
  if (encryption.algorithm !== 'XChaCha20-Poly1305') {
    throw new Error(`Unsupported encryption algorithm: ${encryption.algorithm}`);
  }
  
  const saltB64 = kdf.salt;
  const opslimit = kdf.opslimit;
  const memlimit = kdf.memlimit;
  
  if (!saltB64 || opslimit === undefined || memlimit === undefined) {
    throw new Error('Missing KDF configuration parameters.');
  }
  
  const salt = await fromBase64(saltB64);
  const nonceB64 = encryption.nonce;
  const ciphertextB64 = payload.ciphertext;
  
  if (!nonceB64 || !ciphertextB64) {
    throw new Error('Missing nonce or ciphertext in vault.');
  }
  
  const nonce = await fromBase64(nonceB64);
  const ciphertext = await fromBase64(ciphertextB64);
  
  // Derive key using salt from header
  const derivedKey = await deriveKey(password, salt, opslimit, memlimit);
  
  // Decrypt payload
  const decryptedBytes = await decryptData(ciphertext, nonce, derivedKey);
  const decryptedStr = new TextDecoder().decode(decryptedBytes);
  
  try {
    const payloadData = JSON.parse(decryptedStr);
    const records = payloadData.records || [];
    return {
      records,
      key: derivedKey,
      salt,
      opslimit,
      memlimit
    };
  } catch (error) {
    throw new Error('Failed to parse decrypted JSON payload.');
  }
}

// Generate random salt (16 bytes)
export async function generateRandomSalt(): Promise<Uint8Array> {
  await ensureSodiumReady();
  return libsodium.randombytes_buf(16);
}
