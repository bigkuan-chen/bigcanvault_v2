import unittest
import sys
import os
import json
from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt
from main import PasswordVaultApp, PasswordCellWidget

# Ensure QApplication is initialized once for the testing process
app = QApplication.instance()
if not app:
    app = QApplication(sys.argv)

class TestGUI(unittest.TestCase):
    def setUp(self):
        self.window = PasswordVaultApp()
        self.window.show()

    def tearDown(self):
        self.window.close()

    def test_window_properties(self):
        self.assertEqual(self.window.windowTitle(), "Password Vault Manager")
        self.assertEqual(self.window.table.columnCount(), 5)
        
        # Verify column widths
        self.assertEqual(self.window.table.columnWidth(0), 50)
        self.assertEqual(self.window.table.columnWidth(1), 230)
        self.assertEqual(self.window.table.columnWidth(2), 230)
        self.assertEqual(self.window.table.columnWidth(3), 230)
        self.assertEqual(self.window.table.columnWidth(4), 400)

    def test_state_on_init(self):
        self.assertFalse(self.window.vault_is_open)
        self.assertFalse(self.window.has_unsaved_changes)
        self.assertIsNone(self.window.current_file_path)
        self.assertIsNone(self.window.master_key)
        self.assertEqual(len(self.window.records), 0)

    def test_add_and_delete_row_logic(self):
        # Add row should be disabled when vault is closed
        self.assertFalse(self.window.add_row_button.isEnabled())
        
        # Simulate vault open
        self.window.vault_is_open = True
        self.window.update_action_states()
        self.assertTrue(self.window.add_row_button.isEnabled())
        
        # Click add row
        self.window.add_row_button.click()
        self.assertEqual(self.window.table.rowCount(), 1)
        self.assertEqual(len(self.window.records), 1)
        self.assertTrue(self.window.has_unsaved_changes)
        
        # Verify record fields
        record = self.window.records[0]
        self.assertEqual(record["row_status"], "new")
        self.assertEqual(record["website_name"], "")
        self.assertEqual(record["account"], "")
        self.assertEqual(record["password"], "")
        
        # Verify cell widget in password column
        pwd_widget = self.window.table.cellWidget(0, 3)
        self.assertIsInstance(pwd_widget, PasswordCellWidget)
        self.assertEqual(pwd_widget.raw_password, "")
        
        # Select row and delete
        self.window.table.selectRow(0)
        self.window.delete_row_button.click()
        self.assertEqual(self.window.table.rowCount(), 0)
        self.assertEqual(len(self.window.records), 0)

    def test_row_state_transitions(self):
        self.window.vault_is_open = True
        self.window.records = [
            {
                "id": "1",
                "website_name": "Google",
                "account": "user",
                "password": "pwd",
                "description": "",
                "row_status": "unchanged",
                "created_at": "2026-06-15T12:00:00",
                "updated_at": "2026-06-15T12:00:00"
            }
        ]
        self.window.populate_table()
        
        self.assertEqual(self.window.table.rowCount(), 1)
        self.assertFalse(self.window.has_unsaved_changes)
        
        # Simulate cell change programmatically
        item = self.window.table.item(0, 1) # Website name item
        item.setText("Google Workspace")
        
        # Triggers cell change
        self.window.on_cell_changed(item)
        
        # Verify transition to modified
        self.assertTrue(self.window.has_unsaved_changes)
        self.assertEqual(self.window.records[0]["row_status"], "modified")
        self.assertEqual(self.window.records[0]["website_name"], "Google Workspace")
        self.assertEqual(self.window.table.item(0, 0).text(), "*")
        
        # Delete row (transition modified to deleted)
        self.window.table.selectRow(0)
        self.window.delete_row_button.click()
        
        self.assertEqual(self.window.table.rowCount(), 1) # Still in table as deleted
        self.assertEqual(self.window.records[0]["row_status"], "deleted")
        self.assertEqual(self.window.table.item(0, 0).text(), "-")
        
        # Text cells should become non-editable
        self.assertFalse(self.window.table.item(0, 1).flags() & Qt.ItemFlag.ItemIsEditable)

    def test_save_and_open_flow(self):
        import tempfile
        import shutil
        
        # Setup a temp file path
        temp_dir = tempfile.mkdtemp()
        temp_vault_path = os.path.join(temp_dir, "test.vault")
        
        try:
            self.window.vault_is_open = True
            self.window.current_file_path = temp_vault_path
            
            # Setup salt, opslimit, memlimit
            import crypto
            import nacl.pwhash
            import nacl.utils
            
            self.window.current_salt = nacl.utils.random(nacl.pwhash.argon2id.SALTBYTES)
            self.window.current_opslimit = nacl.pwhash.argon2id.OPSLIMIT_INTERACTIVE
            self.window.current_memlimit = nacl.pwhash.argon2id.MEMLIMIT_INTERACTIVE
            
            # Derive master key
            password = "integration_test_password"
            self.window.master_key = crypto.derive_key(
                password,
                self.window.current_salt,
                self.window.current_opslimit,
                self.window.current_memlimit
            )
            
            # Add a record
            self.window.add_grid_row()
            row = 0
            self.window.table.item(row, 1).setText("Google Workspace")
            self.window.table.item(row, 2).setText("my_email@gmail.com")
            pwd_widget = self.window.table.cellWidget(row, 3)
            pwd_widget.line_edit.setText("super_secret_123")
            pwd_widget.on_text_edited("super_secret_123")
            self.window.table.item(row, 4).setText("Workspace email")
            
            # Trigger cell changes manually to ensure states
            self.window.on_cell_changed(self.window.table.item(row, 1))
            self.window.on_cell_changed(self.window.table.item(row, 2))
            self.window.on_cell_changed(self.window.table.item(row, 4))
            
            # Save vault
            self.window.save_vault()
            
            # Verify file exists
            self.assertTrue(os.path.exists(temp_vault_path))
            
            # Clear window state
            self.window.current_file_path = None
            self.window.master_key = None
            self.window.records = []
            self.window.vault_is_open = False
            self.window.populate_table()
            self.assertEqual(self.window.table.rowCount(), 0)
            
            # Reopen vault programmatically
            with open(temp_vault_path, "r", encoding="utf-8") as f:
                vault_dict = json.load(f)
                
            records, derived_key, salt, opslimit, memlimit = crypto.deserialize_vault(vault_dict, password)
            
            # Success load simulation
            self.window.current_file_path = temp_vault_path
            self.window.master_key = derived_key
            self.window.current_salt = salt
            self.window.current_opslimit = opslimit
            self.window.current_memlimit = memlimit
            self.window.records = [{"id": r["id"], "website_name": r["website_name"], "account": r["account"], "password": r["password"], "description": r["description"], "row_status": "unchanged"} for r in records]
            self.window.vault_is_open = True
            self.window.populate_table()
            
            # Verify UI matches saved data
            self.assertEqual(self.window.table.rowCount(), 1)
            self.assertEqual(self.window.table.item(0, 1).text(), "Google Workspace")
            self.assertEqual(self.window.table.item(0, 2).text(), "my_email@gmail.com")
            restored_pwd_widget = self.window.table.cellWidget(0, 3)
            self.assertEqual(restored_pwd_widget.raw_password, "super_secret_123")
            self.assertEqual(self.window.table.item(0, 4).text(), "Workspace email")
            self.assertEqual(self.window.table.item(0, 0).text(), "") # status should be empty (unchanged)
            
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == '__main__':
    unittest.main()
