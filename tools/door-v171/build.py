#!/usr/bin/env python3
"""Build official 0.6.171 from previous public RBZ and SHA-pinned source deltas.

This script does not touch any installed SketchUp runtime or user's files.
"""
import base64
import hashlib
import json
import re
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
STAGE = Path(__file__).resolve().parent
META = json.loads((STAGE / "manifest.json").read_text(encoding="utf-8"))
assert META["version"] == "0.6.171" and META["base_tag"] == "v0.6.170"
assert re.fullmatch(r"[a-f0-9]{40}", META["source_commit"])
DIST = REPO / "dist"
DIST.mkdir(exist_ok=True)
BASE = DIST / "Plany-0.6.170.rbz"
OUT = DIST / "Plany-0.6.171.rbz"
assert BASE.is_file() and not OUT.exists()
with zipfile.ZipFile(BASE) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert len(names) == len(set(names))
    data = {name: archive.read(name) for name in names}
assert all(name == "plany.rb" or name.startswith("plany/") for name in data)
assert "extension.version = '0.6.170'" in data["plany.rb"].decode("utf-8")
assert '<span class="version">0.6.170</span>' in data["plany/ui/index.html"].decode("utf-8")

def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + bytes([0]) + raw).hexdigest()

changes = {}
for name, attrs in META["files"].items():
    assert name == "plany.rb" or name.startswith("plany/")
    binary = attrs["encoding"] == "base64"
    assert attrs["encoding"] in ("utf-8", "base64")
    filename = STAGE / "source" / (name + (".b64" if binary else ""))
    raw = base64.b64decode(filename.read_bytes()) if binary else filename.read_bytes()
    assert git_blob(raw) == attrs["blob_sha"], "Incorrect source blob: " + name
    changes[name] = raw
assert "plany/front_components.rb" in data
assert data["plany/native/command_keys.exe"].startswith(b"MZ")
assert "extension.version = '0.6.171'" in changes["plany.rb"].decode("utf-8")
data.update(changes)

# Identical inline-dependency contract to source tools/package_contract.py,
# necessary for older extension reloaders and the official updater.
html = changes["plany/ui/index.html"].decode("utf-8")
for ref, relative in (
    ("../glass.js", "plany/glass.js"),
    ("../dimensions.js", "plany/dimensions.js"),
    ("standards.js", "plany/ui/standards.js"),
    ("editor-policy.js", "plany/ui/editor-policy.js"),
    ("standards.css", "plany/ui/standards.css"),
):
    css = ref.endswith(".css")
    marker = '<link rel="stylesheet" href="' + ref + '">' if css else '<script src="' + ref + '"></script>'
    assert html.count(marker) == 1, "Missing or repeated UI dependency: " + ref
    tag = "style" if css else "script"
    code = data[relative].decode("utf-8")
    code = re.sub("</" + tag, lambda _: "<\\/" + tag, code, flags=re.I)
    html = html.replace(marker, "<" + tag + ">" + code + "</" + tag + ">")
data["plany/ui/index.html"] = html.encode("utf-8")
assert '<span class="version">0.6.171</span>' in html
assert 'title="Plany 0.6.171"' in html
assert 'src="standards.js"' not in html
assert set(changes).issubset(data)

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as package:
    for name in sorted(data):
        package.writestr(name, data[name])
with zipfile.ZipFile(OUT) as package:
    assert package.testzip() is None
    assert len(package.namelist()) == len(data)
    for name, raw in changes.items():
        assert package.read(name) == (html.encode("utf-8") if name == "plany/ui/index.html" else raw)
digest = hashlib.sha256(OUT.read_bytes()).hexdigest()
manifest = {
    "version": META["version"],
    "archive": OUT.name,
    "sha256": digest,
    "source_commit": META["source_commit"],
    "base_release": META["base_tag"],
    "base_sha256": hashlib.sha256(BASE.read_bytes()).hexdigest(),
    "files": len(data),
    "updated_files": len(changes),
}
(DIST / "manifest-0.6.171.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print("RBZ candidate verified:", json.dumps(manifest, ensure_ascii=False))
