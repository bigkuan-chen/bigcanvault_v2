import base64
import json
import nacl.pwhash
import nacl.bindings
import nacl.utils
import nacl.exceptions

class DecryptionError(Exception):
    """Raised when decryption fails (e.g. wrong password, corrupted ciphertext)."""
    pass

class FormatError(Exception):
    """Raised when the vault file format is invalid."""
    pass

def to_base64(data: bytes) -> str:
    """Encode bytes to a base64 UTF-8 string."""
    return base64.b64encode(data).decode('utf-8')

def from_base64(data_str: str) -> bytes:
    """Decode a base64 string back to bytes."""
    try:
        return base64.b64decode(data_str.encode('utf-8'))
    except Exception as e:
        raise FormatError("Failed to decode base64 string.") from e

def derive_key(password: str, salt: bytes, opslimit: int, memlimit: int) -> bytes:
    """Derive a 32-byte key from a password and salt using Argon2id."""
    password_bytes = password.encode('utf-8')
    return nacl.pwhash.argon2id.kdf(
        32,  # 32 bytes key length
        password_bytes,
        salt,
        opslimit,
        memlimit
    )

def encrypt_data(plaintext_bytes: bytes, key: bytes) -> tuple[bytes, bytes]:
    """Encrypt plaintext bytes using XChaCha20-Poly1305 AEAD. Returns (ciphertext, nonce)."""
    nonce = nacl.utils.random(nacl.bindings.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
    aad = b""  # Empty additional authenticated data
    ciphertext = nacl.bindings.crypto_aead_xchacha20poly1305_ietf_encrypt(
        plaintext_bytes,
        aad,
        nonce,
        key
    )
    return ciphertext, nonce

def decrypt_data(ciphertext_bytes: bytes, nonce_bytes: bytes, key: bytes) -> bytes:
    """Decrypt ciphertext bytes using XChaCha20-Poly1305 AEAD with the given key and nonce."""
    aad = b""
    try:
        plaintext = nacl.bindings.crypto_aead_xchacha20poly1305_ietf_decrypt(
            ciphertext_bytes,
            aad,
            nonce_bytes,
            key
        )
        return plaintext
    except nacl.exceptions.CryptoError as e:
        raise DecryptionError("Decryption failed. Wrong password or corrupted file.") from e

def serialize_vault(records: list, key: bytes, salt: bytes, opslimit: int, memlimit: int) -> dict:
    """
    Serialize grid records list and encrypt into the dictionary format specified in design.md.
    """
    # 1. Prepare plaintext JSON string of the payload
    # Remove UI-only fields (e.g. row_status) as specified in design.md
    cleaned_records = []
    for r in records:
        cleaned_r = {
            "id": r.get("id"),
            "website_name": r.get("website_name"),
            "account": r.get("account"),
            "password": r.get("password"),
            "description": r.get("description", ""),
            "created_at": r.get("created_at"),
            "updated_at": r.get("updated_at")
        }
        cleaned_records.append(cleaned_r)
        
    payload_dict = {"records": cleaned_records}
    plaintext_bytes = json.dumps(payload_dict, ensure_ascii=False).encode('utf-8')
    
    # 2. Encrypt the payload
    ciphertext, nonce = encrypt_data(plaintext_bytes, key)
    
    # 3. Build the structure
    vault_dict = {
        "version": 1,
        "header": {
            "app_name": "PasswordVaultApp",
            "vault_version": 1,
            "kdf": {
                "algorithm": "Argon2id",
                "salt": to_base64(salt),
                "opslimit": opslimit,
                "memlimit": memlimit,
                "key_length": 32
            },
            "encryption": {
                "algorithm": "XChaCha20-Poly1305",
                "nonce": to_base64(nonce)
            }
        },
        "payload": {
            "ciphertext": to_base64(ciphertext)
        }
    }
    return vault_dict

def deserialize_vault(vault_dict: dict, password: str) -> tuple[list, bytes, bytes, int, int]:
    """
    Decrypt and deserialize the vault dictionary using the provided master password.
    Returns (records_list, derived_key, salt_bytes, opslimit, memlimit).
    """
    try:
        # Validate overall format structure
        if "header" not in vault_dict or "payload" not in vault_dict:
            raise FormatError("Missing header or payload in vault structure.")
            
        header = vault_dict["header"]
        kdf = header.get("kdf", {})
        encryption = header.get("encryption", {})
        payload = vault_dict["payload"]
        
        # Verify algorithms
        if kdf.get("algorithm") != "Argon2id":
            raise FormatError(f"Unsupported KDF algorithm: {kdf.get('algorithm')}")
        if encryption.get("algorithm") != "XChaCha20-Poly1305":
            raise FormatError(f"Unsupported encryption algorithm: {encryption.get('algorithm')}")
            
        # Parse KDF params
        salt_b64 = kdf.get("salt")
        opslimit = kdf.get("opslimit")
        memlimit = kdf.get("memlimit")
        
        if not salt_b64 or opslimit is None or memlimit is None:
            raise FormatError("Missing KDF configuration parameters.")
            
        salt = from_base64(salt_b64)
        
        # Parse encryption params
        nonce_b64 = encryption.get("nonce")
        ciphertext_b64 = payload.get("ciphertext")
        
        if not nonce_b64 or not ciphertext_b64:
            raise FormatError("Missing nonce or ciphertext in vault.")
            
        nonce = from_base64(nonce_b64)
        ciphertext = from_base64(ciphertext_b64)
        
    except (KeyError, TypeError) as e:
        raise FormatError("Vault file contains malformed structures.") from e

    # Derive the key using the salt and parameters from the header
    derived_key = derive_key(password, salt, opslimit, memlimit)
    
    # Decrypt payload
    plaintext_bytes = decrypt_data(ciphertext, nonce, derived_key)
    
    try:
        payload_data = json.loads(plaintext_bytes.decode('utf-8'))
        records = payload_data.get("records", [])
        return records, derived_key, salt, opslimit, memlimit
    except Exception as e:
        raise FormatError("Failed to parse decrypted JSON payload.") from e
