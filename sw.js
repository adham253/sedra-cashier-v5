"use strict";
// CACHE REVISION MUST CHANGE with each deployment. Never touch another app's caches.
const CACHE="sedra-pos-v5-20261111_2",PREFIX="sedra-pos-v5-";
const PRECACHE=["./","./index.html","./styles.20261111_2.css","./app.20261111_2.js","./v5-upgrade.20261111_2.js","./v5.2.20261111_2.js","./pwa-updater.20261111_2.js","./xlsx-mini.js","./seed-products.js","./icon-192.png","./icon-512.png","./manifest.webmanifest","./version.json"];
const BASE=new URL(self.registration.scope);
function ours(url){const u=new URL(url);return u.origin===BASE.origin&&u.pathname.startsWith(BASE.pathname)}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(PRECACHE.map(u=>new Request(new URL(u,self.registration.scope).href,{cache:'reload'})));await self.skipWaiting()})());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||!ours(req.url))return;
  const url=new URL(req.url),isNavigation=req.mode==='navigate';
  // GitHub Pages: always try fresh HTML/JS/CSS first, offline: serve the latest cached revision.
  if(url.pathname.endsWith('/version.json')){
    event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match('./version.json')));return;
  }
  event.respondWith((async()=>{
    try{
      const response=await fetch(req,{cache:'no-store'});
      if(response.ok){
        try{
          const cache=await caches.open(CACHE);
          // navigation cached under a stable key (the PWA start_url)
          if(isNavigation){await cache.put('./index.html',response.clone());}
          else{await cache.put(req,response.clone());}
        }catch(cacheError){console.warn('Sedra cache write failed',cacheError)}
      }
      return response;
    }catch(error){
      const cache=await caches.open(CACHE);
      const saved=await cache.match(req);
      if(saved)return saved;
      if(isNavigation)return (await cache.match('./index.html'))||Response.error();
      return Response.error();
    }
  })());
});
