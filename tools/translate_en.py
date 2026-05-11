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
Translate French strings in glossaire.csv to English using Mistral.

Reads rows where the 'english' column is empty and fills them in batches.
Saves progress after every batch so the script can be safely interrupted
and resumed.

Usage:
    cd /path/to/project
    source .env           # sets AI_CRYPTOKEN
    python tools/translate_en.py

Optional arguments (edit constants below or pass via env):
    BATCH_SIZE   number of terms per API call  (default 50)
    MODEL        Mistral model id              (default mistral-medium-latest)
"""

import argparse
import csv
import os
import sys
from pathlib import Path

# Make sure the tools/ directory is on the path so ai_client is importable
sys.path.insert(0, str(Path(__file__).parent))
from ai_client import AIClient  # noqa: E402

PROJECT_ROOT = Path(__file__).parent.parent
GLOSSARY_PATH = PROJECT_ROOT / "glossaire.csv"

BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "50"))
MODEL = os.environ.get("MODEL", "mistral-medium-latest")
PROVIDER = os.environ.get("PROVIDER", "mistral")

SYSTEM_PROMPT = (
    "You are a technical translator specialising in mechanical and electronical engineering "
    "and technical drawings. Translate French terms to English, preserving "
    "abbreviations, punctuation, and capitalisation style of the original. "
    "DXF special character codes (%%C for Ø, %%P for ±, %%D for °) and "
    "Unicode symbols (Ø, ±, °) must be preserved exactly as-is. "
    "Try to keep the same number or less characters if possible, but accuracy is more important than brevity. "
    "NOVASULF is a proper noun and should be translated as INDUSTRIAL-ANALYZER. "
    "BRISTOL MECI is a proper noun and should be translated as ISMO Group. "
    "INNOV ANALYSIS SYSTEMS is a proper noun and should be translated as ISMO Group. "
    "JLB is a proper noun and should be translated as RLM. "
    "Each translation MUST be on a single line with no line breaks. "
    "Return ONLY a valid JSON array of strings — no prose, no markdown fences."
)


def build_user_prompt(terms: list[str]) -> str:
    numbered = "\n".join(f'{i + 1}. "{t}"' for i, t in enumerate(terms))
    return (
        f"Translate these {len(terms)} French technical drawing terms to English.\n"
        f"Return ONLY a JSON array of exactly {len(terms)} strings in the same order.\n\n"
        f"{numbered}"
    )


def translate_batch(
    client: AIClient,
    terms: list[str],
    provider: str,
    model: str,
    use_gateway: bool,
) -> list[str]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(terms)},
    ]
    response = client.chat(provider, model, messages, use_gateway=use_gateway)
    translations = AIClient.parse_json_array(response)
    if len(translations) != len(terms):
        raise ValueError(
            f"Expected {len(terms)} translations, got {len(translations)}.\n"
            f"Response was:\n{response[:400]}"
        )
    return translations


def translate_with_split(
    client: AIClient,
    terms: list[str],
    provider: str,
    model: str,
    use_gateway: bool,
) -> list[str]:
    """Translate terms, recursively splitting in half on count-mismatch failures."""
    try:
        return translate_batch(client, terms, provider, model, use_gateway)
    except ValueError:
        if len(terms) == 1:
            raise
        mid = len(terms) // 2
        left = translate_with_split(client, terms[:mid], provider, model, use_gateway)
        right = translate_with_split(client, terms[mid:], provider, model, use_gateway)
        return left + right


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
        description="Translate French strings in glossaire.csv to English."
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-translate rows that already have an English translation.",
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
        print("Run tools/extract.py first.", file=sys.stderr)
        sys.exit(1)

    rows = load_csv(GLOSSARY_PATH)
    pending = rows if args.force else [r for r in rows if not r["english"].strip()]

    if not pending:
        print("All rows already have English translations. Nothing to do.")
        return

    print(
        f"{len(pending)} rows need English translation "
        f"(batch size: {batch_size}, model: {provider}/{model}, gateway: {'on' if use_gateway else 'off'})"
    )

    client = AIClient(
        config_path=args.ai_json_enc,
        cryptoken=args.ai_cryptoken,
        gateway_token=args.ai_gateway_token,
        verbose=args.verbose,
    )

    # Build index for fast update: string_id -> row
    index = {r["string_id"]: r for r in rows}

    translated_total = 0
    failed_total = 0

    for batch_start in range(0, len(pending), batch_size):
        batch = pending[batch_start : batch_start + batch_size]
        terms = [r["french"] for r in batch]

        print(
            f"  Batch {batch_start // batch_size + 1} "
            f"({batch_start + 1}–{batch_start + len(batch)}/{len(pending)}) … ",
            end="",
            flush=True,
        )

        try:
            translations = translate_with_split(
                client, terms, provider, model, use_gateway
            )
            for row, translation in zip(batch, translations):
                index[row["string_id"]]["english"] = translation.strip()
            print(f"OK  ({len(translations)} translations)")
            translated_total += len(translations)
        except Exception as exc:
            print(f"FAILED: {exc}")
            failed_total += len(batch)

        # Save after every batch to preserve progress
        save_csv(GLOSSARY_PATH, list(index.values()))

    print(
        f"\nDone. {translated_total} translated, {failed_total} failed. "
        f"Saved to {GLOSSARY_PATH.name}"
    )
    if failed_total:
        print("Re-run the script to retry failed batches.")


if __name__ == "__main__":
    main()
