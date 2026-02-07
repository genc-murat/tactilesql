// =====================================================
// CRYPTO MODULE
// Key management and password encryption/decryption
// =====================================================

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::Entry;
use rand::Rng;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// Encryption constants
const SERVICE_NAME: &str = "tactilesql";
const USER_NAME: &str = "encryption_key";
// LEGACY KEY for migration - DO NOT USE FOR NEW ENCRYPTION
const LEGACY_KEY: &[u8; 32] = b"TactileSQL_SecretKey_32bytes!ok!";

pub fn get_key_entry() -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, USER_NAME).map_err(|e| e.to_string())
}

pub fn get_key_file_path(app_handle: &AppHandle) -> PathBuf {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    if !app_data_dir.exists() {
        let _ = fs::create_dir_all(&app_data_dir);
    }

    app_data_dir.join("encryption.key")
}

pub fn initialize_key(
    app_handle: &AppHandle,
    get_connections_file_path: impl Fn(&AppHandle) -> PathBuf,
) -> Result<Vec<u8>, String> {
    use crate::db_types::ConnectionConfig;

    let entry = get_key_entry()?;
    let key_file_path = get_key_file_path(app_handle);

    // Helper to save key to both locations
    let save_key = |key_b64: &str| -> Result<(), String> {
        // 1. Save to file (Primary fallback)
        fs::write(&key_file_path, key_b64)
            .map_err(|e| format!("Failed to save key to file: {}", e))?;

        // 2. Try to save to keychain (Best effort)
        if let Err(e) = entry.set_password(key_b64) {
            println!("Warning: Failed to sync key to keychain: {}", e);
        }

        Ok(())
    };

    // 1. Try to load from Keychain
    let key_from_keychain = entry.get_password().ok();

    // 2. Try to load from File
    let key_from_file = if key_file_path.exists() {
        fs::read_to_string(&key_file_path).ok()
    } else {
        None
    };

    match (key_from_keychain, key_from_file) {
        (Some(k), _) => {
            // Found in keychain. Sync to file just in case.
            if !key_file_path.exists() {
                let _ = fs::write(&key_file_path, &k);
            }
            BASE64
                .decode(&k)
                .map_err(|e| format!("Failed to decode key from keychain: {}", e))
        }
        (None, Some(k)) => {
            // Found in file but not keychain. Restore to keychain.
            println!("Key found in file but not keychain. Restoring to keychain.");
            let _ = entry.set_password(&k);
            BASE64
                .decode(&k)
                .map_err(|e| format!("Failed to decode key from file: {}", e))
        }
        (None, None) => {
            // Not found anywhere.
            let connections_file = get_connections_file_path(app_handle);

            if connections_file.exists() {
                println!("Migrating legacy connections or recovering from lost key...");
                // MIGRATION / RECOVERY SCENARIO
                let new_key = generate_new_key();

                // Read existing file
                let content = fs::read_to_string(&connections_file)
                    .map_err(|e| format!("Failed to read connections file: {}", e))?;

                let mut connections: Vec<ConnectionConfig> = serde_json::from_str(&content)
                    .map_err(|e| format!("Failed to parse JSON: {}", e))?;

                // Re-encrypt passwords
                for conn in &mut connections {
                    if let Some(ref encrypted_pwd) = conn.password {
                        match decrypt_password_with_key(encrypted_pwd, LEGACY_KEY) {
                            Ok(plaintext) => {
                                match encrypt_password_with_key(&plaintext, &new_key) {
                                    Ok(new_encrypted) => conn.password = Some(new_encrypted),
                                    Err(e) => println!("Failed to re-encrypt password: {}", e),
                                }
                            }
                            Err(e) => println!(
                                "Failed to decrypt legacy password (key lost or already migrated): {}",
                                e
                            ),
                        }
                    }
                }

                // Save new connections file
                let json = serde_json::to_string_pretty(&connections)
                    .map_err(|e| format!("Failed to serialize: {}", e))?;
                fs::write(connections_file, json)
                    .map_err(|e| format!("Failed to write migrated file: {}", e))?;

                // Save NEW key to both locations
                let key_base64 = BASE64.encode(&new_key);
                save_key(&key_base64)?;

                Ok(new_key)
            } else {
                // FRESH INSTALL SCENARIO
                let new_key = generate_new_key();
                let key_base64 = BASE64.encode(&new_key);
                save_key(&key_base64)?;
                Ok(new_key)
            }
        }
    }
}

pub fn generate_new_key() -> Vec<u8> {
    let mut key = vec![0u8; 32];
    rand::thread_rng().fill(&mut key[..]);
    key
}

pub fn encrypt_password_with_key(password: &str, key: &[u8]) -> Result<String, String> {
    if password.is_empty() {
        return Ok(String::new());
    }

    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;

    let mut rng = rand::thread_rng();
    let nonce_bytes: [u8; 12] = rng.gen();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, password.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);

    Ok(BASE64.encode(combined))
}

pub fn decrypt_password_with_key(encrypted: &str, key: &[u8]) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }

    let combined = BASE64
        .decode(encrypted)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    if combined.len() < 12 {
        return Err("Invalid encrypted data".to_string());
    }

    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;

    let nonce = Nonce::from_slice(&combined[..12]);
    let ciphertext = &combined[12..];

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 conversion failed: {}", e))
}
