import sys
import os
import uuid
import json
from datetime import datetime
from PySide6.QtCore import Qt, Slot, QSize
from PySide6.QtGui import QFont, QColor, QClipboard, QAction, QCloseEvent, QIcon
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QLineEdit, QPushButton, QTableWidget, QTableWidgetItem,
    QStatusBar, QMessageBox, QFileDialog, QDialog, QFormLayout,
    QHeaderView, QAbstractItemView
)

import crypto

# Premium Dark Mode QSS Style Sheet
DARK_STYLE = """
QMainWindow {
    background-color: #0f172a;
    color: #f8fafc;
}

QLabel {
    color: #cbd5e1;
    font-size: 13px;
    font-family: 'Segoe UI', Arial, sans-serif;
}

QLineEdit {
    background-color: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 6px 12px;
    color: #f8fafc;
    font-size: 13px;
    font-family: 'Segoe UI', Arial, sans-serif;
}
QLineEdit:focus {
    border: 1px solid #6366f1;
}
QLineEdit:disabled {
    background-color: #0f172a;
    color: #64748b;
    border: 1px solid #1e293b;
}

QPushButton {
    background-color: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 6px 16px;
    color: #f8fafc;
    font-weight: 500;
    font-size: 13px;
    font-family: 'Segoe UI', Arial, sans-serif;
}
QPushButton:hover {
    background-color: #334155;
    border-color: #475569;
}
QPushButton:pressed {
    background-color: #0f172a;
}
QPushButton:disabled {
    background-color: #0f172a;
    border-color: #1e293b;
    color: #64748b;
}

QPushButton#primary_button {
    background-color: #4f46e5;
    border: 1px solid #4f46e5;
    color: #ffffff;
}
QPushButton#primary_button:hover {
    background-color: #4338ca;
    border-color: #4338ca;
}
QPushButton#primary_button:pressed {
    background-color: #3730a3;
}
QPushButton#primary_button:disabled {
    background-color: #1e293b;
    border-color: #334155;
    color: #64748b;
}

QPushButton#danger_button {
    background-color: #991b1b;
    border: 1px solid #991b1b;
    color: #ffffff;
}
QPushButton#danger_button:hover {
    background-color: #b91c1c;
    border-color: #b91c1c;
}
QPushButton#danger_button:pressed {
    background-color: #7f1d1d;
}

QTableWidget {
    background-color: #0f172a;
    gridline-color: #1e293b;
    border: 1px solid #1e293b;
    border-radius: 8px;
    color: #f8fafc;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
}
QTableWidget::item {
    padding: 8px;
    border-bottom: 1px solid #1e293b;
}
QTableWidget::item:selected {
    background-color: #312e81;
    color: #ffffff;
}
QTableWidget::item:hover {
    background-color: #1e293b;
}

QHeaderView::section {
    background-color: #1e293b;
    color: #cbd5e1;
    padding: 8px;
    border: none;
    border-bottom: 2px solid #334155;
    font-weight: bold;
    font-size: 13px;
}

QStatusBar {
    background-color: #1e293b;
    color: #94a3b8;
    border-top: 1px solid #334155;
    font-size: 12px;
}

QDialog {
    background-color: #0f172a;
    color: #f8fafc;
}
"""

class PasswordCellWidget(QWidget):
    """
    Custom cell widget placed in the Password column.
    Contains a masked QLineEdit, an Eye (show/hide) button, and a Copy button.
    """
    def __init__(self, raw_password: str, record_id: str, parent=None):
        super().__init__(parent)
        self.raw_password = raw_password
        self.record_id = record_id
        self.is_masked = True
        self.init_ui()

    def init_ui(self):
        layout = QHBoxLayout()
        layout.setContentsMargins(4, 2, 4, 2)
        layout.setSpacing(4)

        self.line_edit = QLineEdit()
        self.line_edit.setText(self.raw_password)
        self.line_edit.setEchoMode(QLineEdit.EchoMode.Password)
        # Style input to seamlessly match raw cells
        self.line_edit.setStyleSheet("background: transparent; border: none; color: #f8fafc; padding: 0px;")
        self.line_edit.textEdited.connect(self.on_text_edited)

        self.eye_btn = QPushButton("👁")
        self.eye_btn.setToolTip("顯示/隱藏密碼")
        self.eye_btn.setFixedSize(22, 22)
        self.eye_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.eye_btn.setStyleSheet("background: transparent; border: none; color: #94a3b8; padding: 0px; font-size: 14px;")
        self.eye_btn.clicked.connect(self.toggle_mask)

        self.copy_btn = QPushButton("📋")
        self.copy_btn.setToolTip("複製密碼")
        self.copy_btn.setFixedSize(22, 22)
        self.copy_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.copy_btn.setStyleSheet("background: transparent; border: none; color: #94a3b8; padding: 0px; font-size: 14px;")
        self.copy_btn.clicked.connect(self.copy_password)

        layout.addWidget(self.line_edit)
        layout.addWidget(self.eye_btn)
        layout.addWidget(self.copy_btn)
        self.setLayout(layout)

    def on_text_edited(self, text: str):
        self.raw_password = text
        main_window = self.window()
        if hasattr(main_window, "handle_password_edited"):
            main_window.handle_password_edited(self.record_id, text)

    def toggle_mask(self):
        if self.is_masked:
            self.line_edit.setEchoMode(QLineEdit.EchoMode.Normal)
            self.eye_btn.setText("🙈")
            self.is_masked = False
        else:
            self.line_edit.setEchoMode(QLineEdit.EchoMode.Password)
            self.eye_btn.setText("👁")
            self.is_masked = True

    def copy_password(self):
        clipboard = QApplication.clipboard()
        clipboard.setText(self.raw_password)
        main_window = self.window()
        if hasattr(main_window, "show_status_message"):
            main_window.show_status_message("密碼已複製到剪貼簿", 2000)

    def set_disabled(self, disabled: bool):
        self.line_edit.setDisabled(disabled)
        self.eye_btn.setDisabled(disabled)
        self.copy_btn.setDisabled(disabled)
        if disabled:
            self.line_edit.setStyleSheet("background: transparent; border: none; color: #64748b; text-decoration: line-through; padding: 0px;")
        else:
            self.line_edit.setStyleSheet("background: transparent; border: none; color: #f8fafc; padding: 0px;")


class PasswordPromptDialog(QDialog):
    """Modal dialog asking for the master password when opening an existing vault."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("輸入密碼")
        self.setFixedSize(320, 150)
        self.setModal(True)
        self.password = None
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(15, 15, 15, 15)

        label = QLabel("請輸入此加密檔的密碼：")
        self.pwd_input = QLineEdit()
        self.pwd_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.pwd_input.setPlaceholderText("密碼")
        
        btn_layout = QHBoxLayout()
        self.ok_btn = QPushButton("確定")
        self.ok_btn.setObjectName("primary_button")
        self.ok_btn.clicked.connect(self.accept_password)
        self.cancel_btn = QPushButton("取消")
        self.cancel_btn.clicked.connect(self.reject)
        
        btn_layout.addWidget(self.ok_btn)
        btn_layout.addWidget(self.cancel_btn)
        
        layout.addWidget(label)
        layout.addWidget(self.pwd_input)
        layout.addSpacing(10)
        layout.addLayout(btn_layout)
        self.setLayout(layout)
        self.pwd_input.setFocus()

    def accept_password(self):
        self.password = self.pwd_input.text()
        self.accept()


class NewPasswordDialog(QDialog):
    """Modal dialog for creating a new master password with strength checking."""
    def __init__(self, title="新增加密檔 - 設定密碼", parent=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setFixedSize(380, 240)
        self.setModal(True)
        self.password = None
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(15, 15, 15, 15)

        form_layout = QFormLayout()
        
        self.pwd_input = QLineEdit()
        self.pwd_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.pwd_input.setPlaceholderText("請輸入密碼")
        self.pwd_input.textChanged.connect(self.check_strength)
        
        self.confirm_input = QLineEdit()
        self.confirm_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_input.setPlaceholderText("請再次輸入密碼")
        
        form_layout.addRow("設定密碼：", self.pwd_input)
        form_layout.addRow("確認密碼：", self.confirm_input)
        
        self.strength_label = QLabel("密碼強度：尚未輸入")
        self.strength_label.setStyleSheet("color: #94a3b8;")
        
        btn_layout = QHBoxLayout()
        self.ok_btn = QPushButton("確定")
        self.ok_btn.setObjectName("primary_button")
        self.ok_btn.clicked.connect(self.validate_and_accept)
        self.cancel_btn = QPushButton("取消")
        self.cancel_btn.clicked.connect(self.reject)
        
        btn_layout.addWidget(self.ok_btn)
        btn_layout.addWidget(self.cancel_btn)
        
        layout.addLayout(form_layout)
        layout.addWidget(self.strength_label)
        layout.addSpacing(15)
        layout.addLayout(btn_layout)
        self.setLayout(layout)
        self.pwd_input.setFocus()

    def check_strength(self, password: str):
        if not password:
            self.strength_label.setText("密碼強度：尚未輸入")
            self.strength_label.setStyleSheet("color: #94a3b8;")
            return
            
        length = len(password)
        has_upper = any(c.isupper() for c in password)
        has_lower = any(c.islower() for c in password)
        has_digit = any(c.isdigit() for c in password)
        has_special = any(not c.isalnum() for c in password)
        
        score = 0
        if length >= 8: score += 1
        if length >= 12: score += 1
        if has_upper and has_lower: score += 1
        if has_digit: score += 1
        if has_special: score += 1
        
        if score <= 2:
            self.strength_label.setText("密碼強度：弱 (建議使用大小寫英數字與符號組合，長度大於8)")
            self.strength_label.setStyleSheet("color: #ef4444;") # red
        elif score <= 4:
            self.strength_label.setText("密碼強度：中")
            self.strength_label.setStyleSheet("color: #f97316;") # orange
        else:
            self.strength_label.setText("密碼強度：強")
            self.strength_label.setStyleSheet("color: #22c55e;") # green

    def validate_and_accept(self):
        pwd = self.pwd_input.text()
        confirm = self.confirm_input.text()
        
        if not pwd:
            QMessageBox.warning(self, "錯誤", "密碼不可空白")
            return
        if pwd != confirm:
            QMessageBox.warning(self, "錯誤", "密碼與確認密碼不符，請重新輸入")
            return
            
        self.password = pwd
        self.accept()


class ChangePasswordDialog(QDialog):
    """Modal dialog for changing the master password."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("修改密碼")
        self.setFixedSize(380, 280)
        self.setModal(True)
        self.old_password = None
        self.new_password = None
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(15, 15, 15, 15)

        form_layout = QFormLayout()
        
        self.old_input = QLineEdit()
        self.old_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.old_input.setPlaceholderText("請輸入舊密碼")
        
        self.pwd_input = QLineEdit()
        self.pwd_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.pwd_input.setPlaceholderText("請輸入新密碼")
        self.pwd_input.textChanged.connect(self.check_strength)
        
        self.confirm_input = QLineEdit()
        self.confirm_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_input.setPlaceholderText("請確認新密碼")
        
        form_layout.addRow("目前舊密碼：", self.old_input)
        form_layout.addRow("設定新密碼：", self.pwd_input)
        form_layout.addRow("確認新密碼：", self.confirm_input)
        
        self.strength_label = QLabel("密碼強度：尚未輸入")
        self.strength_label.setStyleSheet("color: #94a3b8;")
        
        btn_layout = QHBoxLayout()
        self.ok_btn = QPushButton("確定")
        self.ok_btn.setObjectName("primary_button")
        self.ok_btn.clicked.connect(self.validate_and_accept)
        self.cancel_btn = QPushButton("取消")
        self.cancel_btn.clicked.connect(self.reject)
        
        btn_layout.addWidget(self.ok_btn)
        btn_layout.addWidget(self.cancel_btn)
        
        layout.addLayout(form_layout)
        layout.addWidget(self.strength_label)
        layout.addSpacing(15)
        layout.addLayout(btn_layout)
        self.setLayout(layout)
        self.old_input.setFocus()

    def check_strength(self, password: str):
        if not password:
            self.strength_label.setText("密碼強度：尚未輸入")
            self.strength_label.setStyleSheet("color: #94a3b8;")
            return
            
        length = len(password)
        has_upper = any(c.isupper() for c in password)
        has_lower = any(c.islower() for c in password)
        has_digit = any(c.isdigit() for c in password)
        has_special = any(not c.isalnum() for c in password)
        
        score = 0
        if length >= 8: score += 1
        if length >= 12: score += 1
        if has_upper and has_lower: score += 1
        if has_digit: score += 1
        if has_special: score += 1
        
        if score <= 2:
            self.strength_label.setText("密碼強度：弱")
            self.strength_label.setStyleSheet("color: #ef4444;")
        elif score <= 4:
            self.strength_label.setText("密碼強度：中")
            self.strength_label.setStyleSheet("color: #f97316;")
        else:
            self.strength_label.setText("密碼強度：強")
            self.strength_label.setStyleSheet("color: #22c55e;")

    def validate_and_accept(self):
        old_pwd = self.old_input.text()
        new_pwd = self.pwd_input.text()
        confirm = self.confirm_input.text()
        
        if not old_pwd:
            QMessageBox.warning(self, "錯誤", "請輸入舊密碼以進行驗證")
            return
        if not new_pwd:
            QMessageBox.warning(self, "錯誤", "新密碼不可空白")
            return
        if new_pwd != confirm:
            QMessageBox.warning(self, "錯誤", "新密碼與確認新密碼不符")
            return
            
        self.old_password = old_pwd
        self.new_password = new_pwd
        self.accept()


class PasswordVaultApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Password Vault Manager")
        self.resize(1150, 700)
        self.setMinimumSize(1050, 600)
        
        # Set window icon
        icon_path = os.path.join(os.path.dirname(__file__), "icon.jpg")
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))
        
        # State Management
        self.current_file_path = None
        self.vault_is_open = False
        self.master_key = None
        self.records = []  # List of dictionaries: id, website_name, account, password, description, row_status, created_at, updated_at
        self.has_unsaved_changes = False
        
        # Keep track of loaded KDF parameters to re-use during encrypting/saves
        self.current_salt = None
        self.current_opslimit = crypto.nacl.pwhash.argon2id.OPSLIMIT_INTERACTIVE
        self.current_memlimit = crypto.nacl.pwhash.argon2id.MEMLIMIT_INTERACTIVE

        self.init_ui()
        self.apply_theme()
        self.update_action_states()

    def apply_theme(self):
        self.setStyleSheet(DARK_STYLE)

    def init_ui(self):
        # Main Layout container
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout()
        main_layout.setContentsMargins(15, 15, 15, 15)
        main_layout.setSpacing(15)
        
        # 1. Top Panel
        top_layout = QHBoxLayout()
        top_layout.setSpacing(10)
        
        file_path_label = QLabel("加密檔路徑:")
        self.file_path_textbox = QLineEdit()
        self.file_path_textbox.setReadOnly(True)
        self.file_path_textbox.setPlaceholderText("尚未選擇檔案")
        
        self.browse_file_button = QPushButton("選擇加密檔")
        self.browse_file_button.clicked.connect(self.open_existing_vault)
        
        self.new_file_button = QPushButton("新增加密檔")
        self.new_file_button.clicked.connect(self.create_new_vault)
        
        self.save_button = QPushButton("存檔")
        self.save_button.setObjectName("primary_button")
        self.save_button.clicked.connect(self.save_vault)
        
        self.change_master_password_button = QPushButton("修改密碼")
        self.change_master_password_button.clicked.connect(self.change_master_password)
        
        self.exit_button = QPushButton("離開程式")
        self.exit_button.setObjectName("danger_button")
        self.exit_button.clicked.connect(self.close)
        
        top_layout.addWidget(file_path_label)
        top_layout.addWidget(self.file_path_textbox, 1) # Expandable
        top_layout.addWidget(self.browse_file_button)
        top_layout.addWidget(self.new_file_button)
        top_layout.addWidget(self.save_button)
        top_layout.addWidget(self.change_master_password_button)
        top_layout.addWidget(self.exit_button)
        
        # 2. Grid Action Bar (Add / Delete rows)
        grid_action_layout = QHBoxLayout()
        self.add_row_button = QPushButton("➕ 新增資料列")
        self.add_row_button.clicked.connect(self.add_grid_row)
        
        self.delete_row_button = QPushButton("❌ 刪除資料列")
        self.delete_row_button.setObjectName("danger_button")
        self.delete_row_button.clicked.connect(self.delete_grid_row)
        
        grid_action_layout.addWidget(self.add_row_button)
        grid_action_layout.addWidget(self.delete_row_button)
        grid_action_layout.addStretch()
        
        # 3. Grid Panel
        self.table = QTableWidget()
        self.table.setColumnCount(5)
        self.table.setHorizontalHeaderLabels(["狀態", "網頁名稱", "帳號", "密碼", "說明"])
        
        # Column width settings matching design.md
        self.table.setColumnWidth(0, 50)
        self.table.setColumnWidth(1, 230)
        self.table.setColumnWidth(2, 230)
        self.table.setColumnWidth(3, 230)
        self.table.setColumnWidth(4, 400)
        
        # Set default row height and hide row index numbers
        self.table.verticalHeader().setDefaultSectionSize(40)
        self.table.verticalHeader().setVisible(False)
        
        # Table configuration
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.itemChanged.connect(self.on_cell_changed)
        
        # 4. Bottom Panel / Status Bar
        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)
        self.show_status_message("尚未開啟加密檔")
        
        # Assembly
        main_layout.addLayout(top_layout)
        main_layout.addLayout(grid_action_layout)
        main_layout.addWidget(self.table)
        central_widget.setLayout(main_layout)

    def show_status_message(self, message: str, timeout=0):
        self.status_bar.showMessage(message, timeout)

    def update_action_states(self):
        """Enable or disable elements based on state variables."""
        self.save_button.setEnabled(self.vault_is_open and (self.has_unsaved_changes or len(self.records) > 0))
        self.change_master_password_button.setEnabled(self.vault_is_open)
        self.add_row_button.setEnabled(self.vault_is_open)
        self.delete_row_button.setEnabled(self.vault_is_open)

    def set_unsaved_changes(self, has_changes: bool):
        self.has_unsaved_changes = has_changes
        self.update_action_states()

    def check_unsaved_changes_warning(self) -> bool:
        """
        If there are unsaved changes, prompt the user.
        Returns True if it is safe to proceed (discard or no changes), False to cancel.
        """
        if self.has_unsaved_changes:
            res = QMessageBox.question(
                self,
                "未存檔變更",
                "您有未存檔的變更，確定要放棄這些變更嗎？",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            )
            return res == QMessageBox.StandardButton.Yes
        return True

    # --- Actions ---

    @Slot()
    def open_existing_vault(self):
        if not self.check_unsaved_changes_warning():
            return
            
        file_path, _ = QFileDialog.getOpenFileName(
            self, "選擇加密檔", "", "Vault Files (*.vault);;All Files (*)"
        )
        if not file_path:
            return
            
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                vault_dict = json.load(f)
        except Exception as e:
            QMessageBox.critical(self, "錯誤", f"無法讀取檔案: {str(e)}")
            return
            
        # Prompt master password
        dialog = PasswordPromptDialog(self)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
            
        password = dialog.password
        self.show_status_message("正在解密檔案，請稍候...")
        QApplication.processEvents() # Refresh GUI to show status

        try:
            records, derived_key, salt, opslimit, memlimit = crypto.deserialize_vault(vault_dict, password)
        except crypto.DecryptionError:
            QMessageBox.critical(self, "錯誤", "密碼錯誤，無法解密檔案")
            self.show_status_message("解密失敗：密碼錯誤")
            return
        except Exception as e:
            QMessageBox.critical(self, "錯誤", f"檔案格式錯誤或內容已損毀: {str(e)}")
            self.show_status_message("解密失敗：檔案已損毀")
            return
            
        # Success state
        self.current_file_path = file_path
        self.file_path_textbox.setText(file_path)
        self.master_key = derived_key
        self.current_salt = salt
        self.current_opslimit = opslimit
        self.current_memlimit = memlimit
        
        # Load records list
        self.records = []
        for r in records:
            r["row_status"] = "unchanged"
            self.records.append(r)
            
        self.vault_is_open = True
        self.set_unsaved_changes(False)
        self.show_status_message("開啟加密檔完成")
        self.populate_table()

    @Slot()
    def create_new_vault(self):
        if not self.check_unsaved_changes_warning():
            return
            
        file_path, _ = QFileDialog.getSaveFileName(
            self, "新增加密檔", "", "Vault Files (*.vault)"
        )
        if not file_path:
            return
            
        # Ensure it ends with .vault
        if not file_path.endswith(".vault"):
            file_path += ".vault"
            
        dialog = NewPasswordDialog(parent=self)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
            
        password = dialog.password
        self.show_status_message("正在產生密鑰並新增加密檔...")
        QApplication.processEvents()
        
        # Generate Salt
        salt = crypto.nacl.utils.random(crypto.nacl.pwhash.argon2id.SALTBYTES)
        opslimit = crypto.nacl.pwhash.argon2id.OPSLIMIT_INTERACTIVE
        memlimit = crypto.nacl.pwhash.argon2id.MEMLIMIT_INTERACTIVE
        
        derived_key = crypto.derive_key(password, salt, opslimit, memlimit)
        
        # Build empty vault structure
        records = []
        vault_dict = crypto.serialize_vault(records, derived_key, salt, opslimit, memlimit)
        
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(vault_dict, f, indent=2, ensure_ascii=False)
        except Exception as e:
            QMessageBox.critical(self, "錯誤", f"無法寫入檔案: {str(e)}")
            self.show_status_message("新增加密檔失敗")
            return
            
        # Update app state
        self.current_file_path = file_path
        self.file_path_textbox.setText(file_path)
        self.master_key = derived_key
        self.current_salt = salt
        self.current_opslimit = opslimit
        self.current_memlimit = memlimit
        self.records = []
        self.vault_is_open = True
        self.set_unsaved_changes(False)
        self.show_status_message("新增加密檔完成")
        self.populate_table()

    @Slot()
    def save_vault(self):
        if not self.vault_is_open or not self.current_file_path:
            return
            
        # Validation: check required fields for non-deleted rows
        for r in self.records:
            if r.get("row_status") != "deleted":
                if not r.get("website_name") or not r.get("account") or not r.get("password"):
                    QMessageBox.warning(self, "欄位不可空白", "網頁名稱、帳號、密碼不可空白。")
                    return
                    
        # Exclude deleted rows
        active_records = [r for r in self.records if r.get("row_status") != "deleted"]
        
        self.show_status_message("正在加密並儲存檔案...")
        QApplication.processEvents()
        
        vault_dict = crypto.serialize_vault(
            active_records,
            self.master_key,
            self.current_salt,
            self.current_opslimit,
            self.current_memlimit
        )
        
        try:
            with open(self.current_file_path, "w", encoding="utf-8") as f:
                json.dump(vault_dict, f, indent=2, ensure_ascii=False)
        except Exception as e:
            QMessageBox.critical(self, "錯誤", f"存檔失敗，請確認檔案權限或路徑是否有效: {str(e)}")
            self.show_status_message("存檔失敗")
            return
            
        # Post-save cleanup: Remove deleted rows in local records
        self.records = active_records
        for r in self.records:
            r["row_status"] = "unchanged"
            
        self.set_unsaved_changes(False)
        self.show_status_message("存檔完成，資料已重新加密")
        self.populate_table()

    @Slot()
    def change_master_password(self):
        if not self.vault_is_open or not self.current_file_path:
            return
            
        dialog = ChangePasswordDialog(self)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
            
        # Verify old password
        old_pwd = dialog.old_password
        new_pwd = dialog.new_password
        
        try:
            # Re-derive old key with existing salt to verify old password
            old_derived_key = crypto.derive_key(
                old_pwd, self.current_salt, self.current_opslimit, self.current_memlimit
            )
            # Read current encrypted ciphertext from disk file to test old_derived_key
            with open(self.current_file_path, "r", encoding="utf-8") as f:
                vault_dict = json.load(f)
                
            crypto.deserialize_vault(vault_dict, old_pwd)
        except crypto.DecryptionError:
            QMessageBox.critical(self, "錯誤", "舊密碼錯誤，無法驗證身分。")
            return
        except Exception as e:
            QMessageBox.critical(self, "錯誤", f"無法驗證目前檔案: {str(e)}")
            return
            
        self.show_status_message("正在重新產生密鑰並重新加密...")
        QApplication.processEvents()
        
        # Generate new salt and derive new key
        new_salt = crypto.nacl.utils.random(crypto.nacl.pwhash.argon2id.SALTBYTES)
        new_opslimit = crypto.nacl.pwhash.argon2id.OPSLIMIT_INTERACTIVE
        new_memlimit = crypto.nacl.pwhash.argon2id.MEMLIMIT_INTERACTIVE
        
        new_derived_key = crypto.derive_key(new_pwd, new_salt, new_opslimit, new_memlimit)
        
        # Encrypt the records list with the new key and salt
        active_records = [r for r in self.records if r.get("row_status") != "deleted"]
        
        new_vault_dict = crypto.serialize_vault(
            active_records,
            new_derived_key,
            new_salt,
            new_opslimit,
            new_memlimit
        )
        
        try:
            with open(self.current_file_path, "w", encoding="utf-8") as f:
                json.dump(new_vault_dict, f, indent=2, ensure_ascii=False)
        except Exception as e:
            QMessageBox.critical(self, "錯誤", f"寫入新加密檔失敗: {str(e)}")
            self.show_status_message("修改密碼失敗")
            return
            
        # Update KDF and memory key
        self.master_key = new_derived_key
        self.current_salt = new_salt
        self.current_opslimit = new_opslimit
        self.current_memlimit = new_memlimit
        
        # Clear deleted rows locally
        self.records = active_records
        for r in self.records:
            r["row_status"] = "unchanged"
            
        self.set_unsaved_changes(False)
        self.show_status_message("密碼已修改，vault 已重新加密")
        self.populate_table()

    # --- Grid Logic ---

    def populate_table(self):
        """Populate the table widget based on self.records."""
        self.table.blockSignals(True)
        self.table.setRowCount(0)
        
        for r in self.records:
            row = self.table.rowCount()
            self.table.insertRow(row)
            
            # 1. Status Column (Read-Only)
            status_item = QTableWidgetItem()
            status_item.setFlags(status_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            # Link record ID to status item UserRole for robust lookup
            status_item.setData(Qt.ItemDataRole.UserRole, r["id"])
            self.table.setItem(row, 0, status_item)
            self.update_status_display(row, r["row_status"])
            
            # 2. Website Name Column
            web_item = QTableWidgetItem(r["website_name"])
            self.table.setItem(row, 1, web_item)
            
            # 3. Account Column
            acc_item = QTableWidgetItem(r["account"])
            self.table.setItem(row, 2, acc_item)
            
            # 4. Password Column (Custom Widget)
            pwd_widget = PasswordCellWidget(r["password"], r["id"])
            self.table.setCellWidget(row, 3, pwd_widget)
            
            # 5. Description Column
            desc_item = QTableWidgetItem(r["description"])
            self.table.setItem(row, 4, desc_item)
            
            # Apply formatting if it is marked as deleted
            if r["row_status"] == "deleted":
                self.apply_deleted_style(row)
                
        self.table.blockSignals(False)
        self.update_action_states()

    def update_status_display(self, row: int, status: str):
        """Sets the text and text color of the Status column cell based on state."""
        status_item = self.table.item(row, 0)
        if not status_item:
            return
            
        if status == "unchanged":
            status_item.setText("")
        elif status == "new":
            status_item.setText("+")
            status_item.setForeground(QColor("#22c55e")) # green
        elif status == "modified":
            status_item.setText("*")
            status_item.setForeground(QColor("#f97316")) # orange
        elif status == "deleted":
            status_item.setText("-")
            status_item.setForeground(QColor("#94a3b8")) # gray

    def apply_deleted_style(self, row: int):
        """Styles a row to look deleted (strikethrough and gray text), and disables edits."""
        for col in [1, 2, 4]:
            item = self.table.item(row, col)
            if item:
                font = item.font()
                font.setStrikeOut(True)
                item.setFont(font)
                item.setForeground(QColor("#64748b"))
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                
        # Disable password cell widget
        pwd_widget = self.table.cellWidget(row, 3)
        if isinstance(pwd_widget, PasswordCellWidget):
            pwd_widget.set_disabled(True)

    @Slot()
    def add_grid_row(self):
        if not self.vault_is_open:
            return
            
        row_id = str(uuid.uuid4())
        now_str = datetime.now().isoformat()
        
        new_record = {
            "id": row_id,
            "website_name": "",
            "account": "",
            "password": "",
            "description": "",
            "row_status": "new",
            "created_at": now_str,
            "updated_at": now_str
        }
        
        self.records.append(new_record)
        
        # Append row to QTableWidget
        self.table.blockSignals(True)
        row = self.table.rowCount()
        self.table.insertRow(row)
        
        status_item = QTableWidgetItem()
        status_item.setFlags(status_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
        status_item.setData(Qt.ItemDataRole.UserRole, row_id)
        self.table.setItem(row, 0, status_item)
        self.update_status_display(row, "new")
        
        self.table.setItem(row, 1, QTableWidgetItem(""))
        self.table.setItem(row, 2, QTableWidgetItem(""))
        
        pwd_widget = PasswordCellWidget("", row_id)
        self.table.setCellWidget(row, 3, pwd_widget)
        
        self.table.setItem(row, 4, QTableWidgetItem(""))
        
        self.table.blockSignals(False)
        self.set_unsaved_changes(True)
        
        # Scroll to new row and select it
        self.table.scrollToItem(status_item)
        self.table.selectRow(row)

    @Slot()
    def delete_grid_row(self):
        if not self.vault_is_open:
            return
            
        selected_ranges = self.table.selectedRanges()
        if not selected_ranges:
            QMessageBox.information(self, "說明", "請選擇要刪除的資料列。")
            return
            
        row = selected_ranges[0].topRow()
        status_item = self.table.item(row, 0)
        if not status_item:
            return
            
        record_id = status_item.data(Qt.ItemDataRole.UserRole)
        
        # Find record
        record = None
        for r in self.records:
            if r["id"] == record_id:
                record = r
                break
        if not record:
            return
            
        if record["row_status"] == "new":
            # Remove immediately
            self.table.blockSignals(True)
            self.table.removeRow(row)
            self.table.blockSignals(False)
            self.records.remove(record)
        else:
            # Mark as deleted
            self.table.blockSignals(True)
            record["row_status"] = "deleted"
            record["updated_at"] = datetime.now().isoformat()
            self.update_status_display(row, "deleted")
            self.apply_deleted_style(row)
            self.table.blockSignals(False)
            
        self.set_unsaved_changes(True)

    def handle_password_edited(self, record_id: str, new_password: str):
        """Called when a password is changed inside the custom PasswordCellWidget."""
        for r in self.records:
            if r["id"] == record_id:
                if r["row_status"] == "deleted":
                    return # Block edits on deleted rows
                r["password"] = new_password
                r["updated_at"] = datetime.now().isoformat()
                
                # Check status and transition to modified if unchanged
                if r["row_status"] == "unchanged":
                    r["row_status"] = "modified"
                    # Find corresponding row in QTableWidget
                    for row in range(self.table.rowCount()):
                        status_item = self.table.item(row, 0)
                        if status_item and status_item.data(Qt.ItemDataRole.UserRole) == record_id:
                            self.table.blockSignals(True)
                            self.update_status_display(row, "modified")
                            self.table.blockSignals(False)
                            break
                            
                self.set_unsaved_changes(True)
                break

    def on_cell_changed(self, item: QTableWidgetItem):
        """Slot connected to itemChanged. Triggers on edit of text cells."""
        row = item.row()
        col = item.column()
        
        # We only care about Website Name (col 1), Account (col 2), and Description (col 4)
        if col not in [1, 2, 4]:
            return
            
        status_item = self.table.item(row, 0)
        if not status_item:
            return
            
        record_id = status_item.data(Qt.ItemDataRole.UserRole)
        
        # Find record
        record = None
        for r in self.records:
            if r["id"] == record_id:
                record = r
                break
        if not record:
            return
            
        if record["row_status"] == "deleted":
            # Revert change if edited (should be blocked but safe guard)
            self.populate_table()
            return
            
        # Update field in record
        text = item.text()
        if col == 1:
            record["website_name"] = text
        elif col == 2:
            record["account"] = text
        elif col == 4:
            record["description"] = text
            
        record["updated_at"] = datetime.now().isoformat()
        
        # Change status if unchanged
        if record["row_status"] == "unchanged":
            record["row_status"] = "modified"
            self.table.blockSignals(True)
            self.update_status_display(row, "modified")
            self.table.blockSignals(False)
            
        self.set_unsaved_changes(True)

    def closeEvent(self, event: QCloseEvent):
        """Prompt user on exit if they have unsaved changes."""
        if self.check_unsaved_changes_warning():
            event.accept()
        else:
            event.ignore()


if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = PasswordVaultApp()
    window.show()
    sys.exit(app.exec())
