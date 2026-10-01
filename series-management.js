// Shared validation keeps existing volume records and ownership intact.
export function validateSeries(input, volumes = []) {
  const data = {
    title: String(input.title || '').trim(),
    lang: input.lang,
    released_count: Number(input.released_count),
    announced_count: Number(input.announced_count),
    status: String(input.status || '').trim(),
    note: String(input.note || '').trim()
  };
  if (!data.title || data.title.length > 250) throw new Error('Bitte einen Titel mit 1–250 Zeichen eingeben.');
  if (!['de', 'en', 'ja'].includes(data.lang)) throw new Error('Bitte eine gültige Sprache wählen.');
  if (![data.released_count, data.announced_count].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 10000)) {
    throw new Error('Bandzahlen müssen ganze Zahlen zwischen 1 und 10.000 sein.');
  }
  if (data.announced_count < data.released_count) throw new Error('Die Gesamtzahl darf nicht kleiner als die Zahl erschienener Bände sein.');
  if (!data.status || data.status.length > 100) throw new Error('Bitte einen Status mit 1–100 Zeichen eingeben.');
  if (data.note.length > 5000) throw new Error('Die Notiz darf höchstens 5.000 Zeichen enthalten.');
  if (volumes.some(v => v.volume_number > data.announced_count)) {
    throw new Error('Die Gesamtzahl darf vorhandene Bände nicht entfernen. Bestehende Banddaten bleiben erhalten.');
  }
  if (volumes.some(v => v.owned && v.volume_number > data.released_count)) {
    throw new Error('Ein vorhandener Band würde als noch nicht erschienen gelten. Bitte zuerst dessen Besitzmarkierung prüfen.');
  }
  return data;
}

export function missingVolumes(seriesId, userId, total, volumes) {
  const existing = new Set(volumes.map(v => v.volume_number));
  return Array.from({length: total}, (_, i) => i + 1)
    .filter(n => !existing.has(n))
    .map(n => ({series_id: seriesId, user_id: userId, volume_number: n, owned: false}));
}

export async function persistSeries(client, userId, id, input) {
  // Read current records before validating edits made on another device.
  const {data: volumes, error: readError} = await client.from('volumes')
    .select('volume_number,owned').eq('series_id', id).eq('user_id', userId);
  if (readError) throw readError;
  const data = validateSeries(input, volumes || []);
  // Stable UUID makes retries safe even if the response to an insert is lost.
  const {error: createError} = await client.from('series').upsert(
    {id, user_id: userId, ...data}, {onConflict: 'id', ignoreDuplicates: true});
  if (createError) throw createError;
  const additions = missingVolumes(id, userId, data.announced_count, volumes || []);
  if (additions.length) {
    const {error} = await client.from('volumes').upsert(additions,
      {onConflict: 'series_id,volume_number', ignoreDuplicates: true});
    if (error) throw error;
  }
  const {data: updated, error} = await client.from('series').update(data)
    .eq('id', id).eq('user_id', userId).select('id').single();
  if (error) throw error;
  if (!updated) throw new Error('Die Reihe konnte nicht gespeichert werden.');
}
