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
Generate translated DXF files from glossaire.csv.

For each language with translations in the glossary:
  - Copies the drawings-fr/ tree to drawings-en/ or drawings-cn/
  - Replaces text in each DXF entity using its stored handle

Entity types supported: TEXT, MTEXT, ATTDEF, ATTRIB

For Chinese output:
  - All text styles are set to use the SimSun font (CJK-compatible)
  - SimSun covers both CJK characters and basic Latin, so untranslated
    labels (numbers, codes, etc.) render correctly too.

Usage:
    cd /path/to/project
    python tools/generate.py --path drawings/fr   # default languages: en, cn

    python tools/generate.py --path schematics/fr --lang en
    python tools/generate.py --path drawings/fr --lang en --lang cn --glossary glossaire.csv --cjk-font simsun.ttc
"""

import argparse
import csv
import json
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import ezdxf

PROJECT_ROOT = Path(__file__).parent.parent
DEFAULT_GLOSSARY_PATH = Path("glossaire.csv")
DEFAULT_CJK_FONT = Path("simsun.ttc")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate translated DXF files from glossaire.csv."
            " Use --path multiple times to process several source trees."
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
        help="DXF source directory to process. Repeatable."
    )
    parser.add_argument(
        "--lang",
        action="append",
        dest="langs",
        default=[],
        help="Target language to generate. Repeatable; supported values: en, cn."
    )
    parser.add_argument(
        "--glossary",
        type=Path,
        default=DEFAULT_GLOSSARY_PATH,
        help="Glossary CSV path (default: glossaire.csv in project root)."
    )
    parser.add_argument(
        "--cjk-font",
        type=Path,
        default=DEFAULT_CJK_FONT,
        help="CJK font path or name used for Chinese output (default: simsun.ttc)."
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

    if not args.langs:
        args.langs = ["en", "cn"]

    if not args.glossary.is_absolute():
        args.glossary = args.root / args.glossary
    args.glossary = args.glossary.expanduser()

    if not args.cjk_font.is_absolute():
        args.cjk_font = args.root / args.cjk_font
    args.cjk_font = args.cjk_font.expanduser()

    return args


# ------------------------------------------------------------------
# Glossary loading
# ------------------------------------------------------------------

def load_glossary(lang: str, glossary_path: Path) -> dict[str, dict[str, str]]:
    """Return {dxf_rel_path: {handle: translated_text}} for the given lang.

    Only includes entries where the target column is non-empty.
    """
    file_map: dict[str, dict[str, str]] = defaultdict(dict)

    with open(glossary_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            translation = row[lang].strip()
            if not translation:
                continue
            french = row["french"]
            occurrences = json.loads(row["occurrences"]) if row["occurrences"] else []
            for occ in occurrences:
                file_map[occ["file"]][occ["handle"]] = {
                    "translation": translation,
                    "french": french,
                    "entity_type": occ["entity_type"],
                }

    return dict(file_map)


def _source_output_root(source_path: Path, lang: str) -> tuple[Path, Path]:
    """Return the source and output root for a given source path and language."""
    if source_path.name == "fr":
        return source_path, source_path.parent / lang
    return source_path, source_path / lang


# ------------------------------------------------------------------
# DXF manipulation
# ------------------------------------------------------------------

def _set_cjk_styles(doc: ezdxf.document.Drawing, cjk_font: str) -> None:
    """Replace the font on every text style with SimSun (CJK-compatible)."""
    for style in doc.styles:
        try:
            style.dxf.font = cjk_font
            # Clear bigfont — the chosen font is Unicode and handles CJK natively
            if style.dxf.hasattr("bigfont"):
                style.dxf.bigfont = ""
        except Exception:
            pass


_PCT_CODES = [("%%C", "Ø"), ("%%c", "Ø"), ("%%P", "±"), ("%%p", "±"), ("%%D", "°"), ("%%d", "°")]


def _decode_pct(text: str) -> str:
    """Convert DXF %%X codes to Unicode for comparison purposes."""
    for code, ch in _PCT_CODES:
        text = text.replace(code, ch)
    return text


def _patch_acad_tables(doc: ezdxf.document.Drawing, fr_to_translation: dict[str, str]) -> int:
    """Replace French cell text in all ACAD_TABLE entities.

    ACAD_TABLE stores cell content in xtags.subclasses[3] as DXFTag(code=1) and
    DXFTag(code=302) entries. These are independent from the MTEXT entities and
    must be patched separately.

    Returns the number of tag replacements made.
    """
    from ezdxf.lldxf.types import DXFTag as _DXFTag

    count = 0
    for entity in doc.entitydb.values():
        if entity.dxftype() != "ACAD_TABLE":
            continue
        try:
            sc = entity.xtags.subclasses[3]
        except (AttributeError, IndexError):
            continue
        for i, tag in enumerate(sc):
            if not hasattr(tag, "code") or tag.code not in (1, 302):
                continue
            raw_val = str(tag.value)
            if not raw_val.strip():
                continue
            # Direct match (plain text), then decoded %%X match
            translation = fr_to_translation.get(raw_val) or fr_to_translation.get(_decode_pct(raw_val))
            if translation:
                sc[i] = _DXFTag(tag.code, translation)
                count += 1
    return count


def _replace_entity_text(entity, translation: str, french: str) -> bool:
    """Apply translation to a single entity. Returns True on success."""
    dtype = entity.dxftype()
    try:
        if dtype == "TEXT":
            entity.dxf.text = translation
            return True
        elif dtype == "MTEXT":
            raw = entity.dxf.text
            if french in raw:
                entity.dxf.text = raw.replace(french, translation, 1)
            else:
                # Fallback: check if plain text matches
                try:
                    plain = entity.plain_text()
                except Exception:
                    plain = ""
                if plain and plain in raw:
                    entity.dxf.text = raw.replace(plain, translation, 1)
                else:
                    entity.dxf.text = translation
            return True
        elif dtype in ("ATTDEF", "ATTRIB"):
            entity.dxf.text = translation
            return True
    except Exception as exc:
        print(f"    WARNING: could not set text on {dtype} — {exc}")
        return False
    return False


# ------------------------------------------------------------------
# Per-file generation
# ------------------------------------------------------------------

def _apply_special_entries(
    doc: ezdxf.document.Drawing,
    handle_map: dict[str, dict],
) -> tuple[int, int]:
    """Apply LAYOUT_NAME, PLOT_CONFIG, BLOCK_DESC translations.

    Returns (replaced, missing) counts.
    """
    replaced = 0
    missing = 0

    # Collect by entity_type
    layout_renames: dict[str, str] = {}   # {original_name: translation}
    plot_configs: dict[str, str] = {}      # {handle: translation}
    block_descs: dict[str, str] = {}       # {handle: translation}

    for handle, info in handle_map.items():
        etype = info.get("entity_type", "")
        if etype == "LAYOUT_NAME":
            # handle IS the original layout name (not a DXF entity handle)
            layout_renames[handle] = info["translation"]
        elif etype == "PLOT_CONFIG":
            plot_configs[handle] = info["translation"]
        elif etype == "BLOCK_DESC":
            block_descs[handle] = info["translation"]

    # Rename layout tabs (collect first, rename after — avoid mutating during iteration)
    to_rename = [
        (layout.name, layout_renames[layout.name])
        for layout in doc.layouts
        if layout.name in layout_renames
    ]
    for old_name, new_name in to_rename:
        try:
            doc.layouts.rename(old_name, new_name)
            replaced += 1
        except Exception as exc:
            print(f"    WARNING: could not rename layout {old_name!r}: {exc}")
            missing += 1

    # Update PLOTSETTINGS page_setup_name  (DXF entity type PLOTSETTINGS)
    for handle, translation in plot_configs.items():
        entity = doc.entitydb.get(handle)
        if entity is None:
            missing += 1
            continue
        try:
            entity.dxf.page_setup_name = translation
            replaced += 1
        except Exception as exc:
            print(f"    WARNING: could not update PLOTSETTINGS {handle!r}: {exc}")
            missing += 1

    # Update BLOCK entity description
    for handle, translation in block_descs.items():
        entity = doc.entitydb.get(handle)
        if entity is None:
            missing += 1
            continue
        try:
            entity.dxf.description = translation
            replaced += 1
        except Exception as exc:
            print(f"    WARNING: could not update BLOCK_DESC {handle!r}: {exc}")
            missing += 1

    return replaced, missing


def generate_file(
    fr_path: Path,
    out_path: Path,
    handle_map: dict[str, dict],
    use_cjk: bool,
    cjk_font: str,
) -> tuple[int, int]:
    """Copy fr_path to out_path and apply translations from handle_map.

    Returns (replaced_count, missing_count).
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(fr_path, out_path)

    if not handle_map:
        return 0, 0

    doc = ezdxf.readfile(str(out_path))

    if use_cjk:
        _set_cjk_styles(doc, cjk_font)

    replaced = 0
    missing = 0

    # Special entity types that are not looked up by handle in entitydb
    special_types = {"LAYOUT_NAME", "PLOT_CONFIG", "BLOCK_DESC"}
    sp_replaced, sp_missing = _apply_special_entries(doc, handle_map)
    replaced += sp_replaced
    missing += sp_missing

    # Standard text entities (TEXT, MTEXT, ATTDEF, ATTRIB)
    for handle, info in handle_map.items():
        if info.get("entity_type", "") in special_types:
            continue
        entity = doc.entitydb.get(handle)
        if entity is None:
            missing += 1
            continue
        ok = _replace_entity_text(entity, info["translation"], info["french"])
        if ok:
            replaced += 1

    # Patch ACAD_TABLE cell data (group 1 + 302) — AutoCAD reads these for table display,
    # independently of the associated MTEXT entities.
    fr_to_translation = {
        info["french"]: info["translation"]
        for info in handle_map.values()
        if info.get("entity_type", "") not in special_types
    }
    replaced += _patch_acad_tables(doc, fr_to_translation)

    doc.saveas(str(out_path))
    return replaced, missing


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

def main() -> None:
    args = parse_args()

    if not args.glossary.exists():
        print(f"Glossary not found at {args.glossary}", file=sys.stderr)
        sys.exit(1)

    target_langs = [lang.lower().strip() for lang in args.langs]
    if not target_langs:
        target_langs = ["en", "cn"]

    for lang in target_langs:
        col = {"en": "english", "cn": "chinese"}.get(lang)
        if col is None:
            print(f"Unknown language {lang!r} (use 'en' or 'cn')", file=sys.stderr)
            continue

        use_cjk = lang == "cn"
        print(f"\n=== Generating {lang} output ===")

        file_map = load_glossary(col, args.glossary)

        total_replaced = 0
        total_missing = 0
        total_files = 0

        for source_path in args.paths:
            source_root, output_root = _source_output_root(source_path, lang)
            dxf_files = sorted(source_root.rglob("*.dxf"))
            if not dxf_files:
                print(f"No DXF files found under {source_root}", file=sys.stderr)
                continue

            for fr_path in dxf_files:
                rel = str(fr_path.relative_to(source_root))
                out_path = output_root / rel

                handle_map = file_map.get(str(fr_path.relative_to(args.root)), {})

                replaced, missing = generate_file(fr_path, out_path, handle_map, use_cjk, str(args.cjk_font))
                total_replaced += replaced
                total_missing += missing
                total_files += 1

                out_rel = str(out_path.relative_to(args.root))
                status = f"{replaced} replaced"
                if missing:
                    status += f", {missing} handles not found"
                print(f"  {out_rel}  [{status}]")

        print(
            f"\n{lang.upper()} generation: {total_files} files generated, "
            f"{total_replaced} text substitutions, "
            f"{total_missing} unresolved handles."
        )
        if total_missing:
            print(
                "  Unresolved handles usually mean the glossary was built from "
                "a different DXF version. Re-run extract.py if needed."
            )


if __name__ == "__main__":
    main()
