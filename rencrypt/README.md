# rencrypt

`rencrypt` replaces the previous key generation and file encryption scripts with
a pure Rust AGE v1 tool.

## Examples

Generate 100 key pairs:

```sh
rencrypt -v generate-keys --keys=keys --count=100
```

Encrypt several source trees:

```sh
rencrypt encrypt \
  --path=./doc \
  --path=./drawings \
  --path="./062.305-3.01 NOVASULF_DUAL_MBUS_STD_MAINT_AUTOCHIM"
```

Extract translatable DXF strings into a shared glossary CSV:

```sh
rencrypt extract \
  --root=/path/to/project \
  --path=drawings/fr \
  --path=drawings/en \
  --glossary=glossaire.csv
```

This command scans one or more DXF source directories, merges all discovered
strings into the same glossary, and preserves existing English/Chinese
translations.

Translate glossary entries to multiple languages using AI:

```sh
rencrypt translate \
  --lang=en,cn,es,pt,de,it \
  --use-gateway \
  --ai-json-enc https://mcp.fufuni.pp.ua/ai.json.enc \
  --ai-cryptoken "your_encryption_token" \
  --ai-gateway-token "your_gateway_token"
```

Supported language codes: `en` (English), `cn` (Simplified Chinese), `es` (Spanish),
`pt` (Portuguese), `de` (German), `it` (Italian). If `--lang` is omitted, defaults to `en`.

Additional translation options:

```sh
rencrypt translate \
  --lang=en \
  --glossary=glossaire.csv \
  --batch-size=50 \
  --model=mistral-medium-latest \
  --provider=mistral \
  --force \
  --prompt-system "custom system prompt" \
  --prompt-user "custom user prompt" \
  --verbose
```

Decrypt the manifest and restore files under a plaintext directory:

```sh
rencrypt -v decrypt --keys=keys --decrypted-dir=decrypted
```

Use separate key directories:

```sh
rencrypt encrypt --path=./doc --keys-public=shared/public
rencrypt generate-keys --keys-private=secrets/private --keys-public=shared/public --count=25
```

Control successful command output:

```sh
rencrypt encrypt --path=./doc
rencrypt -v encrypt --path=./doc
rencrypt -vv encrypt --path=./doc
rencrypt -vvv encrypt --path=./doc
rencrypt --verbose=INFO encrypt --path=./doc
rencrypt --verbose=DEBUG encrypt --path=./doc
rencrypt --verbose=ALL encrypt --path=./doc
```

The default level is quiet and only errors are printed. `-v` maps to `INFO`,
`-vv` maps to `DEBUG`, and `-vvv` maps to `ALL`.

Encrypted files are written to `encrypted/<sha256>.age`. The plaintext manifest
is written to `public/files.json`, encrypted to `public/files.json.age`, then
removed unless `--keep-plaintext-manifest` is set.
