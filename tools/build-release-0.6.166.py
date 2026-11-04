#!/usr/bin/env python3
"""Build Plany 0.6.166 from verified 0.6.165 plus exact approved source changes.

Every source file (including native Ruby) is checked against the base and
target Git blob hashes. HTML is reconstructed around the legacy bootstrap
inlining contract, so the installed SketchUp 0.6.165 loader can read it.
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
BASE = DIST / 'Plany-0.6.165.rbz'
OUT = DIST / 'Plany-0.6.166.rbz'
PATCH_FILE = ROOT / 'tools/patch-0.6.166.json'
BASE_HASH = '1d24d74c78ed32bea2fb27ea48f39feeb3495b50c4d4e14ee54a9a360475b375'
SOURCE_COMMIT = 'PENDING_SOURCE_MERGE'
DEPS = [
    ('../glass.js','plany/glass.js'),
    ('../dimensions.js','plany/dimensions.js'),
    ('standards.js','plany/ui/standards.js'),
    ('editor-policy.js','plany/ui/editor-policy.js'),
    ('standards.css','plany/ui/standards.css'),
]

def file_digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()

def normalize(raw):
    return raw.replace(b'\r\n',b'\n')

def git_blob(raw):
    raw=normalize(raw)
    return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()

def assert_blob(name,raw,expected):
    got=git_blob(raw)
    if got!=expected[name]:
        raise ValueError(f'Git source mismatch: {name}, {got}, expected {expected[name]}')

def once(raw,old,new,description):
    n=raw.count(old)
    if n!=1:
        raise ValueError(f'{description}: expected exactly one unique patch anchor, found {n}')
    return raw.replace(old,new,1)

def patch(name,raw,contract):
    crlf=b'\r\n' in raw
    value=normalize(raw).decode('utf-8')
    assert_blob(name,value.encode(),contract['expected_base_blobs'])
    for item in contract['patches'][name]:
        value=once(value,item['before'],item['after'],name+'/'+item['label'])
    clean=value.encode('utf-8')
    assert_blob(name,clean,contract['expected_target_blobs'])
    return clean.replace(b'\n',b'\r\n') if crlf else clean

def marker(href):
    return '<link rel="stylesheet" href="'+href+'">' if href.endswith('.css') else '<script src="'+href+'"></script>'

def embed(href,source):
    tag='style' if href.endswith('.css') else 'script'
    content=re.sub(r'</'+tag,lambda match:'<\\/'+tag,normalize(source).decode('utf-8'),flags=re.I)
    return '<'+tag+'>'+content+'</'+tag+'>'

def reconstruct_source_html(archive,html):
    for href,name in reversed(DEPS):
        html=once(html,embed(href,archive.read(name)),marker(href),'restore source '+name)
    return html

def build():
    DIST.mkdir(exist_ok=True)
    contract=json.loads(PATCH_FILE.read_text(encoding='utf-8'))
    if contract['version']!='0.6.166' or contract['base_release']!='v0.6.165':
        raise ValueError('Unexpected source or release contract')
    if file_digest(BASE)!=BASE_HASH:
        raise ValueError('Old official RBZ does not match the verified immutable release')
    with ZipFile(BASE) as original:
        entries=original.infolist()
        names=[info.filename for info in entries]
        if len(names)!=len(set(names)) or original.testzip() is not None:
            raise ValueError('Old RBZ has duplicate paths or corruption')
        if not set(contract['patches']).issubset(names):
            raise ValueError('Missing source files in the update package')
        if not all(name=='plany.rb' or name.startswith('plany/') for name in names):
            raise ValueError('Non-plugin file in RBZ')
        changed={}
        for name in contract['patches']:
            if name=='plany/ui/index.html':continue
            changed[name]=patch(name,original.read(name),contract)

        html=reconstruct_source_html(original,normalize(original.read('plany/ui/index.html')).decode('utf-8'))
        verified_html=patch('plany/ui/index.html',html.encode('utf-8'),contract).decode('utf-8')
        for href,name in DEPS:
            verified_html=once(verified_html,marker(href),embed(href,changed.get(name,original.read(name))),'inline updated '+name)
        changed['plany/ui/index.html']=verified_html.encode('utf-8')

        with ZipFile(OUT,'w',ZIP_DEFLATED) as destination:
            for entry in entries:
                destination.writestr(entry,changed.get(entry.filename,original.read(entry.filename)))

    with ZipFile(OUT) as result:
        if result.testzip() is not None or len(result.namelist())!=len(names):
            raise ValueError('RBZ structure corrupted')
        html=result.read('plany/ui/index.html').decode('utf-8')
        loader=result.read('plany.rb').decode('utf-8')
        if "extension.version = '0.6.166'" not in loader:
            raise ValueError('Wrong native version')
        if '<span class="version">0.6.166</span>' not in html:
            raise ValueError('Wrong visible version')
        if any(item in html for item in ('src="editor-policy.js"','src="standards.js"','href="standards.css"','src="../dimensions.js"')):
            raise ValueError('Missing legacy bootstrap inlining')
        code=result.read('plany/ui/app.js').decode('utf-8')
        if 'Fita pendente. Clique em Concluir' in code or 'showPassive' in result.read('plany/ui/editor-policy.js').decode('utf-8'):
            raise ValueError('Previous UX regression remains')
    m={'version':'0.6.166','archive':OUT.name,'sha256':file_digest(OUT),
       'files':len(names),'source_commit':SOURCE_COMMIT,
       'base_sha256':BASE_HASH,'distribution_kind':'update',
       'source_blobs_verified':contract['expected_target_blobs']}
    (DIST/'manifest-0.6.166.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8')
    print('PLANY 0.6.166 PACKAGE VERIFIED',OUT.stat().st_size,'bytes')
    print(json.dumps(m,indent=2))

if __name__=='__main__':
    build()
