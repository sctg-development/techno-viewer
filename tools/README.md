# Novasulf Drawing Tools

Tools for extracting, translating, and exporting multilingual DXF technical drawings.

## Overview

The pipeline runs in four sequential steps:

```
drawings-fr/  (source DXF files, French)
      │
      ▼
 extract.py  ──►  glossaire.csv  (French + empty EN/CN columns)
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
  translate_en.py           translate_cn.py
  (fills 'english')         (fills 'chinese', uses FR+EN context)
                       │
                       ▼
                  generate.py  ──►  drawings-en/  drawings-cn/
                       │
                       ▼
                  dxf2pdf.py   ──►  pdf/fr/  pdf/en/  pdf/cn/
```

---

## Prerequisites

```bash
pip install ezdxf matplotlib
```

API keys are stored in `ai.json` (or the encrypted `ai.json.enc`).  
Set `AI_CRYPTOKEN` in your environment to use the encrypted version:

```bash
source .env          # exports AI_CRYPTOKEN
```

`ai.json` structure:

```json
{
  "providers": {
    "mistral": {
      "protocol": "openai",
      "endpoint": "https://api.mistral.ai/v1",
      "keys": [{ "key": "sk-..." }]
    },
    "gemini": {
      "protocol": "gemini",
      "endpoint": "https://generativelanguage.googleapis.com/v1beta",
      "keys": [{ "key": "AIza..." }]
    }
  }
}
```

---
## Encryption utility — `encrypt_files.py`

The legacy shell scripts `tools/encrypt_files.sh` and `tools/gen_filelist.sh` have been replaced by `tools/encrypt_files.py`.

Use this script to encrypt source DXF/PDF files and generate the opaque manifest for the portal:

```bash
python tools/encrypt_files.py          # full run
python tools/encrypt_files.py --help   # show available options
```

Key features:

- encrypts DXF/PDF files under `drawings/` and `doc/`
- writes encrypted outputs to `encrypted/`
- generates `public/files.json`
- encrypts the manifest to `public/files.json.age`
- supports `--skip-encrypt`, `--skip-manifest`, `--keep-plaintext-manifest`, and `--dry-run`

---
## Step 1 — Extract: `extract.py`

Scans every DXF file under `drawings-fr/` and builds `glossaire.csv`.

```bash
python tools/extract.py
```

**What it extracts:**

| Entity type | Where |
|---|---|
| `TEXT` | Direct text entities in layouts and block definitions |
| `MTEXT` | Multi-line text entities (plain text, formatting codes stripped) |
| `ATTRIB` | Attribute values on INSERT entities (e.g. title block fields: part name, author, finish) |
| `ATTDEF` | Attribute definitions inside block templates |

Each string is stored with its **handle** (the DXF entity's stable unique ID) so `generate.py` can locate and replace it exactly, even across multiple files.

Strings that are clearly non-translatable are filtered out (pure numbers, scales like `1:5`, single characters, DXF special codes like `%%P`, thread callouts like `M6`, etc.).

**Output:** `glossaire.csv` with columns:

| Column | Description |
|---|---|
| `string_id` | Stable 8-char MD5 hash of the French text |
| `french` | Source text as found in the DXF |
| `english` | Empty — to be filled by `translate_en.py` or manually |
| `chinese` | Empty — to be filled by `translate_cn.py` or manually |
| `occurrences` | JSON array of `{file, handle, entity_type}` for every instance |

Re-running `extract.py` **overwrites** `glossaire.csv`. Do this only when the source DXF files have changed.

---

## Step 2 — Translate to English: `translate_en.py`

Fills the `english` column for rows where it is empty, using Mistral.

```bash
python tools/translate_en.py
# Force re-translation of all rows and use custom runtime options
python tools/translate_en.py --force --batch-size 25 --provider mistral --model mistral-small-latest
```

**Environment variables (optional):**

| Variable | Default | Description |
|---|---|---|
| `BATCH_SIZE` | `50` | Terms per API call |
| `PROVIDER` | `mistral` | Provider name from `ai.json` |
| `MODEL` | `mistral-medium-latest` | Mistral model ID |

**CLI flags:**

| Flag | Description |
|---|---|
| `--force` | Re-translate rows even if `english` is already filled |
| `--batch-size N` | Override batch size for this run |
| `--provider NAME` | Override provider for this run |
| `--model ID` | Override model for this run |
| `-h`, `--help` | Show command help |

CLI flags override environment defaults for the current execution.

Progress is saved after every batch, so the script can be safely interrupted and resumed. Re-running only processes rows with an empty `english` column.

After the script finishes, **review the CSV** and correct any mistranslations before proceeding.

---

## Step 3 — Translate to Chinese: `translate_cn.py`

Fills the `chinese` column for rows that have a validated English translation but no Chinese yet. Gemini Flash is used; both the French and English texts are sent as context for better quality.

```bash
python tools/translate_cn.py
# Force re-translation of all rows with validated English
python tools/translate_cn.py --force --batch-size 25 --provider gemini --model gemini-3-flash-preview
```

**Environment variables (optional):**

| Variable | Default | Description |
|---|---|---|
| `BATCH_SIZE` | `50` | Terms per API call |
| `PROVIDER` | `gemini` | Provider name from `ai.json` |
| `MODEL` | `gemini-3-flash-preview` | Gemini model ID |

**CLI flags:**

| Flag | Description |
|---|---|
| `--force` | Re-translate rows even if `chinese` is already filled |
| `--batch-size N` | Override batch size for this run |
| `--provider NAME` | Override provider for this run |
| `--model ID` | Override model for this run |
| `-h`, `--help` | Show command help |

CLI flags override environment defaults for the current execution.

Same resume behaviour as `translate_en.py`.

---

## Step 4 — Generate translated DXF files: `generate.py`

Copies one or more source folders to language-specific outputs and replaces text entities in each DXF using the handles stored in `glossaire.csv`.

If no `--path` is supplied, the tool defaults to `drawings/fr`.
Only the directories provided by `--path` are processed.

```bash
python tools/generate.py --path drawings/fr
python tools/generate.py --path drawings/fr --lang en
python tools/generate.py --path drawings/fr --lang en --lang cn --glossary glossaire.csv --cjk-font simsun.ttc
```

**CLI flags:**

| Flag | Description |
|---|---|
| `--path PATH` | DXF source directory to process. Repeatable. |
| `--lang xx` | Target language to generate. Repeatable; supported values: `en`, `cn`. |
| `--root DIR` | Project root directory for resolving relative paths. Default: script parent directory. |
| `--glossary FILE` | Glossary CSV path. Default: `glossaire.csv` in the project root. |
| `--cjk-font FILE` | CJK font path or name used for Chinese output. Default: `simsun.ttc`. |
| `-h`, `--help` | Show command help. |

**Chinese font:** every text style in Chinese output is set to the configured CJK font (default `simsun.ttc`). This ensures both CJK characters and untranslated Latin strings (reference codes, numbers) render correctly in AutoCAD without needing a bigfont.

Rows with an empty target column are skipped — that text is left in French.

---

## Step 5 — Export to PDF: `dxf2pdf.py`

Renders every layout of every DXF file to a multi-page PDF, one page per layout sheet (Model space is skipped if empty).

```bash
python tools/dxf2pdf.py           # all languages found
python tools/dxf2pdf.py fr        # French only
python tools/dxf2pdf.py en cn     # English and Chinese
```

Output mirrors the source folder structure under `pdf/{lang}/`.

---

## `ai_client.py`

Shared library used by the translation scripts. Handles:

- Loading `ai.json` / decrypting `ai.json.enc` with OpenSSL AES-256-CBC
- Round-robin API key rotation across multiple keys per provider
- Automatic retry with exponential back-off on HTTP 429 (rate limit)
- Protocols: Gemini native, OpenAI-compatible (Mistral, Groq, OpenRouter)
- `parse_json_array()` — robust JSON array parser that tolerates markdown fences and literal newlines inside string values (a common model output defect)

---

## Typical full workflow

```bash
# 1. Extract strings from the French DXF files
python tools/extract.py

# 2. Auto-translate to English (review glossaire.csv afterwards)
python tools/translate_en.py

# 3. Auto-translate to Chinese (uses the reviewed English as context)
python tools/translate_cn.py

# 4. Generate translated DXF files
python tools/generate.py

# 5. Export all languages to PDF
python tools/dxf2pdf.py
```

---

## Glossary file tips

- **Delete rows** for strings that should never be translated (product codes, proper names you want to keep in French, etc.).
- **Edit translations directly** in the CSV for any corrections before running `generate.py`.
- The `occurrences` column is used exclusively by `generate.py`; do not edit it.
- `string_id` is a hash of the French text — if you change the `french` column, the ID becomes stale.
