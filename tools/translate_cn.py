# Copyright (c) Ronan Le Meillat - SCTG Development 2008-2026
# Licensed under the MIT License
# 
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# 
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
# 
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
"""
Translate validated FR+EN pairs in glossaire.csv to Simplified Chinese
using Gemini Flash.

Only processes rows where:
  - 'english' column is non-empty  (validated by user)
  - 'chinese' column is empty

The bilingual context (FR + EN) improves translation quality for
technical terms.

Usage:
    cd /path/to/project
    source .env           # sets AI_CRYPTOKEN
    python tools/translate_cn.py

Optional env vars:
    BATCH_SIZE   terms per API call  (default 50 — Chinese output is longer)
    MODEL        Gemini model id     (default gemini-3-flash-preview)
"""

import argparse
import csv
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ai_client import AIClient  # noqa: E402

PROJECT_ROOT = Path(__file__).parent.parent
GLOSSARY_PATH = PROJECT_ROOT / "glossaire.csv"

BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "50"))
MODEL = os.environ.get("MODEL", "gemini-3-flash-preview")
PROVIDER = os.environ.get("PROVIDER", "gemini")

SYSTEM_PROMPT = (
    "You are a technical translator specialising in mechanical and electronical engineering "
    "and technical drawings. Translate the given terms into Simplified Chinese "
    "(Mandarin, Simplified script). Both French and English are provided for "
    "context and disambiguation. Preserve punctuation marks like ':' and '.' "
    "where appropriate. DXF special character codes (%%C for Ø, %%P for ±, %%D for °) "
    "and Unicode symbols (Ø, ±, °) must be preserved exactly as-is. "
    "NOVASULF is a proper noun and should be translated as INDUSTRIAL-ANALYZER. "
    "BRISTOL MECI is a proper noun and should be translated as ISMO Group. "
    "INNOV ANALYSIS SYSTEMS is a proper noun and should be translated as ISMO Group. "
    "JLB is a proper noun and should be translated as RLM. "
    "Return ONLY a valid JSON array of strings — "
    "no prose, no markdown fences."
)


def build_user_prompt(pairs: list[tuple[str, str]]) -> str:
    """pairs: list of (french, english)"""
    numbered = "\n".join(
        f'{i + 1}. FR: "{fr}" | EN: "{en}"' for i, (fr, en) in enumerate(pairs)
    )
    return (
        f"Translate these {len(pairs)} technical drawing terms to Simplified Chinese.\n"
        f"Return ONLY a JSON array of exactly {len(pairs)} strings in the same order.\n\n"
        f"{numbered}"
    )


def translate_batch(
    client: AIClient,
    pairs: list[tuple[str, str]],
    provider: str,
    model: str,
    use_gateway: bool,
) -> list[str]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(pairs)},
    ]
    response = client.chat(provider, model, messages, use_gateway=use_gateway)
    translations = AIClient.parse_json_array(response)
    if len(translations) != len(pairs):
        raise ValueError(
            f"Expected {len(pairs)} translations, got {len(translations)}.\n"
            f"Response was:\n{response[:400]}"
        )
    return translations


def load_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_csv(path: Path, rows: list[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["string_id", "french", "english", "chinese", "occurrences"],
            quoting=csv.QUOTE_ALL,
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Translate FR+EN pairs in glossaire.csv to Simplified Chinese."
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-translate rows that already have a Chinese translation.",
    )
    parser.add_argument(
        "--batch-size", type=int, default=BATCH_SIZE, metavar="N",
        help=f"Number of terms per API call (default: {BATCH_SIZE}).",
    )
    parser.add_argument(
        "--model", default=MODEL,
        help=f"Model ID to use (default: {MODEL}).",
    )
    parser.add_argument(
        "--provider", default=PROVIDER,
        help=f"Provider name to use (default: {PROVIDER}).",
    )
    parser.add_argument(
        "--use-gateway", action="store_true",
        help="Route requests through provider gatewayEndpoint/gatewayModelPrefix/gatewayKey.",
    )
    parser.add_argument(
        "--ai-json-enc", default="./ai.json.enc",
        help="Path or URL to ai.json.enc (default: ./ai.json.enc).",
    )
    parser.add_argument(
        "--ai-cryptoken", default=None,
        help="AI_CRYPTOKEN value to use for decrypting ai.json.enc.",
    )
    parser.add_argument(
        "--ai-gateway-token", default=None,
        help="Token to use instead of gatewayKey when --use-gateway is enabled.",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Enable verbose API request/response debugging.",
    )
    args = parser.parse_args()
    batch_size = args.batch_size
    model = args.model
    provider = args.provider
    use_gateway = args.use_gateway

    if not GLOSSARY_PATH.exists():
        print(f"glossaire.csv not found at {GLOSSARY_PATH}", file=sys.stderr)
        print("Run tools/extract.py then tools/translate_en.py first.", file=sys.stderr)
        sys.exit(1)

    rows = load_csv(GLOSSARY_PATH)

    # Only rows with validated English (and missing Chinese, unless --force)
    if args.force:
        pending = [r for r in rows if r["english"].strip()]
    else:
        pending = [
            r for r in rows
            if r["english"].strip() and not r["chinese"].strip()
        ]

    skipped_no_en = sum(1 for r in rows if not r["english"].strip())
    if skipped_no_en:
        print(
            f"Note: {skipped_no_en} rows skipped (no English — "
            "validate or delete them first)."
        )

    if not pending:
        print("All eligible rows already have Chinese translations. Nothing to do.")
        return

    print(
        f"{len(pending)} rows need Chinese translation "
        f"(batch size: {batch_size}, model: {provider}/{model}, gateway: {'on' if use_gateway else 'off'})"
    )

    client = AIClient(
        config_path=args.ai_json_enc,
        cryptoken=args.ai_cryptoken,
        gateway_token=args.ai_gateway_token,
        verbose=args.verbose,
    )
    index = {r["string_id"]: r for r in rows}

    translated_total = 0
    failed_total = 0

    for batch_start in range(0, len(pending), batch_size):
        batch = pending[batch_start : batch_start + batch_size]
        pairs = [(r["french"], r["english"]) for r in batch]

        print(
            f"  Batch {batch_start // batch_size + 1} "
            f"({batch_start + 1}–{batch_start + len(batch)}/{len(pending)}) … ",
            end="",
            flush=True,
        )

        try:
            translations = translate_batch(
                client, pairs, provider, model, use_gateway
            )
            for row, translation in zip(batch, translations):
                index[row["string_id"]]["chinese"] = translation.strip()
            print(f"OK  ({len(translations)} translations)")
            translated_total += len(translations)
        except Exception as exc:
            print(f"FAILED: {exc}")
            failed_total += len(batch)

        save_csv(GLOSSARY_PATH, list(index.values()))

    print(
        f"\nDone. {translated_total} translated, {failed_total} failed. "
        f"Saved to {GLOSSARY_PATH.name}"
    )
    if failed_total:
        print("Re-run the script to retry failed batches.")


if __name__ == "__main__":
    main()
