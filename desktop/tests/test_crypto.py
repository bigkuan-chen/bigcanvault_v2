import unittest
import os
import nacl.pwhash
import nacl.utils
from crypto import (
    derive_key,
    encrypt_data,
    decrypt_data,
    serialize_vault,
    deserialize_vault,
    DecryptionError,
    FormatError
)

class TestCrypto(unittest.TestCase):
    def setUp(self):
        self.password = "MySecurePassword123!"
        self.salt = nacl.utils.random(nacl.pwhash.argon2id.SALTBYTES)
        self.opslimit = nacl.pwhash.argon2id.OPSLIMIT_INTERACTIVE
        self.memlimit = nacl.pwhash.argon2id.MEMLIMIT_INTERACTIVE
        
        # Sample records
        self.records = [
            {
                "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                "website_name": "Google",
                "account": "user@gmail.com",
                "password": "supersecretpassword",
                "description": "My primary email account",
                "row_status": "new",  # Should be cleaned out in serialization
                "created_at": "2026-06-15T10:00:00+08:00",
                "updated_at": "2026-06-15T10:00:00+08:00"
            },
            {
                "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
                "website_name": "Github",
                "account": "dev_user",
                "password": "anotherpassword",
                "description": "",
                "row_status": "unchanged",
                "created_at": "2026-06-15T11:00:00+08:00",
                "updated_at": "2026-06-15T11:00:00+08:00"
            }
        ]

    def test_key_derivation(self):
        key = derive_key(self.password, self.salt, self.opslimit, self.memlimit)
        self.assertEqual(len(key), 32)
        
        # Verify same params produce same key
        key2 = derive_key(self.password, self.salt, self.opslimit, self.memlimit)
        self.assertEqual(key, key2)
        
        # Different password produces different key
        key_diff = derive_key("DifferentPassword", self.salt, self.opslimit, self.memlimit)
        self.assertNotEqual(key, key_diff)

    def test_encrypt_decrypt(self):
        key = derive_key(self.password, self.salt, self.opslimit, self.memlimit)
        plaintext = b"Secret data"
        
        ciphertext, nonce = encrypt_data(plaintext, key)
        self.assertEqual(len(nonce), 24)
        
        # Successful decryption
        decrypted = decrypt_data(ciphertext, nonce, key)
        self.assertEqual(decrypted, plaintext)
        
        # Decryption fails with wrong key
        wrong_key = nacl.utils.random(32)
        with self.assertRaises(DecryptionError):
            decrypt_data(ciphertext, nonce, wrong_key)
            
        # Decryption fails with corrupted ciphertext
        corrupted_ciphertext = bytearray(ciphertext)
        corrupted_ciphertext[0] ^= 1 # flip one bit
        with self.assertRaises(DecryptionError):
            decrypt_data(bytes(corrupted_ciphertext), nonce, key)

    def test_serialize_deserialize_vault(self):
        key = derive_key(self.password, self.salt, self.opslimit, self.memlimit)
        
        # Serialize records
        vault_dict = serialize_vault(self.records, key, self.salt, self.opslimit, self.memlimit)
        
        # Basic schema checks
        self.assertEqual(vault_dict["version"], 1)
        self.assertEqual(vault_dict["header"]["app_name"], "PasswordVaultApp")
        self.assertEqual(vault_dict["header"]["vault_version"], 1)
        self.assertEqual(vault_dict["header"]["kdf"]["algorithm"], "Argon2id")
        self.assertEqual(vault_dict["header"]["encryption"]["algorithm"], "XChaCha20-Poly1305")
        self.assertIn("ciphertext", vault_dict["payload"])
        
        # Deserialize records
        decrypted_records, derived_key, salt, opslimit, memlimit = deserialize_vault(vault_dict, self.password)
        
        self.assertEqual(len(decrypted_records), 2)
        self.assertEqual(derived_key, key)
        self.assertEqual(salt, self.salt)
        self.assertEqual(opslimit, self.opslimit)
        self.assertEqual(memlimit, self.memlimit)
        
        # Check specific records fields
        rec1 = decrypted_records[0]
        self.assertEqual(rec1["website_name"], "Google")
        self.assertEqual(rec1["account"], "user@gmail.com")
        self.assertEqual(rec1["password"], "supersecretpassword")
        self.assertEqual(rec1["description"], "My primary email account")
        self.assertNotIn("row_status", rec1) # row_status should be removed
        
        # Check incorrect password decryption failure
        with self.assertRaises(DecryptionError):
            deserialize_vault(vault_dict, "WrongPassword!")

    def test_deserialize_malformed_structures(self):
        # Missing payload
        malformed1 = {
            "header": {}
        }
        with self.assertRaises(FormatError):
            deserialize_vault(malformed1, self.password)
            
        # Incorrect algorithms
        malformed2 = {
            "header": {
                "kdf": {"algorithm": "scrypt"},
                "encryption": {"algorithm": "AES-GCM"}
            },
            "payload": {"ciphertext": "abc"}
        }
        with self.assertRaises(FormatError):
            deserialize_vault(malformed2, self.password)

if __name__ == '__main__':
    unittest.main()
