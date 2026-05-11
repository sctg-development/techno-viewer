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
Extract all translatable text strings from DXF files in drawings-fr/.

Scans:
  - All layouts (modelspace + paper space layouts like "Cartouche ISO A3")
  - All named block definitions (excluding *-prefix internal AutoCAD blocks)

Entity types extracted:
  - TEXT   : entity.dxf.text
  - MTEXT  : entity.plain_text()  (plain text, format codes stripped for glossary)
  - ATTRIB : entity.dxf.text  (attribute values attached to INSERT entities in layouts)
  - ATTDEF : entity.dxf.text  (attribute definitions inside block definitions)

Deduplicates by exact string content (case-sensitive).
Filters obvious non-translatable tokens (single chars, pure numbers, dates, scales…).
User should review the CSV and delete rows that must remain unchanged.

Output: glossaire.csv at project root with columns:
  string_id, french, english, chinese, occurrences

  occurrences is a JSON list of:
    {"file": "drawings/fr/...", "handle": "3E0", "entity_type": "TEXT"}
"""

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import ezdxf
from ezdxf.lldxf.const import DXFAttributeError

PROJECT_ROOT = Path(__file__).parent.parent
DEFAULT_SOURCE_DIR = PROJECT_ROOT / "drawings" / "fr"
DEFAULT_GLOSSARY_PATH = PROJECT_ROOT / "glossaire.csv"

# ------------------------------------------------------------------
# Filter helpers
# ------------------------------------------------------------------

_SKIP_EXACT = {
    "XXX", "X", "0", "00", "1/1", "1:1", "2:1", "1:2", "1:5", "1:10",
    "Ra", "ISO", "DIN", "NF", "EN",
}

_SKIP_PATTERNS = [
    re.compile(r"^\s*$"),                       # empty / whitespace
    re.compile(r"^[\d.,\s±°'\"]+$"),            # purely numeric / symbols
    re.compile(r"^\d+/\d+$"),                   # fraction  1/1  3/4
    re.compile(r"^\d+:\d+$"),                   # scale     1:1  2:1
    re.compile(r"^\d+/\d+/\d+$"),              # date      00/00/00
    re.compile(r"^[A-F\d]{1,2}$"),             # grid ref  A  B  3  4F
    re.compile(r"^%%[CPDcpd]$"),               # standalone DXF code only
    re.compile(r"^M\d"),                        # thread    M5
    re.compile(r"^R\d"),                        # radius    R10
    re.compile(r"^\d+[xX×]\d+$"),              # dimension only  10x20
]


def _should_skip(text: str) -> bool:
    s = text.strip()
    if len(s) <= 1:
        return True
    if s in _SKIP_EXACT:
        return True
    for pat in _SKIP_PATTERNS:
        if pat.match(s):
            return True
    return False


def _string_id(text: str) -> str:
    """Stable 8-char hex ID based on MD5 of the text."""
    return hashlib.md5(text.strip().encode("utf-8")).hexdigest()[:8]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract translatable strings from DXF files and merge them into a glossary CSV. "
            "Use --path multiple times to scan multiple source directories with the same glossary."
        )
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=PROJECT_ROOT,
        help="Project root directory (default: script parent directory)."
    )
    parser.add_argument(
        "--path",
        action="append",
        dest="paths",
        default=[],
        help="DXF source directory to scan. Repeatable; uses the same glossary."
    )
    parser.add_argument(
        "--glossary",
        type=Path,
        default=DEFAULT_GLOSSARY_PATH,
        help="Glossary CSV path (default: glossaire.csv in project root)."
    )

    args = parser.parse_args()
    args.root = args.root.expanduser().resolve()

    if not args.paths:
        args.paths = [args.root / "drawings" / "fr"]
    else:
        normalized_paths: list[Path] = []
        for path in args.paths:
            path_obj = Path(path)
            if not path_obj.is_absolute():
                path_obj = args.root / path_obj
            normalized_paths.append(path_obj.expanduser().resolve())
        args.paths = normalized_paths

    if not args.glossary.is_absolute():
        args.glossary = args.root / args.glossary
    args.glossary = args.glossary.expanduser()

    return args


# ------------------------------------------------------------------
# Extraction helpers
# ------------------------------------------------------------------

def _get_text(entity) -> str | None:
    """Return the display text of a TEXT, MTEXT, ATTDEF or ATTRIB entity, or None to skip."""
    try:
        dtype = entity.dxftype()
        if dtype == "TEXT":
            return entity.dxf.text
        elif dtype == "MTEXT":
            return entity.plain_text()
        elif dtype in ("ATTDEF", "ATTRIB"):
            return entity.dxf.text
    except DXFAttributeError:
        return None
    return None


def _add_occurrence(
    strings: dict,
    text: str,
    rel_file: str,
    handle: str,
    entity_type: str,
) -> None:
    key = text.strip()
    if key not in strings:
        strings[key] = {
            "string_id": _string_id(key),
            "occurrences": [],
        }
    strings[key]["occurrences"].append(
        {"file": rel_file, "handle": handle, "entity_type": entity_type}
    )


# ------------------------------------------------------------------
# Main extraction
# ------------------------------------------------------------------

def extract(source_dirs: list[Path], glossary_path: Path, project_root: Path) -> None:
    dxf_files = []
    seen_files = set()
    for source_dir in source_dirs:
        if not source_dir.exists():
            print(f"Warning: source directory not found: {source_dir}", file=sys.stderr)
            continue
        for dxf_path in sorted(source_dir.rglob("*.dxf")):
            if dxf_path not in seen_files:
                seen_files.add(dxf_path)
                dxf_files.append(dxf_path)

    if not dxf_files:
        source_list = ", ".join(str(path) for path in source_dirs)
        print(f"No DXF files found under {source_list}", file=sys.stderr)
        sys.exit(1)

    source_list = ", ".join(str(path) for path in source_dirs)
    print(f"Found {len(dxf_files)} DXF files under {source_list}")

    strings: dict[str, dict] = {}
    errors: list[str] = []

    for dxf_path in dxf_files:
        try:
            rel = str(dxf_path.relative_to(project_root))
        except ValueError:
            rel = str(dxf_path)
        print(f"  Scanning {rel} …", end="", flush=True)

        try:
            doc = ezdxf.readfile(str(dxf_path))
        except Exception as exc:
            print(f" ERROR: {exc}")
            errors.append(f"{rel}: {exc}")
            continue

        count = 0

        # 1. Scan all layouts (model space + paper space layouts)
        #    TEXT and MTEXT are direct entities in the layout space.
        #    ATTRIB entities are NOT returned by layout.query() — they are children
        #    of INSERT entities and must be accessed via insert.attribs.
        for layout in doc.layouts:
            for entity in layout.query("TEXT MTEXT"):
                text = _get_text(entity)
                if text is None or _should_skip(text):
                    continue
                _add_occurrence(strings, text, rel, entity.dxf.handle, entity.dxftype())
                count += 1
            # Scan ATTRIB values attached to INSERT entities (e.g. title block fields)
            for insert in layout.query("INSERT"):
                try:
                    for attrib in insert.attribs:
                        text = attrib.dxf.text
                        if text is None or _should_skip(text):
                            continue
                        _add_occurrence(strings, text, rel, attrib.dxf.handle, "ATTRIB")
                        count += 1
                except Exception:
                    pass

        # 2. Scan block definitions
        #    Skip structural AutoCAD space blocks (*Model_Space, *Paper_Space*).
        #    Anonymous content blocks (*T…, *D…, *U…) contain real text and must be scanned.
        #    ATTDEF entities are attribute template definitions inside block templates.
        for block in doc.blocks:
            name = block.name
            if name == "*Model_Space" or name.startswith("*Paper_Space"):
                continue
            for entity in block.query("TEXT MTEXT ATTDEF"):
                text = _get_text(entity)
                if text is None or _should_skip(text):
                    continue
                _add_occurrence(strings, text, rel, entity.dxf.handle, entity.dxftype())
                count += 1
            # Scan ATTRIB via INSERT.attribs inside block definitions
            for insert in block.query("INSERT"):
                try:
                    for attrib in insert.attribs:
                        text = attrib.dxf.text
                        if text is None or _should_skip(text):
                            continue
                        _add_occurrence(strings, text, rel, attrib.dxf.handle, "ATTRIB")
                        count += 1
                except Exception:
                    pass

        # 3. Structural strings: layout tab names, plot-config names, block descriptions
        for layout in doc.layouts:
            if layout.name == "Model":
                continue  # Model space has no user-visible tab label to translate
            name = layout.name
            if name and not _should_skip(name):
                # handle = name itself (generate.py matches layouts by name, not DXF handle)
                _add_occurrence(strings, name, rel, name, "LAYOUT_NAME")
                count += 1

        for entity in doc.entitydb.values():
            if entity.dxftype() != "PLOTSETTINGS":
                continue
            page_name = entity.dxf.get("page_setup_name", "")
            if page_name and not _should_skip(page_name):
                _add_occurrence(strings, page_name, rel, entity.dxf.handle, "PLOT_CONFIG")
                count += 1

        for entity in doc.entitydb.values():
            if entity.dxftype() != "BLOCK":
                continue
            block_name = entity.dxf.get("name", "")
            if not block_name or block_name.startswith("*"):
                continue
            desc = entity.dxf.get("description", "")
            if desc and not _should_skip(desc):
                _add_occurrence(strings, desc, rel, entity.dxf.handle, "BLOCK_DESC")
                count += 1

        print(f" {count} strings")

    # ------------------------------------------------------------------
    # Preserve existing translations
    # ------------------------------------------------------------------
    existing: dict[str, dict[str, str]] = {}
    if glossary_path.exists():
        with open(glossary_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                existing[row["french"].strip()] = {
                    "english": row["english"],
                    "chinese": row["chinese"],
                }
        print(f"  Loaded {len(existing)} existing translations from {glossary_path.name}")

    # ------------------------------------------------------------------
    # Write CSV
    # ------------------------------------------------------------------
    rows = []
    for french, info in sorted(strings.items()):
        prev = existing.get(french.strip(), {})
        rows.append(
            {
                "string_id": info["string_id"],
                "french": french,
                "english": prev.get("english", ""),
                "chinese": prev.get("chinese", ""),
                "occurrences": json.dumps(info["occurrences"], ensure_ascii=False),
            }
        )

    with open(glossary_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["string_id", "french", "english", "chinese", "occurrences"],
            quoting=csv.QUOTE_ALL,
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nExtracted {len(rows)} unique strings → {glossary_path.name}")

    if errors:
        print(f"\nWarnings ({len(errors)} files could not be read):")
        for e in errors:
            print(f"  {e}")


def main() -> None:
    args = parse_args()
    extract(args.paths, args.glossary, args.root)


if __name__ == "__main__":
    main()
