"use strict";
/* Sedra POS V5: update logic is separate from the business database. NEVER remove site data. */
(()=>{
  const BUILD="2026.11.11.3", BASE="./";
  let reg=null, checkPromise=null, lastCheck=0, banner=null;
  const $=s=>document.querySelector(s);
  const text=(s)=>{const node=$("#updateCheckStatus");if(node)node.textContent=s};
  function createBanner(message){
    if(banner)return banner;
    banner=document.createElement('div');
    banner.id='sedraUpdateNotice';
    banner.style.cssText='position:fixed;top:12px;left:10px;right:10px;z-index:999999;background:#173923;border:1px solid #58ce8a;border-radius:12px;padding:12px;color:#f0fff5;box-shadow:0 6px 24px #000a;direction:rtl;text-align:right;font-family:Tahoma,Arial,sans-serif;font-size:14px';
    document.body.appendChild(banner);
    banner.innerHTML='<div style="font-weight:bold;margin-bottom:8px">'+message+'</div><button id="sedraReload" style="border:0;padding:9px 16px;background:#38d58a;color:#092316;border-radius:8px;font-weight:bold;cursor:pointer">فتح النسخة الجديدة</button> <button id="sedraLater" style="border:1px solid #537360;padding:8px 15px;background:#143121;color:#fff;border-radius:8px;cursor:pointer">بعد انتهاء الفاتورة</button>';
    banner.querySelector('#sedraReload').addEventListener('click',()=>{if(window.sedraHasUnsavedCart?.()&&!confirm('فيه فاتورة غير محفوظة؛ فتح التحديث هيضيع الفاتورة الحالية. متأكد؟'))return;location.reload()});
    banner.querySelector('#sedraLater').addEventListener('click',()=>{banner.remove();banner=null});
    return banner;
  }
  async function check(manual=false){
    if(checkPromise)return checkPromise;
    if(!navigator.onLine){if(manual)text('الجهاز غير متصل؛ الإصدار الحالي يعمل Offline.');return;}
    if(!manual&&Date.now()-lastCheck<15*60*1000)return;
    lastCheck=Date.now();
    checkPromise=(async()=>{
      try{
        if(reg)await reg.update();
        const response=await fetch(BASE+'version.json?check='+Date.now(),{cache:'no-store'});
        if(!response.ok)throw Error('تعذر جلب رقم الإصدار');
        const data=await response.json();
        if(data.build&&data.build!==BUILD){
          text('فيه إصدار جديد جاهز. افتحه بعد إنهاء الفاتورة الحالية.');
          createBanner('فيه تحديث جديد لكاشير سدرة V5. احفظ الفاتورة الحالية أولًا.');
          return;
        }
        if(manual)text('عندك أحدث إصدار: '+BUILD);
      }catch(e){if(manual)text('تعذر التحقق حاليًا؛ حاول وأنت متصل بالإنترنت.');console.warn('Sedra update check',e)}
    })().finally(()=>{checkPromise=null});
    return checkPromise;
  }
  async function start(){
    const version=$('#currentBuild');if(version)version.textContent='V5.2 · '+BUILD;
    const btn=$('#checkAppUpdate');if(btn)btn.addEventListener('click',()=>check(true));
    if(!('serviceWorker' in navigator)||!window.isSecureContext){
      text('التحديث التلقائي متاح على HTTPS أو localhost فقط.');return;
    }
    const hadController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(!hadController)return;
      // NEVER auto-reload: an unpaid bill or unsaved supplier draft could be lost.
      createBanner('تم تحديث ملفات كاشير سدرة. افتح الإصدار الجديد بعد حفظ أي فاتورة مفتوحة.');
    });
    try{
      reg=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
      reg.addEventListener('updatefound',()=>{
        const worker=reg.installing;
        if(!worker)return;
        worker.addEventListener('statechange',()=>{
          if(worker.state==='installed' && navigator.serviceWorker.controller){
            createBanner('تم تجهيز تحديث جديد للكاشير. احفظ الفاتورة الحالية، ثم حدّث التطبيق.');
          }
        });
      });
      // registers & checks on EACH launch, including the installed PWA and not just Chrome tab.
      await check(false);
    }catch(e){console.warn('Sedra PWA register',e);text('تعذر تسجيل التحديث تلقائيًا. التطبيق ما زال قابلًا للاستخدام.')}
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)check(false)});
    window.addEventListener('online',()=>check(false));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
