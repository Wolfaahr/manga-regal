const {JSDOM}=require('jsdom');
const fs=require('fs');const assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..')+'/';
const test=require('node:test');
test('app flows: offline sync, conflicts, covers, backup, import and logout', async t=>{
 const dom=new JSDOM(fs.readFileSync(root+'index.html','utf8'),{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>dom.window.close());
 const errors=[];w.addEventListener('error',e=>errors.push(e.error));w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
 w.fetch=async url=>{if(!url.startsWith('data:'))throw new Error('Unexpected live network call in test');const [head,data]=url.split(',');return {blob:async()=>new w.Blob([Buffer.from(data,'base64')],{type:head.slice(5).split(';')[0]})};};
 w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){};
 let online=true;Object.defineProperty(w.navigator,'onLine',{get:()=>online});
 const storedImages=new Map();
 w.createImageBitmap=async()=>({width:10,height:20,close(){}});
 w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});
 w.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new w.Blob(['test-image'],{type:'image/webp'}));};
 const db={series:[],volumes:[]};let stamp=0,failWrite=false,failVolumesOnce=false,authCallback;
 const session={user:{id:'user-a'}};
 const mockClient={auth:{getSession:async()=>({data:{session}}),onAuthStateChange(fn){authCallback=fn},signOut:async()=>{authCallback('SIGNED_OUT',null);return{};}},
 storage:{from(){return {download:async path=>storedImages.has(path)?{data:storedImages.get(path),error:null}:{error:new Error('missing')},upload:async(path,blob)=>{storedImages.set(path,blob);return {error:null};}}}},
 from(table){let operation='select',payload,opts={},filters=[],start=0,end=Infinity,single=false;
 const q={select(){return q},order(){return q},range(a,b){start=a;end=b;return q},eq(k,v){filters.push([k,v]);return q},maybeSingle(){single=true;return q},single(){single=true;return q},update(p){operation='update';payload=p;return q},delete(){operation='delete';return q},upsert(p,o){operation='upsert';payload=p;opts=o;return q},then(a,b){return execute().then(a,b)}};
 async function execute(){
  if(failVolumesOnce && table==='volumes' && operation==='upsert'){failVolumesOnce=false;return {data:null,error:new Error('temporary volume failure')};}
  if(!online || (failWrite && operation!=='select'))return {data:null,error:new Error('offline')};
  let rows=db[table].filter(x=>filters.every(([k,v])=>x[k]===v));
  if(operation==='upsert')for(const item of Array.isArray(payload)?payload:[payload]){
   const keys=opts.onConflict.split(','),existing=db[table].find(x=>keys.every(k=>x[k]===item[k]));
   if(!existing)db[table].push({id:w.crypto.randomUUID(),updated_at:'t'+(++stamp),...item});
   else if(!opts.ignoreDuplicates)Object.assign(existing,item,{updated_at:'t'+(++stamp)});
  }
  if(operation==='update')rows.forEach(x=>Object.assign(x,payload,{updated_at:'t'+(++stamp)}));
  if(operation==='delete'){db[table]=db[table].filter(x=>!rows.includes(x));if(table==='series')db.volumes=db.volumes.filter(v=>!rows.some(s=>s.id===v.series_id));}
  rows=rows.slice(start,end===Infinity?undefined:end+1);
  return {data:JSON.parse(JSON.stringify(single?(rows[0]||null):rows)),error:null};
 }return q;}};
 w.mockClient=mockClient;
 const sources=['series-management.js','sync-state.js','backup-format.js','app.js'].map(f=>fs.readFileSync(root+f,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''));
 w.eval('const createClient=()=>window.mockClient;const SUPABASE_URL="https://example.test";const SUPABASE_ANON_KEY="test";\n'+sources.join('\n'));
 const $=s=>w.document.querySelector(s),tick=()=>new Promise(r=>setTimeout(r,25));const set=(s,v)=>$(s).value=v;
 const submit=s=>$(s).dispatchEvent(new w.Event('submit',{cancelable:true}));
 await tick();$('#addSeriesBtn').click();set('#editorTitle','Testreihe');set('#editorReleased','2');set('#editorAnnounced','3');submit('#seriesEditorForm');await tick();
 assert.equal(db.series.length,1);assert.equal(db.volumes.length,3);assert.equal(w.document.querySelectorAll('.volume-cover-btn').length,3);
 // Offline write survives a server refresh and retries after reconnect.
 online=false;$('.volume').click();await tick();
 assert.equal(db.volumes[0].owned,false);assert.equal(w.document.querySelectorAll('.volume.owned').length,1);
 const key='manga-regal-queue-v2:user-a';assert.equal(JSON.parse(w.localStorage.getItem(key)).length,1);
 online=true;await w.flushQueue();assert.equal(db.volumes[0].owned,true);assert.equal(JSON.parse(w.localStorage.getItem(key)).length,0);
 // Conflicting remote edit must not be overwritten automatically.
 online=false;$('.volume').click();await tick();db.volumes[0].updated_at='remote-version';online=true;await w.flushQueue();
 assert.equal(db.volumes[0].owned,true);assert.equal(JSON.parse(w.localStorage.getItem(key))[0].conflict.updated_at,'remote-version');
 w.showConflicts();$('#conflictList button').click();await tick();assert.equal(JSON.parse(w.localStorage.getItem(key)).length,0);
 // Refresh even when there are no pending writes.
 db.series[0].note='updated on another device';await w.flushQueue();assert.match(w.localStorage.getItem('manga-regal-cache-v2:user-a'),/updated on another device/);
 // Cover target and label are the selected volume, not the series.
 w.openCoverManager(db.series[0].id,db.volumes[1].id);set('#volumeLabelInput','Band 2 – Ausgabe DE');$('#saveVolumeLabel').click();await tick();assert.equal(db.volumes[1].label,'Band 2 – Ausgabe DE');$('#closeCoverManager').click();
 // Private band cover upload binds to selected volume and remains private.
 const bandTarget={seriesId:db.series[0].id,volumeId:db.volumes[1].id};
 const privatePath=await w.uploadCoverBlob(new w.Blob(['input'],{type:'image/png'}),'user-a',bandTarget.seriesId,bandTarget.volumeId);
 await w.writeCover(bandTarget,privatePath);
 assert.equal(db.volumes[1].cover_path,privatePath);assert.match(privatePath,new RegExp('^user-a/'+bandTarget.seriesId+'/'));
 assert.equal(storedImages.size,1);
 await assert.rejects(w.uploadCoverBlob(new w.Blob(['bad'],{type:'text/html'}),'user-a',bandTarget.seriesId),/JPG/);
 // Import preview is read-only. Additive and update imports use explicit confirmation.
 $('#seriesDialog').close();$('#backupBtn').click();
 const backup={format:'manga-regal',version:1,series:[{title:'Importreihe',lang:'ja',released_count:1,announced_count:1,status:'abgeschlossen',note:'',cover:{kind:'external',url:'https://example.com/c.jpg'},volumes:[{volume_number:1,owned:true,label:'Sonderausgabe',cover:null}]}]};
 await w.readBackupFile({size:500,text:async()=>JSON.stringify(backup)});assert.equal(db.series.length,1);assert.match($('#importPreview').textContent,/Neue Reihe/);
 $('#importConfirm').checked=true;await w.importBackup();assert.equal(db.series.length,2);const imported=db.series.find(s=>s.title==='Importreihe');assert.equal(imported.cover_path,'external:https://example.com/c.jpg');assert.equal(db.volumes.find(v=>v.series_id===imported.id).owned,true);
 await w.readBackupFile({size:500,text:async()=>JSON.stringify(backup)});assert.match($('#importPreview').textContent,/Überspringen/);
 set('#importMode','update');$('#importMode').dispatchEvent(new w.Event('change'));assert.match($('#importPreview').textContent,/Aktualisieren/);
 $('#importConfirm').checked=true;await w.importBackup();assert.equal(db.series.length,2);
 // Export is explicitly whitelisted and private state clears on signout.
 let exported;w.downloadJson=(value)=>{exported=value;};
 await w.exportBackup();assert.equal(exported.series[0].user_id,undefined);assert.equal(exported.series[0].volumes[1].cover.kind,'image');assert.match($('#backupStatus').textContent,/Backup erstellt/);
 // Restore an embedded private cover, with a mid-import failure and retry.
 const restore=JSON.parse(JSON.stringify(exported));restore.series=[restore.series[0]];restore.series[0].title='Wiederhergestellte Testreihe';
 await w.readBackupFile({size:1000,text:async()=>JSON.stringify(restore)});$('#importConfirm').checked=true;
 failVolumesOnce=true;await w.importBackup();assert.match($('#backupStatus').textContent,/Import angehalten/);
 assert.equal(db.series.filter(s=>s.title==='Wiederhergestellte Testreihe').length,1);
 await w.importBackup();assert.match($('#backupStatus').textContent,/Import abgeschlossen/);
 assert.equal(db.series.filter(s=>s.title==='Wiederhergestellte Testreihe').length,1);
 const restored=db.series.find(s=>s.title==='Wiederhergestellte Testreihe');assert.equal(db.volumes.filter(v=>v.series_id===restored.id).length,3);
 assert.match(db.volumes.find(v=>v.series_id===restored.id && v.volume_number===2).cover_path,/^user-a\//);
 await w.logout();assert.equal(w.localStorage.getItem(key),null);assert.equal(w.localStorage.getItem('manga-regal-cache-v2:user-a'),null);assert.equal($('#shelfGrid').childElementCount,0);assert.equal($('#importPreview').childElementCount,0);
 assert.deepEqual(errors,[]);console.log('PASS real DOM handlers: create, offline queue, reconnect, conflict resolution, cross-device refresh, band label, import preview/add/update, export, logout privacy');
 dom.window.close();
});
