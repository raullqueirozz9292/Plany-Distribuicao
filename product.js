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
