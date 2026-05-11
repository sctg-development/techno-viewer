// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
//! Syntax indexing for encrypted source code navigation.

use crate::file_tree::SourceFile;
#[cfg(not(target_arch = "wasm32"))]
use anyhow::{Context, anyhow};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path};
#[cfg(not(target_arch = "wasm32"))]
use std::{collections::HashSet, fs};
#[cfg(not(target_arch = "wasm32"))]
use tree_sitter::{Language, Node, Parser, Point};

const INDEXABLE_EXTENSIONS: &[&str] = &["c", "cpp", "rs", "ts", "js", "tsx", "jsx", "h", "hpp"];

/// Represents the location of a source symbol definition.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct SymbolLocation {
    /// SHA-256 hash of the encrypted source file target.
    pub file_hash: String,
    /// Original source path shown in the navigation UI.
    pub original_path: String,
    /// One-based source line.
    pub line: usize,
    /// One-based source column.
    pub column: usize,
    /// Symbol kind such as `function`, `class`, `method`, or `constant`.
    pub kind: String,
}

/// Complete in-memory source symbol index before chunking.
#[derive(Default, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct CodeIndex {
    /// Key: symbol name. Value: definition locations, preserving overloads and homonyms.
    pub symbols: HashMap<String, Vec<SymbolLocation>>,
}

/// One encrypted index chunk referenced by the manifest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedIndexChunk {
    /// Virtual chunk name used by the UI.
    pub virtual_name: String,
    /// Opaque encrypted path.
    pub encrypted_path: String,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceLanguage {
    C,
    Cpp,
    Rust,
    JavaScript,
    TypeScript,
    Tsx,
}

#[cfg(not(target_arch = "wasm32"))]
impl SourceLanguage {
    fn from_path(path: &Path) -> Option<Self> {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "c" => Some(Self::C),
            "cpp" | "h" | "hpp" => Some(Self::Cpp),
            "rs" => Some(Self::Rust),
            "js" | "jsx" => Some(Self::JavaScript),
            "ts" => Some(Self::TypeScript),
            "tsx" => Some(Self::Tsx),
            _ => None,
        }
    }

    fn language(self) -> Language {
        match self {
            Self::C => tree_sitter_c::LANGUAGE.into(),
            Self::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
        }
    }
}

/// Returns true when a path is syntax-indexable.
///
/// # Examples
///
/// ```
/// assert!(rencrypt::code_index::is_indexable_source("src/lib.rs"));
/// assert!(rencrypt::code_index::is_indexable_source("src/app.tsx"));
/// assert!(!rencrypt::code_index::is_indexable_source("doc/manual.pdf"));
/// ```
pub fn is_indexable_source(path: impl AsRef<Path>) -> bool {
    path.as_ref()
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| INDEXABLE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Builds a syntax index for all indexable source files.
#[cfg(not(target_arch = "wasm32"))]
pub fn build_code_index(files: &[SourceFile]) -> anyhow::Result<CodeIndex> {
    let mut index = CodeIndex::default();
    for file in files {
        if !is_indexable_source(&file.path) {
            continue;
        }
        let source_bytes = fs::read(&file.path)
            .with_context(|| format!("cannot read source {}", file.path.display()))?;
        let Ok(source) = std::str::from_utf8(&source_bytes) else {
            // Skip non-UTF-8 files to keep encryption working on mixed encodings.
            continue;
        };
        let symbols = parse_symbols(&file.path, &source)
            .with_context(|| format!("cannot parse source {}", file.path.display()))?;
        for symbol in symbols {
            index
                .symbols
                .entry(symbol.name)
                .or_default()
                .push(SymbolLocation {
                    file_hash: file.digest.clone(),
                    original_path: normalized_path(&file.relative_path),
                    line: symbol.line,
                    column: symbol.column,
                    kind: symbol.kind,
                });
        }
    }
    Ok(index)
}

/// Builds an empty syntax index on WebAssembly targets.
///
/// Tree-sitter grammars used by this crate are native C parsers. The API stays
/// available for WebAssembly builds, but syntax indexing is intentionally
/// disabled there.
#[cfg(target_arch = "wasm32")]
pub fn build_code_index(_files: &[SourceFile]) -> anyhow::Result<CodeIndex> {
    Ok(CodeIndex::default())
}

/// Splits an index by the first two lowercase symbol characters.
///
/// # Examples
///
/// ```
/// let mut index = rencrypt::code_index::CodeIndex::default();
/// index.symbols.insert("Calibrate".to_string(), Vec::new());
/// let chunks = rencrypt::code_index::chunk_code_index(index);
/// assert!(chunks.contains_key("ca"));
/// ```
pub fn chunk_code_index(index: CodeIndex) -> HashMap<String, CodeIndex> {
    let mut chunks = HashMap::new();
    for (symbol, locations) in index.symbols {
        let prefix = symbol_prefix(&symbol);
        chunks
            .entry(prefix)
            .or_insert_with(CodeIndex::default)
            .symbols
            .insert(symbol, locations);
    }
    chunks
}

/// Computes the virtual chunk prefix for a symbol.
pub fn symbol_prefix(symbol: &str) -> String {
    let prefix = symbol
        .chars()
        .filter(|character| character.is_alphanumeric() || *character == '_')
        .flat_map(char::to_lowercase)
        .take(2)
        .collect::<String>();
    if prefix.len() >= 2 {
        prefix
    } else {
        "misc".to_owned()
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedSymbol {
    name: String,
    kind: String,
    line: usize,
    column: usize,
}

#[cfg(not(target_arch = "wasm32"))]
fn parse_symbols(path: &Path, source: &str) -> anyhow::Result<Vec<ParsedSymbol>> {
    let language = SourceLanguage::from_path(path)
        .ok_or_else(|| anyhow!("unsupported source language for {}", path.display()))?;
    let mut parser = Parser::new();
    parser
        .set_language(&language.language())
        .context("cannot load tree-sitter language")?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| anyhow!("tree-sitter did not return a parse tree"))?;

    let mut symbols = Vec::new();
    let mut seen = HashSet::new();
    collect_symbols(
        tree.root_node(),
        source.as_bytes(),
        language,
        &mut symbols,
        &mut seen,
    );
    Ok(symbols)
}

#[cfg(not(target_arch = "wasm32"))]
fn collect_symbols(
    node: Node<'_>,
    source: &[u8],
    language: SourceLanguage,
    symbols: &mut Vec<ParsedSymbol>,
    seen: &mut HashSet<(String, usize, usize, String)>,
) {
    if let Some((name_node, kind)) = symbol_name_node(node, language)
        && let Ok(name) = name_node.utf8_text(source)
    {
        push_symbol(name, kind, name_node.start_position(), symbols, seen);
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_symbols(child, source, language, symbols, seen);
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn push_symbol(
    name: &str,
    kind: &str,
    point: Point,
    symbols: &mut Vec<ParsedSymbol>,
    seen: &mut HashSet<(String, usize, usize, String)>,
) {
    if !is_valid_symbol_name(name) {
        return;
    }
    let symbol = ParsedSymbol {
        name: name.to_owned(),
        kind: kind.to_owned(),
        line: point.row + 1,
        column: point.column + 1,
    };
    let key = (
        symbol.name.clone(),
        symbol.line,
        symbol.column,
        symbol.kind.clone(),
    );
    if seen.insert(key) {
        symbols.push(symbol);
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn symbol_name_node<'a>(
    node: Node<'a>,
    language: SourceLanguage,
) -> Option<(Node<'a>, &'static str)> {
    match language {
        SourceLanguage::Rust => rust_symbol_name_node(node),
        SourceLanguage::C | SourceLanguage::Cpp => c_family_symbol_name_node(node),
        SourceLanguage::JavaScript | SourceLanguage::TypeScript | SourceLanguage::Tsx => {
            js_family_symbol_name_node(node)
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn rust_symbol_name_node(node: Node<'_>) -> Option<(Node<'_>, &'static str)> {
    match node.kind() {
        "function_item" => {
            field_or_descendant(node, "name", &["identifier"]).map(|n| (n, "function"))
        }
        "struct_item" => {
            field_or_descendant(node, "name", &["type_identifier"]).map(|n| (n, "struct"))
        }
        "enum_item" => field_or_descendant(node, "name", &["type_identifier"]).map(|n| (n, "enum")),
        "trait_item" => {
            field_or_descendant(node, "name", &["type_identifier"]).map(|n| (n, "trait"))
        }
        "const_item" => field_or_descendant(node, "name", &["identifier"]).map(|n| (n, "constant")),
        "static_item" => {
            field_or_descendant(node, "name", &["identifier"]).map(|n| (n, "constant"))
        }
        "type_item" => field_or_descendant(node, "name", &["type_identifier"]).map(|n| (n, "type")),
        _ => None,
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn c_family_symbol_name_node(node: Node<'_>) -> Option<(Node<'_>, &'static str)> {
    match node.kind() {
        "function_definition" => deepest_identifier(node).map(|n| (n, "function")),
        "class_specifier" => field_or_descendant(node, "name", &["type_identifier", "identifier"])
            .map(|n| (n, "class")),
        "struct_specifier" => field_or_descendant(node, "name", &["type_identifier", "identifier"])
            .map(|n| (n, "struct")),
        "enum_specifier" => field_or_descendant(node, "name", &["type_identifier", "identifier"])
            .map(|n| (n, "enum")),
        "field_declaration" => deepest_identifier(node).map(|n| (n, "property")),
        "declaration" if contains_node_kind(node, "const") => {
            deepest_identifier(node).map(|n| (n, "constant"))
        }
        _ => None,
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn js_family_symbol_name_node(node: Node<'_>) -> Option<(Node<'_>, &'static str)> {
    match node.kind() {
        "function_declaration" => {
            field_or_descendant(node, "name", &["identifier"]).map(|n| (n, "function"))
        }
        "class_declaration" => {
            field_or_descendant(node, "name", &["identifier", "type_identifier"])
                .map(|n| (n, "class"))
        }
        "method_definition" => {
            field_or_descendant(node, "name", &["property_identifier", "identifier"])
                .map(|n| (n, "method"))
        }
        "public_field_definition" | "field_definition" => {
            field_or_descendant(node, "property", &["property_identifier", "identifier"])
                .map(|n| (n, "property"))
        }
        "variable_declarator"
            if node
                .parent()
                .is_some_and(|parent| contains_node_kind(parent, "const")) =>
        {
            field_or_descendant(node, "name", &["identifier"]).map(|n| (n, "constant"))
        }
        "lexical_declaration" if contains_node_kind(node, "const") => {
            deepest_identifier(node).map(|n| (n, "constant"))
        }
        "type_alias_declaration" => {
            field_or_descendant(node, "name", &["type_identifier", "identifier"])
                .map(|n| (n, "type"))
        }
        "interface_declaration" => {
            field_or_descendant(node, "name", &["type_identifier", "identifier"])
                .map(|n| (n, "type"))
        }
        _ => None,
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn field_or_descendant<'a>(node: Node<'a>, field: &str, kinds: &[&str]) -> Option<Node<'a>> {
    node.child_by_field_name(field)
        .filter(|child| kinds.contains(&child.kind()))
        .or_else(|| first_descendant_of_kinds(node, kinds))
}

#[cfg(not(target_arch = "wasm32"))]
fn first_descendant_of_kinds<'a>(node: Node<'a>, kinds: &[&str]) -> Option<Node<'a>> {
    if kinds.contains(&node.kind()) {
        return Some(node);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = first_descendant_of_kinds(child, kinds) {
            return Some(found);
        }
    }
    None
}

#[cfg(not(target_arch = "wasm32"))]
fn deepest_identifier(node: Node<'_>) -> Option<Node<'_>> {
    let mut found = None;
    collect_deepest_identifier(node, &mut found);
    found
}

#[cfg(not(target_arch = "wasm32"))]
fn collect_deepest_identifier<'a>(node: Node<'a>, found: &mut Option<Node<'a>>) {
    if matches!(
        node.kind(),
        "identifier" | "type_identifier" | "field_identifier" | "property_identifier"
    ) {
        *found = Some(node);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_deepest_identifier(child, found);
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn contains_node_kind(node: Node<'_>, kind: &str) -> bool {
    if node.kind() == kind {
        return true;
    }
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .any(|child| contains_node_kind(child, kind))
}

#[cfg(not(target_arch = "wasm32"))]
fn is_valid_symbol_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .next()
            .is_some_and(|character| character == '_' || character.is_alphabetic())
}

#[cfg(not(target_arch = "wasm32"))]
fn normalized_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    #[cfg(not(target_arch = "wasm32"))]
    use crate::file_tree::{FileKind, SourceFile};
    #[cfg(not(target_arch = "wasm32"))]
    use super::build_code_index;
    #[cfg(not(target_arch = "wasm32"))]
    use super::parse_symbols;
    use super::{CodeIndex, chunk_code_index, symbol_prefix};
    #[cfg(not(target_arch = "wasm32"))]
    use std::{fs, path::Path};
    #[cfg(not(target_arch = "wasm32"))]
    use tempfile::tempdir;

    #[test]
    fn chunks_symbols_by_lowercase_prefix() {
        let mut index = CodeIndex::default();
        index.symbols.insert("Calibrate".to_owned(), Vec::new());
        index.symbols.insert("A".to_owned(), Vec::new());

        let chunks = chunk_code_index(index);

        assert!(chunks.contains_key("ca"));
        assert!(chunks.contains_key("misc"));
    }

    #[test]
    fn computes_symbol_prefixes() {
        assert_eq!(symbol_prefix("Calibrate"), "ca");
        assert_eq!(symbol_prefix("A"), "misc");
        assert_eq!(symbol_prefix("_hidden"), "_h");
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn indexes_rust_symbols() {
        let source = "pub const LIMIT: usize = 3;\npub trait Run {}\npub struct Pump;\nfn calibrate_sensor() {}\n";

        let symbols = parse_symbols(Path::new("lib.rs"), source).unwrap();
        let names = symbols
            .into_iter()
            .map(|symbol| symbol.name)
            .collect::<Vec<_>>();

        assert!(names.contains(&"LIMIT".to_owned()));
        assert!(names.contains(&"Run".to_owned()));
        assert!(names.contains(&"Pump".to_owned()));
        assert!(names.contains(&"calibrate_sensor".to_owned()));
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn indexes_typescript_symbols() {
        let source =
            "type Mode = string;\nconst limit = 4;\nclass Pump { start() {} }\nfunction run() {}\n";

        let symbols = parse_symbols(Path::new("app.ts"), source).unwrap();
        let names = symbols
            .into_iter()
            .map(|symbol| symbol.name)
            .collect::<Vec<_>>();

        assert!(names.contains(&"Mode".to_owned()));
        assert!(names.contains(&"limit".to_owned()));
        assert!(names.contains(&"Pump".to_owned()));
        assert!(names.contains(&"start".to_owned()));
        assert!(names.contains(&"run".to_owned()));
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn indexes_cpp_symbols() {
        let source = "const int LIMIT = 3;\nclass Pump { int speed; void start() {} };\nvoid calibrate() {}\n";

        let symbols = parse_symbols(Path::new("pump.cpp"), source).unwrap();
        let names = symbols
            .into_iter()
            .map(|symbol| symbol.name)
            .collect::<Vec<_>>();

        assert!(names.contains(&"LIMIT".to_owned()));
        assert!(names.contains(&"Pump".to_owned()));
        assert!(names.contains(&"speed".to_owned()));
        assert!(names.contains(&"calibrate".to_owned()));
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn skips_non_utf8_sources_without_error() {
        let temp = tempdir().unwrap();
        let source_path = temp.path().join("legacy.cpp");
        fs::write(&source_path, [0x23u8, 0x69, 0x6e, 0x63, 0x6c, 0x75, 0x64, 0x65, 0x20, 0xE9])
            .unwrap();

        let files = vec![SourceFile {
            path: source_path,
            relative_path: Path::new("legacy.cpp").to_path_buf(),
            digest: "deadbeef".to_owned(),
            kind: FileKind::Cpp,
            size: 10,
        }];

        let index = build_code_index(&files).unwrap();
        assert!(index.symbols.is_empty());
    }
}
