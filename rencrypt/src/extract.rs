//! DXF glossary extraction utilities for the `rencrypt` command line tool.
//!
//! This module provides a reusable extraction workflow that scans one or more
//! DXF source directories, extracts translatable string literals from text
//! entities and block metadata, and merges them into a shared glossary CSV.
//!
//! The extraction workflow is intentionally conservative: it preserves existing
//! translations in the glossary and deduplicates strings by exact trimmed text.

use anyhow::{Context, Result};
use csv::{QuoteStyle, ReaderBuilder, WriterBuilder};
use dxf::{
    Drawing,
    entities::{Attribute, AttributeDefinition, Entity, EntityType, MText},
    objects::ObjectType,
};
use regex::Regex;
use serde::Serialize;
use serde_json;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use walkdir::WalkDir;

/// Extraction options for the `extract` command.
#[derive(Debug, Clone)]
pub struct ExtractOptions {
    /// Project root used to resolve relative source paths and glossary path.
    pub root: PathBuf,
    /// One or more DXF source directories to scan.
    pub source_paths: Vec<PathBuf>,
    /// Glossary CSV path to write.
    pub glossary_path: PathBuf,
}

/// Summarizes the result of a glossary extraction run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractSummary {
    /// Number of DXF files inspected.
    pub scanned_files: usize,
    /// Number of unique strings written into the glossary.
    pub unique_strings: usize,
    /// Warnings that occurred while scanning individual files.
    pub warnings: Vec<String>,
}

/// Represents a single glossary occurrence in a DXF file.
#[derive(Debug, Clone, Serialize)]
struct Occurrence {
    file: String,
    handle: String,
    entity_type: String,
}

#[derive(Debug, Clone)]
struct ExtractedString {
    string_id: String,
    occurrences: Vec<Occurrence>,
}

#[derive(Debug, Clone)]
struct ExistingTranslation {
    english: String,
    chinese: String,
}

impl ExtractOptions {
    /// Normalizes source paths by resolving relative paths against the project root.
    ///
    /// Relative paths are joined with `root`, while absolute paths are left unchanged.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use std::path::PathBuf;
    /// use rencrypt::extract::ExtractOptions;
    ///
    /// let options = ExtractOptions {
    ///     root: PathBuf::from("/tmp/project"),
    ///     source_paths: vec![PathBuf::from("drawings/fr")],
    ///     glossary_path: PathBuf::from("glossaire.csv"),
    /// };
    ///
    /// let normalized: Vec<_> = options
    ///     .source_paths
    ///     .iter()
    ///     .map(|path| {
    ///         if path.is_absolute() {
    ///             path.clone()
    ///         } else {
    ///             options.root.join(path)
    ///         }
    ///     })
    ///     .collect();
    ///
    /// assert_eq!(normalized[0], PathBuf::from("/tmp/project/drawings/fr"));
    /// ```
    pub fn normalized_source_paths(&self) -> Vec<PathBuf> {
        self.source_paths
            .iter()
            .map(|path| {
                if path.is_absolute() {
                    path.clone()
                } else {
                    self.root.join(path)
                }
            })
            .collect()
    }
}

/// Runs the extraction workflow and writes the merged glossary CSV.
///
/// The glossary preserves any existing English and Chinese translations for
/// strings that were already present, and appends any newly discovered strings.
///
/// # Examples
///
/// ```rust
/// use std::path::PathBuf;
/// let root = std::env::temp_dir().join("rencrypt_extract_example");
/// let _ = std::fs::remove_dir_all(&root);
/// std::fs::create_dir_all(root.join("drawings/fr")).unwrap();
/// std::fs::write(
///     root.join("drawings/fr/example.dxf"),
///     "0\nSECTION\n2\nENTITIES\n0\nTEXT\n1\nHello\n0\nENDSEC\n0\nEOF\n",
/// )
/// .unwrap();
///
/// let options = rencrypt::extract::ExtractOptions {
///     root: root.clone(),
///     source_paths: vec![PathBuf::from("drawings/fr")],
///     glossary_path: root.join("glossaire.csv"),
/// };
///
/// let summary = rencrypt::extract::run_extract(&options).unwrap();
/// assert_eq!(summary.scanned_files, 1);
/// assert!(root.join("glossaire.csv").exists());
/// ```
pub fn run_extract(options: &ExtractOptions) -> Result<ExtractSummary> {
    let root = options
        .root
        .canonicalize()
        .unwrap_or_else(|_| options.root.clone());
    let source_dirs = if options.source_paths.is_empty() {
        vec![root.join("drawings").join("fr")]
    } else {
        options
            .source_paths
            .iter()
            .map(|path| {
                if path.is_absolute() {
                    path.clone()
                } else {
                    root.join(path)
                }
            })
            .collect()
    };

    let glossary_path = if options.glossary_path.is_absolute() {
        options.glossary_path.clone()
    } else {
        root.join(&options.glossary_path)
    };

    let mut strings: HashMap<String, ExtractedString> = HashMap::new();
    let mut warnings: Vec<String> = Vec::new();
    let dxf_files = collect_dxf_files(&source_dirs, &mut warnings)?;

    for dxf_path in &dxf_files {
        let relative_path = dxf_path
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| dxf_path.to_string_lossy().to_string());

        match Drawing::load_file(dxf_path) {
            Ok(drawing) => scan_drawing(&drawing, &relative_path, &mut strings),
            Err(error) => warnings.push(format!("{}: {}", relative_path, error)),
        }
    }

    let existing = load_existing_translations(&glossary_path)?;
    write_glossary(&glossary_path, &strings, &existing)?;

    Ok(ExtractSummary {
        scanned_files: dxf_files.len(),
        unique_strings: strings.len(),
        warnings,
    })
}

fn collect_dxf_files(source_dirs: &[PathBuf], warnings: &mut Vec<String>) -> Result<Vec<PathBuf>> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();

    for source_dir in source_dirs {
        if !source_dir.exists() {
            warnings.push(format!("source directory not found: {}", source_dir.display()));
            continue;
        }

        for entry in WalkDir::new(source_dir)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().is_file())
        {
            if let Some(extension) = entry.path().extension() {
                if extension.eq_ignore_ascii_case("dxf") {
                    let path = entry.path().to_path_buf();
                    if seen.insert(path.clone()) {
                        files.push(path);
                    }
                }
            }
        }
    }

    if files.is_empty() {
        anyhow::bail!("no DXF files found under the provided source paths");
    }

    Ok(files)
}

fn scan_drawing(drawing: &Drawing, rel_file: &str, strings: &mut HashMap<String, ExtractedString>) {
    for entity in drawing.entities() {
        scan_entity(entity, rel_file, strings);
    }

    for block in drawing.blocks() {
        if block.name == "*Model_Space" || block.name.starts_with("*Paper_Space") {
            continue;
        }
        for entity in &block.entities {
            scan_entity(entity, rel_file, strings);
        }
        if !block.name.starts_with('*') {
            scan_string(
                &block.description,
                rel_file,
                &block.handle.as_string(),
                "BLOCK_DESC",
                strings,
            );
        }
    }

    for object in drawing.objects() {
        if let ObjectType::Layout(layout) = &object.specific {
            if layout.layout_name != "Model" {
                scan_string(
                    &layout.layout_name,
                    rel_file,
                    &layout.layout_name,
                    "LAYOUT_NAME",
                    strings,
                );
            }
        }
        if let ObjectType::PlotSettings(settings) = &object.specific {
            scan_string(
                &settings.page_setup_name,
                rel_file,
                &settings.page_setup_name,
                "PLOT_CONFIG",
                strings,
            );
        }
    }
}

fn scan_entity(entity: &Entity, rel_file: &str, strings: &mut HashMap<String, ExtractedString>) {
    if let Some((value, entity_type)) = entity_text(entity) {
        scan_string(
            &value,
            rel_file,
            &entity.common.handle.as_string(),
            entity_type,
            strings,
        );
    }

    if let EntityType::Insert(insert) = &entity.specific {
        let handle = entity.common.handle.as_string();
        for attribute in insert.attributes() {
            if let Some(value) = attribute_text(attribute) {
                scan_string(&value, rel_file, &handle, "ATTRIB", strings);
            }
        }
    }
}

fn entity_text(entity: &Entity) -> Option<(String, &'static str)> {
    match &entity.specific {
        EntityType::Text(text) => Some((normalize_dxf_text(&text.value), "TEXT")),
        EntityType::MText(mtext) => Some((normalize_mtext_text(mtext), "MTEXT")),
        EntityType::AttributeDefinition(attdef) => attribute_text(attdef).map(|value| (normalize_dxf_text(&value), "ATTDEF")),
        EntityType::Attribute(attr) => attribute_text(attr).map(|value| (normalize_dxf_text(&value), "ATTRIB")),
        _ => None,
    }
}

fn attribute_text<T>(item: &T) -> Option<String>
where
    T: AttributeText,
{
    item.text_value().as_deref().map(normalize_dxf_text)
}

trait AttributeText {
    fn text_value(&self) -> Option<String>;
}

impl AttributeText for Attribute {
    fn text_value(&self) -> Option<String> {
        if !self.value.trim().is_empty() {
            Some(self.value.clone())
        } else if !self.m_text.text.trim().is_empty() {
            Some(self.m_text.text.clone())
        } else {
            None
        }
    }
}

impl AttributeText for AttributeDefinition {
    fn text_value(&self) -> Option<String> {
        if !self.value.trim().is_empty() {
            Some(self.value.clone())
        } else if !self.m_text.text.trim().is_empty() {
            Some(self.m_text.text.clone())
        } else {
            None
        }
    }
}

fn normalize_mtext_text(mtext: &MText) -> String {
    let mut parts = Vec::new();
    if !mtext.text.trim().is_empty() {
        parts.push(mtext.text.clone());
    }
    for segment in &mtext.extended_text {
        if !segment.trim().is_empty() {
            parts.push(segment.clone());
        }
    }
    normalize_dxf_text(&parts.join(" "))
}

fn normalize_dxf_text(input: &str) -> String {
    let mut text = input.replace("\\P", "\n").replace("\\p", "\n");

    static A_CODE_RE: OnceLock<Regex> = OnceLock::new();
    let a_re = A_CODE_RE.get_or_init(|| Regex::new(r#"\\A\d+;"#).unwrap());
    text = a_re.replace_all(&text, "").to_string();

    static SUBSCRIPT_RE: OnceLock<Regex> = OnceLock::new();
    let sub_re = SUBSCRIPT_RE.get_or_init(|| Regex::new(r#"\\S([^;]*);"#).unwrap());
    text = sub_re.replace_all(&text, "$1").to_string();

    text = text.replace("\\L", "");

    static FORMAT_GROUP_RE: OnceLock<Regex> = OnceLock::new();
    let fmt_re = FORMAT_GROUP_RE.get_or_init(|| Regex::new(r#"\{\\(?:f[^;]+|C\d+);"#).unwrap());
    text = fmt_re.replace_all(&text, "").to_string();
    text = text.replace("{\\L", "");
    text = text.replace('{', "");
    text = text.replace('}', "");

    text = text.replace("%%C", "Ø").replace("%%c", "Ø");
    text = text.replace("%%D", "°").replace("%%d", "°");
    text = text.replace("%%P", "±").replace("%%p", "±");

    static COLOR_RE: OnceLock<Regex> = OnceLock::new();
    let color_re = COLOR_RE.get_or_init(|| Regex::new(r#"\\C\d+;"#).unwrap());
    text = color_re.replace_all(&text, "").to_string();

    // Preserve numeric and unicode content but remove leftover DXF markup.
    static RAW_CODE_RE: OnceLock<Regex> = OnceLock::new();
    let raw_re = RAW_CODE_RE.get_or_init(|| Regex::new(r#"%%[A-Za-z]"#).unwrap());
    text = raw_re.replace_all(&text, "").to_string();

    while text.contains("  ") {
        text = text.replace("  ", " ");
    }
    text.trim().to_string()
}

fn scan_string(
    value: &str,
    rel_file: &str,
    handle: &str,
    entity_type: &str,
    strings: &mut HashMap<String, ExtractedString>,
) {
    let text = value.trim();
    if text.is_empty() || should_skip(text) {
        return;
    }

    let key = text.to_string();
    let entry = strings.entry(key.clone()).or_insert_with(|| ExtractedString {
        string_id: string_id(text),
        occurrences: Vec::new(),
    });

    entry.occurrences.push(Occurrence {
        file: rel_file.to_string(),
        handle: handle.to_string(),
        entity_type: entity_type.to_string(),
    });
}

fn should_skip(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.len() <= 1 {
        return true;
    }

    static SKIP_EXACT: [&str; 15] = [
        "XXX",
        "X",
        "0",
        "00",
        "1/1",
        "1:1",
        "2:1",
        "1:2",
        "1:5",
        "1:10",
        "Ra",
        "ISO",
        "DIN",
        "NF",
        "EN",
    ];

    if SKIP_EXACT.contains(&trimmed) {
        return true;
    }

    static SKIP_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    let patterns = SKIP_PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r#"^[\d.,\s±°'\"]+$"#).unwrap(),
            Regex::new(r#"^\d+/\d+$"#).unwrap(),
            Regex::new(r#"^\d+:\d+$"#).unwrap(),
            Regex::new(r#"^\d+/\d+/\d+$"#).unwrap(),
            Regex::new(r#"^[A-F\d]{1,2}$"#).unwrap(),
            Regex::new(r#"^%%[CPDcpd]$"#).unwrap(),
            Regex::new(r#"^M\d"#).unwrap(),
            Regex::new(r#"^R\d"#).unwrap(),
            Regex::new(r#"^\d+[xX×]\d+$"#).unwrap(),
        ]
    });

    for pattern in patterns {
        if pattern.is_match(trimmed) {
            return true;
        }
    }

    false
}

fn string_id(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(text.trim().as_bytes());
    hex::encode(&hash)[..8].to_string()
}

fn load_existing_translations(glossary_path: &Path) -> Result<HashMap<String, ExistingTranslation>> {
    let mut existing = HashMap::new();
    if glossary_path.exists() {
        let file = File::open(glossary_path).with_context(|| {
            format!("failed to open existing glossary {}", glossary_path.display())
        })?;
        let mut reader = ReaderBuilder::new()
            .has_headers(true)
            .from_reader(BufReader::new(file));

        for result in reader.records() {
            let record = result.with_context(|| "failed to read a glossary record")?;
            let french = record.get(1).map(str::trim).unwrap_or("").to_string();
            if french.is_empty() {
                continue;
            }
            existing.insert(
                french,
                ExistingTranslation {
                    english: record.get(2).unwrap_or("").to_string(),
                    chinese: record.get(3).unwrap_or("").to_string(),
                },
            );
        }
    }
    Ok(existing)
}

fn write_glossary(
    glossary_path: &Path,
    strings: &HashMap<String, ExtractedString>,
    existing: &HashMap<String, ExistingTranslation>,
) -> Result<()> {
    if let Some(parent) = glossary_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!("failed to create glossary directory {}", parent.display())
        })?;
    }

    let file = File::create(glossary_path)
        .with_context(|| format!("failed to create glossary {}", glossary_path.display()))?;
    let mut writer = WriterBuilder::new()
        .has_headers(true)
        .quote_style(QuoteStyle::Always)
        .from_writer(BufWriter::new(file));

    writer.write_record(&["string_id", "french", "english", "chinese", "occurrences"])?;

    let mut rows: Vec<_> = strings.iter().collect();
    rows.sort_by_key(|(french, _)| french.to_owned());

    for (french, data) in rows {
        let translation = existing.get(french);
        let occurrences = serde_json::to_string(&data.occurrences)?;
        let english = translation.map(|t| t.english.as_str()).unwrap_or("");
        let chinese = translation.map(|t| t.chinese.as_str()).unwrap_or("");

        writer.write_record(&[
            &data.string_id,
            french.as_str(),
            english,
            chinese,
            &occurrences,
        ])?;
    }

    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn string_id_is_stable_for_trimmed_text() {
        let id1 = string_id(" Hello ");
        let id2 = string_id("Hello");
        assert_eq!(id1, id2);
    }

    #[test]
    fn should_skip_empty_and_non_translatable_strings() {
        assert!(should_skip(" "));
        assert!(should_skip("1:1"));
        assert!(should_skip("X"));
        assert!(!should_skip("Hello"));
    }

    #[test]
    fn normalized_source_paths_resolve_relative_paths_against_root() {
        let options = ExtractOptions {
            root: PathBuf::from("/tmp/project"),
            source_paths: vec![PathBuf::from("drawings/fr")],
            glossary_path: PathBuf::from("glossaire.csv"),
        };

        let normalized = options.normalized_source_paths();
        assert_eq!(normalized, vec![PathBuf::from("/tmp/project/drawings/fr")]);
    }

    #[test]
    fn extracts_text_from_a_simple_dxf_file() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let source = root.join("drawings/fr");
        fs::create_dir_all(&source).unwrap();

        let dxf_path = source.join("test.dxf");
        fs::write(
            &dxf_path,
            "0\nSECTION\n2\nENTITIES\n0\nTEXT\n1\nHello world\n0\nENDSEC\n0\nEOF\n",
        )
        .unwrap();

        let options = ExtractOptions {
            root: root.to_path_buf(),
            source_paths: vec![PathBuf::from("drawings/fr")],
            glossary_path: root.join("glossaire.csv"),
        };

        let summary = run_extract(&options).unwrap();
        assert_eq!(summary.scanned_files, 1);
        assert_eq!(summary.unique_strings, 1);
        let content = fs::read_to_string(root.join("glossaire.csv")).unwrap();
        assert!(content.contains("Hello world"));
    }
}
