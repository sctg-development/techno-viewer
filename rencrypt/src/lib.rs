// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
//! Pure Rust AGE key generation and file tree encryption.
//!
//! The crate keeps encrypted payloads in a flat directory named from their
//! SHA-256 digest, then writes a manifest that preserves the original names and
//! hierarchy for authorized clients.

pub mod age_crypto;
pub mod cli;
pub mod code_index;
pub mod extract;
pub mod file_tree;
pub mod hash;
pub mod keys;
pub mod manifest;
pub mod output;
pub mod translate;

pub use cli::{Cli, Command};
