import {initAccountEntry} from './account-entry.js';
const entry=initAccountEntry(document.querySelector('[data-account-entry]'));
// Navigation only. The portal owns OAuth; credentials never pass through marketing.
if(entry&&['http:','https:'].includes(location.protocol)){
 fetch('./v1/account/access',{cache:'no-store',credentials:'omit',redirect:'error'})
  .then(async response=>{if(!response.ok)return;const data=await response.json();if(data.configured!==true)return;
   const portal=new URL(data.portal_url);if(portal.protocol!=='https:'||portal.username||portal.password||portal.search||portal.hash||portal.pathname!=='/'||portal.origin===location.origin)return;
   portal.hash=location.hash==='#criar-conta'?'criar-conta':'entrar';location.replace(portal.href);
  }).catch(()=>{});
}
