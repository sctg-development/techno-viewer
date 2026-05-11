// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
//! AGE key generation and loading.

use age::{secrecy::ExposeSecret, x25519};
use anyhow::{Context, anyhow};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// Location of generated private and public key files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyDirectories {
    /// Directory that stores `userNNN.key` secret AGE identities.
    pub private: PathBuf,
    /// Directory that stores `userNNN.pub` public AGE recipients.
    pub public: PathBuf,
}

impl KeyDirectories {
    /// Builds key directories from a shared root.
    ///
    /// # Examples
    ///
    /// ```
    /// let dirs = rencrypt::keys::KeyDirectories::from_root("keys");
    /// assert!(dirs.private.ends_with("private"));
    /// assert!(dirs.public.ends_with("public"));
    /// ```
    pub fn from_root(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        Self {
            private: root.join("private"),
            public: root.join("public"),
        }
    }
}

/// One generated AGE key pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedKey {
    /// Stable user name used in file names.
    pub user: String,
    /// Secret AGE identity.
    pub private_key: String,
    /// Public AGE recipient.
    pub public_key: String,
}

/// Generates AGE X25519 key pairs in memory.
///
/// # Examples
///
/// ```
/// let keys = rencrypt::keys::generate_key_pairs(2);
/// assert_eq!(keys.len(), 2);
/// assert_eq!(keys[0].user, "user001");
/// assert!(keys[0].public_key.starts_with("age1"));
/// ```
pub fn generate_key_pairs(count: usize) -> Vec<GeneratedKey> {
    let width = count.max(1).to_string().len().max(3);
    (1..=count)
        .map(|index| {
            let identity = x25519::Identity::generate();
            GeneratedKey {
                user: format!("user{index:0width$}"),
                private_key: identity.to_string().expose_secret().to_owned(),
                public_key: identity.to_public().to_string(),
            }
        })
        .collect()
}

/// Writes generated keys as AGE-compatible `*.key` and `*.pub` files.
pub fn write_key_pairs(dirs: &KeyDirectories, count: usize) -> anyhow::Result<Vec<GeneratedKey>> {
    if count == 0 {
        return Err(anyhow!("key count must be greater than zero"));
    }

    fs::create_dir_all(&dirs.private)
        .with_context(|| format!("cannot create {}", dirs.private.display()))?;
    fs::create_dir_all(&dirs.public)
        .with_context(|| format!("cannot create {}", dirs.public.display()))?;

    let pairs = generate_key_pairs(count);
    for pair in &pairs {
        fs::write(
            dirs.private.join(format!("{}.key", pair.user)),
            format!("# public key: {}\n{}\n", pair.public_key, pair.private_key),
        )
        .with_context(|| format!("cannot write private key for {}", pair.user))?;
        fs::write(
            dirs.public.join(format!("{}.pub", pair.user)),
            format!("{}\n", pair.public_key),
        )
        .with_context(|| format!("cannot write public key for {}", pair.user))?;
    }

    Ok(pairs)
}

/// Loads public AGE recipient keys from all `*.pub` files in a directory.
pub fn load_public_keys(public_dir: &Path) -> anyhow::Result<Vec<String>> {
    let mut files = fs::read_dir(public_dir)
        .with_context(|| format!("cannot read {}", public_dir.display()))?
        .collect::<Result<Vec<_>, _>>()
        .with_context(|| format!("cannot list {}", public_dir.display()))?;
    files.sort_by_key(|entry| entry.path());

    let keys = files
        .into_iter()
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "pub")
        })
        .map(|entry| {
            fs::read_to_string(entry.path())
                .map(|content| content.trim().to_owned())
                .with_context(|| format!("cannot read {}", entry.path().display()))
        })
        .filter_map(|result| match result {
            Ok(key) if key.is_empty() => None,
            other => Some(other),
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    if keys.is_empty() {
        return Err(anyhow!(
            "no public AGE keys found in {}",
            public_dir.display()
        ));
    }
    Ok(keys)
}

/// Loads private AGE identities from all `*.key` files in a directory.
pub fn load_private_identities(private_dir: &Path) -> anyhow::Result<Vec<x25519::Identity>> {
    let mut files = fs::read_dir(private_dir)
        .with_context(|| format!("cannot read {}", private_dir.display()))?
        .collect::<Result<Vec<_>, _>>()
        .with_context(|| format!("cannot list {}", private_dir.display()))?;
    files.sort_by_key(|entry| entry.path());

    let identities = files
        .into_iter()
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "key")
        })
        .map(|entry| {
            let content = fs::read_to_string(entry.path())
                .with_context(|| format!("cannot read {}", entry.path().display()))?;
            parse_private_identity(&content)
                .with_context(|| format!("cannot parse {}", entry.path().display()))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    if identities.is_empty() {
        return Err(anyhow!(
            "no private AGE keys found in {}",
            private_dir.display()
        ));
    }
    Ok(identities)
}

fn parse_private_identity(content: &str) -> anyhow::Result<x25519::Identity> {
    let key = content
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("AGE-SECRET-KEY-"))
        .ok_or_else(|| anyhow!("missing AGE-SECRET-KEY entry"))?;

    key.parse::<x25519::Identity>()
        .map_err(|err| anyhow!("invalid AGE private key: {err}"))
}

#[cfg(test)]
mod tests {
    use super::{
        KeyDirectories, generate_key_pairs, load_private_identities, load_public_keys,
        write_key_pairs,
    };

    #[test]
    fn generated_names_keep_three_digits_for_small_sets() {
        let keys = generate_key_pairs(2);

        assert_eq!(keys[0].user, "user001");
        assert_eq!(keys[1].user, "user002");
    }

    #[test]
    fn writes_and_loads_public_keys() {
        let temp = tempfile::tempdir().unwrap();
        let dirs = KeyDirectories::from_root(temp.path().join("keys"));

        write_key_pairs(&dirs, 3).unwrap();
        let keys = load_public_keys(&dirs.public).unwrap();

        assert_eq!(keys.len(), 3);
        assert!(keys.iter().all(|key| key.starts_with("age1")));
    }

    #[test]
    fn writes_and_loads_private_identities() {
        let temp = tempfile::tempdir().unwrap();
        let dirs = KeyDirectories::from_root(temp.path().join("keys"));

        write_key_pairs(&dirs, 2).unwrap();
        let identities = load_private_identities(&dirs.private).unwrap();

        assert_eq!(identities.len(), 2);
    }
}
