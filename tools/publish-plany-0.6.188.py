#!/usr/bin/env python3
"""Publish only the SHA-pinned Plany 0.6.188 channel update, with a full installer if verified.
Version support is SketchUp 2024 only. Real SketchUp acceptance is deferred by owner.
Does NOT touch personal installations, project files, prior releases, or the pilot channel.
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

REPO='raullqueirozz9292/Plany-Distribuicao'
VERSION='0.6.188'
TAG='v'+VERSION
MAIN='v0.6.181'
DONOR='v0.6.45'
SOURCE='3c2a9aaf857473d1f4ba4bfefe714d1dbf804afc'
EXPECTED_SHA='55da231604e4f7eae54a0cac7465e2f0d28b4c36531e282e1f8a240c8a718971'
EXPECTED_DONOR_SHA='ee82a0c1121a045c932bab78c8138d2f0647bbca5dd383ece4180855087fa6e5'

def sh(cmd):
    return subprocess.check_output(cmd, text=True)

def api(endpoint):
    return json.loads(sh(['gh','api','repos/'+REPO+'/'+endpoint]))

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def verify_zip(path,complete=False):
    with zipfile.ZipFile(path) as z:
        names=z.namelist()
        assert len(names)==len(set(names)), 'Duplicate ZIP entries forbidden'
        assert not any(name.startswith('/') or '..' in name.split('/') or '\\' in name for name in names)
        assert all(name=='plany.rb' or name.startswith('plany/') for name in names)
        assert 'plany/distribution.json' not in names, 'Pilot package rejected'
        assert z.testzip() is None, 'Corrupted archive'
        loader=z.read('plany.rb').decode('utf-8')
        html=z.read('plany/ui/index.html').decode('utf-8')
        assert "extension.version = '0.6.188'" in loader, 'Not version 188'
        assert "SketchupExtension.new('Plany — Módulos', 'plany/main')" in loader
        assert '<span class="version">0.6.188</span>' in html
        assert b'PLANY_TRANSPORT:' in z.read('plany/trial_check.ps1'), 'HTTPS diagnostics missing'
        assert b'recover_plany_update' in z.read('plany/main.rb'), 'Safe reload recovery missing'
        assert b'production-scope-options' in z.read('plany/ui/standards.js'), 'Production radio UI fix missing'
        assert len(names)==(821 if complete else 472), 'Unexpected archive inventory size'
        return names

def reconstruct(manifest,out):
    encoded=[]
    assert manifest['archive']=='Plany-0.6.188.rbz' and manifest['origin_commit']==SOURCE
    assert manifest['update_sha256']==EXPECTED_SHA and manifest['size']==3185597
    assert manifest['official_repository']==REPO and manifest['supported_sketchup']==[2024]
    chunks=manifest['segments']
    assert len(chunks)==22 and len(set(e['sha'] for e in chunks))==22
    for i,part in enumerate(chunks):
        assert part['i']==i and re.fullmatch(r'[a-f0-9]{40}',part['sha'])
        blob=api('git/blobs/'+part['sha'])
        assert blob['encoding']=='base64' and blob['size']==part['size']
        plain=base64.b64decode(blob['content']).decode('ascii')
        assert len(plain)==part['size'] and sha(plain.encode())==part['utf8_sha256']
        gitsha=hashlib.sha1(('blob '+str(len(plain))+'\0').encode()+plain.encode()).hexdigest()
        assert gitsha==part['sha'], 'Git blob identity changed'
        encoded.append(plain)
    raw=base64.b64decode(''.join(encoded),validate=True)
    assert len(raw)==manifest['size'] and sha(raw)==EXPECTED_SHA, 'End-to-end RBZ checksum mismatch'
    out.write_bytes(raw)
    verify_zip(out)
    print('PASS pinned original RBZ:',EXPECTED_SHA,'bytes',len(raw),flush=True)

def build_full(update,donor,destination):
    # Preserve the exact tested update recipe; donor contributes render images ONLY.
    # All images must match SHA-256 from the CURRENT catalog, not the old catalog.
    expected={}
    with zipfile.ZipFile(update) as candidate, zipfile.ZipFile(donor) as old:
        for brand in ('arauco','berneck','duratex','guararapes'):
            data=json.loads(candidate.read('plany/catalog/'+brand+'/manifest.json'))
            for item in data['entries']:
                rel=item.get('render_texture')
                if not rel:continue
                name='plany/'+rel
                digest=item.get('render_sha256')
                assert isinstance(digest,str) and re.fullmatch(r'[a-f0-9]{64}',digest)
                if name in expected:assert expected[name]==digest
                expected[name]=digest
        # There are 351 distinct catalog render references. Two mandatory
        # seamless UI images are already included in the update RBZ, leaving
        # exactly 349 donor render files to append (821 = 472 + 349).
        assert len(expected)==351, 'Expected 351 verified catalog render references'
        embedded=set(expected).intersection(candidate.namelist())
        assert embedded=={'plany/ui/cinza-sagrado-cristallo-seamless.png','plany/ui/branco-tx-seamless.png'}, 'Unexpected update-embedded render files'
        for name in embedded:
            assert sha(candidate.read(name))==expected[name], 'Update-embedded render digest mismatch: '+name
        missing={name:digest for name,digest in expected.items() if name not in embedded}
        assert len(missing)==349, 'Expected 349 donor-owned renders'
        old_names=set(old.namelist())
        with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as full:
            for entry in candidate.infolist():
                full.writestr(entry,candidate.read(entry.filename))
            for name,digest in sorted(missing.items()):
                assert name in old_names,'Render missing in official v0.6.45: '+name
                image=old.read(name)
                assert sha(image)==digest, 'Stale render SHA-256 in donor: '+name
                full.writestr(name,image)
    verify_zip(destination,True)
    print('PASS complete 188: 349 appended and 2 already embedded = 351 verified images, SHA',sha(destination.read_bytes()),flush=True)
    return len(expected)

def main():
    assert os.environ.get('GITHUB_REPOSITORY')==REPO
    assert os.environ.get('GITHUB_REF')=='refs/heads/publish/oficial-0.6.188-20261109'
    assert os.environ.get('GH_TOKEN'), 'GITHUB_TOKEN with contents:write required'
    meta=json.loads(Path('tools/0.6.188-handoff.json').read_text(encoding='utf-8'))
    latest=api('releases/latest')
    assert latest['tag_name']==MAIN and not latest['draft'],'Official latest changed; abort'
    releases=api('releases?per_page=80')
    assert all(r['tag_name']!=TAG for r in releases),'Existing release: never overwrite'
    assert all(not r['draft'] or r['tag_name']!=TAG for r in releases)
    dist=Path('dist-188');dist.mkdir(exist_ok=False)
    update=dist/'Plany-0.6.188.rbz'
    reconstruct(meta,update)
    donor=dist/'Plany-0.6.45.rbz'
    subprocess.run(['gh','release','download',DONOR,'--repo',REPO,'--pattern','Plany-0.6.45.rbz','--dir',str(dist)],check=True)
    assert sha(donor.read_bytes())==EXPECTED_DONOR_SHA,'Trusted complete installer donor changed'
    full=dist/'Plany-0.6.188-completo.rbz'
    nrender=build_full(update,donor,full)
    att={
        update.name:{'sha256':sha(update.read_bytes()),'size':update.stat().st_size,'kind':'update'},
        full.name:{'sha256':sha(full.read_bytes()),'size':full.stat().st_size,'kind':'complete'}
    }
    manifest={'version':VERSION,'channel':'official','supported_sketchup':[2024],
              'native_sketchup_2024_verification':'deferred at owner request',
              'source_repository':'raullqueirozz9292/Plany','source_commit':SOURCE,
              'published_after_automated_synthetic_validation':True,
              'prior_official':MAIN,'render_donor':DONOR,'verified_unique_renders':nrender,
              'assets':att}
    manifest_path=dist/'Plany-0.6.188-integridade.json'
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    notes=dist/'notas-0.6.188.md'
    notes.write_text('''# Plany 0.6.188 — canal oficial para SketchUp 2024

Atualização cumulativa com todas as correções das versões 0.6.182 até 0.6.187 e ajuste do formulário de Produção. Inclui correções de portas e ferragens, espaçamento de divisórias, confirmação via Enter, comunicação do editor, diagnóstico de autenticação HTTPS e recuperação de atualização sem liberar o editor sem licença.

**Suporte atual: SketchUp 2024. O SketchUp 2021 foi retirado do suporte por decisão do desenvolvedor.** Nenhuma validação de funcionamento no SketchUp 2021 é declarada.

**Instalações existentes:** use a opção **Recarregar Plany** se o acesso estiver funcionando. O arquivo `Plany-0.6.188.rbz` é o pacote de atualização e não inclui as 351 texturas completas.

**Primeira instalação e recuperação quando o login da versão 0.6.181 impede a atualização:** use o arquivo **Plany-0.6.188-completo.rbz** pelo Gerenciador de Extensões do SketchUp 2024. Feche e reabra o SketchUp. A recuperação não remove a necessidade de validar o código de acesso online.

**Estado da homologação:** por solicitação expressa do desenvolvedor, a publicação foi realizada antes dos ensaios nativos no SketchUp 2024. Os testes automatizados e a integridade de arquivos passaram; o funcionamento final no SketchUp 2024 real será avaliado posteriormente. Portanto, esta release não possui certificação nativa de uso. Faça cópia de segurança dos projetos antes de instalar.

**Integridade:** consulte o arquivo de manifesto JSON desta release, com SHA-256 dos pacotes e commit de origem. Publicações anteriores e dados dos usuários não foram removidos. A Central de corte possui testes de validade e economia em casos sintéticos, mas isso não garante aproveitamento matematicamente ótimo para todos os projetos.
''',encoding='utf-8')
    latest=api('releases/latest')
    assert latest['tag_name']==MAIN,'Latest changed during preparation; abort'
    print('Creating official DRAFT with SHA-256 verified artifacts:',att,flush=True)
    subprocess.run(['gh','release','create',TAG,str(update),str(full),str(manifest_path),
                    '--repo',REPO,'--target','main','--draft','--title',
                    'Plany 0.6.188 — versão oficial para SketchUp 2024',
                    '--notes-file',str(notes)],check=True)
    releases=api('releases?per_page=80')
    found=[r for r in releases if r['tag_name']==TAG]
    assert len(found)==1 and found[0]['draft'] and not found[0]['prerelease'],'Unverified release identity'
    assets={x['name']:x for x in found[0]['assets']}
    for name,identity in att.items():
        item=assets.get(name)
        assert item and item.get('size')==identity['size'] and item.get('digest')=='sha256:'+identity['sha256'],'Remote SHA-256 mismatch for '+name
    m=assets.get(manifest_path.name)
    assert m and m['size']==manifest_path.stat().st_size and m['digest']=='sha256:'+sha(manifest_path.read_bytes())
    assert api('releases/latest')['tag_name']==MAIN, 'Public latest changed while draft'
    print('PASS: DRAFT assets verified remotely, now publishing on express developer authorization.',flush=True)
    subprocess.run(['gh','api','--method','PATCH','repos/'+REPO+'/releases/'+str(found[0]['id']),
                    '-F','draft=false','-f','make_latest=true'],check=True,stdout=subprocess.DEVNULL)
    latest=api('releases/latest')
    assert latest['tag_name']==TAG and not latest['draft'],'Public latest not switched correctly'
    public={x['name']:x for x in latest['assets']}
    for name,identity in att.items():
        assert public[name]['digest']=='sha256:'+identity['sha256'] and public[name]['size']==identity['size']
    print('PUBLIC_RELEASE_188='+latest['html_url'],flush=True)
    print('PUBLIC_UPDATE_SHA256='+EXPECTED_SHA,flush=True)
    print('PUBLIC_COMPLETE_SHA256='+att[full.name]['sha256'],flush=True)

if __name__=='__main__':
    main()
