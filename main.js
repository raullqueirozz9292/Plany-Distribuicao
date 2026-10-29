import {priceExample,scheduleExample,dayOffset} from './demo-models.js?v=5a05189c0c947381e97018f78de514e8e1379378';
import {afterLayout,alignContent,onPageReady} from './framing.js?v=5a05189c0c947381e97018f78de514e8e1379378';

document.documentElement.classList.add('js');
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
const percent=n=>n.toFixed(1).replace('.',',')+'%';
const short=d=>d.slice(8,10)+'/'+d.slice(5,7);
const nav=document.querySelector('#primary-nav');
const toggle=document.querySelector('#nav-toggle');
if(nav&&toggle){
  toggle.hidden=false;
  const setMenu=open=>{nav.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'Fechar':'Menu';};
  toggle.addEventListener('click',()=>setMenu(toggle.getAttribute('aria-expanded')!=='true'));
  nav.addEventListener('click',event=>{if(event.target.closest('a'))setMenu(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&nav.classList.contains('is-open')){setMenu(false);toggle.focus();}});
  document.addEventListener('click',event=>{if(!nav.contains(event.target)&&!toggle.contains(event.target))setMenu(false);});
  matchMedia('(min-width:851px)').addEventListener('change',()=>setMenu(false));
}

const tablist=document.querySelector('[data-product-tabs]');
let selectProduct=null;
if(tablist){
  const tabs=[...tablist.querySelectorAll('button')];
  const panels=[...document.querySelectorAll('.product-panel')];
  tablist.hidden=false;tablist.setAttribute('role','tablist');
  const select=(id,focus=false,writeHash=false)=>{
    if(!panels.some(p=>p.id===id))return;
    for(const tab of tabs){const selected=tab.dataset.product===id;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',tab.dataset.product);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus();}
    for(const panel of panels){panel.hidden=panel.id!==id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','tab-'+panel.id);}
    if(writeHash)history.replaceState(null,'','#'+id);
  };
  selectProduct=id=>select(id);
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>select(tab.dataset.product,false,true));
    tab.addEventListener('keydown',event=>{
      let next=index;
      if(event.key==='ArrowRight')next=(index+1)%tabs.length;
      else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=tabs.length-1;
      else return;
      event.preventDefault();select(tabs[next].dataset.product,true,true);
    });
  });
  const fromHash=()=>{const id=location.hash.slice(1);if(panels.some(p=>p.id===id))select(id);};
  select(panels.some(p=>p.id===location.hash.slice(1))?location.hash.slice(1):'plany');
  window.addEventListener('hashchange',fromHash);
}

// Reveal the requested product before positioning. Native anchors cannot scroll
// to a panel that was hidden when the link was followed.
let navigation=0;
async function followFragment({initial=false}={}){
 const generation=++navigation;
 let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}
 const target=document.getElementById(id);
 if(!target||target.matches('.account-pane'))return;
 const product=target.matches('.product-panel');
 if(product)selectProduct?.(id);
 await afterLayout();if(generation!==navigation)return;
 alignContent(product?tablist:target,{initial});
}
const documentPath=path=>path.endsWith('/')?path+'index.html':path;
document.addEventListener('click',event=>{
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const link=event.target.closest('a[href]');if(!link||link.target||link.hasAttribute('download'))return;
 const url=new URL(link.href,location.href);
 if(url.origin!==location.origin||documentPath(url.pathname)!==documentPath(location.pathname)||!url.hash)return;
 let target;try{target=document.getElementById(decodeURIComponent(url.hash.slice(1)));}catch{return;}
 if(!target||target.matches('.account-pane'))return;
 event.preventDefault();if(location.hash!==url.hash)history.pushState(null,'',url.pathname+url.search+url.hash);
 followFragment();
});
window.addEventListener('hashchange',()=>followFragment());
window.addEventListener('popstate',()=>followFragment());
onPageReady(()=>followFragment({initial:true}));

// The restored scene has a fixed authoring canvas. Its occupied layout space
// must follow its proportional scale, rather than the unscaled canvas height.
const scene=document.querySelector('.heritage-scene'),slot=scene?.parentElement;
if(scene&&slot){
 const hero=slot.closest('.hero'),art=slot.closest('.hero-art');
 let queued=false;
 const fit=()=>{
  queued=false;
  if(innerWidth<=600){slot.style.removeProperty('--scene-height');scene.style.removeProperty('--scene-scale');return;}
  const layout=getComputedStyle(hero),desktop=innerWidth>850;
  const nonScene=art.offsetHeight-slot.offsetHeight;
  const available=innerHeight-(hero.getBoundingClientRect().top+scrollY)-parseFloat(layout.paddingTop)-parseFloat(layout.paddingBottom)-nonScene;
  const scale=Math.min(.8,slot.clientWidth/660,desktop?Math.max(610*.46,available)/610:.8);
  const height=(610*scale).toFixed(2)+'px',value=scale.toFixed(5);
  if(slot.style.getPropertyValue('--scene-height')!==height)slot.style.setProperty('--scene-height',height);
  if(scene.style.getPropertyValue('--scene-scale')!==value)scene.style.setProperty('--scene-scale',value);
 };
 const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(fit);}};
 // Establish the occupied space during module startup, before load completes.
 // Observers then refine it for fonts and viewport changes without a late jump.
 fit();new ResizeObserver(schedule).observe(art);window.addEventListener('resize',schedule);onPageReady(schedule);
}

for(const demo of document.querySelectorAll('[data-pricing]')){
  const input=demo.querySelector('[data-discount]'),protect=demo.querySelector('[data-protect]');
  demo.querySelector('[data-js-controls]').disabled=false;
  demo.querySelector('[data-js-note]').hidden=true;
  const update=()=>{
    const result=priceExample(Number(input.value),protect.checked);
    demo.querySelector('[data-discount-label]').textContent=String(result.discount).replace('.',',')+'%';
    input.setAttribute('aria-valuetext',String(result.discount).replace('.',',')+' por cento');
    for(const key of ['cost','before','sale','profit'])demo.querySelector(`[data-price="${key}"]`).textContent=money(result[key]);
    demo.querySelector('[data-price="discount"]').textContent=String(result.discount).replace('.',',')+'%';
    demo.querySelector('[data-price="margin"]').textContent=percent(result.margin);
    for(const key of ['profit','margin'])demo.querySelector(`[data-metric="${key}"]`).classList.toggle('negative',result.profit<0);
    const status=demo.querySelector('[data-pricing-result]');
    status.dataset.warning=String(result.margin<10);
    status.textContent=(result.profit<0?'Preço abaixo do custo. ':result.margin<10?'Margem reduzida. ':'')+
      `Com ${result.discount}% de desconto, ${result.profit<0?'o prejuízo':'o lucro'} é ${money(Math.abs(result.profit))} e a margem é ${percent(result.margin)}. `+
      (result.protect?'A proteção ajustou o preço anterior ao desconto para preservar o lucro planejado.':'O desconto foi aplicado ao preço inicial, sem proteção do lucro.');
  };
  input.addEventListener('input',update);protect.addEventListener('change',update);update();
}

for(const demo of document.querySelectorAll('[data-schedule]')){
  const cut=demo.querySelector('[data-cut]'),sat=demo.querySelector('[data-saturday]'),holiday=demo.querySelector('[data-holiday]');
  demo.querySelector('[data-js-controls]').disabled=false;demo.querySelector('[data-js-note]').hidden=true;
  const update=()=>{
    const stages=scheduleExample(Number(cut.value),sat.checked,holiday.checked);
    const duration=Number(cut.value),label=duration+(duration===1?' dia útil':' dias úteis');
    demo.querySelector('[data-cut-label]').textContent=label;cut.setAttribute('aria-valuetext',label);
    demo.querySelector('[data-schedule-results]').replaceChildren(...stages.map(s=>{
      const item=document.createElement('div');item.className='schedule-item';
      const name=document.createElement('strong');name.textContent=`${s.name} · ${s.duration} ${s.duration===1?'dia útil':'dias úteis'}`;
      const dates=document.createElement('span');dates.textContent=short(s.start)+' a '+short(s.end);item.append(name,dates);return item;
    }));
    demo.querySelector('[data-schedule-chart]').replaceChildren(...stages.map(s=>{
      const row=document.createElement('div');row.className='schedule-chart-row';
      const label=document.createElement('span');label.textContent=s.name;
      const days=document.createElement('div');days.className='schedule-days';
      for(let n=0;n<24;n++){
        const cell=document.createElement('span');
        if(s.days.some(d=>dayOffset(d)===n)){const bar=document.createElement('i');cell.append(bar);}days.append(cell);
      }
      row.append(label,days);return row;
    }));
    demo.querySelector('[data-schedule-summary]').textContent=`Instalação prevista para ${short(stages.at(-1).end)}/2026. Corte: ${label}. ${sat.checked?'Com trabalho aos sábados.':'Sem trabalho aos sábados.'} ${holiday.checked?'Feriado de exemplo em 11/11 considerado.':'Sem o feriado de exemplo.'}`;
  };
  cut.addEventListener('input',update);sat.addEventListener('change',update);holiday.addEventListener('change',update);update();
}
for(const demo of document.querySelectorAll('[data-plany]')){
  const nav=demo.querySelector('[data-steps]'),buttons=[...nav.querySelectorAll('button')],panels=[...demo.querySelectorAll('[data-step-panel]')];
  nav.hidden=false;
  const select=n=>{for(const button of buttons)button.setAttribute('aria-pressed',String(Number(button.dataset.step)===n));for(const panel of panels)panel.hidden=Number(panel.dataset.stepPanel)!==n;};
  for(const button of buttons)button.addEventListener('click',()=>select(Number(button.dataset.step)));
  select(0);
}
