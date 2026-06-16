project:
  name: web_password_vault_manager
  version: v2
  description: >
    將 desktop 版密碼管理器改寫成網頁版。
    使用 Next.js 開發 UI，部署至 Vercel。
    加密檔案儲存在使用者個人的 Google Drive。
    系統支援多人使用，每個使用者以帳號名稱產生自己的加密檔案名稱。
    系統只保存加密後的 vault 檔，不保存明文密碼、不保存 master password、不保存 master key。

goals:
  - 提供桌面版密碼管理器的網頁操作體驗
  - 支援手機與桌面瀏覽器使用
  - 使用 Next.js 開發 UI
  - 部署至 Vercel 免費或低成本平台
  - 使用 Google Drive 作為加密檔案儲存空間
  - 每位使用者根據帳號名稱對應自己的加密檔案
  - 使用者需要輸入帳號與密碼才能開啟 vault
  - 密碼資料只在瀏覽器端解密
  - Google Drive 只存放加密後的 vault 檔案
  - 加密檔案不允許被刪除
  - 加密檔案不允許被直接取代
  - 若使用者無法正常解密，只能重新輸入帳號與密碼
  - 若仍無法解密，只能建立新的加密檔案

non_goals:
  - 不做瀏覽器自動填密碼 extension
  - 不做生物辨識
  - 不做明文匯出
  - 不做雲端資料庫保存密碼
  - 不讓 server 端解密使用者資料
  - 不在 Vercel server 儲存 vault 檔案
  - 不保存使用者 master password
  - 不保存使用者 master key

technology_stack:
  frontend:
    framework: Next.js
    language: TypeScript
    ui_library:
      recommended:
        - Tailwind CSS
        - shadcn/ui
        - TanStack Table
      optional:
        - AG Grid

  deployment:
    platform: Vercel
    type: serverless_web_app
    storage_rule: >
      Vercel 不保存使用者 vault 檔案。
      所有 vault 檔案只存放在 Google Drive。

  crypto:
    library: libsodium-wrappers
    execution_location: browser_client_side
    kdf:
      algorithm: Argon2id
      function: crypto_pwhash
      salt_size: 16_bytes
      key_size: 32_bytes
    encryption:
      algorithm: XChaCha20-Poly1305
      function: crypto_aead_xchacha20poly1305_ietf_encrypt
      nonce_size: 24_bytes
    decryption:
      function: crypto_aead_xchacha20poly1305_ietf_decrypt

  cloud_storage:
    provider: Google Drive
    access_method: Google Drive API
    storage_content: encrypted_vault_file_only

system_architecture:
  encryption_model: client_side_encryption

  client_browser:
    responsibilities:
      - 顯示 Next.js UI
      - 讓使用者輸入帳號
      - 讓使用者輸入 master password
      - 根據帳號名稱計算 vault 檔案名稱
      - 從 Google Drive 下載該使用者的加密 vault
      - 使用 libsodium 在瀏覽器端解密
      - 顯示密碼資料 grid
      - 編輯資料
      - 重新加密 vault
      - 上傳新的加密版本到 Google Drive

  vercel_server:
    responsibilities:
      - 提供靜態網頁與 Next.js app
      - 處理必要的 Google OAuth callback
      - 不處理明文密碼資料
      - 不處理 master password
      - 不處理 master key
      - 不長期保存任何 vault 檔案

  google_drive:
    responsibilities:
      - 保存每位使用者的 encrypted vault file
      - 不保存 master password
      - 不保存 master key
      - 不保存明文 JSON
      - 不保存明文 CSV

user_identity_design:
  login_fields:
    account_name:
      label: 使用者帳號
      type: string
      required: true
      purpose:
        - 用來產生 vault 檔案名稱
        - 用來識別不同使用者的 vault
      note: >
        account_name 不是加密密碼。
        account_name 可以視為 vault id 的一部分。

    master_password:
      label: 主密碼
      type: password
      required: true
      purpose:
        - 用來透過 Argon2id 產生 master key
        - 用來解密該帳號對應的 vault

  account_name_rules:
    normalize:
      - trim_spaces
      - convert_to_lowercase
      - remove_or_replace_unsafe_filename_chars
    allowed_characters:
      - a-z
      - 0-9
      - underscore
      - hyphen
      - dot
    min_length: 3
    max_length: 64

  vault_file_name_strategy:
    input: account_name
    recommended_file_name_format: "vault_{normalized_account_name}.vault"
    example:
      account_name: kuanchen
      file_name: vault_kuanchen.vault

  security_note: >
    帳號名稱只用來定位檔案。
    真正的安全性來自 master password + Argon2id + libsodium encryption。
    不可以把 account_name 當成加密 key。

google_drive_storage_design:
  root_folder:
    name: PasswordVaultApp
    create_if_not_exists: true

  file_location:
    folder: PasswordVaultApp
    file_name_pattern: "vault_{normalized_account_name}.vault"

  file_visibility:
    default: private
    sharing: disabled_by_default
    public_link: not_allowed

  file_content:
    type: encrypted_vault
    extension: ".vault"
    format: json
    contains:
      - vault_header
      - encrypted_payload

  delete_policy:
    allow_delete_vault_file: false
    ui_delete_button: disabled
    api_delete_action: not_implemented
    note: >
      系統功能上不提供刪除 vault 檔案。
      若使用者自行到 Google Drive 手動刪除，系統無法阻止，
      只能在下次開啟時提示找不到 vault。

  replace_policy:
    allow_direct_replace: false
    reason: >
      不允許直接刪除舊檔再上傳新檔取代。
      儲存時應使用版本新增或修訂更新策略，保留可追蹤性。

  update_policy:
    recommended_strategy: create_new_version_file
    version_file_name_pattern: "vault_{normalized_account_name}_{timestamp}.vault"
    latest_pointer_file:
      enabled: true
      file_name_pattern: "vault_{normalized_account_name}_latest.json"
      content:
        latest_vault_file_id: google_drive_file_id
        latest_version: integer
        updated_at: datetime
      note: >
        因為需求是不允許加密檔被刪除或被取代，
        建議每次存檔都建立新的 vault 版本檔，
        再用 latest pointer 指向最新版本。
        若連 pointer 也不想被取代，則可以改用版本清單檔，
        但實作會更複雜。

vault_file_format:
  extension: ".vault"
  encoding: utf-8
  format: json

  structure:
    version: 1

    header:
      app_name: web_password_vault_manager
      vault_version: 1

      owner:
        account_name_hash: string
        note: >
          不建議直接把明文帳號放入 vault header。
          可以使用 SHA-256(normalized_account_name) 作為識別。

      kdf:
        algorithm: Argon2id
        salt: base64_string
        opslimit: integer
        memlimit: integer
        key_length: 32

      encryption:
        algorithm: XChaCha20-Poly1305
        nonce: base64_string

      metadata:
        created_at: datetime
        updated_at: datetime
        version_number: integer

    payload:
      ciphertext: base64_string

  plaintext_before_encryption:
    format: json
    content:
      records:
        - id: uuid
          website_name: string
          account: string
          password: string
          description: string
          created_at: datetime
          updated_at: datetime

data_model:
  password_record:
    fields:
      id:
        type: uuid
        required: true
        generated_by: browser

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
        display_default: masked

      description:
        type: string
        required: false
        max_length: 1000

      row_status:
        type: enum
        ui_only: true
        values:
          - unchanged
          - new
          - modified
          - deleted

      created_at:
        type: datetime
        required: true

      updated_at:
        type: datetime
        required: true

ui_requirements:
  responsive_design:
    desktop: true
    mobile: true
    tablet: true

  pages:
    unlock_page:
      route: "/"
      purpose: 輸入帳號與主密碼，開啟或建立 vault
      components:
        - account_name_input
        - master_password_input
        - unlock_button
        - create_new_vault_button
        - google_drive_connect_button
        - error_message_area

    vault_page:
      route: "/vault"
      purpose: 顯示與編輯密碼資料
      components:
        - current_account_display
        - vault_file_display
        - search_box
        - password_grid
        - add_row_button
        - delete_row_button
        - save_button
        - lock_button
        - change_master_password_button
        - status_message_area

    settings_page:
      route: "/settings"
      purpose: 管理設定與 Google Drive 狀態
      components:
        - google_drive_connection_status
        - vault_storage_folder_display
        - auto_lock_timeout_setting
        - export_encrypted_backup_button
        - import_encrypted_backup_button

  password_grid:
    desktop_component: TanStack Table
    mobile_component: card_list_with_edit_dialog
    columns:
      - id: row_status
        title: 狀態
        readonly: true
        values:
          - ""
          - 新增
          - 修改
          - 刪除

      - id: website_name
        title: 網頁名稱
        editable: true
        required: true

      - id: account
        title: 帳號
        editable: true
        required: true

      - id: password
        title: 密碼
        editable: true
        required: true
        masked_by_default: true
        allow_show_hide: true
        allow_copy: true

      - id: description
        title: 說明
        editable: true
        required: false

functional_requirements:
  connect_google_drive:
    description: 連接使用者個人的 Google Drive
    steps:
      - user_clicks_google_drive_connect
      - start_google_oauth_flow
      - request_minimum_required_drive_scope
      - verify_google_drive_access
      - create_or_find_app_folder
      - store_oauth_state_in_browser_session
    security:
      - do_not_request_full_drive_access_if_not_needed
      - do_not_store_master_password
      - do_not_store_master_key

  open_existing_vault:
    description: 使用帳號名稱找到 Google Drive 上對應的加密 vault，並使用主密碼解密
    inputs:
      - account_name
      - master_password
    steps:
      - normalize_account_name
      - build_vault_file_name
      - search_google_drive_folder_for_matching_vault
      - if_latest_pointer_enabled_then_find_latest_version
      - download_encrypted_vault_file
      - parse_vault_header
      - read_salt_from_header
      - read_kdf_params_from_header
      - derive_master_key_with_argon2id
      - read_nonce_from_header
      - decrypt_ciphertext_with_xchacha20_poly1305
      - if_decrypt_success_then_load_records_to_grid
      - if_decrypt_failed_then_show_retry_message
    failure_policy:
      decrypt_failed:
        allowed_actions:
          - re_enter_account_name_and_master_password
          - create_new_vault
        not_allowed_actions:
          - bypass_decryption
          - reset_password_for_existing_vault
          - recover_plaintext_passwords
      file_not_found:
        allowed_actions:
          - create_new_vault
          - re_enter_account_name

  create_new_vault:
    description: 使用帳號名稱與主密碼建立新的加密 vault
    inputs:
      - account_name
      - master_password
      - confirm_master_password
    validation:
      - account_name_required
      - account_name_format_valid
      - master_password_required
      - master_password_equals_confirm
      - warn_if_master_password_too_weak
    steps:
      - normalize_account_name
      - build_vault_file_name
      - check_google_drive_if_vault_already_exists
      - if_vault_exists_then_confirm_create_new_version_or_abort
      - generate_random_salt
      - derive_master_key_with_argon2id
      - initialize_empty_records
      - generate_random_nonce
      - encrypt_empty_vault
      - upload_new_vault_file_to_google_drive
      - create_or_update_latest_pointer_if_enabled
      - load_empty_grid
    rules:
      - cannot_delete_existing_vault
      - cannot_replace_existing_vault_directly
      - new_vault_should_create_new_version_file_if_same_account_exists

  add_record:
    description: 新增一筆密碼資料
    steps:
      - user_clicks_add
      - create_new_record_with_uuid
      - set_row_status_new
      - append_to_grid
      - mark_unsaved_changes_true

  edit_record:
    description: 修改一筆密碼資料
    steps:
      - user_edits_cell
      - update_record_value
      - update_updated_at
      - if_row_status_is_unchanged_set_to_modified
      - mark_unsaved_changes_true

  delete_record:
    description: 刪除一筆密碼資料
    behavior:
      if_row_status_is_new:
        action: remove_from_grid
      if_row_status_is_unchanged_or_modified:
        action: mark_as_deleted
    note: >
      刪除 row 只是刪除 vault 內的密碼紀錄。
      不等於刪除 Google Drive 上的 vault 檔案。

  save_vault:
    description: 將目前 grid 資料重新加密並存到 Google Drive
    validation:
      - vault_is_unlocked
      - google_drive_connected
      - required_fields_not_empty
      - master_key_exists_in_memory
    steps:
      - collect_records_excluding_deleted_rows
      - remove_ui_only_fields
      - serialize_records_to_json
      - generate_new_nonce
      - encrypt_with_existing_master_key
      - build_new_vault_file
      - upload_as_new_version_file_to_google_drive
      - update_latest_pointer_if_enabled
      - mark_all_rows_unchanged
      - mark_unsaved_changes_false
    rules:
      - do_not_delete_old_vault_file
      - do_not_replace_old_vault_file_directly
      - every_save_creates_new_encrypted_vault_version
      - plaintext_never_sent_to_server

  change_master_password:
    description: 修改主密碼並建立新的加密 vault 版本
    steps:
      - verify_current_vault_is_unlocked
      - prompt_old_master_password
      - test_old_password_by_decrypting_current_vault
      - prompt_new_master_password
      - confirm_new_master_password
      - generate_new_salt
      - derive_new_master_key
      - serialize_current_records
      - generate_new_nonce
      - encrypt_with_new_master_key
      - upload_as_new_version_file
      - update_latest_pointer_if_enabled
      - clear_old_master_key_from_memory
      - keep_new_master_key_in_memory
    rules:
      - old_vault_file_not_deleted
      - old_vault_file_not_replaced
      - new_password_creates_new_encrypted_version

  lock_vault:
    description: 鎖定 vault 並清除敏感資料
    steps:
      - clear_master_key_from_memory
      - clear_plaintext_records_from_memory
      - clear_master_password_input
      - clear_clipboard_if_possible
      - redirect_to_unlock_page

security_requirements:
  client_side_only_crypto:
    enabled: true
    rule: >
      master password、master key、plaintext records 不可送到 Vercel server。
      所有加密與解密都必須在瀏覽器端執行。

  master_password:
    store_in_browser_storage: false
    store_in_server: false
    store_in_google_drive: false
    input_type: password

  master_key:
    store_in_browser_storage: false
    store_in_server: false
    store_in_google_drive: false
    memory_only: true
    clear_on_lock: true
    clear_on_logout: true
    clear_on_tab_close_best_effort: true

  plaintext_records:
    store_in_local_storage: false
    store_in_session_storage: false
    store_in_indexeddb: false
    store_in_server: false
    memory_only: true

  encrypted_vault:
    store_in_google_drive: true
    store_in_vercel: false

  logging:
    log_master_password: false
    log_master_key: false
    log_plaintext_records: false
    log_ciphertext_allowed: false

  clipboard:
    allow_copy_password: true
    clear_after_seconds: 30

  auto_lock:
    enabled: true
    default_timeout_minutes: 5
    lock_on_browser_idle: true
    lock_on_tab_hidden_optional: true

error_handling:
  wrong_account_or_password:
    message: 帳號或密碼錯誤，無法解密 vault。請重新輸入帳號與密碼。
    allowed_next_actions:
      - retry_unlock
      - create_new_vault

  vault_file_not_found:
    message: 找不到此帳號對應的 vault 檔案。請確認帳號名稱，或建立新的 vault。
    allowed_next_actions:
      - retry_account_name
      - create_new_vault

  corrupted_vault_file:
    message: vault 檔案格式錯誤或內容損毀，無法解密。
    allowed_next_actions:
      - retry_unlock
      - create_new_vault

  google_drive_access_failed:
    message: 無法連線 Google Drive，請重新登入 Google 帳號。

  save_failed:
    message: 儲存失敗，請確認 Google Drive 權限與網路連線。

  duplicate_vault_exists:
    message: 此帳號已有 vault 檔案，系統不會刪除或覆蓋既有檔案。可建立新的版本檔。

important_business_rules:
  - 帳號名稱是 vault 檔案定位用，不是加密 key
  - master password 才是產生 master key 的來源
  - vault 檔案只存加密內容
  - Google Drive 上的 vault 檔案不可由系統刪除
  - Google Drive 上的 vault 檔案不可由系統直接取代
  - 每次儲存應建立新的 encrypted vault version
  - 解密失敗不可重設舊 vault 密碼
  - 解密失敗不可繞過檢查
  - 解密失敗只能重新輸入帳號密碼或建立新 vault
  - 明文密碼資料不可傳到 server
  - Vercel 只負責部署與服務網頁，不作為密碼資料儲存空間

recommended_versioning_strategy:
  reason: >
    因為需求要求加密檔案不允許被刪除或被取代，
    所以不建議每次 save 都覆蓋同一個 .vault。
    建議採用 append-only version file 策略。

  file_examples:
    first_version: "vault_kuanchen_20260616_100000.vault"
    second_version: "vault_kuanchen_20260616_103000.vault"
    latest_pointer: "vault_kuanchen_latest.json"

  latest_pointer_content:
    account_name_hash: sha256_normalized_account_name
    latest_file_id: google_drive_file_id
    latest_version: 2
    updated_at: "2026-06-16T10:30:00+08:00"

  tradeoff:
    advantage:
      - 舊版本不會被刪除
      - 舊版本不會被覆蓋
      - 可以保留歷史紀錄
      - 符合不可刪除與不可取代需求

    disadvantage:
      - Google Drive 會累積多個版本檔
      - 需要 latest pointer 或版本清單
      - 需要處理多裝置同時儲存造成的版本衝突

future_versions:
  v2:
    features:
      - Google Drive appDataFolder
      - 更完整版本清單
      - 多裝置同步衝突偵測
      - PWA 離線模式
      - 匯入 KeePass CSV
      - 密碼產生器
      - 密碼強度檢查

  v3:
    features:
      - browser extension
      - TOTP 管理
      - team vault
      - emergency recovery
      - audit history