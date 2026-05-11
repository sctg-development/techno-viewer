// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
use anyhow::Context;
use clap::Parser;
use rencrypt::{
    cli::{Cli, Command},
    extract,
    keys, manifest, translate,
};

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let message_level = cli.message_level();

    match cli.command {
        Command::GenerateKeys(args) => {
            let dirs = args.directories();
            let generated = keys::write_key_pairs(&dirs, args.count)?;
            if message_level.allows_info() {
                println!(
                    "generated {} AGE key pair(s) in {} and {}",
                    generated.len(),
                    dirs.public.display(),
                    dirs.private.display()
                );
            }
        }
        Command::Encrypt(args) => {
            let options = args.to_options(message_level);
            let summary = manifest::run_encrypt(&options).context("encryption run failed")?;
            if message_level.allows_info() {
                println!(
                    "processed {} source file(s), encrypted {} new file(s)",
                    summary.discovered_files, summary.encrypted_files
                );
            }
        }
        Command::Extract(args) => {
            let options = args.to_options();
            let summary = extract::run_extract(&options).context("extract run failed")?;
            if message_level.allows_info() {
                println!(
                    "processed {} DXF file(s), extracted {} unique strings",
                    summary.scanned_files, summary.unique_strings
                );
            }
            for warning in summary.warnings {
                eprintln!("warning: {warning}");
            }
        }
        Command::Decrypt(args) => {
            let options = args.to_options(message_level);
            let summary = manifest::run_decrypt(&options).context("decryption run failed")?;
            if message_level.allows_info() {
                println!(
                    "decrypted {} of {} manifest file(s)",
                    summary.decrypted_files, summary.manifest_files
                );
            }
        }
        Command::Translate(args) => {
            let languages = args.parse_languages().context("invalid language code")?;
            let glossary_path = if args.glossary.is_absolute() {
                args.glossary.clone()
            } else {
                args.root.join(&args.glossary)
            };
            let ai_json_enc = args.resolved_ai_json_enc();

            for lang in languages {
                let mut config = translate::TranslateConfig::default();
                config.language = lang;
                config.model = lang.default_model().to_string();
                config.provider = lang.default_provider().to_string();
                config.batch_size = args.batch_size;
                config.use_gateway = args.use_gateway;
                config.ai_json_enc = ai_json_enc.clone();
                config.ai_cryptoken = args.ai_cryptoken.clone();
                config.ai_gateway_token = args.ai_gateway_token.clone();
                config.verbose = message_level.allows_debug();
                config.force = args.force;
                config.prompt_system = args.prompt_system.clone();
                config.prompt_user = args.prompt_user.clone();

                if let Some(ref model) = args.model {
                    config.model = model.clone();
                }
                if let Some(ref provider) = args.provider {
                    config.provider = provider.clone();
                }

                if message_level.allows_info() {
                    println!("Translating to {}...", lang.display_name());
                }

                let summary = translate::run_translate(&glossary_path, &config)
                    .context(format!("translation to {} failed", lang.code()))?;

                if message_level.allows_info() {
                    println!(
                        "  {} translated, {} failed",
                        summary.translated, summary.failed
                    );
                }
            }
        }
    }

    Ok(())
}
