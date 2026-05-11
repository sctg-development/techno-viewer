// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
//! Manifest generation and encryption workflow.

use crate::{
    age_crypto::{decrypt_bytes, decrypt_file, encrypt_bytes, encrypt_file, parse_recipients},
    code_index::{EncryptedIndexChunk, build_code_index, chunk_code_index},
    file_tree::{ManifestNode, build_manifest_tree, discover_source_files},
    hash::sha256_reader,
    keys,
    output::MessageLevel,
};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

/// JSON manifest written before it is encrypted with AGE.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    /// Manifest schema version.
    pub version: u8,
    /// UTC generation timestamp in RFC3339 format.
    pub generated: String,
    /// File tree preserving original names and hierarchy.
    pub tree: Vec<ManifestNode>,
    /// Mapping from virtual source index names to opaque encrypted paths.
    #[serde(
        rename = "codeIndexes",
        skip_serializing_if = "BTreeMap::is_empty",
        default
    )]
    pub code_indexes: BTreeMap<String, String>,
}

impl Manifest {
    /// Builds a manifest with the current UTC timestamp.
    pub fn new(tree: Vec<ManifestNode>) -> anyhow::Result<Self> {
        Self::with_code_indexes(tree, BTreeMap::new())
    }

    /// Builds a manifest with encrypted code index chunk mappings.
    pub fn with_code_indexes(
        tree: Vec<ManifestNode>,
        code_indexes: BTreeMap<String, String>,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            version: 1,
            generated: OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .context("cannot format UTC timestamp")?,
            tree,
            code_indexes,
        })
    }
}

/// Options for an encryption run.
#[derive(Debug, Clone)]
pub struct EncryptOptions {
    /// Project root used to resolve relative paths.
    pub root: PathBuf,
    /// Repeated source paths to scan.
    pub source_paths: Vec<PathBuf>,
    /// Directory containing public AGE key files.
    pub public_keys_dir: PathBuf,
    /// Flat encrypted file destination directory.
    pub encrypted_dir: PathBuf,
    /// Plaintext JSON manifest path.
    pub output_json: PathBuf,
    /// AGE-encrypted manifest path.
    pub output_age: PathBuf,
    /// Skips source file encryption.
    pub skip_encrypt: bool,
    /// Skips manifest generation and manifest encryption.
    pub skip_manifest: bool,
    /// Skips tree-sitter code index generation and encryption.
    pub skip_indexing: bool,
    /// Keeps plaintext `index_*.json` files in addition to encrypted chunks.
    pub keep_plaintext_index: bool,
    /// Keeps the plaintext JSON manifest after encryption.
    pub keep_plaintext_manifest: bool,
    /// Prints planned operations without writing encrypted files or manifests.
    pub dry_run: bool,
    /// Controls successful command output.
    pub message_level: MessageLevel,
}

/// Summary returned by an encryption run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptSummary {
    /// Number of supported source files discovered.
    pub discovered_files: usize,
    /// Number of source files encrypted in this run.
    pub encrypted_files: usize,
}

/// Options for a decryption run.
#[derive(Debug, Clone)]
pub struct DecryptOptions {
    /// Project root used to resolve manifest paths.
    pub root: PathBuf,
    /// Directory containing private AGE key files.
    pub private_keys_dir: PathBuf,
    /// AGE-encrypted manifest path.
    pub input_age: PathBuf,
    /// Directory where plaintext files are restored.
    pub decrypted_dir: PathBuf,
    /// Controls successful command output.
    pub message_level: MessageLevel,
}

/// Summary returned by a decryption run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecryptSummary {
    /// Number of files listed in the manifest.
    pub manifest_files: usize,
    /// Number of files decrypted in this run.
    pub decrypted_files: usize,
}

/// Runs source file encryption, manifest generation, and manifest encryption.
pub fn run_encrypt(options: &EncryptOptions) -> anyhow::Result<EncryptSummary> {
    if options.source_paths.is_empty() {
        anyhow::bail!("at least one --path value is required");
    }

    let public_keys = keys::load_public_keys(&options.public_keys_dir)?;
    let recipients = parse_recipients(&public_keys)?;
    let files = discover_source_files(&options.root, &options.source_paths)?;
    let mut encrypted_files = 0;

    if !options.skip_encrypt {
        for file in &files {
            let destination = options.encrypted_dir.join(format!("{}.age", file.digest));
            if destination.exists() {
                if options.message_level.allows_all() {
                    println!("skip existing encrypted file {}", destination.display());
                }
                continue;
            }
            if options.dry_run {
                if options.message_level.allows_info() {
                    println!(
                        "would encrypt {} -> {}",
                        file.relative_path.display(),
                        destination.display()
                    );
                }
                continue;
            }
            encrypt_file(&file.path, &destination, &recipients)?;
            if options.message_level.allows_debug() {
                println!(
                    "encrypted {} -> {}",
                    file.relative_path.display(),
                    destination.display()
                );
            }
            encrypted_files += 1;
        }
    }

    if !options.skip_manifest {
        let tree = build_manifest_tree(&files);
        let index_chunks = if options.skip_indexing {
            Vec::new()
        } else {
            generate_and_encrypt_indexes(&files, options, &recipients)?
        };
        let code_indexes = index_chunks
            .into_iter()
            .map(|chunk| (chunk.virtual_name, chunk.encrypted_path))
            .collect::<BTreeMap<_, _>>();
        let manifest = Manifest::with_code_indexes(tree, code_indexes)?;
        let manifest_json =
            serde_json::to_vec_pretty(&manifest).context("cannot serialize manifest")?;

        if options.dry_run {
            if options.message_level.allows_info() {
                println!("would write {}", options.output_json.display());
                println!("would encrypt manifest to {}", options.output_age.display());
            }
        } else {
            if let Some(parent) = options.output_json.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("cannot create {}", parent.display()))?;
            }
            fs::write(&options.output_json, &manifest_json)
                .with_context(|| format!("cannot write {}", options.output_json.display()))?;

            let encrypted_manifest =
                encrypt_bytes(&manifest_json, &recipients).context("cannot encrypt manifest")?;
            if let Some(parent) = options.output_age.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("cannot create {}", parent.display()))?;
            }
            fs::write(&options.output_age, encrypted_manifest)
                .with_context(|| format!("cannot write {}", options.output_age.display()))?;
            if options.message_level.allows_debug() {
                println!("encrypted manifest {}", options.output_age.display());
            }

            if !options.keep_plaintext_manifest {
                fs::remove_file(&options.output_json)
                    .with_context(|| format!("cannot remove {}", options.output_json.display()))?;
                if options.message_level.allows_all() {
                    println!(
                        "removed plaintext manifest {}",
                        options.output_json.display()
                    );
                }
            }
        }
    }

    Ok(EncryptSummary {
        discovered_files: files.len(),
        encrypted_files,
    })
}

fn generate_and_encrypt_indexes(
    files: &[crate::file_tree::SourceFile],
    options: &EncryptOptions,
    recipients: &[age::x25519::Recipient],
) -> anyhow::Result<Vec<EncryptedIndexChunk>> {
    let index = build_code_index(files)?;
    let chunks = chunk_code_index(index);
    let mut encrypted_chunks = Vec::new();
    let plaintext_index_dir = options
        .output_json
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| options.root.clone());

    for (prefix, chunk) in chunks {
        let virtual_name = format!("index_{prefix}.json");
        let digest = sha256_reader(virtual_name.as_bytes())
            .with_context(|| format!("cannot hash virtual index name {virtual_name}"))?;
        let encrypted_path = format!("encrypted/{digest}.age");
        let destination = options.encrypted_dir.join(format!("{digest}.age"));
        let plaintext_destination = plaintext_index_dir.join(&virtual_name);
        let json = serde_json::to_vec_pretty(&chunk)
            .with_context(|| format!("cannot serialize {virtual_name}"))?;

        if options.dry_run {
            if options.message_level.allows_info() {
                println!("would encrypt code index {virtual_name} -> {encrypted_path}");
                if options.keep_plaintext_index {
                    println!(
                        "would write plaintext code index {}",
                        plaintext_destination.display()
                    );
                }
            }
        } else {
            if options.keep_plaintext_index {
                if let Some(parent) = plaintext_destination.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("cannot create {}", parent.display()))?;
                }
                fs::write(&plaintext_destination, &json).with_context(|| {
                    format!("cannot write {}", plaintext_destination.display())
                })?;
                if options.message_level.allows_debug() {
                    println!(
                        "wrote plaintext code index {}",
                        plaintext_destination.display()
                    );
                }
            }

            let encrypted = encrypt_bytes(&json, recipients)
                .with_context(|| format!("cannot encrypt {virtual_name}"))?;
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("cannot create {}", parent.display()))?;
            }
            fs::write(&destination, encrypted)
                .with_context(|| format!("cannot write {}", destination.display()))?;
            if options.message_level.allows_debug() {
                println!("encrypted code index {virtual_name} -> {encrypted_path}");
            }
        }

        encrypted_chunks.push(EncryptedIndexChunk {
            virtual_name,
            encrypted_path,
        });
    }

    encrypted_chunks.sort_by(|left, right| left.virtual_name.cmp(&right.virtual_name));
    Ok(encrypted_chunks)
}

/// Decrypts the manifest and every encrypted file it references.
pub fn run_decrypt(options: &DecryptOptions) -> anyhow::Result<DecryptSummary> {
    let identities = keys::load_private_identities(&options.private_keys_dir)?;
    let encrypted_manifest = fs::read(&options.input_age)
        .with_context(|| format!("cannot read {}", options.input_age.display()))?;
    let manifest_json =
        decrypt_bytes(&encrypted_manifest, &identities).context("cannot decrypt manifest")?;
    let manifest: Manifest =
        serde_json::from_slice(&manifest_json).context("cannot parse decrypted manifest JSON")?;
    let files = manifest_files(&manifest.tree);
    let mut decrypted_files = 0;

    for manifest_file in &files {
        let encrypted_path = resolve_under(&options.root, &manifest_file.encrypted_path);
        let decrypted_path = options.decrypted_dir.join(&manifest_file.plaintext_path);
        decrypt_file(&encrypted_path, &decrypted_path, &identities)?;
        decrypted_files += 1;

        if options.message_level.allows_debug() {
            println!(
                "decrypted {} -> {}",
                encrypted_path.display(),
                decrypted_path.display()
            );
        }
    }

    Ok(DecryptSummary {
        manifest_files: files.len(),
        decrypted_files,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ManifestFile {
    plaintext_path: PathBuf,
    encrypted_path: PathBuf,
}

fn manifest_files(nodes: &[ManifestNode]) -> Vec<ManifestFile> {
    let mut files = Vec::new();
    collect_manifest_files(nodes, PathBuf::new(), &mut files);
    files
}

fn collect_manifest_files(nodes: &[ManifestNode], prefix: PathBuf, files: &mut Vec<ManifestFile>) {
    for node in nodes {
        let plaintext_path = if prefix.as_os_str().is_empty() {
            manifest_root_path(node).unwrap_or_else(|| PathBuf::from(&node.name))
        } else {
            prefix.join(&node.name)
        };
        if node.node_type == "folder" {
            collect_manifest_files(&node.children, plaintext_path, files);
        } else if let Some(encrypted_path) = &node.path {
            files.push(ManifestFile {
                plaintext_path,
                encrypted_path: PathBuf::from(encrypted_path),
            });
        }
    }
}

fn manifest_root_path(node: &ManifestNode) -> Option<PathBuf> {
    if let Some(lang_dir) = wrapper_language_dir(&node.name) {
        if node.id.starts_with("drawings-") {
            return Some(PathBuf::from("drawings").join(lang_dir));
        }
        if node.id.starts_with("doc-") {
            return Some(PathBuf::from("doc").join(lang_dir));
        }
    }
    None
}

fn wrapper_language_dir(name: &str) -> Option<String> {
    let start = name.rfind('(')?;
    let end = name.rfind(')')?;
    (start < end).then(|| name[start + 1..end].to_ascii_lowercase())
}

/// Resolves a path relative to a root unless it is already absolute.
///
/// # Examples
///
/// ```
/// let root = std::path::Path::new("/project");
/// let path = rencrypt::manifest::resolve_under(root, "doc");
/// assert!(path.ends_with("project/doc"));
/// ```
pub fn resolve_under(root: &Path, path: impl AsRef<Path>) -> PathBuf {
    let path = path.as_ref();
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    }
}

#[cfg(test)]
mod tests {
    use super::{Manifest, manifest_files, resolve_under};
    use crate::file_tree::ManifestNode;
    use std::{collections::BTreeMap, path::Path};

    #[test]
    fn manifest_uses_version_one() {
        let manifest = Manifest::new(Vec::new()).unwrap();

        assert_eq!(manifest.version, 1);
        assert!(manifest.generated.contains('T'));
    }

    #[test]
    fn resolves_relative_paths_under_root() {
        assert_eq!(
            resolve_under(Path::new("/tmp/root"), "doc"),
            Path::new("/tmp/root/doc")
        );
    }

    #[test]
    fn extracts_files_from_manifest_tree() {
        let tree = vec![ManifestNode {
            id: "doc-en".to_owned(),
            name: "Documentation (EN)".to_owned(),
            node_type: "folder".to_owned(),
            children: vec![ManifestNode {
                id: "doc_manual-pdf".to_owned(),
                name: "manual.pdf".to_owned(),
                node_type: "pdf".to_owned(),
                children: Vec::new(),
                path: Some("encrypted/abc.age".to_owned()),
                size: Some(6),
                lang: None,
                is_old: None,
            }],
            path: None,
            size: None,
            lang: None,
            is_old: None,
        }];

        let files = manifest_files(&tree);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].plaintext_path, Path::new("doc/en/manual.pdf"));
        assert_eq!(files[0].encrypted_path, Path::new("encrypted/abc.age"));
    }

    #[test]
    fn serializes_code_index_mapping_when_present() {
        let mut code_indexes = BTreeMap::new();
        code_indexes.insert(
            "index_ca.json".to_owned(),
            "encrypted/opaque.age".to_owned(),
        );
        let manifest = Manifest::with_code_indexes(Vec::new(), code_indexes).unwrap();

        let json = serde_json::to_string(&manifest).unwrap();

        assert!(json.contains("codeIndexes"));
        assert!(json.contains("index_ca.json"));
    }
}
