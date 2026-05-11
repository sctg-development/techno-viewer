// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
//! Source tree discovery and manifest node construction.

use crate::hash::sha256_file;
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

/// File extensions that are exposed in the generated manifest.
pub const SUPPORTED_EXTENSIONS: &[(&str, FileKind)] = &[
    ("c", FileKind::Cpp),
    ("cpp", FileKind::Cpp),
    ("dxf", FileKind::Dxf),
    ("h", FileKind::Header),
    ("hpp", FileKind::Header),
    ("pdf", FileKind::Pdf),
    ("tsx", FileKind::React),
    ("jsx", FileKind::ReactJSX),
    ("ts", FileKind::Typescript),
    ("js", FileKind::Javascript),
    ("rs", FileKind::Rust),
    ("yaml", FileKind::Yaml),
    ("yml", FileKind::Yaml),
    ("toml", FileKind::Toml),
    ("json", FileKind::Json),
    ("sln", FileKind::Sln),
    ("vcxproj", FileKind::Vcxproj),
    ("html", FileKind::Html),
    ("htm", FileKind::Html),
    ("xml", FileKind::Xml),
    ("gerber.zip", FileKind::GerberZip),
    ("xlsx", FileKind::Xlsx),
];

/// Manifest file type labels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    /// AutoCAD DXF drawings.
    Dxf,
    /// PDF documents.
    Pdf,
    /// C or C++ source files.
    Cpp,
    /// C or C++ header files.
    Header,
    /// React component source files.
    React,
    /// React JSX component source files.
    ReactJSX,
    /// Typescript source files.
    Typescript,
    /// Javascript source files.
    Javascript,
    /// Rust source files.
    Rust,
    /// Yaml files.
    Yaml,
    /// Toml files.
    Toml,
    /// Json files.
    Json,
    /// Visual Studio solution files.
    Sln,
    /// Visual Studio project files.
    Vcxproj,
    /// HTML files.
    Html,
    /// XML files.
    Xml,
    /// Gerber ZIP files.
    GerberZip,
    /// Excel spreadsheet files.
    Xlsx,
}

impl FileKind {
    /// Detects a supported file kind from a path extension.
    ///
    /// # Examples
    ///
    /// ```
    /// let kind = rencrypt::file_tree::FileKind::from_path("drawing.DXF");
    /// assert_eq!(kind.unwrap().as_manifest_type(), "dxf");
    /// ```
    pub fn from_path(path: impl AsRef<Path>) -> Option<Self> {
        let file_name = path.as_ref().file_name()?.to_str()?.to_ascii_lowercase();

        SUPPORTED_EXTENSIONS
            .iter()
            .filter(|(candidate, _)| file_name.ends_with(&format!(".{candidate}")))
            .max_by_key(|(candidate, _)| candidate.len())
            .map(|(_, kind)| *kind)
    }

    /// Returns the type string used by the web manifest.
    pub fn as_manifest_type(self) -> &'static str {
        match self {
            Self::Dxf => "dxf",
            Self::Pdf => "pdf",
            Self::Cpp => "cpp",
            Self::Header => "h",
            Self::React => "tsx",
            Self::ReactJSX => "jsx",
            Self::Typescript => "ts",
            Self::Javascript => "js",
            Self::Rust => "rs",
            Self::Yaml => "yaml",
            Self::Toml => "toml",
            Self::Json => "json",
            Self::Sln => "sln",
            Self::Vcxproj => "vcxproj",
            Self::Html => "html",
            Self::Xml => "xml",
            Self::GerberZip => "gerber.zip",
            Self::Xlsx => "xlsx",
        }
    }
}

/// Converts a relative path to a stable manifest node identifier.
///
/// # Examples
///
/// ```
/// let id = rencrypt::file_tree::path_to_id("doc/en/My File.pdf");
/// assert_eq!(id, "doc_en_My_File-pdf");
/// ```
pub fn path_to_id(path: &str) -> String {
    path.replace(['/', '\\'], "_")
        .replace(' ', "_")
        .replace('.', "-")
}

/// A source file selected for encryption.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFile {
    /// Absolute or process-relative source file path.
    pub path: PathBuf,
    /// Path relative to the project root.
    pub relative_path: PathBuf,
    /// SHA-256 digest of the plaintext file.
    pub digest: String,
    /// Manifest type.
    pub kind: FileKind,
    /// Plaintext byte size.
    pub size: u64,
}

/// Discovers supported files below the requested source paths.
pub fn discover_source_files(
    root: &Path,
    source_paths: &[PathBuf],
) -> anyhow::Result<Vec<SourceFile>> {
    let mut files = Vec::new();

    for source_path in source_paths {
        let absolute = if source_path.is_absolute() {
            source_path.clone()
        } else {
            root.join(source_path)
        };
        if !absolute.exists() {
            continue;
        }

        for entry in WalkDir::new(&absolute).sort_by_file_name() {
            let entry = entry.with_context(|| format!("cannot walk {}", absolute.display()))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(kind) = FileKind::from_path(entry.path()) else {
                continue;
            };
            let path = entry.path().to_path_buf();
            let relative_path = path
                .strip_prefix(root)
                .map(Path::to_path_buf)
                .unwrap_or_else(|_| path.clone());
            let digest = sha256_file(&path)?;
            let size = entry
                .metadata()
                .with_context(|| format!("cannot stat {}", path.display()))?
                .len();

            files.push(SourceFile {
                path,
                relative_path,
                digest,
                kind,
                size,
            });
        }
    }

    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    files.dedup_by(|left, right| left.path == right.path);
    Ok(files)
}

/// Manifest node compatible with the previous JSON shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestNode {
    /// Stable path-derived identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Node type: `folder`, `pdf`, `dxf`, `cpp`, `h`, `ts`, `js`, `rs`, `yaml`, `toml`, `json`, `sln`, `vcxproj`, `html`, `gerber.zip`, `xlsx`.
    #[serde(rename = "type")]
    pub node_type: String,
    /// Child nodes for folders.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub children: Vec<ManifestNode>,
    /// Opaque encrypted path for files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Plaintext byte size for files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// Language inferred from `en`, `fr`, `cn`, or `zh` folders.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    /// Marks files and folders below an `old` directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_old: Option<bool>,
}

#[derive(Default)]
struct FolderBuilder {
    files: Vec<ManifestNode>,
    folders: HashMap<String, FolderBuilder>,
}

/// Builds manifest tree nodes from discovered source files.
pub fn build_manifest_tree(files: &[SourceFile]) -> Vec<ManifestNode> {
    let mut root = FolderBuilder::default();
    let mut special_roots: HashMap<SpecialRoot, FolderBuilder> = HashMap::new();

    for file in files {
        if let Some(special_root) = SpecialRoot::from_path(&file.relative_path) {
            let skip = special_root.skip_components();
            insert_file_skipping_components(
                special_roots.entry(special_root).or_default(),
                file,
                skip,
            );
        } else {
            insert_file(&mut root, file);
        }
    }

    let mut special_entries = special_roots.into_iter().collect::<Vec<_>>();
    special_entries.sort_by(|(left, _), (right, _)| {
        left.kind
            .sort_rank()
            .cmp(&right.kind.sort_rank())
            .then_with(|| left.lang_dir.cmp(&right.lang_dir))
    });

    let mut nodes = special_entries
        .into_iter()
        .map(|(special_root, folder)| {
            let prefix = special_root.relative_prefix();
            let children = finish_folder(folder, &prefix, Some(special_root.lang()), false);
            special_root.into_node(children)
        })
        .collect::<Vec<_>>();
    nodes.extend(finish_folder(root, "", None, false));
    nodes
}

fn insert_file(root: &mut FolderBuilder, file: &SourceFile) {
    insert_file_skipping_components(root, file, 0);
}

fn insert_file_skipping_components(root: &mut FolderBuilder, file: &SourceFile, skip: usize) {
    let components = file
        .relative_path
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if components.len() <= skip {
        return;
    }

    let mut folder = root;
    for component in &components[skip..components.len() - 1] {
        folder = folder.folders.entry(component.clone()).or_default();
    }

    let rel = normalized_path(&file.relative_path);
    folder.files.push(ManifestNode {
        id: path_to_id(&rel),
        name: components.last().cloned().unwrap_or_default(),
        node_type: file.kind.as_manifest_type().to_owned(),
        children: Vec::new(),
        path: Some(format!("encrypted/{}.age", file.digest)),
        size: Some(file.size),
        lang: infer_language(&components),
        is_old: components
            .iter()
            .any(|component| component.eq_ignore_ascii_case("old"))
            .then_some(true),
    });
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SpecialRoot {
    kind: SpecialRootKind,
    lang_dir: String,
    lang: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum SpecialRootKind {
    Doc,
    Drawings,
    Schematics,
}

impl SpecialRootKind {
    fn sort_rank(self) -> u8 {
        match self {
            Self::Drawings => 0,
            Self::Doc => 1,
            Self::Schematics => 2,
        }
    }
}

impl SpecialRoot {
    fn from_path(path: &Path) -> Option<Self> {
        let components = path
            .components()
            .map(|component| component.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        let [first, second, ..] = components.as_slice() else {
            return None;
        };
        let kind = match first.as_str() {
            "doc" => SpecialRootKind::Doc,
            "drawings" => SpecialRootKind::Drawings,
            "schematics" => SpecialRootKind::Schematics,
            _ => return None,
        };
        let lang = language_from_folder(second)?;

        Some(Self {
            kind,
            lang_dir: second.clone(),
            lang,
        })
    }

    fn skip_components(&self) -> usize {
        2
    }

    fn relative_prefix(&self) -> String {
        match self.kind {
            SpecialRootKind::Doc => format!("doc/{}", self.lang_dir),
            SpecialRootKind::Drawings => format!("drawings/{}", self.lang_dir),
            SpecialRootKind::Schematics => format!("schematics/{}", self.lang_dir),
        }
    }

    fn lang(&self) -> String {
        self.lang.clone()
    }

    fn into_node(self, children: Vec<ManifestNode>) -> ManifestNode {
        let (id_prefix, name_prefix) = match self.kind {
            SpecialRootKind::Doc => ("doc", "Documentation"),
            SpecialRootKind::Drawings => ("drawings", "Drawings"),
            SpecialRootKind::Schematics => ("schematics", "Schematics"),
        };

        ManifestNode {
            id: format!("{id_prefix}-{}", self.lang),
            name: format!("{name_prefix} ({})", self.lang_dir.to_uppercase()),
            node_type: "folder".to_owned(),
            children,
            path: None,
            size: None,
            lang: Some(self.lang),
            is_old: None,
        }
    }
}

fn finish_folder(
    folder: FolderBuilder,
    prefix: &str,
    inherited_lang: Option<String>,
    inherited_old: bool,
) -> Vec<ManifestNode> {
    let mut nodes = Vec::new();
    let mut folder_entries = folder.folders.into_iter().collect::<Vec<_>>();
    folder_entries.sort_by(|left, right| left.0.cmp(&right.0));

    for (name, child) in folder_entries {
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let lang = language_from_folder(&name).or_else(|| inherited_lang.clone());
        let is_old = inherited_old || name.eq_ignore_ascii_case("old");
        let children = finish_folder(child, &rel, lang.clone(), is_old);
        if children.is_empty() {
            continue;
        }
        nodes.push(ManifestNode {
            id: path_to_id(&rel),
            name,
            node_type: "folder".to_owned(),
            children,
            path: None,
            size: None,
            lang,
            is_old: is_old.then_some(true),
        });
    }

    let mut files = folder.files;
    files.sort_by(|left, right| left.name.cmp(&right.name));
    nodes.extend(files);
    nodes
}

fn normalized_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn language_from_folder(name: &str) -> Option<String> {
    match name {
        "cn" => Some("zh".to_owned()),
        "en" | "fr" | "zh" => Some(name.to_owned()),
        _ => None,
    }
}

fn infer_language(components: &[String]) -> Option<String> {
    components
        .iter()
        .find_map(|component| language_from_folder(component))
}

/// Writes bytes only when the destination does not exist.
pub fn write_if_missing(path: &Path, bytes: &[u8]) -> anyhow::Result<bool> {
    if path.exists() {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("cannot create {}", parent.display()))?;
    }
    fs::write(path, bytes).with_context(|| format!("cannot write {}", path.display()))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{FileKind, SourceFile, build_manifest_tree, path_to_id};
    use std::path::PathBuf;

    #[test]
    fn maps_supported_extensions() {
        assert_eq!(FileKind::from_path("file.pdf"), Some(FileKind::Pdf));
        assert_eq!(FileKind::from_path("file.CPP"), Some(FileKind::Cpp));
        assert_eq!(FileKind::from_path("file.txt"), None);
    }

    #[test]
    fn converts_path_to_id() {
        assert_eq!(path_to_id("a b/c.d"), "a_b_c-d");
    }

    #[test]
    fn accepts_gerber_zip_extension() {
        assert_eq!(FileKind::from_path("board.gerber.zip"), Some(FileKind::GerberZip));
        assert_eq!(FileKind::from_path("BOARD.GERBER.ZIP"), Some(FileKind::GerberZip));
    }

    #[test]
    fn builds_generic_tree_with_language_and_old_flags() {
        let files = vec![SourceFile {
            path: PathBuf::from("custom/en/old/a.pdf"),
            relative_path: PathBuf::from("custom/en/old/a.pdf"),
            digest: "abc".to_owned(),
            kind: FileKind::Pdf,
            size: 10,
        }];

        let tree = build_manifest_tree(&files);

        assert_eq!(tree[0].name, "custom");
        assert_eq!(tree[0].children[0].lang.as_deref(), Some("en"));
        assert_eq!(tree[0].children[0].children[0].is_old, Some(true));
    }

    #[test]
    fn builds_legacy_doc_and_drawings_language_roots() {
        let files = vec![
            SourceFile {
                path: PathBuf::from("doc/en/manual.pdf"),
                relative_path: PathBuf::from("doc/en/manual.pdf"),
                digest: "abc".to_owned(),
                kind: FileKind::Pdf,
                size: 10,
            },
            SourceFile {
                path: PathBuf::from("drawings/cn/plate/file.dxf"),
                relative_path: PathBuf::from("drawings/cn/plate/file.dxf"),
                digest: "def".to_owned(),
                kind: FileKind::Dxf,
                size: 20,
            },
        ];

        let tree = build_manifest_tree(&files);

        assert_eq!(tree[0].id, "drawings-zh");
        assert_eq!(tree[0].name, "Drawings (CN)");
        assert_eq!(tree[0].children[0].name, "plate");
        assert_eq!(tree[1].id, "doc-en");
        assert_eq!(tree[1].name, "Documentation (EN)");
        assert_eq!(tree[1].children[0].name, "manual.pdf");
    }
}
