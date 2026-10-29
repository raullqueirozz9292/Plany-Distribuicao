for(const slideshow of document.querySelectorAll('[data-project-slideshow]')){
  const slides=[...slideshow.querySelectorAll('[data-project-slide]')];
  if(slides.length<2)continue;
  const controls=slideshow.querySelector('[data-project-controls]');
  const counter=slideshow.querySelector('[data-project-counter]');
  const pause=slideshow.querySelector('[data-project-pause]');
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let current=0,timer=null,paused=motion.matches,hovered=false,focused=false;
  function schedule(){
    clearInterval(timer);timer=null;
    if(!paused&&!hovered&&!focused&&!document.hidden)timer=setInterval(()=>show(current+1),6000);
  }
  function show(index){
    current=(index+slides.length)%slides.length;
    slides.forEach((slide,n)=>{slide.hidden=n!==current;});
    counter.textContent=`${slides[current].dataset.projectName} · ${current+1}/${slides.length}`;
  }
  function updatePause(){
    pause.setAttribute('aria-pressed',String(paused));
    pause.setAttribute('aria-label',paused?'Retomar apresentação':'Pausar apresentação');
    pause.textContent=paused?'▶':'❚❚';
    schedule();
  }
  controls.hidden=false;show(0);updatePause();
  slideshow.querySelector('[data-project-previous]').addEventListener('click',()=>{show(current-1);schedule();});
  slideshow.querySelector('[data-project-next]').addEventListener('click',()=>{show(current+1);schedule();});
  pause.addEventListener('click',()=>{paused=!paused;updatePause();});
  slideshow.addEventListener('mouseenter',()=>{hovered=true;schedule();});
  slideshow.addEventListener('mouseleave',()=>{hovered=false;schedule();});
  slideshow.addEventListener('focusin',()=>{focused=true;schedule();});
  slideshow.addEventListener('focusout',event=>{focused=slideshow.contains(event.relatedTarget);schedule();});
  slideshow.addEventListener('keydown',event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();show(current+(event.key==='ArrowRight'?1:-1));schedule();
  });
  motion.addEventListener('change',()=>{paused=motion.matches;updatePause();});
  document.addEventListener('visibilitychange',schedule);
  window.addEventListener('pagehide',()=>clearInterval(timer));
  window.addEventListener('pageshow',schedule);
}

// O formulário só é mostrado após confirmação explícita do serviço no mesmo domínio.
const form=document.querySelector('#interest-form');
const status=document.querySelector('#form-status');
let ready=false;
async function checkAvailability(){
  if(!form||location.protocol==='file:')return;
  try{
    const response=await fetch('/health',{cache:'no-store',credentials:'omit'});
    const result=await response.json();
    ready=response.ok&&result.service==='ecossistema-y-site'&&result.intake_enabled===true;
    if(ready){form.hidden=false;document.querySelector('[data-intake-unavailable]').hidden=true;}
  }catch{/* A informação de indisponibilidade já está visível antes de qualquer dado pessoal. */}
}
checkAvailability();
form?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!ready||!form.reportValidity())return;
  const fields=new FormData(form),params=new URLSearchParams(location.search);
  const payload={product:form.dataset.product,name:String(fields.get('name')||'').trim(),email:String(fields.get('email')||'').trim(),phone:String(fields.get('phone')||'').trim(),consent:fields.get('consent')==='on',website:String(fields.get('website')||'')};
  for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])payload[key]=String(params.get(key)||'').slice(0,80);
  const button=form.querySelector('button[type=submit]');button.disabled=true;status.textContent='Registrando seu interesse…';
  try{
    const response=await fetch('/v1/leads',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify(payload)});
    const result=await response.json().catch(()=>({}));
    if(response.status!==202||result.ok!==true)throw new Error(result.error==='lead_service_unavailable'?'O cadastro está temporariamente indisponível. Nenhum registro foi confirmado.':result.error==='rate_limited'?'Limite temporário de tentativas. Tente novamente mais tarde.':'Não foi possível confirmar seu cadastro. Tente novamente mais tarde.');
    status.textContent='Solicitação recebida! Entraremos em contato quando houver novidades.';form.reset();
  }catch(error){status.textContent=error.message||'Não foi possível confirmar seu cadastro.';}
  finally{button.disabled=false;}
});
