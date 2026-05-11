// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
use assert_cmd::Command;
use rencrypt::{
    age_crypto::decrypt_bytes, code_index::CodeIndex, keys::load_private_identities,
    manifest::Manifest,
};
use std::fs;

#[test]
fn manifest_uses_legacy_doc_and_drawings_roots_without_extra_levels() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("doc/en")).unwrap();
    fs::create_dir_all(root.join("drawings/cn/plate")).unwrap();
    fs::write(root.join("doc/en/manual.pdf"), b"manual").unwrap();
    fs::write(root.join("drawings/cn/plate/part.dxf"), b"0\nSECTION\n").unwrap();

    generate_keys(root);
    encrypt_keep_manifest(root, &["doc", "drawings"]);

    let manifest = read_manifest(root);

    assert_eq!(manifest.tree[0].id, "drawings-zh");
    assert_eq!(manifest.tree[0].name, "Drawings (CN)");
    assert_eq!(manifest.tree[0].children[0].name, "plate");
    assert_eq!(manifest.tree[1].id, "doc-en");
    assert_eq!(manifest.tree[1].name, "Documentation (EN)");
    assert_eq!(manifest.tree[1].children[0].name, "manual.pdf");
    assert!(!manifest.tree.iter().any(|node| node.id == "doc"));
    assert!(!manifest.tree.iter().any(|node| node.id == "drawings"));
}

#[test]
fn manifest_maps_encrypted_code_index_chunks() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/lib.rs"),
        "pub const LIMIT: usize = 4;\npub struct Pump;\npub fn calibrate_sensor() {}\n",
    )
    .unwrap();

    generate_keys(root);
    encrypt_keep_manifest(root, &["src"]);

    let manifest = read_manifest(root);
    assert!(manifest.code_indexes.contains_key("index_ca.json"));
    assert!(manifest.code_indexes.contains_key("index_li.json"));
    assert!(manifest.code_indexes.contains_key("index_pu.json"));

    let identities = load_private_identities(&root.join("keys/private")).unwrap();
    let encrypted_path = root.join(manifest.code_indexes["index_ca.json"].as_str());
    let encrypted_chunk = fs::read(encrypted_path).unwrap();
    let plaintext = decrypt_bytes(&encrypted_chunk, &identities).unwrap();
    let index: CodeIndex = serde_json::from_slice(&plaintext).unwrap();

    let locations = index.symbols.get("calibrate_sensor").unwrap();
    assert_eq!(locations[0].original_path, "src/lib.rs");
    assert_eq!(locations[0].file_hash.len(), 64);
    assert_eq!(locations[0].line, 3);
}

#[test]
fn keep_plaintext_index_writes_plaintext_index_chunks() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/lib.rs"),
        "pub const LIMIT: usize = 4;\npub struct Pump;\npub fn calibrate_sensor() {}\n",
    )
    .unwrap();

    generate_keys(root);

    Command::cargo_bin("rencrypt")
        .unwrap()
        .args([
            "encrypt",
            "--root",
            root.to_str().unwrap(),
            "--path",
            "src",
            "--keys",
            "keys",
            "--keep-plaintext-manifest",
            "--keep-plaintext-index",
        ])
        .assert()
        .success();

    assert!(root.join("public/index_ca.json").exists());
    assert!(root.join("public/index_li.json").exists());
    assert!(root.join("public/index_pu.json").exists());
}

fn generate_keys(root: &std::path::Path) {
    Command::cargo_bin("rencrypt")
        .unwrap()
        .args([
            "generate-keys",
            "--keys",
            root.join("keys").to_str().unwrap(),
            "--count",
            "1",
        ])
        .assert()
        .success();
}

fn encrypt_keep_manifest(root: &std::path::Path, paths: &[&str]) {
    let mut args = vec![
        "encrypt".to_owned(),
        "--root".to_owned(),
        root.to_str().unwrap().to_owned(),
        "--keys".to_owned(),
        "keys".to_owned(),
        "--keep-plaintext-manifest".to_owned(),
    ];
    for path in paths {
        args.push("--path".to_owned());
        args.push((*path).to_owned());
    }

    Command::cargo_bin("rencrypt")
        .unwrap()
        .args(args)
        .assert()
        .success();
}

fn read_manifest(root: &std::path::Path) -> Manifest {
    let json = fs::read(root.join("public/files.json")).unwrap();
    serde_json::from_slice(&json).unwrap()
}
