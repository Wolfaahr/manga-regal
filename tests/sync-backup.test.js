import test from 'node:test';
import assert from 'node:assert/strict';
import {userKey,enqueue,acknowledge,overlayQueue} from '../sync-state.js';
import {validateBackup,previewImport,externalCover} from '../backup-format.js';
const series={title:'Testreihe',lang:'de',released_count:1,announced_count:2,status:'laufend',note:'Test',cover:null,volumes:[{volume_number:1,owned:true,label:null,cover:null},{volume_number:2,owned:false,label:null,cover:null}]};
const backup=()=>({format:'manga-regal',version:1,series:[structuredClone(series)]});
test('private storage is account scoped and anonymous access is refused',()=>{
  assert.notEqual(userKey('cache','a'),userKey('cache','b'));assert.throws(()=>userKey('cache',null));
});
test('repeated offline toggles retain original base and latest desired state',()=>{
  const v={id:'v',updated_at:'t1'};
  const q=enqueue(enqueue([],v,true,'a'),{...v,updated_at:'t2'},false,'b');
  assert.equal(q.length,1);assert.equal(q[0].base,'t1');assert.equal(q[0].owned,false);
});
test('acknowledging an old operation never discards a newer change',()=>{
  const old={id:'v',token:'a'},q=[{id:'v',token:'b',owned:false,base:'t1'}];
  assert.deepEqual(acknowledge(q,old,'t2'),[{id:'v',token:'b',owned:false,base:'t2',conflict:null}]);
  assert.deepEqual(acknowledge(q,q[0],'t2'),[]);
});
test('server reload overlays local pending ownership without mutating input',()=>{
  const rows=[{volumes:[{id:'v',owned:false}]}];
  assert.equal(overlayQueue(rows,[{id:'v',owned:true}])[0].volumes[0].owned,true);
  assert.equal(rows[0].volumes[0].owned,false);
});
test('backup round trip preserves metadata ownership and covers, strips arbitrary keys',()=>{
  const raw=backup();raw.series[0].user_id='not-exportable';raw.series[0].volumes[0].cover={kind:'image',data:'data:image/png;base64,aGVsbG8='};
  const clean=validateBackup(raw);assert.equal(clean.series[0].user_id,undefined);assert.equal(clean.series[0].volumes[0].owned,true);assert.equal(clean.series[0].volumes[0].cover.kind,'image');
});
test('unsafe or malformed backups are rejected before writes',()=>{
  const changes=[b=>b.version=999,b=>b.series.push(b.series[0]),b=>b.series[0].volumes.pop(),b=>b.series[0].volumes[0].owned='true',b=>b.series[0].cover={kind:'external',url:'javascript:alert(1)'},b=>b.series[0].cover={kind:'image',data:'data:image/svg+xml;base64,aGVsbG8='},b=>b.series[0].volumes[1].owned=true];
  for(const edit of changes){const b=backup();edit(b);assert.throws(()=>validateBackup(b));}
});
test('preview defaults to additive; update is explicit; ambiguous existing rows are skipped',()=>{
  const b=validateBackup(backup()),lib=[{...series,id:'s'}];
  assert.equal(previewImport(b,lib)[0].action,'skip');assert.equal(previewImport(b,lib,'update')[0].action,'update');
  assert.equal(previewImport(b,[])[0].action,'add');assert.equal(previewImport(b,[...lib,{...series,id:'s2'}],'update')[0].action,'ambiguous');
});
test('external cover references require HTTPS and no embedded credentials',()=>{
  assert.equal(externalCover('external:https://example.com/cover.jpg'),'https://example.com/cover.jpg');
  for(const s of ['javascript:alert(1)','http://example.com/a','https://user:pass@example.com/a','someone/private.png'])assert.equal(externalCover(s),null);
});
