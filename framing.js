// Shared positioning for the static commercial pages, including hidden panels.
export async function afterLayout(){
 await document.fonts.ready;
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}
export function alignContent(element,{initial=false}={}){
 if(!element||!element.getClientRects().length)return;
 const header=document.querySelector('.site-header'),headerStyle=header&&getComputedStyle(header);
 const inset=header&&['fixed','sticky'].includes(headerStyle.position)?Math.max(0,header.getBoundingClientRect().bottom):0;
 const top=Math.max(0,scrollY+element.getBoundingClientRect().top-inset);
 window.scrollTo({top,behavior:initial||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
export function onPageReady(callback){
 const run=()=>afterLayout().then(callback);
 if(document.readyState==='complete')run();else window.addEventListener('load',run,{once:true});
}
