// Shared presentation and validation. No passwords, tokens or e-mails persisted.
export function initAccountEntry(root,{onContinue,unavailableText}={}){
 if(!root)return null;
 const win=root.ownerDocument.defaultView;
 const tabs=[...root.querySelectorAll('[data-access-mode]')];
 const panels=[...root.querySelectorAll('[data-access-panel]')];
 const forms=[...root.querySelectorAll('[data-access-form]')];
 const availability=root.querySelector('[data-access-availability]');
 let pending=false,loading=false;
 const modeForHash=()=>win.location.hash==='#criar-conta'?'signup':'login';
 function select(mode,focus=false){
  mode=mode==='signup'?'signup':'login';
  for(const tab of tabs){const active=tab.dataset.accessMode===mode;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',tab.dataset.accessMode==='login'?'entrar':'criar-conta');tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;if(active&&focus)tab.focus();}
  for(const panel of panels){panel.hidden=panel.dataset.accessPanel!==mode;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',panel.dataset.accessPanel==='login'?'access-login-tab':'access-signup-tab');}
 }
 function busy(value){pending=value;for(const form of forms){form.querySelector('button').disabled=value||loading;form.setAttribute('aria-busy',String(value));}}
 root.classList.add('account-entry-enhanced');root.querySelector('.account-modes').setAttribute('role','tablist');
 for(const tab of tabs){
  tab.addEventListener('click',event=>{event.preventDefault();if(pending)return;const hash=tab.dataset.accessMode==='signup'?'#criar-conta':'#entrar';win.history.replaceState(null,'',win.location.pathname+win.location.search+hash);select(tab.dataset.accessMode);});
  tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||pending)return;event.preventDefault();const mode=event.key==='Home'?'login':event.key==='End'?'signup':tab.dataset.accessMode==='login'?'signup':'login';win.history.replaceState(null,'',win.location.pathname+win.location.search+(mode==='signup'?'#criar-conta':'#entrar'));select(mode,true);});
 }
 for(const form of forms){
  form.querySelector('button').disabled=false;
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(pending||loading||!form.reportValidity())return;
   const feedback=form.querySelector('[data-access-feedback]');feedback.textContent='';
   const email=form.elements.email.value.trim();
   if(!email||email.length>254||/[\s\u0000-\u001f\u007f]/.test(email)){feedback.textContent='Confira o e-mail informado.';form.elements.email.focus();return;}
   if(!onContinue){feedback.textContent=unavailableText||'O acesso à Conta Y ainda não está disponível. Seu e-mail não foi enviado e nenhuma conta foi criada.';return;}
   busy(true);
   let redirecting=false;
   try{const result=await onContinue({intent:form.dataset.accessForm,email});redirecting=result?.redirected===true;}
   catch(error){feedback.textContent=typeof error?.userMessage==='string'?error.userMessage:'Não foi possível iniciar o acesso. Tente novamente.';}
   finally{if(!redirecting)busy(false);}
  });
 }
 win.addEventListener('hashchange',()=>select(modeForHash()));win.addEventListener('pageshow',event=>{if(event.persisted)busy(false);});select(modeForHash());
 return {select,clear(){for(const form of forms){form.reset();form.querySelector('[data-access-feedback]').textContent='';}busy(false);},setAvailability(text,{isLoading=false}={}){availability.textContent=text;loading=isLoading;for(const form of forms)form.querySelector('button').disabled=loading||pending;}};
}
