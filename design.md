application:
  name: PasswordVaultApp
  version: v1
  description: >
    一個使用 libsodium 加密的本機密碼管理器。
    使用者可以建立加密檔、開啟加密檔、輸入主密碼解密、
    在 Grid 中新增/修改/刪除密碼資料，最後重新加密存檔。

  security_design:
    crypto_library: libsodium

    key_derivation:
      algorithm: Argon2id
      libsodium_function: crypto_pwhash
      purpose: >
        將使用者輸入的 master_password 轉成加密用的 256-bit key。
      key_length: 32 bytes
      salt:
        size: 16 bytes
        generation: randombytes_buf
        storage: vault_header
        rule: >
          建立新加密檔時產生一次 salt。
          開啟舊檔案時從 vault header 讀取原本的 salt。
      opslimit:
        default: crypto_pwhash_OPSLIMIT_INTERACTIVE
        stronger_option: crypto_pwhash_OPSLIMIT_MODERATE
      memlimit:
        default: crypto_pwhash_MEMLIMIT_INTERACTIVE
        stronger_option: crypto_pwhash_MEMLIMIT_MODERATE

    encryption:
      algorithm: XChaCha20-Poly1305
      libsodium_function: crypto_aead_xchacha20poly1305_ietf_encrypt
      key_size: 32 bytes
      nonce:
        size: 24 bytes
        generation: randombytes_buf
        rule: 每次存檔加密時都重新產生新的 nonce
      authentication:
        enabled: true
        purpose: 防止密文被竄改

    decryption:
      libsodium_function: crypto_aead_xchacha20poly1305_ietf_decrypt
      failure_handling:
        wrong_password: show_error_message
        corrupted_file: show_error_message
        invalid_format: show_error_message

    never_store:
      - master_password
      - derived_key
      - plaintext_password_data

    allowed_to_store:
      - salt
      - nonce
      - kdf_params
      - encrypted_ciphertext
      - vault_version

  ui:
    main_window:
      title: Password Vault Manager
      width: 1000
      height: 700

    layout:
      top_panel:
        components:
          - id: file_path_label
            type: label
            text: 加密檔路徑

          - id: file_path_textbox
            type: textbox
            readonly: true
            placeholder: 尚未選擇檔案

          - id: browse_file_button
            type: button
            text: 選擇加密檔
            action: open_existing_vault

          - id: new_file_button
            type: button
            text: 新增加密檔
            action: create_new_vault

          - id: save_button
            type: button
            text: 存檔
            action: save_vault
            enabled_when:
              - vault_is_open
              - grid_has_data

          - id: change_master_password_button
            type: button
            text: 修改密碼
            action: change_master_password
            enabled_when:
              - vault_is_open

      grid_panel:
        component:
          id: password_grid
          type: data_grid
          editable: true
          allow_add_row: true
          allow_delete_row: true
          columns:
            - id: status
              title: 狀態
              width: 80
              readonly: true
              values:
                - unchanged
                - new
                - modified
                - deleted

            - id: website_name
              title: 網頁名稱
              width: 220
              editable: true
              required: true

            - id: account
              title: 帳號
              width: 220
              editable: true
              required: true

            - id: password
              title: 密碼
              width: 220
              editable: true
              required: true
              display_mode: masked
              options:
                allow_show_hide: true
                allow_copy: true

            - id: description
              title: 說明
              width: 300
              editable: true
              required: false

      bottom_panel:
        components:
          - id: status_bar
            type: status_bar
            text: 尚未開啟加密檔

  vault_file_format:
    file_extension: ".vault"
    encoding: utf-8
    format: json

    structure:
      version: 1

      header:
        app_name: PasswordVaultApp
        vault_version: 1

        kdf:
          algorithm: Argon2id
          salt: base64_string
          opslimit: integer
          memlimit: integer
          key_length: 32

        encryption:
          algorithm: XChaCha20-Poly1305
          nonce: base64_string

      payload:
        ciphertext: base64_string

    plaintext_before_encryption:
      format: json
      example:
        records:
          - id: uuid
            website_name: Google
            account: user@gmail.com
            password: my-password
            description: Gmail account
            created_at: "2026-06-15T10:00:00+08:00"
            updated_at: "2026-06-15T10:00:00+08:00"

  data_model:
    password_record:
      fields:
        id:
          type: uuid
          required: true
          generated_when: new_row_created

        website_name:
          type: string
          required: true
          max_length: 200

        account:
          type: string
          required: true
          max_length: 200

        password:
          type: string
          required: true
          max_length: 500

        description:
          type: string
          required: false
          max_length: 1000

        row_status:
          type: enum
          values:
            - unchanged
            - new
            - modified
            - deleted
          default: unchanged

        created_at:
          type: datetime
          required: true

        updated_at:
          type: datetime
          required: true

  state_management:
    global_state:
      current_file_path:
        type: string
        default: null

      vault_is_open:
        type: boolean
        default: false

      master_key_in_memory:
        type: bytes
        default: null
        rule: >
          只存在記憶體，不可寫入檔案。
          關閉程式時必須清除。

      grid_records:
        type: list
        default: []

      has_unsaved_changes:
        type: boolean
        default: false

  functions:
    open_existing_vault:
      description: >
        功能一：選擇加密後的密檔，輸入主密碼，透過 libsodium 解密，
        將資料載入 Grid。
      steps:
        - show_file_picker:
            filter: "*.vault"

        - read_vault_file:
            input: selected_file_path

        - parse_header:
            read:
              - salt
              - opslimit
              - memlimit
              - nonce
              - ciphertext

        - prompt_master_password:
            dialog_title: 輸入主密碼
            input_type: password

        - derive_key:
            function: crypto_pwhash
            input:
              password: master_password
              salt: vault_header.kdf.salt
              opslimit: vault_header.kdf.opslimit
              memlimit: vault_header.kdf.memlimit
              algorithm: Argon2id
            output: master_key

        - decrypt_payload:
            function: crypto_aead_xchacha20poly1305_ietf_decrypt
            input:
              ciphertext: payload.ciphertext
              nonce: header.encryption.nonce
              key: master_key
            on_success:
              - parse_plaintext_json
              - load_records_to_grid
              - set_all_row_status_to_unchanged
              - set_current_file_path
              - set_vault_is_open_true
              - set_has_unsaved_changes_false
            on_failure:
              - clear_master_key
              - show_error: 密碼錯誤，或檔案已損毀

    create_new_vault:
      description: >
        功能二：新增一個加密檔，輸入密碼，並對這個檔案開始加密。
      steps:
        - show_save_file_dialog:
            default_extension: ".vault"

        - prompt_new_master_password:
            fields:
              - master_password
              - confirm_master_password
            validation:
              - password_not_empty
              - password_equals_confirm_password
              - password_strength_warning_if_too_weak

        - generate_salt:
            function: randombytes_buf
            size: 16 bytes

        - derive_key:
            function: crypto_pwhash
            input:
              password: master_password
              salt: generated_salt
              opslimit: crypto_pwhash_OPSLIMIT_INTERACTIVE
              memlimit: crypto_pwhash_MEMLIMIT_INTERACTIVE
              algorithm: Argon2id
            output: master_key

        - initialize_empty_records:
            records: []

        - generate_nonce:
            function: randombytes_buf
            size: 24 bytes

        - encrypt_empty_payload:
            function: crypto_aead_xchacha20poly1305_ietf_encrypt
            input:
              plaintext:
                records: []
              nonce: generated_nonce
              key: master_key

        - write_vault_file:
            file_path: selected_save_path
            content:
              version: 1
              header:
                kdf:
                  algorithm: Argon2id
                  salt: base64_generated_salt
                  opslimit: crypto_pwhash_OPSLIMIT_INTERACTIVE
                  memlimit: crypto_pwhash_MEMLIMIT_INTERACTIVE
                  key_length: 32
                encryption:
                  algorithm: XChaCha20-Poly1305
                  nonce: base64_generated_nonce
              payload:
                ciphertext: base64_ciphertext

        - update_ui:
            set_current_file_path: selected_save_path
            clear_grid: true
            set_vault_is_open_true: true
            set_has_unsaved_changes_false: true
            status_bar_text: 新增加密檔完成

    add_grid_row:
      description: 功能三之一：Grid 可以新增資料。
      trigger:
        - user_clicks_add_row
        - user_edits_empty_new_row
      steps:
        - create_record:
            id: uuid
            website_name: ""
            account: ""
            password: ""
            description: ""
            row_status: new
            created_at: now
            updated_at: now

        - append_to_grid
        - set_has_unsaved_changes_true
        - show_row_status: new

    delete_grid_row:
      description: 功能三之二：Grid 可以刪除資料。
      trigger:
        - user_selects_row_and_clicks_delete
      behavior:
        if_row_status_is_new:
          action: remove_from_grid_directly
        if_row_status_is_unchanged_or_modified:
          action: mark_as_deleted
          display:
            row_status: deleted
            row_style: strikethrough_or_gray
      steps:
        - set_has_unsaved_changes_true

    edit_grid_row:
      description: 功能五：只要有異動的 row，要顯示新增/修改狀態。
      trigger:
        - user_edits_cell
      rules:
        if_original_row_status_is_unchanged:
          set_row_status: modified

        if_original_row_status_is_new:
          keep_row_status: new

        if_original_row_status_is_modified:
          keep_row_status: modified

        if_original_row_status_is_deleted:
          block_editing: true

      steps:
        - update_record_value
        - update_record_updated_at
        - set_has_unsaved_changes_true
        - refresh_grid_status_column

    save_vault:
      description: >
        功能四：存檔時將 Grid 資料轉成 JSON，再使用 libsodium 加密後寫入檔案。
      validation:
        - vault_is_open_must_be_true
        - current_file_path_must_exist
        - required_fields_must_not_be_empty:
            fields:
              - website_name
              - account
              - password

      steps:
        - collect_grid_records:
            exclude_status:
              - deleted

        - remove_ui_only_fields:
            fields_to_remove:
              - row_status

        - serialize_to_json:
            output: plaintext_json

        - generate_new_nonce:
            function: randombytes_buf
            size: 24 bytes
            reason: 每次重新加密存檔都要使用新的 nonce

        - encrypt_payload:
            function: crypto_aead_xchacha20poly1305_ietf_encrypt
            input:
              plaintext: plaintext_json
              nonce: new_nonce
              key: master_key
            output: ciphertext

        - update_vault_header:
            encryption.nonce: base64_new_nonce

        - write_file:
            path: current_file_path
            content:
              version: 1
              header:
                kdf:
                  algorithm: Argon2id
                  salt: existing_salt
                  opslimit: existing_opslimit
                  memlimit: existing_memlimit
                  key_length: 32
                encryption:
                  algorithm: XChaCha20-Poly1305
                  nonce: base64_new_nonce
              payload:
                ciphertext: base64_ciphertext

        - update_grid_after_save:
            remove_deleted_rows: true
            set_all_row_status_to_unchanged: true
            set_has_unsaved_changes_false: true

        - show_status:
            message: 存檔完成，資料已重新加密

    change_master_password:
      description: >
        修改主密碼。
        注意：修改主密碼不是修改每筆網站密碼，而是重新產生新的 KDF salt 與 master_key，
        再把整個 vault 重新加密。
      steps:
        - verify_vault_is_open

        - prompt_old_master_password:
            input_type: password

        - derive_key_with_existing_salt:
            function: crypto_pwhash
            input:
              password: old_master_password
              salt: existing_salt
              opslimit: existing_opslimit
              memlimit: existing_memlimit

        - test_decrypt_current_payload:
            on_failure:
              - show_error: 舊密碼錯誤
              - stop

        - prompt_new_master_password:
            fields:
              - new_master_password
              - confirm_new_master_password
            validation:
              - password_not_empty
              - password_equals_confirm_password
              - password_strength_warning_if_too_weak

        - generate_new_salt:
            function: randombytes_buf
            size: 16 bytes

        - derive_new_master_key:
            function: crypto_pwhash
            input:
              password: new_master_password
              salt: new_salt
              opslimit: crypto_pwhash_OPSLIMIT_INTERACTIVE
              memlimit: crypto_pwhash_MEMLIMIT_INTERACTIVE
              algorithm: Argon2id

        - serialize_current_grid_records_to_json

        - generate_new_nonce:
            function: randombytes_buf
            size: 24 bytes

        - encrypt_with_new_master_key:
            function: crypto_aead_xchacha20poly1305_ietf_encrypt

        - write_vault_file_with_new_header:
            update:
              kdf.salt: base64_new_salt
              encryption.nonce: base64_new_nonce
              payload.ciphertext: base64_new_ciphertext

        - replace_master_key_in_memory:
            old_key: clear_memory
            new_key: keep_in_memory

        - show_status:
            message: 主密碼已修改，vault 已重新加密

  row_status_display:
    unchanged:
      label: ""
      color: default
      meaning: 已存檔，沒有異動

    new:
      label: 新增
      color: green
      meaning: 新增資料，尚未存檔

    modified:
      label: 修改
      color: orange
      meaning: 已修改，尚未存檔

    deleted:
      label: 刪除
      color: gray
      meaning: 已標記刪除，存檔後會移除

  error_handling:
    wrong_master_password:
      message: 密碼錯誤，無法解密檔案

    corrupted_vault_file:
      message: 檔案格式錯誤或內容已損毀

    missing_required_fields:
      message: 網頁名稱、帳號、密碼不可空白

    save_failed:
      message: 存檔失敗，請確認檔案權限或路徑是否有效

    crypto_failed:
      message: 加密或解密失敗

  recommended_language_options:
    python:
      gui:
        - PySide6
        - PyQt6
        - Tkinter
      libsodium_binding:
        - PyNaCl
        - pysodium
      note: >
        如果要做正式桌面程式，建議 PySide6 + libsodium binding。

    java:
      gui:
        - JavaFX
        - Swing
      libsodium_binding:
        - kalium
        - lazy-sodium-java
      note: >
        如果你熟 Java，可以用 JavaFX 做介面。

    csharp:
      gui:
        - WPF
        - WinForms
      libsodium_binding:
        - Sodium.Core
      note: >
        如果主要跑 Windows，WPF 很適合。

  future_versions:
    v2:
      features:
        - 密碼產生器
        - 搜尋功能
        - 複製密碼後自動清除剪貼簿
        - 自動鎖定 vault
        - 顯示密碼強度
        - 匯入 CSV
        - 匯出加密備份

    v3:
      features:
        - key file
        - TOTP OTP 管理
        - 多 vault 支援
        - 雲端同步
        - 生物辨識解鎖