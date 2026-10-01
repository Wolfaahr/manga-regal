const CACHE="manga-regal-pwa-v9";
const CORE=["./","./index.html","./styles.css?v=9","./app.js?v=9","./config.js","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png"];

self.addEventListener("install",e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())
));

self.addEventListener("activate",e=>e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
  const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  await Promise.all(clients.map(client=>client.navigate(client.url).catch(()=>{})));
})()));

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const url=new URL(e.request.url);

  if(url.origin===location.origin){
    e.respondWith(
      fetch(e.request)
        .then(resp=>{
          const copy=resp.clone();
          caches.open(CACHE).then(c=>c.put(e.request,copy));
          return resp;
        })
        .catch(()=>caches.match(e.request))
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
