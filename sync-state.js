export function userKey(kind, userId) {
  if (!userId) throw new Error('Keine aktive Anmeldung.');
  return `manga-regal-${kind}-v2:${userId}`;
}
export function enqueue(queue, volume, owned, token) {
  const previous = queue.find(op => op.id === volume.id);
  return [...queue.filter(op => op.id !== volume.id), {
    type: 'volume', id: volume.id, owned, token,
    base: previous ? previous.base : volume.updated_at,
    conflict: null
  }];
}
export function acknowledge(queue, sent, updatedAt) {
  return queue.flatMap(op => {
    if (op.id !== sent.id) return [op];
    if (op.token === sent.token) return [];
    return [{...op, base: updatedAt, conflict: null}];
  });
}
export function overlayQueue(series, queue) {
  const pending = new Map(queue.map(op => [op.id, op]));
  return series.map(s => ({...s, volumes: s.volumes.map(v => pending.has(v.id)
    ? {...v, owned: pending.get(v.id).owned} : v)}));
}
