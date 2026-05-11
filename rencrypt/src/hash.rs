// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
//! Hashing helpers used to hide encrypted file names.

use anyhow::Context;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{self, Read},
    path::Path,
};

/// Returns the lowercase SHA-256 hex digest of a reader.
///
/// # Examples
///
/// ```
/// let digest = rencrypt::hash::sha256_reader("abc".as_bytes()).unwrap();
/// assert_eq!(
///     digest,
///     "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
/// );
/// ```
pub fn sha256_reader(mut reader: impl Read) -> io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 65_536];

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hex::encode(hasher.finalize()).to_lowercase())
}

/// Returns the lowercase SHA-256 hex digest of a file.
pub fn sha256_file(path: &Path) -> anyhow::Result<String> {
    let file = File::open(path).with_context(|| format!("cannot open {}", path.display()))?;
    sha256_reader(file).with_context(|| format!("cannot hash {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::sha256_reader;

    #[test]
    fn hashes_reader_content() {
        let digest = sha256_reader("novasulf".as_bytes()).unwrap();

        assert_eq!(
            digest,
            "04581deb5ac833c3a0e99057c38850bd130b1b6f1a55a3083a7bd56c000a2fff"
        );
    }
}
