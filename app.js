import { BACKUP_FORMAT, BACKUP_VERSION, externalCover, validateBackup, previewImport, seriesIdentity } from "./backup-format.js?v=11";
import { userKey, enqueue, acknowledge, overlayQueue } from "./sync-state.js?v=11";
import { validateSeries, persistSeries } from "./series-management.js?v=11";
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
let libraryLoaded=false;
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
function storageRead(kind, uid=session?.user.id){
  if(!uid)return [];
  try{ const value=JSON.parse(localStorage.getItem(userKey(kind,uid))||"[]"); return Array.isArray(value)?value:[]; }catch{return [];}
}
function saveCache(){
  if(!session)return;
  try{ localStorage.setItem(userKey("cache",session.user.id),JSON.stringify(library,(key,value)=>key==="signed_cover_url"?undefined:value)); }
  catch{ toast("Der Offline-Speicher ist voll. Bitte ein Backup exportieren."); }
}
function loadCache(){ return storageRead("cache"); }
function getQueue(uid=session?.user.id){ return storageRead("queue",uid); }
function setQueue(q,uid=session?.user.id){
  if(!uid)throw new Error("Keine aktive Anmeldung.");
  localStorage.setItem(userKey("queue",uid),JSON.stringify(q));
}
async function localLock(uid,task){
  return navigator.locks ? navigator.locks.request(userKey("lock",uid),task) : task();
}
function syncStatus(){
  const q=getQueue();
  const conflicts=q.filter(op=>op.conflict).length;
  setSync(conflicts ? `${conflicts} Konflikt(e) – bitte klären` : q.length ? `${q.length} Änderung(en) warten auf Synchronisierung` : navigator.onLine ? "✓ synchron" : "Offline – lokale Ansicht",q.length?"bad":"ok");
  $("#conflictsBtn").classList.toggle("hidden",!conflicts);
}

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


let loadSequence=0;
async function readAll(table,uid){
  const rows=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await supabase.from(table).select("*").eq("user_id",uid).order("id").range(offset,offset+999);
    if(error)throw error;
    rows.push(...data);
    if(data.length<1000)return rows;
  }
}
async function loadLibrary(){
  const uid=session?.user.id; if(!uid)return;
  const sequence=++loadSequence;
  syncing=true;
  try{
    const [seriesRows,volumeRows]=await Promise.all([readAll("series",uid),readAll("volumes",uid)]);
    const bySeries=new Map(seriesRows.map(s=>[s.id,{...s,volumes:[]}]));
    for(const v of volumeRows)bySeries.get(v.series_id)?.volumes.push(v);
    const next=[...bySeries.values()];
    next.forEach(s=>s.volumes.sort((a,b)=>a.volume_number-b.volume_number));
    await hydrateCovers(next,uid);
    if(session?.user.id!==uid || sequence!==loadSequence)return;
    library=overlayQueue(next,getQueue(uid));libraryLoaded=true;
    if(activeSeries)activeSeries=library.find(s=>s.id===activeSeries.id)||null;
    renderAll(); syncStatus();
    if($("#seriesDialog").open && activeSeries && document.querySelectorAll("dialog[open]").length===1 && $("#coverSuggestions").classList.contains("hidden"))openSeries(activeSeries.id);
  }finally{ if(sequence===loadSequence)syncing=false; }
}

function showApp(){
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}
function showLogin(){
  $$("dialog[open]").forEach(dialog=>dialog.close());
  $("#appView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
}

async function login(email,password){
  const {data,error}=await supabase.auth.signInWithPassword({email,password});
  if(error) throw error;
  session=data.session;
}

async function clearPrivateState(uid,purgeQueue=false){
  ++loadSequence;++bulkCoverGeneration;
  library=[]; libraryLoaded=false;activeSeries=null;
  importedBackup=null;importPlan=[];importCompleted.clear();coverTarget=null;++coverSearchGeneration;++importFileGeneration;
  $("#importPreview").replaceChildren();$("#backupStatus").textContent="";$("#backupFile").value="";$("#importConfirm").checked=false;
  $("#managedSuggestions").replaceChildren();$("#managedCover").replaceChildren();$("#conflictList").replaceChildren();
  $("#shelfGrid").replaceChildren(); $("#shoppingList").replaceChildren(); $("#volumeGrid").replaceChildren();
  $("#seriesCover").replaceChildren(); $("#password").value="";
  for(const id of ["#seriesTitle","#seriesLang","#seriesMeta","#seriesNote","#seriesCoverSource","#deleteSeriesTitle","#coverTargetLabel","#managedCoverSource","#coverManagerStatus","#bulkCoverGrid","#coverSuggestionGrid"]){$(id).replaceChildren();}
  $("#seriesEditorForm").reset();$("#deleteSeriesForm").reset();$("#volumeLabelInput").value="";$("#coverSearchInput").value="";
  updateStats();
  showLogin();
  if(uid){ localStorage.removeItem(userKey("cache",uid)); if(purgeQueue)localStorage.removeItem(userKey("queue",uid)); }
  localStorage.removeItem(CACHE_KEY);localStorage.removeItem(QUEUE_KEY);
  releaseCoverUrls();
  if(uid && "caches" in window)await caches.delete(userKey("covers",uid));
}
async function logout(){
  if(featureBusy || editorBusy){toast("Bitte den laufenden Vorgang abwarten.");return;}
  if(syncPromise)await syncPromise;
  if(getQueue().length){
    toast("Es gibt ungespeicherte Änderungen. Bitte synchronisieren oder Konflikte klären, bevor du dich abmeldest.");
    if(getQueue().some(op=>op.conflict))showConflicts();
    return;
  }
  const uid=session?.user.id;
  const {error}=await supabase.auth.signOut();
  if(error){toast("Abmelden fehlgeschlagen. Bitte erneut versuchen.");return;}
  session=null;await clearPrivateState(uid,true);
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
  resetCoverSuggestions();
  $("#seriesCoverSource").textContent=coverSource(s.cover_path);

  const vg=$("#volumeGrid"); vg.innerHTML="";
  for(const v of s.volumes){
    const future=v.volume_number>s.released_count;
    const b=document.createElement("button");
    b.type="button"; b.className=`volume ${future?"future":v.owned?"owned":"missing"}`;
    b.disabled=future;
    b.innerHTML=`<strong>${esc(v.label||("Band "+v.volume_number))}</strong><span>${future?"angekündigt":v.owned?"✓ vorhanden":"✕ fehlt"}</span>`;
    if(!future) b.addEventListener("click",()=>toggleVolume(s.id,v.id,!v.owned));
    const item=document.createElement("div");item.className="volume-item";
    if(v.signed_cover_url){const img=document.createElement("img");img.src=v.signed_cover_url;img.alt=v.label||("Cover Band "+v.volume_number);img.loading="lazy";item.append(img);}
    const coverButton=document.createElement("button");coverButton.type="button";coverButton.className="volume-cover-btn";coverButton.textContent="🖼 Cover / Ausgabe";
    coverButton.onclick=()=>openCoverManager(s.id,v.id);
    item.append(b,coverButton);
    if(v.cover_path){const source=document.createElement("small");source.className="cover-source";source.textContent=externalCover(v.cover_path)?"Extern verknüpft":"Privates Cover";item.append(source);}
    vg.appendChild(item);
  }
  $("#seriesDialog").showModal();
}

async function toggleVolume(seriesId,volumeId,newOwned){
  const uid=session?.user.id;if(!uid)return;
  const v=library.find(x=>x.id===seriesId)?.volumes.find(x=>x.id===volumeId);if(!v)return;
  try{
    await localLock(uid,async()=>{
      if(session?.user.id!==uid)return;
      setQueue(enqueue(getQueue(uid),v,newOwned,crypto.randomUUID()),uid);
      v.owned=newOwned;renderAll();openSeries(seriesId);syncStatus();
    });
    if(navigator.onLine)await flushQueue();
  }catch{toast("Änderung konnte nicht sicher gespeichert werden. Bitte erneut versuchen.");}
}
let syncPromise=null;
async function flushQueue(){
  if(syncPromise)return syncPromise;
  if(!navigator.onLine || !session || !supabase)return;
  const uid=session.user.id;
  syncPromise=(async()=>{
    await localLock(uid,async()=>{
      for(const op of getQueue(uid)){
        if(session?.user.id!==uid)return;
        if(op.conflict)continue;
        // Read before a conditional write: conflicting edits never silently overwrite each other.
        const {data:remote,error:readError}=await supabase.from("volumes").select("id,owned,updated_at").eq("id",op.id).eq("user_id",uid).maybeSingle();
        if(readError)throw readError;
        if(session?.user.id!==uid)return;
        if(!remote){
          setQueue(getQueue(uid).map(x=>x.token===op.token?{...x,conflict:{deleted:true}}:x),uid);continue;
        }
        if(remote.owned===op.owned){setQueue(acknowledge(getQueue(uid),op,remote.updated_at),uid);continue;}
        if(!op.base || remote.updated_at!==op.base){
          setQueue(getQueue(uid).map(x=>x.token===op.token?{...x,conflict:remote}:x),uid);continue;
        }
        const {data,error}=await supabase.from("volumes").update({owned:op.owned}).eq("id",op.id).eq("user_id",uid).eq("updated_at",op.base).select("id,updated_at");
        if(error)throw error;
        if(session?.user.id!==uid)return;
        if(data.length)setQueue(acknowledge(getQueue(uid),op,data[0].updated_at),uid);
        // A concurrent write causes zero rows; keep the operation for the next comparison.
      }
    });
    if(session?.user.id===uid)await loadLibrary();
  })().catch(()=>{if(session?.user.id===uid)setSync("Sync nicht erreichbar – Änderungen bleiben lokal gespeichert","bad");})
    .finally(()=>{syncPromise=null;});
  return syncPromise;
}
function showConflicts(){
  const root=$("#conflictList");root.replaceChildren();
  for(const op of getQueue().filter(x=>x.conflict)){
    const s=library.find(s=>s.volumes.some(v=>v.id===op.id));
    const v=s?.volumes.find(v=>v.id===op.id);
    const row=document.createElement("article");row.className="conflict-row";
    const label=document.createElement("p");
    label.textContent=`${s?.title||"Entfernter Band"} ${v?" · Band "+v.volume_number:""}: lokal ${op.owned?"vorhanden":"fehlend"}; ${op.conflict.deleted?"online gelöscht":"online "+(op.conflict.owned?"vorhanden":"fehlend")}`;
    row.append(label);
    for(const useLocal of op.conflict.deleted?[false]:[false,true]){
      const button=document.createElement("button");button.textContent=useLocal?"Meine Änderung übernehmen":"Online-Stand übernehmen";
      button.onclick=async()=>{
        const uid=session?.user.id;if(!uid)return;
        await localLock(uid,async()=>setQueue(getQueue(uid).flatMap(x=>x.token!==op.token?[x]:useLocal?[{...x,base:op.conflict.updated_at,conflict:null}]:[]),uid));
        await flushQueue();showConflicts();
      };row.append(button);
    }
    root.append(row);
  }
  if(!root.childElementCount){$("#conflictDialog").close();return;}
  $("#conflictDialog").showModal();
}


function resetCoverSuggestions(){
  const box=$("#coverSuggestions");
  if(!box)return;
  box.classList.add("hidden");
  $("#coverSuggestionGrid").innerHTML="";
  $("#coverSuggestionStatus").textContent="";
  $("#coverSuggestionSource").textContent="";
  const btn=$("#coverSuggestionsBtn");
  if(btn){ btn.disabled=false; btn.textContent="✨ Cover-Vorschläge laden"; }
}

function cleanCoverSearchTitle(title){
  return String(title||"")
    .replace(/\s+[–—-]\s+alte Ausgabe$/i,"")
    .replace(/\s+[–—-]\s+Hauptreihe$/i,"")
    .replace(/\s+/g," ")
    .trim();
}

function normalizeCoverTitle(text){
  return String(text||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}



const COVER_ALIASES = new Map([
  ["attack on titan","Attack on Titan"],
  ["black butler","Black Butler"],
  ["brave10","Brave 10"],
  ["brynhildr in the darkness","Brynhildr in the Darkness"],
  ["chrome breaker","Chrome Breaker"],
  ["dark souls redemption","Dark Souls: Redemption"],
  ["darker than black","Darker than Black"],
  ["death note","Death Note"],
  ["death note how to read band 13","Death Note 13: How to Read"],
  ["death note black edition","Death Note"],
  ["death note another note","Death Note Another Note"],
  ["death note l change the world","L Change the WorLd"],
  ["death note short stories","Death Note Short Stories"],
  ["death note light up the new world","Death Note Light up the NEW world"],
  ["defense devil","Defense Devil"],
  ["elden ring der weg zum erdenbaum","Elden Ring: The Road to the Erdtree"],
  ["elfen lied","Elfen Lied"],
  ["goblin slayer","Goblin Slayer"],
  ["highschool dxd","High School DxD"],
  ["made in abyss","Made in Abyss"],
  ["meine wiedergeburt als schleim in einer anderen welt","That Time I Got Reincarnated as a Slime"],
  ["naruto","Naruto"],
  ["noragami","Noragami"],
  ["ranma 1 2","Ranma 1/2"],
  ["seven deadly sins","The Seven Deadly Sins"],
  ["tales of xillia","Tales of Xillia"],
  ["talisman himari","Omamori Himari"],
  ["the testament of sister new devil","The Testament of Sister New Devil"],
  ["the testament of sister new devil storm","The Testament of Sister New Devil: Storm"],
  ["tokyo ghoul","Tokyo Ghoul"],
  ["yorha abstieg 11941 eine nier automata story","NieR:Automata - YoRHa Pearl Harbor Descent Record"],
  ["xxxholic","xxxHOLiC"]
]);

function canonicalCoverTitle(series){
  const cleaned=cleanCoverSearchTitle(series.title);
  return COVER_ALIASES.get(normalizeCoverTitle(cleaned)) || cleaned;
}

function titleSimilarityScore(wantedText,candidateTexts){
  const wanted=normalizeCoverTitle(wantedText);
  const words=wanted.split(" ").filter(x=>x.length>2);
  let best=0;
  for(const raw of candidateTexts.filter(Boolean)){
    const got=normalizeCoverTitle(raw);
    if(!got)continue;
    if(got===wanted) best=Math.max(best,190);
    else if(got.includes(wanted)||wanted.includes(got)) best=Math.max(best,135);
    const matched=words.filter(w=>got.includes(w)).length;
    const ratio=words.length ? matched/words.length : 0;
    if(ratio>=0.8) best=Math.max(best,110+Math.round(ratio*20));
    else if(ratio>=0.6) best=Math.max(best,85+Math.round(ratio*20));
  }
  return best;
}

async function queryAniList(series){
  const search=canonicalCoverTitle(series);
  const query='query ($search: String) { Page(page: 1, perPage: 10) { media(search: $search, type: MANGA, sort: SEARCH_MATCH) { id title { romaji english native userPreferred } synonyms format coverImage { extraLarge large medium } } } }';
  const resp=await fetch("https://graphql.anilist.co",{
    method:"POST",
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({query:query,variables:{search:search}}),
    signal:AbortSignal.timeout(15000),
    cache:"no-store"
  });
  if(resp.status===429) throw new Error("AniList ist kurz im Rate-Limit");
  if(!resp.ok) throw new Error("AniList antwortet mit "+resp.status);
  const data=await resp.json();
  const media=data?.data?.Page?.media||[];

  return media
    .map(x=>{
      const titles=[x.title?.english,x.title?.romaji,x.title?.native,x.title?.userPreferred,...(x.synonyms||[])];
      const score=titleSimilarityScore(search,titles);
      const url=x.coverImage?.extraLarge||x.coverImage?.large||x.coverImage?.medium||"";
      return {x:x,score:score,url:url};
    })
    .filter(r=>r.url && r.score>=110)
    .sort((a,b)=>b.score-a.score)
    .slice(0,3)
    .map(r=>({
      id:"anilist-"+r.x.id,
      url:r.url,
      title:r.x.title?.english||r.x.title?.userPreferred||r.x.title?.romaji||series.title,
      publisher:"AniList",
      date:"",
      source:"AniList"
    }));
}

function mangaDexTitles(manga){
  const a=manga?.attributes||{};
  const out=[
    ...Object.values(a.title||{}),
    ...(a.altTitles||[]).flatMap(x=>Object.values(x||{}))
  ];
  return [...new Set(out.filter(Boolean))];
}

function mangaDexCoverUrl(manga){
  const rel=(manga?.relationships||[]).find(r=>r.type==="cover_art");
  const filename=rel?.attributes?.fileName;
  return filename ? "https://uploads.mangadex.org/covers/"+manga.id+"/"+filename+".512.jpg" : "";
}

async function queryMangaDex(series){
  const search=canonicalCoverTitle(series);
  const params=new URLSearchParams();
  params.set("title",search);
  params.set("limit","10");
  params.append("includes[]","cover_art");
  params.set("order[relevance]","desc");

  const resp=await fetch("https://api.mangadex.org/manga?"+params.toString(),{
    headers:{Accept:"application/json"},
    signal:AbortSignal.timeout(15000),
    cache:"no-store"
  });
  if(resp.status===429) throw new Error("MangaDex ist kurz im Rate-Limit");
  if(!resp.ok) throw new Error("MangaDex antwortet mit "+resp.status);
  const data=await resp.json();

  return (data?.data||[])
    .map(x=>{
      const score=titleSimilarityScore(search,mangaDexTitles(x));
      const url=mangaDexCoverUrl(x);
      return {x:x,score:score,url:url};
    })
    .filter(r=>r.url && r.score>=110)
    .sort((a,b)=>b.score-a.score)
    .slice(0,3)
    .map(r=>({
      id:"mangadex-"+r.x.id,
      url:r.url,
      title:mangaDexTitles(r.x)[0]||series.title,
      publisher:"MangaDex",
      date:r.x.attributes?.year ? String(r.x.attributes.year) : "",
      source:"MangaDex"
    }));
}

async function queryCoverProviders(series){
  const all=[];
  const seen=new Set();

  function add(found){
    for(const x of found){
      if(!seen.has(x.url)){ seen.add(x.url); all.push(x); }
      if(all.length>=3)break;
    }
  }

  try{ add(await queryAniList(series)); }
  catch(err){ console.warn("AniList cover search failed:",err); }

  if(all.length<3){
    try{ add(await queryMangaDex(series)); }
    catch(err){ console.warn("MangaDex cover search failed:",err); }
  }

  return all.slice(0,3);
}

async function loadCoverSuggestions(){
  if(!activeSeries)return;
  const seriesId=activeSeries.id;
  const btn=$("#coverSuggestionsBtn");
  const box=$("#coverSuggestions");
  const grid=$("#coverSuggestionGrid");
  box.classList.remove("hidden");
  grid.innerHTML="";
  $("#coverSuggestionSource").textContent="AniList + MangaDex";
  $("#coverSuggestionStatus").textContent="Suche passende Manga-Cover …";
  btn.disabled=true; btn.textContent="Suche …";

  try{
    const suggestions=await queryCoverProviders(activeSeries);
    if(!activeSeries || activeSeries.id!==seriesId)return;
    $("#coverSuggestionStatus").textContent=suggestions.length
      ? "Wähle das Cover, das zu deiner Ausgabe passt."
      : "Bei AniList und MangaDex wurde kein sicher passender Treffer gefunden. Lieber kein Cover als ein falsches.";
    if(!suggestions.length){
      grid.innerHTML='<div class="suggestion-empty">Keine Cover gefunden.</div>';
      return;
    }
    for(const s of suggestions){
      const card=document.createElement("article");
      card.className="suggestion-card";

      const cover=document.createElement("div");
      cover.className="suggestion-cover";
      const img=document.createElement("img");
      img.src=s.url; img.alt="Cover-Vorschlag"; img.loading="lazy";
      cover.appendChild(img);

      const meta=document.createElement("div");
      meta.className="suggestion-meta";
      const details=[s.source,s.title,s.publisher,s.date].filter(Boolean);
      meta.textContent=details.join(" · ");

      const use=document.createElement("button");
      use.type="button";
      use.textContent="✓ Übernehmen";
      use.addEventListener("click",()=>saveSuggestedCover(s.url,use));

      card.append(cover,meta,use);
      grid.appendChild(card);
    }
  }catch(err){
    $("#coverSuggestionStatus").textContent="Cover-Suche nicht erreichbar: "+(err?.message||"unbekannter Fehler");
    grid.innerHTML='<div class="suggestion-empty">Suche fehlgeschlagen. Du kannst weiterhin ein Cover manuell hochladen.</div>';
  }finally{
    btn.disabled=false; btn.textContent="↻ Vorschläge neu laden";
  }
}

async function saveSuggestedCoverForSeries(seriesId,url,button,{bulk=false,card=null}={}){
  if(!seriesId || !session || featureBusy)return false;
  featureBusy=true;
  try{


  if(button){ button.disabled=true; button.textContent="Speichere …"; }
  setSync("Cover wird gespeichert …");
  let coverPath="";
  let copied=false;
  const uid=session.user.id;
  try{
    const resp=await fetch(url,{mode:"cors",signal:AbortSignal.timeout(20000)});
    if(!resp.ok)throw new Error("Bildabruf fehlgeschlagen");
    coverPath=await uploadCoverBlob(await resp.blob(),uid,seriesId);copied=true;
  }catch{
    if(!confirm("Das Cover konnte nicht privat gespeichert werden. Stattdessen ausdrücklich als externen Bildlink verknüpfen?")){
      if(button){button.disabled=false;button.textContent="✓ Übernehmen";}syncStatus();return false;
    }
    const safe=externalCover(url);if(!safe)return false;
    coverPath="external:"+safe;
  }
  if(session?.user.id!==uid)return false;

  const {error}=await supabase.from("series").update({cover_path:coverPath}).eq("id",seriesId);
  if(error){
    if(button){ button.disabled=false; button.textContent="✓ Übernehmen"; }
    setSync("Cover konnte nicht gespeichert werden","bad");
    toast("Cover konnte nicht gespeichert werden.");
    return false;
  }

  await loadLibrary();
  const refreshed=library.find(x=>x.id===seriesId);

  if(bulk){
    if(card){
      card.classList.add("bulk-saved");
      const results=card.querySelector(".bulk-results");
      if(results) results.innerHTML='<div class="bulk-noresult">✓ Cover übernommen</div>';
    }
  }else{
    if(refreshed){
      activeSeries=refreshed;
      $("#seriesCover").innerHTML=coverMarkup(refreshed,true);
    }
    $("#coverSuggestions").classList.add("hidden");
  }

  const left=library.filter(x=>!x.cover_path).length;
  setSync("✓ synchron","ok");
  toast((copied?"Cover in Supabase gespeichert":"Cover verknüpft")+" · noch "+left+" ohne Cover");
  return true;

  }catch(err){toast(err?.message||"Cover konnte nicht gespeichert werden.");return false;}
  finally{featureBusy=false;if(button){button.disabled=false;button.textContent="✓ Übernehmen";}}
}

async function saveSuggestedCover(url,button){
  if(!activeSeries)return;
  return saveSuggestedCoverForSeries(activeSeries.id,url,button);
}

function wait(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

function renderBulkSuggestionCard(series,suggestion,parent,card){
  const item=document.createElement("article");
  item.className="bulk-result";

  const cover=document.createElement("div");
  cover.className="suggestion-cover";
  const img=document.createElement("img");
  img.src=suggestion.url;
  img.alt="Cover-Vorschlag "+series.title;
  img.loading="lazy";
  cover.appendChild(img);

  const meta=document.createElement("div");
  meta.className="bulk-result-meta";
  meta.textContent=[suggestion.source,suggestion.title,suggestion.publisher,suggestion.date].filter(Boolean).join(" · ");

  const use=document.createElement("button");
  use.type="button";
  use.textContent="✓ Übernehmen";
  use.addEventListener("click",()=>saveSuggestedCoverForSeries(series.id,suggestion.url,use,{bulk:true,card}));

  item.append(cover,meta,use);
  parent.appendChild(item);
}

let bulkCoverGeneration=0;
async function startBulkCoverSearch(){
  const generation=++bulkCoverGeneration;
  const uid=session?.user.id;
  const btn=$("#startBulkCoverSearch");
  const root=$("#bulkCoverGrid");
  const status=$("#bulkCoverStatus");
  const targets=library.filter(s=>!s.cover_path);

  if(!targets.length){
    status.textContent="Alle Reihen haben bereits ein Cover 🎉";
    root.innerHTML="";
    return;
  }

  btn.disabled=true;
  btn.textContent="Suche läuft …";
  root.innerHTML="";
  status.textContent="0 / "+targets.length+" Reihen durchsucht";

  const cards=new Map();
  for(const s of targets){
    const card=document.createElement("article");
    card.className="bulk-series-card";
    card.dataset.seriesId=s.id;
    card.innerHTML='<div class="bulk-series-head"><strong>'+flag(s.lang)+' '+esc(s.title)+'</strong><span class="muted small">warte …</span></div><div class="bulk-results"><div class="bulk-loading">Noch nicht durchsucht</div></div>';
    root.appendChild(card);
    cards.set(s.id,card);
  }

  let done=0;
  for(const s of targets){
    if(generation!==bulkCoverGeneration || session?.user.id!==uid)return;
    const card=cards.get(s.id);
    const state=card.querySelector(".bulk-series-head span");
    const results=card.querySelector(".bulk-results");
    state.textContent="suche …";
    results.innerHTML='<div class="bulk-loading">Cover werden gesucht …</div>';

    try{
      const suggestions=await queryCoverProviders(s);
      if(generation!==bulkCoverGeneration || session?.user.id!==uid)return;
      results.innerHTML="";
      if(suggestions.length){
        state.textContent=suggestions.length+" Vorschlag"+(suggestions.length===1?"":"e");
        for(const suggestion of suggestions) renderBulkSuggestionCard(s,suggestion,results,card);
      }else{
        state.textContent="kein Treffer";
        results.innerHTML='<div class="bulk-noresult">Kein ausreichend passender Treffer – lieber manuell hochladen.</div>';
      }
    }catch(err){
      state.textContent="Fehler";
      results.innerHTML='<div class="bulk-noresult">Suche fehlgeschlagen: '+esc(err?.message||"unbekannter Fehler")+'</div>';
    }

    done++;
    status.textContent=done+" / "+targets.length+" Reihen durchsucht";
    if(done<targets.length) await wait(700);
  }

  btn.disabled=false;
  btn.textContent="↻ Alle ohne Cover erneut durchsuchen";
  status.textContent="Fertig: "+targets.length+" Reihen durchsucht. Wähle pro Reihe das passende Cover.";
}

function openCoverAssistant(){
  $("#startBulkCoverSearch").disabled=false;
  $("#coverAssistantDialog").showModal();
  const targets=library.filter(s=>!s.cover_path);
  $("#bulkCoverStatus").textContent=targets.length
    ? targets.length+" Reihen ohne Cover. Mit einem Klick werden alle nacheinander gesucht."
    : "Alle Reihen haben bereits ein Cover 🎉";
  $("#bulkCoverGrid").innerHTML="";
  if(targets.length) startBulkCoverSearch();
}

async function uploadSeriesCover(file){
  if(!activeSeries || featureBusy)return;
  const target={seriesId:activeSeries.id,volumeId:null};featureBusy=true;
  try{const path=await uploadCoverBlob(file,session.user.id,target.seriesId);await writeCover(target,path);openSeries(target.seriesId);toast("Cover privat gespeichert.");}
  catch(err){toast(err.message||"Cover-Upload fehlgeschlagen.");}
  finally{featureBusy=false;}
}


let editorId = null;
let editorExisting = false;
let editorBusy = false;

function openEditor(series = null){
  if(!session || !navigator.onLine){ toast("Reihen lassen sich nur online verwalten."); return; }
  editorId=series?.id || crypto.randomUUID();
  editorExisting=Boolean(series);
  $("#editorHeading").textContent=series ? "Reihe bearbeiten" : "Reihe hinzufügen";
  $("#editorTitle").value=series?.title || "";
  $("#editorLang").value=series?.lang || "de";
  $("#editorStatus").value=series?.status || "laufend";
  $("#editorReleased").value=series?.released_count || 1;
  $("#editorAnnounced").value=series?.announced_count || 1;
  $("#editorNote").value=series?.note || "";
  $("#editorError").textContent="";
  $("#deleteSeriesBtn").classList.toggle("hidden",!series);
  $("#seriesEditorDialog").showModal();
  $("#editorTitle").focus();
}
function closeEditor(){ if(!editorBusy) $("#seriesEditorDialog").close(); }
function setEditorBusy(busy){
  editorBusy=busy;
  $("#editorFields").disabled=busy;
  $("#closeEditor").disabled=busy;
  $("#saveSeriesBtn").textContent=busy ? "Speichere …" : "Speichern";
}
async function saveSeries(e){
  e.preventDefault();
  if(editorBusy)return;
  const errorBox=$("#editorError"); errorBox.textContent="";
  if(!session || !navigator.onLine){ errorBox.textContent="Zum Speichern bitte online anmelden."; return; }
  setEditorBusy(true);
  const id=editorId;
  let writeStarted=false;
  try{
    const data=validateSeries({title:$("#editorTitle").value,lang:$("#editorLang").value,
      released_count:$("#editorReleased").value,announced_count:$("#editorAnnounced").value,
      status:$("#editorStatus").value,note:$("#editorNote").value},
      library.find(s=>s.id===id)?.volumes || []);
    if(library.some(s=>s.id!==id && s.lang===data.lang && s.title.toLocaleLowerCase()===data.title.toLocaleLowerCase())){
      throw new Error("Eine Reihe mit diesem Titel und dieser Sprache ist bereits vorhanden.");
    }
    await flushQueue();
    if(getQueue().length) throw new Error("Es stehen noch Besitzänderungen aus. Bitte nach erfolgreicher Synchronisierung erneut speichern.");
    writeStarted=true;
    await persistSeries(supabase,session.user.id,id,data);
    $("#seriesEditorDialog").close();
    $("#seriesDialog").close();
    try{ await loadLibrary(); openSeries(id); toast("Reihe gespeichert."); }
    catch{ setSync("Gespeichert – bitte Ansicht neu laden","bad"); toast("Reihe gespeichert. Die Ansicht konnte noch nicht aktualisiert werden."); }
  }catch(err){
    errorBox.textContent=(err?.message || "Speichern fehlgeschlagen.")+(writeStarted ? " Änderungen können teilweise gespeichert sein; erneutes Speichern ergänzt fehlende Bände." : "");
  }finally{ setEditorBusy(false); }
}
function openDelete(){
  const s=library.find(x=>x.id===editorId); if(!s || !editorExisting)return;
  $("#deleteSeriesTitle").textContent=s.title;
  $("#deleteConfirmation").value="";
  $("#deleteError").textContent="";
  $("#deleteSeriesDialog").showModal();
  $("#deleteConfirmation").focus();
}
async function deleteSeries(e){
  e.preventDefault();
  if(editorBusy)return;
  const s=library.find(x=>x.id===editorId); if(!s)return;
  const errorBox=$("#deleteError"); errorBox.textContent="";
  if($("#deleteConfirmation").value!==s.title){ errorBox.textContent="Der Titel stimmt nicht überein."; return; }
  if(!session || !navigator.onLine){ errorBox.textContent="Zum Löschen bitte online anmelden."; return; }
  setEditorBusy(true);
  $("#confirmDelete").disabled=true; $("#cancelDelete").disabled=true;
  try{
    const {data,error}=await supabase.from("series").delete().eq("id",s.id).eq("user_id",session.user.id).select("id").single();
    if(error)throw error;
    if(!data)throw new Error("Die Reihe konnte nicht gelöscht werden.");
    const volumeIds=new Set(s.volumes.map(v=>v.id));
    setQueue(getQueue().filter(op=>!volumeIds.has(op.id)));
    library=library.filter(x=>x.id!==s.id); activeSeries=null;
    renderAll();
    $("#deleteSeriesDialog").close(); $("#seriesEditorDialog").close(); $("#seriesDialog").close();
    toast("Reihe gelöscht."); setSync("✓ synchron","ok");
  }catch(err){ errorBox.textContent=err?.message || "Löschen fehlgeschlagen."; }
  finally{ setEditorBusy(false); $("#confirmDelete").disabled=false; $("#cancelDelete").disabled=false; }
}
$("#addSeriesBtn").addEventListener("click",()=>openEditor());
$("#editSeriesBtn").addEventListener("click",()=>openEditor(activeSeries));
$("#closeEditor").addEventListener("click",closeEditor);
$("#cancelEditor").addEventListener("click",closeEditor);
$("#seriesEditorForm").addEventListener("submit",saveSeries);
$("#deleteSeriesBtn").addEventListener("click",openDelete);
$("#cancelDelete").addEventListener("click",()=>$("#deleteSeriesDialog").close());
$("#deleteSeriesForm").addEventListener("submit",deleteSeries);
for(const id of ["#seriesEditorDialog","#deleteSeriesDialog"]){
  $(id).addEventListener("cancel",e=>{ if(editorBusy)e.preventDefault(); });
}
$("#editorReleased").addEventListener("input",()=>{
  if(Number($("#editorAnnounced").value)<Number($("#editorReleased").value)){
    $("#editorAnnounced").value=$("#editorReleased").value;
  }
});

$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!CONFIGURED){ $("#configWarning").classList.remove("hidden"); return; }
  const btn=e.submitter; btn.disabled=true; btn.textContent="Anmeldung …";
  try{
    await login($("#email").value.trim(),$("#password").value);
    showApp(); await flushQueue();
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
$("#coverSuggestionsBtn").addEventListener("click",loadCoverSuggestions);
$("#coverAssistantBtn").addEventListener("click",openCoverAssistant);
$("#startBulkCoverSearch").addEventListener("click",startBulkCoverSearch);
$("#closeCoverAssistant").addEventListener("click",()=>{++bulkCoverGeneration;$("#coverAssistantDialog").close();});
$("#coverAssistantDialog").addEventListener("cancel",()=>{++bulkCoverGeneration;});

window.addEventListener("online",()=>flushQueue());
window.addEventListener("focus",()=>{if(!featureBusy && !editorBusy)flushQueue();});
setInterval(()=>{if(document.visibilityState==="visible" && !featureBusy && !editorBusy)flushQueue();},30000);
window.addEventListener("storage",e=>{
  if(session && e.key===userKey("queue",session.user.id)){library=overlayQueue(library,getQueue());renderAll();syncStatus();}
});
$("#syncBtn").addEventListener("click",()=>flushQueue());
$("#conflictsBtn").addEventListener("click",showConflicts);
$("#closeConflicts").addEventListener("click",()=>$("#conflictDialog").close());
window.addEventListener("offline",()=>setSync("Offline – lokale Ansicht","bad"));
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); deferredInstallPrompt=e; $("#installBtn").classList.remove("hidden"); });
$("#installBtn").addEventListener("click",async()=>{
  if(!deferredInstallPrompt)return;
  deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt=null; $("#installBtn").classList.add("hidden");
});

if("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js?v=11",{updateViaCache:"none"}).catch(()=>{});

async function init(){
  if(!CONFIGURED){
    $("#configWarning").classList.remove("hidden");
    $("#loginHint").textContent="Einmalige Einrichtung nötig – siehe START_HIER.md.";
    return;
  }
  const {data}=await supabase.auth.getSession();
  session=data.session;
  if(session){
    try{
      const legacy=JSON.parse(localStorage.getItem(CACHE_KEY)||"[]");
      const oldQueue=JSON.parse(localStorage.getItem(QUEUE_KEY)||"[]");
      const own=legacy.filter(s=>s.user_id===session.user.id);
      if(!loadCache().length && own.length){library=own;saveCache();}
      if(!getQueue().length){
        let q=[];
        for(const op of oldQueue){const v=own.flatMap(s=>s.volumes||[]).find(v=>v.id===op.id && v.user_id===session.user.id);if(v)q=enqueue(q,v,op.owned,crypto.randomUUID());}
        setQueue(q);
      }
      localStorage.removeItem(CACHE_KEY);localStorage.removeItem(QUEUE_KEY);
    }catch{toast("Alter Offline-Speicher konnte nicht übernommen werden.");}
    showApp();
    const cached=loadCache();
    if(cached.length){ libraryLoaded=true;library=overlayQueue(cached,getQueue()); await hydrateCovers(library,session.user.id); setSync("Cache geladen – synchronisiere …"); renderAll(); }
    try{ await flushQueue(); }catch(err){
      setSync("Offline / Sync nicht erreichbar","bad");
      if(!library.length) toast("Daten konnten nicht geladen werden.");
    }
  }else showLogin();

  supabase.auth.onAuthStateChange((_event,newSession)=>{
    const oldUid=session?.user.id;
    session=newSession;
    if(oldUid && oldUid!==newSession?.user.id){clearPrivateState(oldUid);}
    if(!session)showLogin();
  });
}
// Private image URLs exist only in memory; blobs are cached per account for offline use.
const coverObjectUrls=new Map();
let featureBusy=false;
let coverTarget=null;
let coverSearchGeneration=0;
function releaseCoverUrls(){for(const x of coverObjectUrls.values())URL.revokeObjectURL(x);coverObjectUrls.clear();}
function coverSource(path){return !path?"Kein Cover":externalCover(path)?"Extern verknüpft · nicht im privaten Speicher":"Privat in Supabase gespeichert";}
async function signedCover(path,uid=session?.user.id){
  if(!path || !uid)return "";
  const external=externalCover(path);if(external)return external;
  if(!path.startsWith(uid+"/"))return "";
  const key=uid+":"+path;if(coverObjectUrls.has(key))return coverObjectUrls.get(key);
  let cache=null,blob=null;
  const requestUrl=location.origin+"/__manga_private_cover__/"+encodeURIComponent(path);
  try{if("caches" in window){cache=await caches.open(userKey("covers",uid));const cached=await cache.match(requestUrl);if(cached)blob=await cached.blob();}}catch{}
  if(!blob && navigator.onLine){
    const {data,error}=await supabase.storage.from("manga-covers").download(path);
    if(error)return "";blob=data;
    if(!blob?.type?.startsWith("image/"))return "";
    if(session?.user.id!==uid)return "";
    try{await cache?.put(requestUrl,new Response(blob));}catch{}
  }
  if(!blob || session?.user.id!==uid)return "";
  const url=URL.createObjectURL(blob);coverObjectUrls.set(key,url);return url;
}
async function hydrateCovers(items,uid){
  const rows=items.flatMap(s=>[s,...s.volumes]);let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(cursor<rows.length){const row=rows[cursor++];row.signed_cover_url=await signedCover(row.cover_path,uid);}
  }));
}
async function uploadCoverBlob(file,uid,seriesId,volumeId=null){
  if(session?.user.id!==uid || !navigator.onLine)throw new Error("Bitte online anmelden.");
  if(!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size>10*1024*1024)throw new Error("Bitte JPG, PNG oder WebP bis 10 MB auswählen.");
  // Decode before storing, then resize/re-encode to strip metadata and cap dimensions.
  const bitmap=await createImageBitmap(file);
  let blob;
  try{
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
    blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",0.88));
  }finally{bitmap.close();}
  if(!blob)throw new Error("Bild konnte nicht verarbeitet werden.");
  const ext=blob.type==='image/webp'?'webp':'png';
  const path=`${uid}/${seriesId}/${volumeId||"series"}-${crypto.randomUUID()}.${ext}`;
  const {error}=await supabase.storage.from("manga-covers").upload(path,blob,{contentType:blob.type,cacheControl:"31536000",upsert:false});
  if(error)throw error;
  return path;
}
async function writeCover(target,path){
  if(!session || !navigator.onLine)throw new Error("Cover lassen sich nur online ändern.");
  const uid=session.user.id;
  const {data,error}=await supabase.from(target.volumeId?"volumes":"series").update({cover_path:path})
    .eq("id",target.volumeId||target.seriesId).eq("user_id",uid).select("id").single();
  if(error)throw error;if(!data)throw new Error("Eintrag nicht mehr vorhanden.");
  await loadLibrary();
}
function getCoverTarget(target=coverTarget){
  const series=library.find(s=>s.id===target?.seriesId);
  const row=target?.volumeId?series?.volumes.find(v=>v.id===target.volumeId):series;
  return {series,row};
}
function renderManagedCover(){
  const {series,row}=getCoverTarget();if(!series||!row)return;
  $("#coverTargetLabel").textContent=`${flag(series.lang)} ${series.title}${coverTarget.volumeId?" · Band "+row.volume_number:" · Reihencover"}`;
  $("#managedCover").innerHTML=row.signed_cover_url?`<img src="${esc(row.signed_cover_url)}" alt="Aktuelles Cover">`:"";
  $("#managedCoverSource").textContent=coverSource(row.cover_path);
  $("#removeCover").disabled=!row.cover_path;
}
function openCoverManager(seriesId,volumeId=null){
  if(featureBusy)return;
  coverTarget={seriesId,volumeId};++coverSearchGeneration;
  const {series,row}=getCoverTarget();if(!row)return;
  $("#coverManagerHeading").textContent=volumeId?"Bandcover verwalten":"Reihencover verwalten";
  $("#volumeLabelField").classList.toggle("hidden",!volumeId);
  $("#saveVolumeLabel").classList.toggle("hidden",!volumeId);
  $("#volumeLabelInput").value=row.label||"";
  $("#coverSearchInput").value=series.title;
  $("#managedSuggestions").replaceChildren();$("#coverManagerStatus").textContent="";$("#searchManagedCover").disabled=false;
  renderManagedCover();$("#coverManagerDialog").showModal();
}
async function coverAction(task){
  if(featureBusy)return;
  if(!session || !navigator.onLine){$("#coverManagerStatus").textContent="Bitte online anmelden.";return;}
  featureBusy=true;$("#coverManagerStatus").textContent="Wird gespeichert …";
  const controls=[...$("#coverManagerDialog").querySelectorAll("button,input")];controls.forEach(b=>b.disabled=true);
  try{await task();renderManagedCover();if(activeSeries)openSeries(activeSeries.id);$("#coverManagerStatus").textContent="Gespeichert.";}
  catch(err){$("#coverManagerStatus").textContent=err?.message||"Speichern fehlgeschlagen.";}
  finally{featureBusy=false;controls.forEach(b=>b.disabled=false);renderManagedCover();}
}
async function queryVolumeCovers(series,number){
  const mangas=await queryMangaDex(series);const results=[];
  for(const manga of mangas.slice(0,2)){
    const id=manga.id.replace(/^mangadex-/,"");
    for(let offset=0;offset<1000;offset+=100){
      const params=new URLSearchParams({"manga[]":id,limit:"100",offset:String(offset)});
      const response=await fetch("https://api.mangadex.org/cover?"+params,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error("MangaDex-Bandcover derzeit nicht erreichbar.");
      const data=await response.json();
      for(const c of data.data||[]){
        const a=c.attributes||{};
        if(Number(a.volume)!==number || !a.fileName)continue;
        results.push({url:`https://uploads.mangadex.org/covers/${id}/${a.fileName}.512.jpg`,title:manga.title,source:"MangaDex",volume:a.volume,locale:a.locale||"unbekannt"});
      }
      if((data.data||[]).length<100)break;
    }
  }
  return results.sort((a,b)=>Number(b.locale===series.lang)-Number(a.locale===series.lang)).slice(0,8);
}
async function searchManagedCovers(){
  const target={...coverTarget};const {series,row}=getCoverTarget(target);if(!row)return;
  const generation=++coverSearchGeneration;
  const term=$("#coverSearchInput").value.trim();if(!term)return;
  $("#managedSuggestions").replaceChildren();$("#coverManagerStatus").textContent="Suche …";
  $("#searchManagedCover").disabled=true;
  try{
    const query={...series,title:term};
    let suggestions=[],warning="";
    if(target.volumeId){try{suggestions=await queryVolumeCovers(query,row.volume_number);}catch(err){warning=err.message+" ";}}
    if(!suggestions.length)suggestions=await queryCoverProviders(query);
    if(generation!==coverSearchGeneration)return;
    $("#coverManagerStatus").textContent=warning+(suggestions.length?"Band, Sprache und Ausgabe prüfen. Privat speichern kopiert das Bild nach Supabase; externer Link bleibt beim Anbieter.":"Keine passenden Cover gefunden. Eigenes Cover hochladen oder Suchbegriff ändern.");
    for(const item of suggestions){
      const card=document.createElement("article");card.className="suggestion-card";
      const img=document.createElement("img");img.src=item.url;img.alt="Cover-Vorschlag";img.loading="lazy";img.referrerPolicy="no-referrer";
      const cover=document.createElement("div");cover.className="suggestion-cover";cover.append(img);
      const text=document.createElement("p");text.className="suggestion-meta";
      text.textContent=`${item.source} · ${item.title} · ${item.volume?"Band "+item.volume+" · "+item.locale:"Reihenmotiv – Ausgabe nicht bestätigt"}`;
      const save=document.createElement("button");save.textContent="Privat speichern";save.onclick=()=>coverAction(async()=>{
        const uid=session.user.id;
        const response=await fetch(item.url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error("Bildabruf fehlgeschlagen. Du kannst ausdrücklich einen externen Link wählen.");
        const path=await uploadCoverBlob(await response.blob(),uid,target.seriesId,target.volumeId);await writeCover(target,path);
      });
      const link=document.createElement("button");link.textContent="Extern verknüpfen";link.onclick=()=>coverAction(()=>writeCover(target,"external:"+externalCover(item.url)));
      card.append(cover,text,save,link);$("#managedSuggestions").append(card);
    }
  }catch(err){if(generation===coverSearchGeneration)$("#coverManagerStatus").textContent=err.message;}
  finally{if(generation===coverSearchGeneration)$("#searchManagedCover").disabled=false;}
}
$("#manageSeriesCoverBtn").onclick=()=>openCoverManager(activeSeries.id);
$("#closeCoverManager").onclick=()=>{if(!featureBusy){++coverSearchGeneration;$("#coverManagerDialog").close();}};
$("#coverManagerDialog").addEventListener("cancel",e=>{if(featureBusy)e.preventDefault();else ++coverSearchGeneration;});
$("#managedCoverInput").onchange=e=>{const file=e.target.files?.[0];e.target.value="";if(file){const target={...coverTarget};coverAction(async()=>{const path=await uploadCoverBlob(file,session.user.id,target.seriesId,target.volumeId);await writeCover(target,path);});}};
$("#removeCover").onclick=()=>{const target={...coverTarget};coverAction(()=>writeCover(target,null));};
$("#saveVolumeLabel").onclick=()=>{const target={...coverTarget};const label=$("#volumeLabelInput").value.trim();coverAction(async()=>{
  const {error}=await supabase.from("volumes").update({label:label||null}).eq("id",target.volumeId).eq("user_id",session.user.id);if(error)throw error;await loadLibrary();
});};
$("#searchManagedCover").onclick=searchManagedCovers;

let importedBackup=null;
let importPlan=[];
let importFileGeneration=0;
const importCompleted=new Set();
function backupBusy(busy){
  featureBusy=busy;
  for(const el of $("#backupDialog").querySelectorAll("button,input,select"))el.disabled=busy;
  if(!busy)$("#importBackup").disabled=!importedBackup || !$("#importConfirm").checked || !importPlan.some(x=>['add','update'].includes(x.action));
}
function downloadJson(value,name){
  const blob=new Blob([JSON.stringify(value,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function blobDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("Cover konnte nicht gelesen werden."));reader.readAsDataURL(blob);});}
async function exportBackup(){
  if(featureBusy || !session)return;
  backupBusy(true);const uid=session.user.id;
  try{
    if(navigator.onLine)await flushQueue();
    if(!libraryLoaded)throw new Error("Die Sammlung konnte noch nicht geladen werden. Bitte zuerst synchronisieren.");
    const snapshot=overlayQueue(library,getQueue(uid));
    if(!snapshot.length && !navigator.onLine)throw new Error("Keine lokale Sammlung verfügbar. Bitte zuerst online laden.");
    const images=new Map();let bytes=0;
    async function cover(path){
      if(!path)return null;
      const external=externalCover(path);if(external)return {kind:'external',url:external};
      if(!images.has(path)){
        if(!path.startsWith(uid+'/'))throw new Error("Ein Cover gehört nicht zum angemeldeten Konto.");
        let blob;
        if(navigator.onLine){const {data,error}=await supabase.storage.from("manga-covers").download(path);if(error)throw new Error("Privates Cover nicht erreichbar. Backup wurde nicht erstellt.");blob=data;}
        else if("caches" in window){const cache=await caches.open(userKey("covers",uid));const response=await cache.match(location.origin+"/__manga_private_cover__/"+encodeURIComponent(path));if(response)blob=await response.blob();}
        if(!blob || !/^image\/(jpeg|png|webp)$/.test(blob.type) || blob.size>10*1024*1024)throw new Error("Ein Cover ist offline nicht verfügbar oder hat ein nicht unterstütztes Format. Bitte online prüfen.");
        images.set(path,await blobDataUrl(blob));
      }
      bytes+=images.get(path).length;if(bytes>140000000)throw new Error("Backup mit Covern überschreitet 140 MB.");
      return {kind:'image',data:images.get(path)};
    }
    const rows=[];
    for(const s of snapshot){
      if(session?.user.id!==uid)throw new Error("Anmeldung geändert. Export abgebrochen.");
      $("#backupStatus").textContent=`Sichere Reihe ${rows.length+1} / ${snapshot.length} …`;
      const volumes=[];
      for(const v of s.volumes)volumes.push({volume_number:v.volume_number,owned:v.owned,label:v.label||null,cover:await cover(v.cover_path)});
      rows.push({...validateSeries(s),cover:await cover(s.cover_path),volumes});
    }
    const result={format:BACKUP_FORMAT,version:BACKUP_VERSION,exported_at:new Date().toISOString(),series:rows};
    validateBackup(result);
    if(session?.user.id!==uid)throw new Error("Anmeldung geändert.");
    downloadJson(result,`manga-regal-backup-${new Date().toISOString().slice(0,10)}.json`);
    $("#backupStatus").textContent=`Backup erstellt: ${rows.length} Reihen. Lokale Besitzänderungen sind enthalten. Private Cover sind eingebettet; externe Links benötigen weiterhin Internet.`;
  }catch(err){$("#backupStatus").textContent=err.message||"Backup fehlgeschlagen.";}
  finally{backupBusy(false);}
}
function renderImportPreview(rebuild=true){
  const root=$("#importPreview");root.replaceChildren();
  if(!importedBackup){backupBusy(false);return;}
  if(rebuild){importPlan=previewImport(importedBackup,library,$("#importMode").value).map(x=>({...x,id:x.target?.id||crypto.randomUUID()}));importCompleted.clear();}
  const labels={add:"Neue Reihe",update:"Aktualisieren",skip:"Überspringen",ambiguous:"Mehrdeutig – übersprungen"};
  const summary=document.createElement("p");summary.textContent=`${importPlan.filter(x=>x.action==='add').length} neu · ${importPlan.filter(x=>x.action==='update').length} aktualisieren · ${importPlan.filter(x=>['skip','ambiguous'].includes(x.action)).length} überspringen`;
  const table=document.createElement("table");table.innerHTML='<thead><tr><th>Reihe</th><th>Bände</th><th>Aktion</th></tr></thead>';
  const body=document.createElement("tbody");
  for(const x of importPlan){const tr=document.createElement("tr");for(const value of [flag(x.source.lang)+' '+x.source.title,x.source.volumes.length,importCompleted.has(x.id)?'✓ Fertig':labels[x.action]]){const td=document.createElement("td");td.textContent=value;tr.append(td);}body.append(tr);}
  table.append(body);root.append(summary,table);backupBusy(false);
}
async function readBackupFile(file){
  const generation=++importFileGeneration;
  importedBackup=null;importPlan=[];$("#importConfirm").checked=false;renderImportPreview();
  if(!file)return;
  try{
    if(file.size>150*1024*1024)throw new Error("Backup darf höchstens 150 MB groß sein.");
    const data=validateBackup(JSON.parse(await file.text()));
    if(generation!==importFileGeneration)return;
    importedBackup=data;renderImportPreview();$("#backupStatus").textContent="Datei geprüft. Bitte Vorschau und Import-Modus prüfen.";
  }catch(err){$("#backupStatus").textContent=err.message||"Datei konnte nicht gelesen werden.";}
}
async function importBackup(){
  if(featureBusy || !importedBackup || !$("#importConfirm").checked)return;
  if(!session || !navigator.onLine){$("#backupStatus").textContent="Der Import benötigt eine Online-Anmeldung.";return;}
  backupBusy(true);const uid=session.user.id;
  try{
    await flushQueue();
    if(getQueue().length)throw new Error("Bitte zuerst wartende Änderungen synchronisieren und Konflikte klären.");
    // Re-read every row; reject a stale preview before performing any import writes.
    await loadLibrary();
    for(const item of importPlan.filter(x=>x.action==='update' && !x.started && !importCompleted.has(x.id))){
      const current=library.find(s=>s.id===item.id);
      if(!current || current.updated_at!==item.target.updated_at || JSON.stringify(current.volumes.map(v=>[v.id,v.updated_at]))!==JSON.stringify(item.target.volumes.map(v=>[v.id,v.updated_at])))throw new Error("Die Sammlung hat sich seit der Vorschau geändert. Datei erneut auswählen und Vorschau prüfen.");
    }
    for(const item of importPlan.filter(x=>x.action==='add' && !x.started)){
      if(library.some(s=>s.id!==item.id && seriesIdentity(s)===seriesIdentity(item.source)))throw new Error("Eine neue Reihe ist inzwischen vorhanden. Bitte Datei erneut auswählen und Vorschau prüfen.");
    }
    const entries=importPlan.filter(x=>['add','update'].includes(x.action));
    for(const item of entries){
      if(importCompleted.has(item.id))continue;
      if(session?.user.id!==uid)throw new Error("Anmeldung geändert. Import angehalten.");
      const source=item.source;
      // On retry, use the same UUID. Upserts repair partial writes rather than duplicating rows.
      const current=library.find(s=>s.id===item.id);
      const values={...source,released_count:Math.max(source.released_count,...(current?.volumes||[]).filter(v=>v.owned).map(v=>v.volume_number)),announced_count:Math.max(source.announced_count,...(current?.volumes||[]).map(v=>v.volume_number))};
      values.announced_count=Math.max(values.announced_count,values.released_count);
      $("#backupStatus").textContent=`Importiere ${source.title} (${importCompleted.size+1}/${entries.length}) …`;
      item.started=true;
      await persistSeries(supabase,uid,item.id,values);
      async function restoreCover(value,volumeNumber){
        if(!value)return null;
        if(value.kind==='external')return 'external:'+value.url;
        const blob=await (await fetch(value.data)).blob();
        return uploadCoverBlob(blob,uid,item.id,volumeNumber?'volume-'+volumeNumber:null);
      }
      const coverPath=await restoreCover(source.cover);
      const volumes=[];
      for(const v of source.volumes)volumes.push({series_id:item.id,user_id:uid,volume_number:v.volume_number,owned:v.owned,label:v.label,cover_path:await restoreCover(v.cover,v.volume_number)});
      for(let offset=0;offset<volumes.length;offset+=200){
        const {error}=await supabase.from("volumes").upsert(volumes.slice(offset,offset+200),{onConflict:'series_id,volume_number'});if(error)throw error;
      }
      const {error}=await supabase.from('series').update({cover_path:coverPath}).eq('id',item.id).eq('user_id',uid);if(error)throw error;
      importCompleted.add(item.id);
    }
    await loadLibrary();renderImportPreview(false);
    $("#backupStatus").textContent=`Import abgeschlossen: ${importCompleted.size} Reihen übernommen. Andere Reihen und zusätzliche Bände wurden nicht gelöscht.`;
    $("#importConfirm").checked=false;
  }catch(err){
    // Keep the plan and stable IDs, allowing retries after transient failures.
    $("#backupStatus").textContent=`Import angehalten: ${err.message||'Verbindung unterbrochen'}. ${importCompleted.size} Reihen fertig. Bereits gespeicherte Daten bleiben erhalten. Bei Verbindungsfehlern kannst du hier erneut starten.`;
  }finally{backupBusy(false);}
}
$("#backupBtn").onclick=()=>{if(!featureBusy)$("#backupDialog").showModal();};
$("#closeBackup").onclick=()=>{if(!featureBusy)$("#backupDialog").close();};
$("#backupDialog").addEventListener('cancel',e=>{if(featureBusy)e.preventDefault();});
$("#exportBackup").onclick=exportBackup;
$("#backupFile").onchange=e=>readBackupFile(e.target.files?.[0]);
$("#importMode").onchange=()=>{$("#importConfirm").checked=false;renderImportPreview();};
$("#importConfirm").onchange=()=>backupBusy(false);
$("#importBackup").onclick=importBackup;

init();
