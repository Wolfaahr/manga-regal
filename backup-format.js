import { validateSeries } from './series-management.js?v=11';
export const BACKUP_FORMAT='manga-regal';
export const BACKUP_VERSION=1;
export function externalCover(path){
  const raw=String(path||'').replace(/^external:/,'');
  try{const u=new URL(raw);return u.protocol==='https:' && !u.username && !u.password ? u.href : null;}catch{return null;}
}
export function seriesIdentity(s){return s.title.trim().normalize('NFC').toLocaleLowerCase('de')+'\u0000'+s.lang;}
export function validateBackup(raw){
  if(!raw || raw.format!==BACKUP_FORMAT || raw.version!==BACKUP_VERSION || !Array.isArray(raw.series) || raw.series.length>2000)throw new Error('Keine unterstützte Manga-Regal-Sicherung (Version 1).');
  const identities=new Set();let total=0;
  function cover(value){
    if(value==null)return null;
    if(value.kind==='external' && externalCover(value.url))return {kind:'external',url:externalCover(value.url)};
    if(value.kind==='image' && typeof value.data==='string' && value.data.length<=14000000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.data)){
      total+=value.data.length;if(total>140000000)throw new Error('Die Cover im Backup sind zu groß.');return {kind:'image',data:value.data};
    }
    throw new Error('Ungültige Coverdaten in der Sicherung.');
  }
  let volumeCount=0;
  const series=raw.series.map(s=>{
    if(!s || !Array.isArray(s.volumes))throw new Error('Bandliste fehlt.');
    const data=validateSeries(s);
    const identity=seriesIdentity(data);if(identities.has(identity))throw new Error('Doppelte Reihe in der Sicherung: '+data.title);identities.add(identity);
    const numbers=new Set();
    const volumes=s.volumes.map(v=>{
      if(!v || !Number.isSafeInteger(v.volume_number) || v.volume_number<1 || v.volume_number>data.announced_count || numbers.has(v.volume_number) || typeof v.owned!=='boolean' || (v.owned && v.volume_number>data.released_count))throw new Error('Ungültige Banddaten: '+data.title);
      numbers.add(v.volume_number);
      if(v.label!=null && (typeof v.label!=='string'||v.label.length>250))throw new Error('Ungültige Bandbezeichnung.');
      return {volume_number:v.volume_number,owned:v.owned,label:v.label||null,cover:cover(v.cover)};
    });
    if(numbers.size!==data.announced_count)throw new Error('Unvollständige Bandliste: '+data.title);
    volumeCount+=volumes.length;if(volumeCount>100000)throw new Error('Zu viele Bände in einer Sicherung.');
    return {...data,cover:cover(s.cover),volumes};
  });
  return {format:BACKUP_FORMAT,version:BACKUP_VERSION,series};
}
export function previewImport(backup, library, mode='add'){
  const existing=new Map();
  for(const s of library){const key=seriesIdentity(s);if(existing.has(key))existing.set(key,null);else existing.set(key,s);}
  return backup.series.map(s=>{
    const key=seriesIdentity(s),found=existing.get(key);
    if(existing.has(key)&&!found)return {source:s,action:'ambiguous',target:null};
    return {source:s,target:found||null,action:found?(mode==='update'?'update':'skip'):'add'};
  });
}
