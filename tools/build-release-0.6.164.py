#!/usr/bin/env python3
"""Rebuild the verified Plany 0.6.164 update from the withdrawn 0.6.163 release.

The previous complete RBZ is immutable and SHA-256 verified. Only the four
known source changes are applied; each transformed source file is verified
against the exact Git blob committed in Plany/main (PR #50).
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

REPOSITORY = "raullqueirozz9292/Plany-Distribuicao"
SOURCE_COMMIT = "f76d24d8dff462747a96187cab7f41f1a8d1e276"
ORIGINAL_SHA = "63ace1098fa4842e70536fb135ff6bb1eb2434f907043a31dbaa88a6c45d61b1"
GIT_BLOBS = {
    "plany.rb": "7bdc15ec878ac44a6dda3ad42e859e1facaec40e",
    "plany/ui/index.html": "534bc7d3c8602589dd1eeb14f4c799c36cc26d33",
    "plany/reloader.rb": "577cf11d1b18ef7e97f093dfa6ea7d0bdae9d8bd",
    "plany/ui/standards.js": "0a23b2d78731cdef6e2cf5a469f0bfd3bfed2933",
}
ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)
BASE = DIST / "verified-withdrawn-0.6.163.rbz"
TARGET = DIST / "Plany-0.6.164.rbz"


def call(*args):
    return subprocess.check_output(args, text=True).strip()


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_blob(content):
    value = b"blob " + str(len(content)).encode() + b"\0" + content
    return hashlib.sha1(value).hexdigest()


def check_blob(name, raw):
    # Source Git blobs use LF via .gitattributes text=auto; the verified
    # original RBZ was packaged on Windows and may retain CRLF on disk.
    digest = git_blob(raw.replace(b"\\r\\n", b"\\n"))
    if digest != GIT_BLOBS[name]:
        raise RuntimeError(f"Source mismatch: {name}, normalized Git blob {digest} != {GIT_BLOBS[name]}")


def once(text, before, after, name):
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f"{name}: expected exactly one patch anchor, found {count}: {before[:110]}")
    return text.replace(before, after, 1)


def inline_script(raw):
    content = re.sub(r"</script", lambda match: r"<\/script", raw.decode("utf-8"), flags=re.I)
    return "<script>" + content + "</script>"


def prepare():
    records = json.loads(call("gh", "api", f"repos/{REPOSITORY}/releases?per_page=100"))
    if any(x.get("tag_name") == "v0.6.164" for x in records):
        raise RuntimeError("Release v0.6.164 already exists. Never overwrite a release.")
    drafts = [x for x in records if x.get("tag_name") == "v0.6.163" and x.get("draft")]
    if len(drafts) != 1:
        raise RuntimeError("Unique withdrawn draft v0.6.163 not found.")
    assets = [x for x in drafts[0].get("assets", []) if x["name"] == "Plany-0.6.163.rbz"]
    if len(assets) != 1:
        raise RuntimeError("Verified 0.6.163 asset missing or ambiguous.")
    token = os.environ["GH_TOKEN"]
    asset_id = assets[0]["id"]
    url = f"https://api.github.com/repos/{REPOSITORY}/releases/assets/{asset_id}"
    subprocess.run(["curl", "--fail", "--show-error", "--silent", "--location",
                    "--retry", "3", "--connect-timeout", "20", "--max-time", "900",
                    "-H", f"Authorization: Bearer {token}",
                    "-H", "Accept: application/octet-stream",
                    "-H", "X-GitHub-Api-Version: 2022-11-28",
                    url, "--output", str(BASE)], check=True)
    value = sha256(BASE)
    if value != ORIGINAL_SHA:
        raise RuntimeError(f"Withdrawn RBZ SHA mismatch: {value}; no release will be created.")
    print(f"Verified immutable draft: {BASE.stat().st_size} bytes, SHA256 {value}", flush=True)


def patch_files(archive):
    with ZipFile(archive) as package:
        names = package.namelist()
        if len(names) != len(set(names)) or package.testzip() is not None:
            raise RuntimeError("Withdrawn RBZ is corrupted or has duplicate paths.")
        required = set(GIT_BLOBS) | {"plany/glass.js", "plany/dimensions.js",
                    "plany/ui/editor-policy.js", "plany/ui/standards.css"}
        if not required.issubset(names):
            raise RuntimeError("Missing dependencies: " + str(sorted(required - set(names))))

        loader = package.read("plany.rb").decode("utf-8")
        loader = once(loader, "extension.version = '0.6.163'",
                      "extension.version = '0.6.164'", "plany.rb")
        modified_loader = loader.encode("utf-8")
        check_blob("plany.rb", modified_loader)

        standards = package.read("plany/ui/standards.js").decode("utf-8")
        standards = once(standards,
            "!/^(decimal|numeric)$/.test(input.inputMode)",
            "!/^(decimal|numeric)$/.test(input.getAttribute('inputmode')||input.inputMode)",
            "standards.js")
        modified_standards = standards.encode("utf-8")
        check_blob("plany/ui/standards.js", modified_standards)

        reloader = package.read("plany/reloader.rb").decode("utf-8")
        # Run the pinpoint source patch in LF, then preserve the original
        # archive's newline convention for the official update.
        original_crlf = "\\r\\n" in reloader
        reloader = reloader.replace("\\r\\n", "\\n")
        anchor = "      html = html.sub('<script src=\"../glass.js\"></script>') { script(File.join(directory, 'glass.js')) }\n"
        addition = (
            "      html = html.sub('<script src=\"standards.js\"></script>') { script(File.join(ui, 'standards.js')) }\n"
            "      html = html.sub('<script src=\"editor-policy.js\"></script>') { script(File.join(ui, 'editor-policy.js')) }\n"
            "      html = html.sub('<link rel=\"stylesheet\" href=\"standards.css\">') { '<style>' + File.read(File.join(ui, 'standards.css'), encoding: 'UTF-8') + '</style>' }\n"
        )
        reloader = once(reloader, anchor, anchor + addition, "reloader bootstrap")
        for old in (
            "        '<link rel=\"stylesheet\" href=\"standards.css\">' => '<style>' + File.read(File.join(ui, 'standards.css'), encoding: 'UTF-8') + '</style>',\n",
            "        '<script src=\"standards.js\"></script>' => script(File.join(ui, 'standards.js')),\n",
            "        '<script src=\"editor-policy.js\"></script>' => script(File.join(ui, 'editor-policy.js')),\n",
        ):
            reloader = once(reloader, old, "", "reloader obsolete mappings")
        modified_reloader = reloader.replace("\\n", "\\r\\n").encode("utf-8") if original_crlf else reloader.encode("utf-8")
        check_blob("plany/reloader.rb", modified_reloader)

        # The withdrawn package already inlines glass.js. Undo only this
        # packaging transformation to verify the canonical HTML source blob.
        glass = inline_script(package.read("plany/glass.js"))
        embedded_html = package.read("plany/ui/index.html").decode("utf-8")
        raw_html = once(embedded_html, glass, '<script src="../glass.js"></script>',
                        "undo old glass packaging")
        if raw_html.count("0.6.163") != 2:
            raise RuntimeError("Unexpected count of visible UI versions")
        raw_html = raw_html.replace("0.6.163", "0.6.164")
        check_blob("plany/ui/index.html", raw_html.encode("utf-8"))

        # Use the *new* package_contract order, preserving original design and
        # integrating dependencies for SketchUp's legacy 0.6.162 bootstrap.
        new_html = raw_html
        deps = [
            ("../glass.js", "plany/glass.js"),
            ("../dimensions.js", "plany/dimensions.js"),
            ("standards.js", "plany/ui/standards.js"),
            ("editor-policy.js", "plany/ui/editor-policy.js"),
            ("standards.css", "plany/ui/standards.css"),
        ]
        for href, name in deps:
            css = href.endswith(".css")
            marker = (f'<link rel="stylesheet" href="{href}">' if css
                      else f'<script src="{href}"></script>')
            source = modified_standards if name == "plany/ui/standards.js" else package.read(name)
            tag = "style" if css else "script"
            content = re.sub(r"</" + tag, lambda match: r"<\/" + tag,
                             source.decode("utf-8"), flags=re.I)
            new_html = once(new_html, marker, "<" + tag + ">" + content +
                            "</" + tag + ">", "inline " + href)

        if any(marker in new_html for marker in
               ('src="../dimensions.js"', 'src="standards.js"',
                'src="editor-policy.js"', 'href="standards.css"')):
            raise RuntimeError("Legacy bootstrap dependencies not embedded.")

        modified = {
            "plany.rb": modified_loader,
            "plany/reloader.rb": modified_reloader,
            "plany/ui/standards.js": modified_standards,
            "plany/ui/index.html": new_html.encode("utf-8"),
        }
        # In the standard update package, render textures are inherited from
        # installed/cached resources, just as prior small official releases.
        rendered = re.compile(r"^plany/catalog/.*-render\.(?:jpe?g|png)$", re.I)
        kept = []
        with ZipFile(TARGET, "w", ZIP_DEFLATED) as destination:
            for entry in package.infolist():
                name = entry.filename
                if rendered.search(name):
                    continue
                if not (name == "plany.rb" or name.startswith("plany/")):
                    raise RuntimeError("Unexpected plugin path: " + name)
                destination.writestr(name, modified.get(name, package.read(name)))
                kept.append(name)
    with ZipFile(TARGET) as result:
        if result.testzip() is not None or len(result.namelist()) != len(set(result.namelist())):
            raise RuntimeError("Invalid generated RBZ")
        if result.read("plany.rb") != modified_loader or result.read("plany/ui/index.html") != modified["plany/ui/index.html"]:
            raise RuntimeError("RBZ verification failed")
        if len(result.namelist()) < 200:
            raise RuntimeError("Unexpectedly small update file set")
    return kept


if __name__ == "__main__":
    prepare()
    files = patch_files(BASE)
    digest = sha256(TARGET)
    manifest = {
        "version": "0.6.164", "archive": TARGET.name,
        "sha256": digest, "files": len(files),
        "distribution_kind": "update", "source_commit": SOURCE_COMMIT,
        "source_blobs_verified": GIT_BLOBS,
        "base_verified_release_sha256": ORIGINAL_SHA,
    }
    (DIST / "manifest-0.6.164.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2), flush=True)
