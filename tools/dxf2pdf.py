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
Generate PDF files from DXF drawings.

For each DXF file found in drawings-{lang}/:
  - Renders all layouts (modelspace + paper-space sheets) to PDF pages
  - Outputs to pdf/{lang}/ mirroring the folder structure

Usage:
    cd /path/to/project
    python tools/dxf2pdf.py --path drawings/fr   # process only this source path

    python tools/dxf2pdf.py --path drawings/fr --lang fr
    python tools/dxf2pdf.py --path drawings/en --path drawings/cn --lang en --lang cn
"""

import argparse
import sys
from pathlib import Path

import ezdxf
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

PROJECT_ROOT = Path(__file__).parent.parent

KNOWN_LANGS = ["fr", "en", "cn"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate PDF files from DXF drawings."
            " Use --path multiple times to process only the requested source folders."
        )
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("."),
        help="Project root directory (default: current working directory)."
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
        help="Language directory to process. Repeatable; supported values: fr, en, cn."
    )
    parser.add_argument(
        "positionals",
        nargs="*",
        help=argparse.SUPPRESS,
    )

    args = parser.parse_args()
    args.root = args.root.expanduser().resolve()

    if args.paths:
        normalized_paths: list[Path] = []
        for path in args.paths:
            path_obj = Path(path)
            if not path_obj.is_absolute():
                path_obj = args.root / path_obj
            normalized_paths.append(path_obj.expanduser().resolve())
        args.paths = normalized_paths

    if not args.langs and args.positionals:
        args.langs = args.positionals

    return args


# ------------------------------------------------------------------
# Rendering
# ------------------------------------------------------------------

def _render_layout_to_axes(doc, layout, fig, ax):
    """Render a single ezdxf layout onto the given matplotlib axes."""
    ax.set_aspect("equal")
    ctx = RenderContext(doc)
    backend = MatplotlibBackend(ax)
    Frontend(ctx, backend).draw_layout(layout, finalize=True)


def dxf_to_pdf(dxf_path: Path, pdf_path: Path) -> int:
    """Convert a DXF file to a multi-page PDF (one page per layout).

    Returns the number of pages written.
    """
    doc = ezdxf.readfile(str(dxf_path))

    # Collect non-empty layouts: modelspace first, then paper-space layouts
    layouts = []
    msp = doc.modelspace()
    if list(msp):
        layouts.append(("Model", msp))
    for layout in doc.layouts:
        if not layout.is_modelspace:
            layouts.append((layout.name, layout))

    if not layouts:
        return 0

    pdf_path.parent.mkdir(parents=True, exist_ok=True)

    with PdfPages(str(pdf_path)) as pdf:
        for name, layout in layouts:
            fig, ax = plt.subplots(figsize=(16.54, 11.69))  # A3 landscape
            ax.set_axis_off()
            try:
                _render_layout_to_axes(doc, layout, fig, ax)
            except Exception as exc:
                ax.text(
                    0.5, 0.5,
                    f"Render error:\n{exc}",
                    transform=ax.transAxes,
                    ha="center", va="center",
                    fontsize=8, color="red",
                )
            fig.tight_layout(pad=0)
            pdf.savefig(fig, dpi=150)
            plt.close(fig)

    return len(layouts)


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

def main() -> None:
    args = parse_args()

    target_langs = [lang.lower().strip() for lang in args.langs]
    if args.paths:
        source_dirs = args.paths
    else:
        if not target_langs:
            target_langs = [l for l in KNOWN_LANGS if (args.root / "drawings" / l).exists()]
        source_dirs = [(args.root / "drawings" / lang) for lang in target_langs]

    if not source_dirs:
        print("No source paths provided or detected.", file=sys.stderr)
        sys.exit(1)

    total_files = 0
    total_pages = 0
    total_errors = 0

    for source_dir in source_dirs:
        if not source_dir.exists():
            print(f"  {source_dir} not found — skipping", file=sys.stderr)
            continue

        print(f"\n=== Generating PDF from {source_dir} ===")

        dxf_files = sorted(source_dir.rglob("*.dxf"))
        if not dxf_files:
            print(f"  No DXF files found in {source_dir}", file=sys.stderr)
            continue

        for dxf_path in dxf_files:
            rel = dxf_path.relative_to(source_dir)
            pdf_path = source_dir / rel.with_suffix(".pdf")

            try:
                pages = dxf_to_pdf(dxf_path, pdf_path)
                total_pages += pages
                total_files += 1
                print(f"  {source_dir}/{rel}  [{pages} page(s)]")
            except Exception as exc:
                total_errors += 1
                print(f"  ERROR {rel}: {exc}", file=sys.stderr)

    print(
        f"\nPDF generation: {total_files} files generated, "
        f"{total_pages} pages total."
        + (f" {total_errors} error(s)." if total_errors else "")
    )


if __name__ == "__main__":
    main()
