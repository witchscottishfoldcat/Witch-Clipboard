use std::{
    fs,
    path::{Path, PathBuf},
};

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;

const MAGIC_KEYFILE: &[u8; 4] = b"ZTBK";
const MAGIC_BLOB: &[u8; 4] = b"ZTB1";
const MAGIC_LOCAL_SECRET: &[u8; 4] = b"ZTS1";
const MAGIC_SYNC: &[u8; 4] = b"WCS1";
const SAFE_STORAGE_PREFIX: &[u8; 3] = b"v10";
const DPAPI_PREFIX: &[u8; 5] = b"DPAPI";
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("base64 error: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("invalid key file: {0}")]
    InvalidKey(&'static str),
    #[error("AES-GCM authentication failed")]
    Aes,
    #[error("Windows DPAPI failed")]
    Dpapi,
    #[cfg(not(windows))]
    #[error("OS-protected key storage is only available on Windows")]
    Unsupported,
}

#[derive(Clone)]
pub struct KeyMaterial {
    master: [u8; 32],
    os_protected: bool,
}

impl KeyMaterial {
    pub fn load_or_create(data_dir: &Path) -> Result<Self, CryptoError> {
        let key_path = data_dir.join("master.key");
        if key_path.exists() {
            return Self::load_existing(data_dir);
        }

        fs::create_dir_all(data_dir)?;
        let mut master = [0u8; 32];
        rand::rng().fill_bytes(&mut master);

        #[cfg(windows)]
        {
            let os_crypt_key = load_or_create_os_crypt_key(data_dir)?;
            let encoded = BASE64.encode(master);
            let sealed = encrypt_safe_storage(&os_crypt_key, encoded.as_bytes())?;
            let mut key_file = Vec::with_capacity(MAGIC_KEYFILE.len() + sealed.len());
            key_file.extend_from_slice(MAGIC_KEYFILE);
            key_file.extend_from_slice(&sealed);
            fs::write(key_path, key_file)?;
            return Ok(Self {
                master,
                os_protected: true,
            });
        }

        #[cfg(not(windows))]
        {
            fs::write(key_path, BASE64.encode(master))?;
            Ok(Self {
                master,
                os_protected: false,
            })
        }
    }

    pub fn load_existing(data_dir: &Path) -> Result<Self, CryptoError> {
        let raw = fs::read(data_dir.join("master.key"))?;
        let (decoded, os_protected) = if raw.starts_with(MAGIC_KEYFILE) {
            #[cfg(windows)]
            {
                let os_crypt_key = load_os_crypt_key(data_dir)?;
                (
                    decrypt_safe_storage(&os_crypt_key, &raw[MAGIC_KEYFILE.len()..])?,
                    true,
                )
            }
            #[cfg(not(windows))]
            return Err(CryptoError::Unsupported);
        } else {
            (raw, false)
        };

        let encoded = std::str::from_utf8(&decoded)
            .map_err(|_| CryptoError::InvalidKey("master key is not UTF-8 base64"))?
            .trim();
        let bytes = BASE64.decode(encoded)?;
        let master: [u8; 32] = bytes
            .try_into()
            .map_err(|_| CryptoError::InvalidKey("master key is not 32 bytes"))?;
        Ok(Self {
            master,
            os_protected,
        })
    }

    pub fn is_os_protected(&self) -> bool {
        self.os_protected
    }

    pub fn database_key_hex(&self) -> String {
        hex_lower(&self.subkey(b"sqlcipher"))
    }

    pub fn seal_blob(&self, plain: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let key = self.subkey(b"blob");
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| CryptoError::Aes)?;
        let mut nonce = [0u8; NONCE_LEN];
        rand::rng().fill_bytes(&mut nonce);
        let nonce_ref = Nonce::try_from(nonce.as_slice()).map_err(|_| CryptoError::Aes)?;
        let encrypted = cipher
            .encrypt(&nonce_ref, plain)
            .map_err(|_| CryptoError::Aes)?;
        let split = encrypted.len() - TAG_LEN;
        let mut output = Vec::with_capacity(4 + NONCE_LEN + encrypted.len());
        output.extend_from_slice(MAGIC_BLOB);
        output.extend_from_slice(&nonce);
        output.extend_from_slice(&encrypted[split..]);
        output.extend_from_slice(&encrypted[..split]);
        Ok(output)
    }

    pub fn open_blob(&self, sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if sealed.len() < 4 + NONCE_LEN + TAG_LEN || !sealed.starts_with(MAGIC_BLOB) {
            return Err(CryptoError::InvalidKey("blob header mismatch"));
        }
        let nonce = &sealed[4..4 + NONCE_LEN];
        let tag = &sealed[4 + NONCE_LEN..4 + NONCE_LEN + TAG_LEN];
        let body = &sealed[4 + NONCE_LEN + TAG_LEN..];
        let mut combined = Vec::with_capacity(body.len() + TAG_LEN);
        combined.extend_from_slice(body);
        combined.extend_from_slice(tag);
        let key = self.subkey(b"blob");
        let nonce_ref = Nonce::try_from(nonce).map_err(|_| CryptoError::Aes)?;
        Aes256Gcm::new_from_slice(&key)
            .map_err(|_| CryptoError::Aes)?
            .decrypt(&nonce_ref, combined.as_ref())
            .map_err(|_| CryptoError::Aes)
    }

    pub fn seal_local_secret(&self, plain: &[u8]) -> Result<Vec<u8>, CryptoError> {
        seal_with_key(
            MAGIC_LOCAL_SECRET,
            &self.subkey(b"local-secret"),
            plain,
            b"local-secret",
        )
    }

    pub fn open_local_secret(&self, sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
        open_with_key(
            MAGIC_LOCAL_SECRET,
            &self.subkey(b"local-secret"),
            sealed,
            b"local-secret",
        )
    }

    fn subkey(&self, purpose: &[u8]) -> [u8; 32] {
        Sha256::new()
            .chain_update(self.master)
            .chain_update(purpose)
            .finalize()
            .into()
    }
}

pub fn generate_sync_key() -> String {
    let mut key = [0u8; 32];
    rand::rng().fill_bytes(&mut key);
    BASE64.encode(key)
}

pub fn decode_sync_key(encoded: &str) -> Result<[u8; 32], CryptoError> {
    let decoded = BASE64.decode(encoded.trim())?;
    decoded
        .try_into()
        .map_err(|_| CryptoError::InvalidKey("sync key is not 32 bytes"))
}

pub fn seal_sync(encoded_key: &str, plain: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let key = decode_sync_key(encoded_key)?;
    seal_with_key(MAGIC_SYNC, &key, plain, b"witch-clipboard-webdav-v1")
}

pub fn open_sync(encoded_key: &str, sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let key = decode_sync_key(encoded_key)?;
    open_with_key(MAGIC_SYNC, &key, sealed, b"witch-clipboard-webdav-v1")
}

fn seal_with_key(
    magic: &[u8; 4],
    key: &[u8; 32],
    plain: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::Aes)?;
    let mut nonce = [0u8; NONCE_LEN];
    rand::rng().fill_bytes(&mut nonce);
    let nonce_ref = Nonce::try_from(nonce.as_slice()).map_err(|_| CryptoError::Aes)?;
    let encrypted = cipher
        .encrypt(&nonce_ref, Payload { msg: plain, aad })
        .map_err(|_| CryptoError::Aes)?;
    let mut output = Vec::with_capacity(magic.len() + NONCE_LEN + encrypted.len());
    output.extend_from_slice(magic);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&encrypted);
    Ok(output)
}

fn open_with_key(
    magic: &[u8; 4],
    key: &[u8; 32],
    sealed: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if sealed.len() < magic.len() + NONCE_LEN + TAG_LEN || !sealed.starts_with(magic) {
        return Err(CryptoError::InvalidKey("encrypted payload header mismatch"));
    }
    let nonce_ref = Nonce::try_from(&sealed[magic.len()..magic.len() + NONCE_LEN])
        .map_err(|_| CryptoError::Aes)?;
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| CryptoError::Aes)?
        .decrypt(
            &nonce_ref,
            Payload {
                msg: &sealed[magic.len() + NONCE_LEN..],
                aad,
            },
        )
        .map_err(|_| CryptoError::Aes)
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(windows)]
fn load_os_crypt_key(data_dir: &Path) -> Result<[u8; 32], CryptoError> {
    let value: Value = serde_json::from_slice(&fs::read(data_dir.join("Local State"))?)?;
    let encoded = value
        .pointer("/os_crypt/encrypted_key")
        .and_then(Value::as_str)
        .ok_or(CryptoError::InvalidKey(
            "Local State has no os_crypt.encrypted_key",
        ))?;
    let wrapped = BASE64.decode(encoded)?;
    if !wrapped.starts_with(DPAPI_PREFIX) {
        return Err(CryptoError::InvalidKey("os_crypt key has no DPAPI prefix"));
    }
    let plain = dpapi_unprotect(&wrapped[DPAPI_PREFIX.len()..])?;
    plain
        .try_into()
        .map_err(|_| CryptoError::InvalidKey("os_crypt key is not 32 bytes"))
}

#[cfg(windows)]
fn load_or_create_os_crypt_key(data_dir: &Path) -> Result<[u8; 32], CryptoError> {
    let path = data_dir.join("Local State");
    if path.exists() {
        return load_os_crypt_key(data_dir);
    }
    let mut key = [0u8; 32];
    rand::rng().fill_bytes(&mut key);
    let mut wrapped = DPAPI_PREFIX.to_vec();
    wrapped.extend_from_slice(&dpapi_protect(&key)?);
    let value = json!({ "os_crypt": { "encrypted_key": BASE64.encode(wrapped) } });
    fs::write(path, serde_json::to_vec(&value)?)?;
    Ok(key)
}

#[cfg(windows)]
fn encrypt_safe_storage(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let mut nonce = [0u8; NONCE_LEN];
    rand::rng().fill_bytes(&mut nonce);
    let nonce_ref = Nonce::try_from(nonce.as_slice()).map_err(|_| CryptoError::Aes)?;
    let encrypted = Aes256Gcm::new_from_slice(key)
        .map_err(|_| CryptoError::Aes)?
        .encrypt(&nonce_ref, plain)
        .map_err(|_| CryptoError::Aes)?;
    let mut output = Vec::with_capacity(3 + NONCE_LEN + encrypted.len());
    output.extend_from_slice(SAFE_STORAGE_PREFIX);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&encrypted);
    Ok(output)
}

#[cfg(windows)]
fn decrypt_safe_storage(key: &[u8; 32], sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if sealed.len() < 3 + NONCE_LEN + TAG_LEN || !sealed.starts_with(SAFE_STORAGE_PREFIX) {
        return Err(CryptoError::InvalidKey(
            "safeStorage payload has no v10 prefix",
        ));
    }
    let nonce_ref = Nonce::try_from(&sealed[SAFE_STORAGE_PREFIX.len()..3 + NONCE_LEN])
        .map_err(|_| CryptoError::Aes)?;
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| CryptoError::Aes)?
        .decrypt(&nonce_ref, &sealed[3 + NONCE_LEN..])
        .map_err(|_| CryptoError::Aes)
}

#[cfg(windows)]
fn dpapi_unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let mut input = ciphertext.to_vec();
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_mut_ptr(),
    };
    let mut output_blob = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptUnprotectData(
            &input_blob,
            null_mut(),
            null(),
            null(),
            null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output_blob,
        ) != 0
    };
    if !ok || output_blob.pbData.is_null() {
        return Err(CryptoError::Dpapi);
    }
    let output = unsafe {
        std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
    };
    unsafe { LocalFree(output_blob.pbData as _) };
    Ok(output)
}

#[cfg(windows)]
fn dpapi_protect(plain: &[u8]) -> Result<Vec<u8>, CryptoError> {
    use std::ptr::null;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };
    let mut input = plain.to_vec();
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_mut_ptr(),
    };
    let mut output_blob = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptProtectData(
            &input_blob,
            null(),
            null(),
            null(),
            null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output_blob,
        ) != 0
    };
    if !ok || output_blob.pbData.is_null() {
        return Err(CryptoError::Dpapi);
    }
    let output = unsafe {
        std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
    };
    unsafe { LocalFree(output_blob.pbData as _) };
    Ok(output)
}

pub fn canonical_data_dir() -> PathBuf {
    std::env::var_os("WCC_TAURI_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::data_dir().map(|dir| dir.join("WitchCat-Clipboard")))
        .unwrap_or_else(|| PathBuf::from("WitchCat-Clipboard"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> KeyMaterial {
        KeyMaterial {
            master: [7; 32],
            os_protected: true,
        }
    }

    #[test]
    fn blob_round_trip_matches_ztb_layout() {
        let keys = fixture();
        let plain = b"\x89PNG\r\nfixture";
        let sealed = keys.seal_blob(plain).unwrap();
        assert!(sealed.starts_with(b"ZTB1"));
        assert_eq!(keys.open_blob(&sealed).unwrap(), plain);
    }

    #[test]
    fn database_subkey_is_stable() {
        assert_eq!(
            fixture().database_key_hex(),
            "dbba006d83a9729bfa69a81664e4961decd72c7a96cf925121c33578afa250d3"
        );
    }

    #[test]
    fn local_secret_and_sync_payload_use_distinct_authenticated_formats() {
        let keys = fixture();
        let local = keys.seal_local_secret(b"password").unwrap();
        assert!(local.starts_with(MAGIC_LOCAL_SECRET));
        assert_eq!(keys.open_local_secret(&local).unwrap(), b"password");

        let sync_key = generate_sync_key();
        let remote = seal_sync(&sync_key, b"history").unwrap();
        assert!(remote.starts_with(MAGIC_SYNC));
        assert_eq!(open_sync(&sync_key, &remote).unwrap(), b"history");
        assert!(fixture().open_local_secret(&remote).is_err());
    }

    #[test]
    fn reads_real_electron_safe_storage_fixture_when_requested() {
        let Some(path) = std::env::var_os("WCC_COMPAT_DATA_DIR") else {
            return;
        };
        let keys = KeyMaterial::load_existing(Path::new(&path)).unwrap();
        assert!(keys.is_os_protected());
        assert_eq!(keys.database_key_hex().len(), 64);
    }
}
