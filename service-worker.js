const CACHE="manga-regal-pwa-v11";
const CORE=["./","./index.html","./styles.css?v=11","./app.js?v=11","./config.js","./series-management.js?v=11","./sync-state.js?v=11","./backup-format.js?v=11","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png"];

self.addEventListener("install",e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())
));

self.addEventListener("activate",e=>e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith("manga-regal-pwa-")&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();

})()));

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const url=new URL(e.request.url);

  if(url.origin===location.origin){
    e.respondWith(
      fetch(e.request)
        .then(resp=>{
          if(resp.ok){const copy=resp.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)));}
          return resp;
        })
        .catch(async()=>{
          const cache=await caches.open(CACHE);
          return await cache.match(e.request) || (e.request.mode==="navigate" ? await cache.match("./index.html") : undefined) || Response.error();
        })
    );
    return;
  }

  if(url.hostname==="cdn.jsdelivr.net"){
    e.respondWith(
      caches.match(e.request).then(cached=>cached||fetch(e.request).then(resp=>{
        const copy=resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return resp;
      }))
    );
  }
});
