// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
//! AGE encryption helpers backed by the Rust `age` crate.

use age::{Decryptor, Encryptor, Recipient, x25519};
use anyhow::{Context, anyhow};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

/// Parses AGE X25519 public recipient keys.
pub fn parse_recipients(keys: &[String]) -> anyhow::Result<Vec<x25519::Recipient>> {
    if keys.is_empty() {
        return Err(anyhow!("no AGE public recipient keys were provided"));
    }

    keys.iter()
        .map(|key| {
            key.parse::<x25519::Recipient>()
                .map_err(|err| anyhow!("invalid AGE public key {key:?}: {err}"))
        })
        .collect()
}

/// Encrypts bytes for all recipients and returns binary AGE ciphertext.
///
/// # Examples
///
/// ```
/// let identity = age::x25519::Identity::generate();
/// let recipient = identity.to_public();
/// let encrypted = rencrypt::age_crypto::encrypt_bytes(b"hello", &[recipient]).unwrap();
/// assert!(encrypted.starts_with(b"age-encryption.org/v1"));
/// ```
pub fn encrypt_bytes(
    plaintext: &[u8],
    recipients: &[x25519::Recipient],
) -> anyhow::Result<Vec<u8>> {
    if recipients.is_empty() {
        return Err(anyhow!("at least one AGE recipient is required"));
    }

    let recipient_refs: Vec<&dyn Recipient> = recipients
        .iter()
        .map(|recipient| recipient as &dyn Recipient)
        .collect();
    let encryptor = Encryptor::with_recipients(recipient_refs.into_iter())
        .context("cannot create AGE encryptor")?;
    let mut encrypted = Vec::new();
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .context("cannot write AGE header")?;
    writer
        .write_all(plaintext)
        .context("cannot write encrypted payload")?;
    writer.finish().context("cannot finish AGE encryption")?;
    Ok(encrypted)
}

/// Encrypts one file into another path using binary AGE format.
pub fn encrypt_file(
    source: &Path,
    destination: &Path,
    recipients: &[x25519::Recipient],
) -> anyhow::Result<()> {
    let mut plaintext = Vec::new();
    fs::File::open(source)
        .with_context(|| format!("cannot open {}", source.display()))?
        .read_to_end(&mut plaintext)
        .with_context(|| format!("cannot read {}", source.display()))?;

    let ciphertext = encrypt_bytes(&plaintext, recipients)
        .with_context(|| format!("cannot encrypt {}", source.display()))?;

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("cannot create {}", parent.display()))?;
    }
    fs::write(destination, ciphertext)
        .with_context(|| format!("cannot write {}", destination.display()))
}

/// Decrypts binary AGE ciphertext with the first matching identity.
///
/// # Examples
///
/// ```
/// let identity = age::x25519::Identity::generate();
/// let recipient = identity.to_public();
/// let encrypted = rencrypt::age_crypto::encrypt_bytes(b"hello", &[recipient]).unwrap();
/// let decrypted = rencrypt::age_crypto::decrypt_bytes(&encrypted, &[identity]).unwrap();
/// assert_eq!(decrypted, b"hello");
/// ```
pub fn decrypt_bytes(
    ciphertext: &[u8],
    identities: &[x25519::Identity],
) -> anyhow::Result<Vec<u8>> {
    if identities.is_empty() {
        return Err(anyhow!("at least one AGE identity is required"));
    }

    let identity_refs: Vec<&dyn age::Identity> = identities
        .iter()
        .map(|identity| identity as &dyn age::Identity)
        .collect();
    let decryptor =
        Decryptor::new_buffered(ciphertext).context("cannot parse AGE encrypted payload")?;
    let mut reader = decryptor
        .decrypt(identity_refs.into_iter())
        .context("cannot decrypt AGE payload with provided identities")?;
    let mut plaintext = Vec::new();
    reader
        .read_to_end(&mut plaintext)
        .context("cannot read decrypted AGE payload")?;
    Ok(plaintext)
}

/// Decrypts one AGE file into another path.
pub fn decrypt_file(
    source: &Path,
    destination: &Path,
    identities: &[x25519::Identity],
) -> anyhow::Result<()> {
    let ciphertext =
        fs::read(source).with_context(|| format!("cannot read {}", source.display()))?;
    let plaintext = decrypt_bytes(&ciphertext, identities)
        .with_context(|| format!("cannot decrypt {}", source.display()))?;

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("cannot create {}", parent.display()))?;
    }
    fs::write(destination, plaintext)
        .with_context(|| format!("cannot write {}", destination.display()))
}

#[cfg(test)]
mod tests {
    use super::{decrypt_bytes, encrypt_bytes, parse_recipients};
    use age::{Decryptor, secrecy::ExposeSecret, x25519};
    use std::io::Read;

    #[test]
    fn encrypts_for_generated_identity() {
        let identity = x25519::Identity::generate();
        let recipient = identity.to_public();
        let encrypted = encrypt_bytes(b"secret", &[recipient]).unwrap();

        let decryptor = Decryptor::new_buffered(encrypted.as_slice()).unwrap();
        let mut reader = decryptor
            .decrypt(std::iter::once(&identity as &dyn age::Identity))
            .unwrap();
        let mut decrypted = Vec::new();
        reader.read_to_end(&mut decrypted).unwrap();

        assert_eq!(decrypted, b"secret");
    }

    #[test]
    fn decrypts_with_generated_identity() {
        let identity = x25519::Identity::generate();
        let recipient = identity.to_public();
        let encrypted = encrypt_bytes(b"secret", &[recipient]).unwrap();

        let decrypted = decrypt_bytes(&encrypted, &[identity]).unwrap();

        assert_eq!(decrypted, b"secret");
    }

    #[test]
    fn parses_public_keys() {
        let identity = x25519::Identity::generate();
        let public = identity.to_public().to_string();

        let parsed = parse_recipients(&[public]).unwrap();

        assert_eq!(parsed.len(), 1);
        assert!(
            identity
                .to_string()
                .expose_secret()
                .starts_with("AGE-SECRET-KEY-")
        );
    }
}
