"""Deterministic Lambda zip builder (stdlib only, py3.10+).

Usage: python3 tools/build_lambda_zip.py <staged_site_packages_dir> <out_zip>

Determinism matters because Terraform's source_code_hash drives deploys: the
same inputs must produce byte-identical zips on any machine. Entries are
sorted, timestamps fixed to the zip epoch, permissions normalized, and
bytecode caches skipped.
"""

import sys
import zipfile
from pathlib import Path

FIXED_DATE = (1980, 1, 1, 0, 0, 0)
SKIP_DIRS = {"__pycache__"}
SKIP_SUFFIXES = {".pyc", ".pyo"}


def build(src: Path, out: Path) -> int:
    files = sorted(
        p
        for p in src.rglob("*")
        if p.is_file()
        and p.suffix not in SKIP_SUFFIXES
        and not any(part in SKIP_DIRS for part in p.parts)
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            info = zipfile.ZipInfo(str(path.relative_to(src)), date_time=FIXED_DATE)
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, path.read_bytes())
    return len(files)


if __name__ == "__main__":
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    count = build(src, out)
    print(f"{out}: {count} files, {out.stat().st_size:,} bytes")
