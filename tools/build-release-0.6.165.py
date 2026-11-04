#!/usr/bin/env python3
"""Build Plany 0.6.165 from immutable 0.6.164 RBZ and byte-audited Git patches.

Do not modify existing releases. The verified source blobs are those of
Plany PR #51, merged to main at bd01463118f6f79fdde2fd74060ae920c154b75d.
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'dist'
BASE=DIST/'Plany-0.6.164.rbz'
OUT=DIST/'Plany-0.6.165.rbz'
PATCH_FILE=ROOT/'tools/patch-0.6.165.json'
OLD_HASH='a3d8a74c267ba8cf5bfaa2225fe0301f96afd769fec97a63f9c45d760869da8c'
SOURCE_COMMIT='bd01463118f6f79fdde2fd74060ae920c154b75d'
DEPS=[
    ('../glass.js','plany/glass.js'),
    ('../dimensions.js','plany/dimensions.js'),
    ('standards.js','plany/ui/standards.js'),
    ('editor-policy.js','plany/ui/editor-policy.js'),
    ('standards.css','plany/ui/standards.css'),
]

def hash_file(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()

def normalize(data):
    return data.replace(b'\r\n',b'\n')

def git_blob(data):
    data=normalize(data)
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()

def assert_blob(name,data,mapping):
    actual=git_blob(data)
    expected=mapping[name]
    if actual!=expected:
        raise ValueError('Git blob mismatch for '+name+': '+actual+' != '+expected)

def once(text,old,new,description):
    count=text.count(old)
    if count!=1:
        raise ValueError(description+': expected one anchor, found '+str(count))
    return text.replace(old,new,1)

def marker_for(href):
    return '<link rel="stylesheet" href="'+href+'">' if href.endswith('.css') else '<script src="'+href+'"></script>'

def inlined_for(href,raw):
    css=href.endswith('.css')
    tag='style' if css else 'script'
    content=re.sub(r'</'+tag,lambda _:'<\\/'+tag,normalize(raw).decode('utf-8'),flags=re.I)
    return '<'+tag+'>'+content+'</'+tag+'>'

def reverse_embed(archive,html):
    for href,name in reversed(DEPS):
        html=once(html,inlined_for(href,archive.read(name)),marker_for(href),'uninline '+name)
    return html

def embed_new(read,html):
    for href,name in DEPS:
        html=once(html,marker_for(href),inlined_for(href,read(name)),'inline '+name)
    return html

def apply_patches(name,raw,config):
    original_crlf=b'\r\n' in raw
    text=normalize(raw).decode('utf-8')
    assert_blob(name,text.encode('utf-8'),config['expected_base_blobs'])
    for change in config['patches'].get(name,[]):
        text=once(text,change['before'],change['after'],name+'/'+change['label'])
    result=text.encode('utf-8')
    assert_blob(name,result,config['expected_target_blobs'])
    return result.replace(b'\n',b'\r\n') if original_crlf else result

def make():
    DIST.mkdir(exist_ok=True)
    config=json.loads(PATCH_FILE.read_text(encoding='utf-8'))
    if config['base_release']!='v0.6.164' or config['version']!='0.6.165':
        raise ValueError('Wrong release contract')
    if hash_file(BASE)!=OLD_HASH:
        raise ValueError('Official 0.6.164 package hash mismatch; refusing publication')
    with ZipFile(BASE) as base:
        entries=base.infolist()
        names=[entry.filename for entry in entries]
        if len(set(names))!=len(names) or base.testzip() is not None:
            raise ValueError('Base RBZ has corruption or duplicate file paths')
        if not set(config['expected_target_blobs']).issubset(names):
            raise ValueError('Missing patch target files')
        changed={}
        for name in config['patches']:
            changed[name]=apply_patches(name,base.read(name),config)

        loader=normalize(base.read('plany.rb')).decode('utf-8')
        assert_blob('plany.rb',loader.encode(),config['expected_base_blobs'])
        loader=once(loader,"extension.version = '0.6.164'","extension.version = '0.6.165'","Ruby version")
        assert_blob('plany.rb',loader.encode(),config['expected_target_blobs'])
        changed['plany.rb']=loader.encode('utf-8')

        # The official package embeds selected CSS/JS in HTML for SketchUp's
        # old bootstrap; verify original source before changing the markup.
        bundled_html=normalize(base.read('plany/ui/index.html')).decode('utf-8')
        source_html=reverse_embed(base,bundled_html)
        assert_blob('plany/ui/index.html',source_html.encode(),config['expected_base_blobs'])
        if source_html.count('0.6.164')!=2:
            raise ValueError('Unexpected count of UI version markers')
        source_html=source_html.replace('0.6.164','0.6.165')
        before='<span class="material-arrow">▾</span>'
        count=source_html.count(before)
        if count<10:
            raise ValueError('Unexpected number of material selectors: '+str(count))
        source_html=source_html.replace(before,'<span class="material-arrow" aria-hidden="true"></span>')
        assert_blob('plany/ui/index.html',source_html.encode(),config['expected_target_blobs'])
        changed['plany/ui/index.html']=embed_new(
            lambda name:changed.get(name,base.read(name)),source_html).encode('utf-8')

        with ZipFile(OUT,'w',compression=ZIP_DEFLATED) as destination:
            for entry in entries:
                if not (entry.filename=='plany.rb' or entry.filename.startswith('plany/')):
                    raise ValueError('Invalid package file path: '+entry.filename)
                destination.writestr(entry,changed.get(entry.filename,base.read(entry.filename)))

    with ZipFile(OUT) as result:
        if result.testzip() is not None or len(result.namelist())!=len(names):
            raise ValueError('Invalid final RBZ')
        if result.read('plany.rb')!=changed['plany.rb']:
            raise ValueError('Incorrect loader in RBZ')
        html=result.read('plany/ui/index.html').decode('utf-8')
        if '<span class="version">0.6.165</span>' not in html:
            raise ValueError('Incorrect version in UI')
        if any(token in html for token in (
            'src="standards.js"','href="standards.css"',
            'src="../dimensions.js"','src="editor-policy.js"')):
            raise ValueError('Legacy boot dependencies not embedded')

    manifest={'version':'0.6.165','archive':OUT.name,'sha256':hash_file(OUT),
              'files':len(names),'source_commit':SOURCE_COMMIT,
              'distribution_kind':'update','base_sha256':OLD_HASH,
              'source_blobs_verified':config['expected_target_blobs']}
    (DIST/'manifest-0.6.165.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('PLANY 0.6.165 VERIFIED',OUT.stat().st_size,'bytes')
    print(json.dumps(manifest,indent=2))

if __name__=='__main__':
    make()
