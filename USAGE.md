# Usage Instructions

## Build rencrypt (Rust tool)

```bash
cd rencrypt && cargo build --release
cd ..
```

## Generate key pairs

```bash
# Generate 5 test key pairs
rencrypt/target/release/rencrypt -v generate-keys --keys=keys --count=5
```

## Encrypt source trees

```bash
# Encrypt drawings, schematics, doc, and source code
cd rencrypt && cargo build --release && cd ..
rencrypt/target/release/rencrypt encrypt \
  --path drawings/ \
  --path schematics/ \
  --path doc/ \
  --path agro-crypt/ \
  --keep-plaintext-manifest -v
```

## Extract DXF strings to glossary

```bash
# Extract from drawings and schematics (Rust tool)
cd rencrypt && cargo build --release && cd ..
rencrypt/target/release/rencrypt extract \
  --root $(pwd) \
  --path drawings/en \
  --path schematics/en \
  --glossary glossaire.csv

# Extract strings using Python tool
python tools/extract.py --root $(pwd) --path drawings/en --glossary glossaire.csv
```

## Translate glossary with AI

```bash
# Translate to English and Chinese via rencrypt
rencrypt/target/release/rencrypt translate \
  --lang=en,cn \
  --ai-json-enc https://your-ai-config-host/ai.json.enc \
  --ai-cryptoken YOUR_CRYPT_TOKEN \
  --ai-gateway-token YOUR_GATEWAY_TOKEN

# Translate using Python tools
python tools/translate_en.py \
  --ai-json-enc https://your-ai-config-host/ai.json.enc \
  --ai-cryptoken YOUR_CRYPT_TOKEN
```

## Generate translated DXF files

```bash
python tools/generate.py \
  --root $(pwd) \
  --path schematics/fr \
  --glossary glossaire.csv \
  --lang en --lang cn
```

## Convert DXF to PDF

```bash
python tools/dxf2pdf.py --root $(pwd) --path schematics --lang en --lang fr
```
