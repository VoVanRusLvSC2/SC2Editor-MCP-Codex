"""Import the supplied SC2 reference catalog without executing its bundled scripts.

Usage: python scripts/import-authoring-catalog.py <SC2_Full_v6_2_With_Scripts.zip>
JSON payloads above 16 KiB are compressed deterministically. IMPORT.json records
the archive checksum and every original payload checksum for reproducibility.
"""
import gzip
import hashlib
import json
import sys
import zipfile
from pathlib import Path, PurePosixPath

root = Path(__file__).resolve().parents[1] / "resources" / "authoring-catalog"
archive = Path(sys.argv[1]).resolve()
prefix = "SC2_Full_v6_2_With_Scripts/SC2_Catalog/"
guides = {"AGENT_INSTRUCTIONS_EN.md", "AUTHORING_GUIDE_EN.md", "MCP_INTEGRATION_EN.md", "SOURCES_EN.md"}
entries = []
seen = set()
with zipfile.ZipFile(archive) as source:
    for entry in source.infolist():
        if entry.is_dir() or not entry.filename.startswith(prefix):
            continue
        relative = PurePosixPath(entry.filename[len(prefix):])
        if relative.suffix != ".json" and relative.name not in guides:
            continue
        if relative.is_absolute() or ".." in relative.parts or "\\" in str(relative) or ":" in str(relative):
            raise ValueError("Catalog entry escapes destination")
        if str(relative).casefold() in seen:
            raise ValueError("Duplicate catalog entry")
        seen.add(str(relative).casefold())
        if entry.file_size > 32 * 1024 * 1024:
            raise ValueError("Catalog payload exceeds bounded reader limit")
        data = source.read(entry)
        if relative.suffix == ".json":
            json.loads(data)
        stored = str(relative) + (".gz" if len(data) > 16384 and relative.suffix == ".json" else "")
        output = root / stored
        if not output.resolve().is_relative_to(root.resolve()):
            raise ValueError("Catalog path escapes destination")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(gzip.compress(data, compresslevel=9, mtime=0) if stored.endswith(".gz") else data)
        alternative = root / (str(relative) if stored.endswith(".gz") else str(relative) + ".gz")
        if alternative.resolve().is_relative_to(root.resolve()):
            alternative.unlink(missing_ok=True)
        entries.append({"file": str(relative), "storage": stored, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
(root / "IMPORT.json").write_text(json.dumps({"version": 1, "source": archive.name, "sourceSha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "entries": entries}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"files": len(entries), "originalBytes": sum(e["bytes"] for e in entries), "storedBytes": sum((root / e["storage"]).stat().st_size for e in entries)}))
