use super::*;

#[test]
fn test_encryption_decryption() {
    let key = generate_new_key();
    let password = "my_secret_password";
    
    let encrypted = encrypt_password_with_key(password, &key).unwrap();
    assert_ne!(password, encrypted);
    
    let decrypted = decrypt_password_with_key(&encrypted, &key).unwrap();
    assert_eq!(password, decrypted);
}

#[test]
fn test_encryption_empty() {
    let key = generate_new_key();
    assert_eq!(encrypt_password_with_key("", &key).unwrap(), "");
    assert_eq!(decrypt_password_with_key("", &key).unwrap(), "");
}

#[test]
fn test_decryption_invalid() {
    let key = generate_new_key();
    let invalid = BASE64.encode(vec![1, 2, 3]); // too short
    assert!(decrypt_password_with_key(&invalid, &key).is_err());
}

#[test]
fn test_legacy_key_decryption() {
    let password = "legacy_password";
    let encrypted = encrypt_password_with_key(password, LEGACY_KEY).unwrap();
    let decrypted = decrypt_password_with_key(&encrypted, LEGACY_KEY).unwrap();
    assert_eq!(password, decrypted);
}
