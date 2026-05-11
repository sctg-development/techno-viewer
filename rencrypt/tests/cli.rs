// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;

#[test]
fn generate_keys_command_writes_public_and_private_files() {
    let temp = tempfile::tempdir().unwrap();

    Command::cargo_bin("rencrypt")
        .unwrap()
        .args([
            "-v",
            "generate-keys",
            "--keys",
            temp.path().join("keys").to_str().unwrap(),
            "--count",
            "2",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("generated 2 AGE key pair"));

    assert!(temp.path().join("keys/private/user001.key").exists());
    assert!(temp.path().join("keys/public/user001.pub").exists());
    assert!(temp.path().join("keys/private/user002.key").exists());
    assert!(temp.path().join("keys/public/user002.pub").exists());
}

#[test]
fn encrypt_command_writes_flat_encrypted_files_and_manifest_age() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("doc/en")).unwrap();
    fs::write(root.join("doc/en/manual.pdf"), b"manual").unwrap();

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

    Command::cargo_bin("rencrypt")
        .unwrap()
        .args([
            "-v",
            "encrypt",
            "--root",
            root.to_str().unwrap(),
            "--path",
            "doc",
            "--keys",
            "keys",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("processed 1 source file"));

    let encrypted_entries = fs::read_dir(root.join("encrypted"))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(encrypted_entries.len(), 1);
    assert!(root.join("public/files.json.age").exists());
    assert!(!root.join("public/files.json").exists());
}

#[test]
fn decrypt_command_restores_manifest_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("doc/en")).unwrap();
    fs::write(root.join("doc/en/manual.pdf"), b"manual").unwrap();

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
        .success()
        .stdout(predicate::str::is_empty());

    Command::cargo_bin("rencrypt")
        .unwrap()
        .args([
            "encrypt",
            "--root",
            root.to_str().unwrap(),
            "--path",
            "doc",
            "--keys",
            "keys",
        ])
        .assert()
        .success()
        .stdout(predicate::str::is_empty());

    Command::cargo_bin("rencrypt")
        .unwrap()
        .args([
            "-v",
            "decrypt",
            "--root",
            root.to_str().unwrap(),
            "--keys",
            "keys",
            "--decrypted-dir",
            "plain",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("decrypted 1 of 1 manifest file"));

    assert_eq!(
        fs::read(root.join("plain/doc/en/manual.pdf")).unwrap(),
        b"manual"
    );
}

#[test]
fn extract_command_writes_a_glossary_csv() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let source = root.join("drawings/fr");
    fs::create_dir_all(&source).unwrap();
    fs::write(
        source.join("hello.dxf"),
        "0\nSECTION\n2\nENTITIES\n0\nTEXT\n1\nHello world\n0\nENDSEC\n0\nEOF\n",
    )
    .unwrap();

    Command::cargo_bin("rencrypt")
        .unwrap()
        .args([
            "extract",
            "--root",
            root.to_str().unwrap(),
            "--path",
            "drawings/fr",
            "--glossary",
            "glossaire.csv",
        ])
        .assert()
        .success();

    let glossary = fs::read_to_string(root.join("glossaire.csv")).unwrap();
    assert!(glossary.contains("Hello world"));
}
