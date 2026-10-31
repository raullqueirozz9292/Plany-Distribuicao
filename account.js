import {initAccountEntry} from './account-entry.js?v=19f5c31821673db34e902ad80e3f8fc37b457bcd';
import {afterLayout,alignContent,onPageReady} from './framing.js?v=19f5c31821673db34e902ad80e3f8fc37b457bcd';
const root=document.querySelector('[data-account-entry]');
const entry=initAccountEntry(root);
// Marketing-only framing: keep the shared portal/authentication component intact.
if(entry){
 const frame=async(initial=false)=>{await afterLayout();alignContent(root,{initial});};
 root.addEventListener('click',event=>{
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const link=event.target.closest('a[href]');if(!link||!['#entrar','#criar-conta'].includes(link.hash))return;
  if(!link.matches('[data-access-mode]')){
   event.preventDefault();history.pushState(null,'',location.pathname+location.search+link.hash);
   entry.select(link.hash==='#criar-conta'?'signup':'login');
  }
  frame();
 });
 root.addEventListener('keydown',event=>{if(event.target.matches('[data-access-mode]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key))frame();});
 window.addEventListener('hashchange',()=>frame());
 onPageReady(()=>{if(['#entrar','#criar-conta'].includes(location.hash))frame(true);});
}
// Navigation only. The portal owns OAuth; credentials never pass through marketing.
if(entry&&['http:','https:'].includes(location.protocol)){
 fetch('./v1/account/access',{cache:'no-store',credentials:'omit',redirect:'error'})
  .then(async response=>{if(!response.ok)return;const data=await response.json();if(data.configured!==true)return;
   const portal=new URL(data.portal_url);if(portal.protocol!=='https:'||portal.username||portal.password||portal.search||portal.hash||portal.pathname!=='/'||portal.origin===location.origin)return;
   portal.hash=location.hash==='#criar-conta'?'criar-conta':'entrar';location.replace(portal.href);
  }).catch(()=>{});
}
