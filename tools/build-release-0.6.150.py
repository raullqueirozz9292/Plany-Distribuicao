#!/usr/bin/env python3
"""Build the Plany 0.6.150 incremental RBZ from the verified official 0.6.149 RBZ.

Only the requested Central guidance and the matching version markers may change.
The existing release is never overwritten. Safe to run in GitHub Actions.
"""
from __future__ import annotations
import hashlib
import io
import json
import urllib.request
import zipfile
from pathlib import Path

REPOSITORY = "raullqueirozz9292/Plany-Distribuicao"
PREVIOUS = "0.6.149"
VERSION = "0.6.150"
EXPECTED_PREVIOUS = "58bb5bdd9de742623d49f64c2ed6f1346daf95fe4d05c1d43aed535a636d76d4"
DESTINATION = Path("dist") / f"Plany-{VERSION}.rbz"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Plany-0.6.150-Release-Builder", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()

meta = json.loads(fetch(f"https://api.github.com/repos/{REPOSITORY}/releases/tags/v{PREVIOUS}"))
if meta.get("draft") or meta.get("prerelease") or meta.get("tag_name") != f"v{PREVIOUS}":
    raise SystemExit("A versão anterior não é a release oficial esperada.")
asset_name = f"Plany-{PREVIOUS}.rbz"
assets = [x for x in meta["assets"] if x["name"] == asset_name]
if len(assets) != 1 or assets[0].get("digest") != "sha256:" + EXPECTED_PREVIOUS:
    raise SystemExit("A assinatura da release anterior não é a esperada.")
asset = assets[0]
if asset.get("browser_download_url") != f"https://github.com/{REPOSITORY}/releases/download/v{PREVIOUS}/{asset_name}":
    raise SystemExit("O endereço do pacote anterior é inesperado.")
source_bytes = fetch(asset["browser_download_url"])
if hashlib.sha256(source_bytes).hexdigest() != EXPECTED_PREVIOUS or len(source_bytes) != asset["size"]:
    raise SystemExit("O pacote original não passou na verificação SHA-256/tamanho.")

changes = {
    "plany.rb": (
        "extension.version = '0.6.149'",
        "extension.version = '0.6.150'",
    ),
    "plany/ui/index.html": (
        '<span class="version">0.6.149</span>',
        '<span class="version">0.6.150</span>',
    ),
    "plany/central/index.html": (
        '<p class="hint retalhos-explanation">Serra é o material consumido em cada corte.<br>Refilo é a margem retirada de cada borda.<br>O veio da chapa acompanha o comprimento.</p>',
        '<p class="hint retalhos-explanation">* Serra é o material consumido em cada corte.<br>** Refilo é a margem retirada de cada borda.<br>*** O veio da chapa acompanha o comprimento.</p>',
    ),
}
changed = set()
DESTINATION.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(io.BytesIO(source_bytes), "r") as original, zipfile.ZipFile(DESTINATION, "w") as output:
    members = original.infolist()
    if len({info.filename for info in members}) != len(members):
        raise SystemExit("O RBZ original contém arquivos duplicados.")
    if any(info.filename.startswith("/") or ".." in info.filename.split("/") for info in members):
        raise SystemExit("Caminho inseguro no RBZ original.")
    if sum(info.file_size for info in members) > 250_000_000:
        raise SystemExit("O pacote original excede o tamanho permitido.")
    for info in members:
        contents = original.read(info)
        if info.filename in changes:
            before, after = changes[info.filename]
            old = before.encode("utf-8")
            if contents.count(old) != 1:
                raise SystemExit(f"Trecho exclusivo não encontrado em {info.filename}; release abortada.")
            contents = contents.replace(old, after.encode("utf-8"))
            changed.add(info.filename)
        if info.filename == "plany/central.rb":
            text = contents.decode("utf-8")
            from_dep = "app.js manifest.webmanifest"
            required = "app.js manifest.webmanifest index.html styles.css"
            if required not in text:
                if text.count(from_dep) != 1:
                    raise SystemExit("A identificação da Central é incompatível com 0.6.150.")
                contents = contents.replace(from_dep.encode(), required.encode())
                changed.add(info.filename)
        output.writestr(info, contents)
if set(changes) - changed:
    raise SystemExit("Nem todos os componentes solicitados foram modificados.")

with zipfile.ZipFile(DESTINATION) as package:
    files = set(package.namelist())
    required_files = {"plany.rb","plany/main.rb","plany/reloader.rb","plany/central/index.html",
                      "plany/central/styles.css","plany/central/server.cjs","plany/central.rb",
                      "plany/ui/index.html","plany/central/launch.ps1"}
    if not required_files.issubset(files) or "plany/development.json" in files:
        raise SystemExit("RBZ novo incompleto ou contendo artefato de desenvolvimento.")
    if "extension.version = '0.6.150'" not in package.read("plany.rb").decode("utf-8"):
        raise SystemExit("Versão do carregador incompatível.")
    if '<span class="version">0.6.150</span>' not in package.read("plany/ui/index.html").decode("utf-8"):
        raise SystemExit("Versão da interface incompatível.")
    central = package.read("plany/central/index.html").decode("utf-8")
    expected = "* Serra é o material consumido em cada corte.<br>** Refilo é a margem retirada de cada borda.<br>*** O veio da chapa acompanha o comprimento."
    if expected not in central or "include-retalhos" not in central or "retalhos-warning" not in central:
        raise SystemExit("Orientações, controle ou aviso de retalhos ausentes.")
    if "app.js manifest.webmanifest index.html styles.css" not in package.read("plany/central.rb").decode("utf-8"):
        raise SystemExit("Identificação Ruby da Central está desatualizada.")
    if "'index.html','styles.css'" not in package.read("plany/central/server.cjs").decode("utf-8"):
        raise SystemExit("Identificação Node da Central está desatualizada.")
    if "'index.html','styles.css'" not in package.read("plany/central/launch.ps1").decode("utf-8"):
        raise SystemExit("Inicializador não monitora HTML e CSS.")
    package.testzip()
digest = hashlib.sha256(DESTINATION.read_bytes()).hexdigest()
record = {"version": VERSION, "file": str(DESTINATION), "sha256": digest,
          "size": DESTINATION.stat().st_size, "base_release": PREVIOUS,
          "changed_files": sorted(changed)}
Path("dist/release-manifest-0.6.150.json").write_text(json.dumps(record, indent=2)+"\n")
print(json.dumps(record, indent=2), flush=True)
