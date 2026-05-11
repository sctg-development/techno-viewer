// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
//! Command line interface definitions.
use crate::output::MessageLevel;
use crate::{
    keys::KeyDirectories,
    manifest::{DecryptOptions, EncryptOptions, resolve_under},
};
use clap::{ArgAction, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

/// Pure Rust AGE key generation and encrypted manifest builder.
#[derive(Debug, Parser)]
#[command(author, version, about)]
pub struct Cli {
    /// Increase output verbosity: `-v` is INFO, `-vv` is DEBUG, `-vvv` is ALL.
    #[arg(short = 'v', action = ArgAction::Count, global = true)]
    pub verbose_count: u8,
    /// Set output verbosity explicitly.
    #[arg(long = "verbose", value_enum, ignore_case = true, global = true)]
    pub verbose: Option<VerboseValue>,
    /// Command to execute.
    #[command(subcommand)]
    pub command: Command,
}

impl Cli {
    /// Returns the selected message level.
    pub fn message_level(&self) -> MessageLevel {
        self.verbose
            .map(VerboseValue::into_level)
            .unwrap_or_else(|| MessageLevel::from_count(self.verbose_count))
    }
}

/// CLI values accepted by `--verbose`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum VerboseValue {
    /// Print nothing for successful operations.
    Quiet,
    /// Print high-level progress and summaries.
    Info,
    /// Print per-file operations and useful diagnostics.
    Debug,
    /// Print every available detail.
    All,
}

impl VerboseValue {
    /// Converts a CLI verbosity value into a message level.
    pub fn into_level(self) -> MessageLevel {
        match self {
            Self::Quiet => MessageLevel::Quiet,
            Self::Info => MessageLevel::Info,
            Self::Debug => MessageLevel::Debug,
            Self::All => MessageLevel::All,
        }
    }
}

/// Supported commands.
#[derive(Debug, Subcommand)]
pub enum Command {
    /// Generate AGE v1 X25519 key pairs.
    GenerateKeys(GenerateKeysArgs),
    /// Encrypt source trees and generate an encrypted manifest.
    Encrypt(EncryptArgs),
    /// Extract translatable strings from DXF files into a glossary CSV.
    Extract(ExtractArgs),
    /// Decrypt an encrypted manifest and its referenced files.
    Decrypt(DecryptArgs),
    /// Translate glossary entries to multiple languages using AI.
    Translate(TranslateArgs),
}

/// Arguments for AGE key generation.
#[derive(Debug, Parser)]
pub struct GenerateKeysArgs {
    /// Shared key root. Creates `<keys>/public` and `<keys>/private`.
    #[arg(long, default_value = "keys")]
    pub keys: PathBuf,
    /// Private key output directory. Overrides `<keys>/private`.
    #[arg(long)]
    pub keys_private: Option<PathBuf>,
    /// Public key output directory. Overrides `<keys>/public`.
    #[arg(long)]
    pub keys_public: Option<PathBuf>,
    /// Number of AGE key pairs to generate.
    #[arg(long, default_value_t = 100)]
    pub count: usize,
}

impl GenerateKeysArgs {
    /// Resolves private and public key directories.
    pub fn directories(&self) -> KeyDirectories {
        let from_root = KeyDirectories::from_root(&self.keys);
        KeyDirectories {
            private: self.keys_private.clone().unwrap_or(from_root.private),
            public: self.keys_public.clone().unwrap_or(from_root.public),
        }
    }
}

/// Arguments for the encryption workflow.
#[derive(Debug, Parser)]
pub struct EncryptArgs {
    /// Project root used to resolve relative paths.
    #[arg(long, default_value = ".")]
    pub root: PathBuf,
    /// Source path to scan. Can be repeated.
    #[arg(long = "path", required = true)]
    pub paths: Vec<PathBuf>,
    /// Shared key root. Reads `<keys>/public` unless `--keys-public` is set.
    #[arg(long, default_value = "keys")]
    pub keys: PathBuf,
    /// Private key directory accepted for symmetry with `generate-keys`.
    #[arg(long)]
    pub keys_private: Option<PathBuf>,
    /// Public key directory. Overrides `<keys>/public`.
    #[arg(long)]
    pub keys_public: Option<PathBuf>,
    /// Output directory for encrypted files.
    #[arg(long, default_value = "encrypted")]
    pub encrypted_dir: PathBuf,
    /// Path for the generated plaintext manifest.
    #[arg(long, default_value = "public/files.json")]
    pub output_json: PathBuf,
    /// Path for the encrypted manifest.
    #[arg(long, default_value = "public/files.json.age")]
    pub output_age: PathBuf,
    /// Skip encrypting source files and only regenerate the manifest.
    #[arg(long)]
    pub skip_encrypt: bool,
    /// Skip generating and encrypting the manifest.
    #[arg(long)]
    pub skip_manifest: bool,
    /// Skip generating and encrypting tree-sitter code indexes.
    #[arg(long)]
    pub skip_indexing: bool,
    /// Keep plaintext `index_*.json` files after generating code indexes.
    #[arg(long)]
    pub keep_plaintext_index: bool,
    /// Keep `files.json` after encrypting it.
    #[arg(long)]
    pub keep_plaintext_manifest: bool,
    /// Print planned work without writing encrypted outputs.
    #[arg(long)]
    pub dry_run: bool,
}

impl EncryptArgs {
    /// Converts CLI arguments into workflow options.
    pub fn to_options(&self, message_level: MessageLevel) -> EncryptOptions {
        let root = self
            .root
            .canonicalize()
            .unwrap_or_else(|_| self.root.clone());
        let key_dirs = KeyDirectories::from_root(&self.keys);
        let public_keys_dir = self.keys_public.clone().unwrap_or(key_dirs.public);

        EncryptOptions {
            root: root.clone(),
            source_paths: self.paths.clone(),
            public_keys_dir: resolve_under(&root, public_keys_dir),
            encrypted_dir: resolve_under(&root, &self.encrypted_dir),
            output_json: resolve_under(&root, &self.output_json),
            output_age: resolve_under(&root, &self.output_age),
            skip_encrypt: self.skip_encrypt,
            skip_manifest: self.skip_manifest,
            skip_indexing: self.skip_indexing,
            keep_plaintext_index: self.keep_plaintext_index,
            keep_plaintext_manifest: self.keep_plaintext_manifest,
            dry_run: self.dry_run,
            message_level,
        }
    }
}

/// Arguments for DXF glossary extraction.
#[derive(Debug, Parser)]
pub struct ExtractArgs {
    /// Project root used to resolve relative paths.
    #[arg(long, default_value = ".")]
    pub root: PathBuf,
    /// DXF source directory to scan. Can be repeated.
    #[arg(long = "path", action = ArgAction::Append)]
    pub paths: Vec<PathBuf>,
    /// Glossary CSV path.
    #[arg(long, default_value = "glossaire.csv")]
    pub glossary: PathBuf,
}

impl ExtractArgs {
    /// Converts CLI arguments into extraction options.
    pub fn to_options(&self) -> super::extract::ExtractOptions {
        let root = self
            .root
            .canonicalize()
            .unwrap_or_else(|_| self.root.clone());

        let source_paths = if self.paths.is_empty() {
            vec![root.join("drawings").join("fr")]
        } else {
            self.paths
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

        let glossary_path = if self.glossary.is_absolute() {
            self.glossary.clone()
        } else {
            root.join(&self.glossary)
        };

        super::extract::ExtractOptions {
            root,
            source_paths,
            glossary_path,
        }
    }
}

/// Arguments for the decryption workflow.
#[derive(Debug, Parser)]
pub struct DecryptArgs {
    /// Project root used to resolve manifest paths.
    #[arg(long, default_value = ".")]
    pub root: PathBuf,
    /// Shared key root. Reads `<keys>/private` unless `--keys-private` is set.
    #[arg(long, default_value = "keys")]
    pub keys: PathBuf,
    /// Private key directory. Overrides `<keys>/private`.
    #[arg(long)]
    pub keys_private: Option<PathBuf>,
    /// Public key directory accepted for symmetry with `generate-keys`.
    #[arg(long)]
    pub keys_public: Option<PathBuf>,
    /// AGE-encrypted manifest path.
    #[arg(long, default_value = "public/files.json.age")]
    pub input_age: PathBuf,
    /// Output directory for decrypted plaintext files.
    #[arg(long, default_value = "decrypted")]
    pub decrypted_dir: PathBuf,
}

impl DecryptArgs {
    /// Converts CLI arguments into workflow options.
    pub fn to_options(&self, message_level: MessageLevel) -> DecryptOptions {
        let root = self
            .root
            .canonicalize()
            .unwrap_or_else(|_| self.root.clone());
        let key_dirs = KeyDirectories::from_root(&self.keys);
        let private_keys_dir = self.keys_private.clone().unwrap_or(key_dirs.private);

        DecryptOptions {
            root: root.clone(),
            private_keys_dir: resolve_under(&root, private_keys_dir),
            input_age: resolve_under(&root, &self.input_age),
            decrypted_dir: resolve_under(&root, &self.decrypted_dir),
            message_level,
        }
    }
}

/// Arguments for the glossary translation workflow.
#[derive(Debug, Parser)]
pub struct TranslateArgs {
    /// Project root used to resolve relative paths.
    #[arg(long, default_value = ".")]
    pub root: PathBuf,
    /// Glossary CSV file path.
    #[arg(long, default_value = "glossaire.csv")]
    pub glossary: PathBuf,
    /// Target language codes (comma-separated: en,cn,es,pt,de,it). Defaults to 'en'.
    #[arg(long, default_value = "en")]
    pub lang: String,
    /// Number of terms per API call.
    #[arg(long, default_value_t = 50)]
    pub batch_size: usize,
    /// AI model ID.
    #[arg(long)]
    pub model: Option<String>,
    /// AI provider name (mistral, gemini, etc.).
    #[arg(long)]
    pub provider: Option<String>,
    /// Route requests through provider gateway endpoint.
    #[arg(long)]
    pub use_gateway: bool,
    /// Path or URL to ai.json.enc configuration file.
    #[arg(long, default_value = "./ai.json.enc")]
    pub ai_json_enc: PathBuf,
    /// Encryption token for ai.json.enc (sets AI_CRYPTOKEN).
    #[arg(long)]
    pub ai_cryptoken: Option<String>,
    /// Gateway token (overrides gatewayKey).
    #[arg(long)]
    pub ai_gateway_token: Option<String>,
    /// Re-translate existing translations.
    #[arg(long)]
    pub force: bool,
    /// Custom system prompt (overrides language default).
    #[arg(long)]
    pub prompt_system: Option<String>,
    /// Custom user prompt (overrides language default).
    #[arg(long)]
    pub prompt_user: Option<String>,
}

impl TranslateArgs {
    /// Returns parsed language codes from the `--lang` argument.
    ///
    /// # Errors
    ///
    /// Returns an error if any language code is not recognized.
    pub fn parse_languages(&self) -> anyhow::Result<Vec<crate::translate::Language>> {
        if self.lang.is_empty() {
            return Ok(vec![crate::translate::Language::English]);
        }

        self.lang
            .split(',')
            .map(|code| crate::translate::Language::from_code(code.trim()))
            .collect()
    }

    /// Resolves `--ai-json-enc` to either a URL (unchanged) or an absolute/local path.
    pub fn resolved_ai_json_enc(&self) -> String {
        let raw = self.ai_json_enc.to_string_lossy();
        if raw.starts_with("http://") || raw.starts_with("https://") {
            return raw.to_string();
        }

        if self.ai_json_enc.is_absolute() {
            self.ai_json_enc.to_string_lossy().to_string()
        } else {
            self.root.join(&self.ai_json_enc).to_string_lossy().to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Cli, Command};
    use clap::Parser;
    use std::path::PathBuf;

    #[test]
    fn parses_repeated_paths() {
        let cli = Cli::parse_from([
            "rencrypt",
            "encrypt",
            "--path=./doc",
            "--path=./drawings",
            "--keys=my-keys",
        ]);

        let Command::Encrypt(args) = cli.command else {
            panic!("expected encrypt command");
        };
        assert_eq!(
            args.paths,
            vec![PathBuf::from("./doc"), PathBuf::from("./drawings")]
        );
        assert_eq!(args.keys, PathBuf::from("my-keys"));
    }

    #[test]
    fn parses_short_verbosity() {
        let cli = Cli::parse_from(["rencrypt", "-vv", "encrypt", "--path=./doc"]);

        assert_eq!(cli.message_level(), crate::output::MessageLevel::Debug);
    }

    #[test]
    fn parses_skip_indexing() {
        let cli = Cli::parse_from([
            "rencrypt",
            "encrypt",
            "--path=./doc",
            "--skip-indexing",
        ]);

        let Command::Encrypt(args) = cli.command else {
            panic!("expected encrypt command");
        };
        assert!(args.skip_indexing);
    }

    #[test]
    fn parses_keep_plaintext_index() {
        let cli = Cli::parse_from([
            "rencrypt",
            "encrypt",
            "--path=./doc",
            "--keep-plaintext-index",
        ]);

        let Command::Encrypt(args) = cli.command else {
            panic!("expected encrypt command");
        };
        assert!(args.keep_plaintext_index);
    }

    #[test]
    fn parses_long_verbosity() {
        let cli = Cli::parse_from([
            "rencrypt",
            "--verbose=ALL",
            "decrypt",
            "--decrypted-dir",
            "plain",
        ]);

        assert_eq!(cli.message_level(), crate::output::MessageLevel::All);
        let Command::Decrypt(args) = cli.command else {
            panic!("expected decrypt command");
        };
        assert_eq!(args.decrypted_dir, PathBuf::from("plain"));
    }

    #[test]
    fn resolves_generate_key_directories_from_shared_root() {
        let cli = Cli::parse_from(["rencrypt", "generate-keys", "--keys=my-keys"]);

        let Command::GenerateKeys(args) = cli.command else {
            panic!("expected generate-keys command");
        };
        let dirs = args.directories();
        assert_eq!(dirs.private, PathBuf::from("my-keys/private"));
        assert_eq!(dirs.public, PathBuf::from("my-keys/public"));
    }

    #[test]
    fn parses_translate_default_args() {
        let cli = Cli::parse_from(["rencrypt", "translate"]);

        let Command::Translate(args) = cli.command else {
            panic!("expected translate command");
        };
        assert_eq!(args.lang, "en");
        assert_eq!(args.glossary, PathBuf::from("glossaire.csv"));
        assert_eq!(args.batch_size, 50);
        assert!(!args.use_gateway);
        assert!(!args.force);
    }

    #[test]
    fn parses_translate_with_multiple_languages() {
        let cli = Cli::parse_from([
            "rencrypt",
            "translate",
            "--lang=en,cn,es,pt,de,it",
        ]);

        let Command::Translate(args) = cli.command else {
            panic!("expected translate command");
        };
        assert_eq!(args.lang, "en,cn,es,pt,de,it");
        let languages = args.parse_languages().unwrap();
        assert_eq!(languages.len(), 6);
    }

    #[test]
    fn parses_translate_with_all_options() {
        let cli = Cli::parse_from([
            "rencrypt",
            "-vv",
            "translate",
            "--lang=en,cn",
            "--glossary=my-glossaire.csv",
            "--batch-size=100",
            "--model=mistral-small",
            "--provider=mistral",
            "--use-gateway",
            "--ai-json-enc=./config.enc",
            "--ai-cryptoken=secret123",
            "--ai-gateway-token=gw_secret",
            "--force",
            "--prompt-system=Custom system",
            "--prompt-user=Custom user",
        ]);

        let Command::Translate(ref args) = cli.command else {
            panic!("expected translate command");
        };
        assert_eq!(args.lang, "en,cn");
        assert_eq!(args.glossary, PathBuf::from("my-glossaire.csv"));
        assert_eq!(args.batch_size, 100);
        assert_eq!(args.model.as_ref().unwrap(), "mistral-small");
        assert_eq!(args.provider.as_ref().unwrap(), "mistral");
        assert!(args.use_gateway);
        assert_eq!(args.ai_json_enc, PathBuf::from("./config.enc"));
        assert_eq!(args.ai_cryptoken.as_ref().unwrap(), "secret123");
        assert_eq!(args.ai_gateway_token.as_ref().unwrap(), "gw_secret");
        assert!(args.force);
        assert_eq!(args.prompt_system.as_ref().unwrap(), "Custom system");
        assert_eq!(args.prompt_user.as_ref().unwrap(), "Custom user");
        // Check verbose via message_level instead
        assert_eq!(cli.message_level(), crate::output::MessageLevel::Debug);
    }

    #[test]
    fn parses_translate_invalid_language_code() {
        let cli = Cli::parse_from([
            "rencrypt",
            "translate",
            "--lang=xx",
        ]);

        let Command::Translate(args) = cli.command else {
            panic!("expected translate command");
        };
        assert!(args.parse_languages().is_err());
    }

    #[test]
    fn translate_ai_json_enc_keeps_url() {
        let cli = Cli::parse_from([
            "rencrypt",
            "translate",
            "--root=.",
            "--ai-json-enc=https://mcp.fufuni.pp.ua/ai.json.enc",
        ]);

        let Command::Translate(args) = cli.command else {
            panic!("expected translate command");
        };

        assert_eq!(
            args.resolved_ai_json_enc(),
            "https://mcp.fufuni.pp.ua/ai.json.enc"
        );
    }
}
