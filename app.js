import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];
const CONFIGURED = !SUPABASE_URL.includes("PASTE_") && !SUPABASE_ANON_KEY.includes("PASTE_");
const supabase = CONFIGURED ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
}) : null;

let session = null;
let library = [];
let activeSeries = null;
let activeFilter = "all";
let currentView = "shelf";
let deferredInstallPrompt = null;
let syncing = false;

const CACHE_KEY = "manga-regal-cache-v1";
const QUEUE_KEY = "manga-regal-queue-v1";

function toast(msg){
  const el=$("#toast"); el.textContent=msg; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2200);
}
function flag(lang){ return lang==="de"?"🇩🇪":lang==="en"?"🇬🇧":lang==="ja"?"🇯🇵":"🌐"; }
function langName(lang){ return lang==="de"?"Deutsch":lang==="en"?"Englisch":lang==="ja"?"Japanisch":lang; }
function esc(s){ return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
function missingOf(s){ return s.volumes.filter(v=>v.volume_number<=s.released_count && !v.owned).map(v=>v.volume_number); }
function ownedCount(s){ return s.volumes.filter(v=>v.volume_number<=s.released_count && v.owned).length; }
function complete(s){ return missingOf(s).length===0; }
function progress(s){ return s.released_count ? Math.round(ownedCount(s)/s.released_count*100) : 0; }
function formatRanges(nums){
  if(!nums.length) return "—";
  const a=[...nums].sort((x,y)=>x-y), out=[];
  let start=a[0], prev=a[0];
  for(let i=1;i<=a.length;i++){
    const cur=a[i];
    if(cur===prev+1){ prev=cur; continue; }
    out.push(start===prev?String(start):`${start}–${prev}`);
    start=cur; prev=cur;
  }
  return out.join(", ");
}
function saveCache(){ localStorage.setItem(CACHE_KEY,JSON.stringify(library)); }
function loadCache(){
  try{ return JSON.parse(localStorage.getItem(CACHE_KEY)||"[]"); }catch{ return []; }
}
function getQueue(){
  try{ return JSON.parse(localStorage.getItem(QUEUE_KEY)||"[]"); }catch{ return []; }
}
function setQueue(q){ localStorage.setItem(QUEUE_KEY,JSON.stringify(q)); }

function setSync(text,mode=""){
  const el=$("#syncLabel"); el.textContent=text;
  el.style.color=mode==="ok"?"var(--good)":mode==="bad"?"var(--bad)":"";
}

function coverMarkup(s, detail=false){
  if(s.signed_cover_url){
    return `<img src="${esc(s.signed_cover_url)}" alt="Cover ${esc(s.title)}">`;
  }
  return `<div class="fallback-cover"><b>${esc(s.title)}</b><span>${flag(s.lang)} · ${s.released_count} Band${s.released_count===1?"":"e"}</span></div>`;
}

function updateStats(){
  $("#statSeries").textContent=library.length;
  $("#statOwned").textContent=library.reduce((n,s)=>n+ownedCount(s),0);
  $("#statMissing").textContent=library.reduce((n,s)=>n+missingOf(s).length,0);
  $("#statComplete").textContent=library.filter(complete).length;
}

function filteredSeries(){
  const q=$("#searchInput").value.trim().toLowerCase();
  let arr=library.filter(s=>s.title.toLowerCase().includes(q));
  if(activeFilter==="missing") arr=arr.filter(s=>!complete(s));
  if(activeFilter==="complete") arr=arr.filter(complete);
  if(["de","en","ja"].includes(activeFilter)) arr=arr.filter(s=>s.lang===activeFilter);
  const sort=$("#sortSelect").value;
  if(sort==="title") arr.sort((a,b)=>a.title.localeCompare(b.title,"de"));
  if(sort==="missing") arr.sort((a,b)=>missingOf(b).length-missingOf(a).length || a.title.localeCompare(b.title,"de"));
  if(sort==="progress") arr.sort((a,b)=>progress(b)-progress(a) || a.title.localeCompare(b.title,"de"));
  return arr;
}

function renderShelf(){
  const root=$("#shelfGrid"); root.innerHTML="";
  const arr=filteredSeries();
  for(const s of arr){
    const card=document.createElement("article"); card.className="card";
    card.innerHTML=`<div class="book">
      ${coverMarkup(s)}
      <span class="flag">${flag(s.lang)}</span>
      ${complete(s)?'<span class="done">✓ komplett</span>':""}
      <button class="book-click" type="button" aria-label="${esc(s.title)} öffnen"></button>
    </div>
    <div class="card-title" title="${esc(s.title)}">${esc(s.title)}</div>
    <div class="progress"><div class="progress-track"><i style="width:${progress(s)}%"></i></div><small>${ownedCount(s)}/${s.released_count}</small></div>`;
    card.querySelector(".book-click").addEventListener("click",()=>openSeries(s.id));
    root.appendChild(card);
  }
  $("#emptyShelf").classList.toggle("hidden",arr.length>0);
}

function renderShopping(){
  const root=$("#shoppingList"); root.innerHTML="";
  const arr=library.filter(s=>missingOf(s).length).sort((a,b)=>a.title.localeCompare(b.title,"de"));
  if(!arr.length){ root.innerHTML='<div class="empty">Aktuell fehlt nichts 🎉</div>'; return; }
  for(const s of arr){
    const item=document.createElement("article"); item.className="shopping-item";
    item.innerHTML=`<header><span>${flag(s.lang)} ${esc(s.title)}</span><span class="muted">${missingOf(s).length} Stück</span></header>
    <p>${esc(formatRanges(missingOf(s)))}</p>`;
    item.addEventListener("click",()=>openSeries(s.id));
    root.appendChild(item);
  }
}

function renderAll(){
  updateStats(); renderShelf(); renderShopping(); saveCache();
}

async function signedCover(path){
  if(!path || !supabase) return "";
  const {data,error}=await supabase.storage.from("manga-covers").createSignedUrl(path,3600);
  return error ? "" : (data?.signedUrl||"");
}

async function loadLibrary(){
  syncing=true; setSync("Synchronisiere …");
  const {data:seriesRows,error:seriesError}=await supabase.from("series").select("*").order("title");
  if(seriesError){ syncing=false; throw seriesError; }

  if(!seriesRows.length){
    library=[];
    syncing=false;
    setSync(navigator.onLine?"✓ synchron":"Offline-Cache","ok");
    renderAll();
    return;
  }

  const {data:volumeRows,error:volumeError}=await supabase.from("volumes").select("*").order("volume_number");
  if(volumeError){ syncing=false; throw volumeError; }

  const bySeries=new Map();
  for(const s of seriesRows) bySeries.set(s.id,{...s,volumes:[]});
  for(const v of volumeRows) if(bySeries.has(v.series_id)) bySeries.get(v.series_id).volumes.push(v);

  library=[...bySeries.values()];
  await Promise.all(library.map(async s=>{ s.signed_cover_url=await signedCover(s.cover_path); }));
  syncing=false; setSync(navigator.onLine?"✓ synchron":"Offline-Cache","ok"); renderAll();
}

function showApp(){
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}
function showLogin(){
  $("#appView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
}

async function login(email,password){
  const {data,error}=await supabase.auth.signInWithPassword({email,password});
  if(error) throw error;
  session=data.session;
}

async function logout(){
  await supabase.auth.signOut();
  session=null; library=[]; showLogin();
}

function openSeries(id){
  const s=library.find(x=>x.id===id); if(!s)return;
  activeSeries=s;
  $("#seriesLang").textContent=`${flag(s.lang)} ${langName(s.lang)}`;
  $("#seriesTitle").textContent=s.title;
  $("#seriesCover").innerHTML=coverMarkup(s,true);
  $("#seriesMeta").innerHTML=`<span class="tag">${ownedCount(s)} / ${s.released_count} vorhanden</span>
    <span class="tag">${missingOf(s).length} fehlen</span><span class="tag">${esc(s.status)}</span>
    ${s.announced_count>s.released_count?`<span class="tag">${s.announced_count-s.released_count} angekündigt</span>`:""}`;
  $("#seriesNote").classList.toggle("hidden",!s.note);
  $("#seriesNote").textContent=s.note||"";

  const vg=$("#volumeGrid"); vg.innerHTML="";
  for(const v of s.volumes){
    const future=v.volume_number>s.released_count;
    const b=document.createElement("button");
    b.type="button"; b.className=`volume ${future?"future":v.owned?"owned":"missing"}`;
    b.disabled=future;
    b.innerHTML=`<strong>${esc(v.label||("Band "+v.volume_number))}</strong><span>${future?"angekündigt":v.owned?"✓ vorhanden":"✕ fehlt"}</span>`;
    if(!future) b.addEventListener("click",()=>toggleVolume(s.id,v.id,!v.owned));
    vg.appendChild(b);
  }
  $("#seriesDialog").showModal();
}

async function toggleVolume(seriesId,volumeId,newOwned){
  const s=library.find(x=>x.id===seriesId);
  const v=s?.volumes.find(x=>x.id===volumeId);
  if(!v)return;
  v.owned=newOwned; renderAll(); openSeries(seriesId);

  if(!navigator.onLine){
    const q=getQueue();
    const existing=q.find(x=>x.type==="volume"&&x.id===volumeId);
    if(existing) existing.owned=newOwned; else q.push({type:"volume",id:volumeId,owned:newOwned});
    setQueue(q); setSync("Offline – Änderung vorgemerkt","bad"); return;
  }

  const {error}=await supabase.from("volumes").update({owned:newOwned}).eq("id",volumeId);
  if(error){
    toast("Synchronisierung fehlgeschlagen – wird später erneut versucht.");
    const q=getQueue(); q.push({type:"volume",id:volumeId,owned:newOwned}); setQueue(q);
    setSync("Änderung vorgemerkt","bad");
  }else setSync("✓ synchron","ok");
}

async function flushQueue(){
  if(!navigator.onLine || !session || !supabase)return;
  const q=getQueue(); if(!q.length)return;
  const remain=[];
  for(const op of q){
    if(op.type==="volume"){
      const {error}=await supabase.from("volumes").update({owned:op.owned}).eq("id",op.id);
      if(error) remain.push(op);
    }
  }
  setQueue(remain);
  if(!remain.length){ setSync("✓ synchron","ok"); await loadLibrary(); }
}

async function uploadSeriesCover(file){
  if(!activeSeries || !file)return;
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"") || "jpg";
  const path=`${session.user.id}/${activeSeries.id}/series.${ext}`;
  setSync("Cover wird hochgeladen …");
  const {error:upErr}=await supabase.storage.from("manga-covers").upload(path,file,{upsert:true,cacheControl:"3600"});
  if(upErr){ toast("Cover-Upload fehlgeschlagen."); setSync("Upload fehlgeschlagen","bad"); return; }
  const {error}=await supabase.from("series").update({cover_path:path}).eq("id",activeSeries.id);
  if(error){ toast("Cover konnte nicht gespeichert werden."); return; }
  await loadLibrary(); openSeries(activeSeries.id); toast("Cover gespeichert.");
}

$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!CONFIGURED){ $("#configWarning").classList.remove("hidden"); return; }
  const btn=e.submitter; btn.disabled=true; btn.textContent="Anmeldung …";
  try{
    await login($("#email").value.trim(),$("#password").value);
    showApp(); await loadLibrary(); await flushQueue();
  }catch(err){
    $("#loginHint").textContent=err?.message||"Anmeldung fehlgeschlagen.";
    $("#loginHint").style.color="var(--bad)";
  }finally{ btn.disabled=false; btn.textContent="Anmelden"; }
});
$("#logoutBtn").addEventListener("click",logout);
$("#searchInput").addEventListener("input",renderShelf);
$("#sortSelect").addEventListener("change",renderShelf);
$("#filterChips").addEventListener("click",e=>{
  const b=e.target.closest("[data-filter]"); if(!b)return;
  activeFilter=b.dataset.filter; $$(".chip").forEach(x=>x.classList.toggle("active",x===b)); renderShelf();
});
$$(".view-tab").forEach(b=>b.addEventListener("click",()=>{
  currentView=b.dataset.view;
  $$(".view-tab").forEach(x=>x.classList.toggle("active",x===b));
  $("#shelfView").classList.toggle("hidden",currentView!=="shelf");
  $("#shoppingView").classList.toggle("hidden",currentView!=="shopping");
}));
$("#closeSeries").addEventListener("click",()=>$("#seriesDialog").close());
$("#seriesCoverInput").addEventListener("change",e=>{ const f=e.target.files?.[0]; if(f)uploadSeriesCover(f); e.target.value=""; });

window.addEventListener("online",()=>{ setSync("Online – synchronisiere …"); flushQueue(); });
window.addEventListener("offline",()=>setSync("Offline – lokale Ansicht","bad"));
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); deferredInstallPrompt=e; $("#installBtn").classList.remove("hidden"); });
$("#installBtn").addEventListener("click",async()=>{
  if(!deferredInstallPrompt)return;
  deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt=null; $("#installBtn").classList.add("hidden");
});

if("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(()=>{});

async function init(){
  if(!CONFIGURED){
    $("#configWarning").classList.remove("hidden");
    $("#loginHint").textContent="Einmalige Einrichtung nötig – siehe START_HIER.md.";
    return;
  }
  const {data}=await supabase.auth.getSession();
  session=data.session;
  if(session){
    showApp();
    const cached=loadCache();
    if(cached.length){ library=cached; setSync("Cache geladen – synchronisiere …"); renderAll(); }
    try{ await loadLibrary(); await flushQueue(); }catch(err){
      setSync("Offline / Sync nicht erreichbar","bad");
      if(!library.length) toast("Daten konnten nicht geladen werden.");
    }
  }else showLogin();

  supabase.auth.onAuthStateChange((_event,newSession)=>{
    session=newSession;
    if(!session) showLogin();
  });
}
init();
