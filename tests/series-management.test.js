import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSeries, missingVolumes, persistSeries} from '../series-management.js';
const input={title:' Testreihe ',lang:'de',released_count:2,announced_count:3,status:'laufend',note:''};
test('validates titles, languages and integer volume ranges',()=>{
  assert.equal(validateSeries(input).title,'Testreihe');
  for(const change of [{title:''},{lang:'xx'},{released_count:1.5},{released_count:0},{announced_count:1},{announced_count:10001}]){
    assert.throws(()=>validateSeries({...input,...change}));
  }
});
test('refuses to remove existing volumes or hide owned volumes',()=>{
  assert.throws(()=>validateSeries(input,[{volume_number:4,owned:false}]));
  assert.throws(()=>validateSeries(input,[{volume_number:3,owned:true}]));
  assert.doesNotThrow(()=>validateSeries(input,[{volume_number:2,owned:true}]));
});
test('only missing volumes are added; existing ownership is untouched',()=>{
  const existing=[{volume_number:1,owned:true},{volume_number:3,owned:false}];
  assert.deepEqual(missingVolumes('s','u',4,existing).map(x=>[x.volume_number,x.owned]),[[2,false],[4,false]]);
  assert.equal(existing[0].owned,true);
});
function fakeClient(failVolumes=false){
  const calls=[];
  return {calls,from(table){
    const q={select(){return q},eq(){return q},single(){return Promise.resolve({data:{id:'s'},error:null})},
      then(resolve){resolve({data:[{volume_number:1,owned:true}],error:null})},
      upsert(data,options){calls.push({table,action:'upsert',data,options});return Promise.resolve({error:table==='volumes'&&failVolumes?new Error('offline'):null})},
      update(data){calls.push({table,action:'update',data});return q}};
    return q;
  }};
}
test('save uses conflict-safe inserts and preserves existing volume records',async()=>{
  const client=fakeClient();await persistSeries(client,'u','s',input);
  assert.equal(client.calls[0].options.ignoreDuplicates,true);
  assert.deepEqual(client.calls[1].data.map(x=>x.volume_number),[2,3]);
  assert.equal(client.calls[1].options.ignoreDuplicates,true);
  assert.equal(client.calls[2].action,'update');
});
test('failed band creation does not update existing series counts',async()=>{
  const client=fakeClient(true);
  await assert.rejects(persistSeries(client,'u','s',input),/offline/);
  assert.equal(client.calls.some(x=>x.action==='update'),false);
});
