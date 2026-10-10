// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: map, params, Object.create and settings.update, session.save on a sessions resource, and Dexie db.delete(key) are not sites
export function lookalikes(map, params, settings, request, session, p) {
  map.delete("k");
  params.delete("q");
  Object.create(p);
  settings.update({});
  request.session.save();
  session.save();
  const set = new Set();
  set.delete(1);
}
// A Dexie table named db, in a file that does not import drizzle-orm: db.delete(key) is not a Drizzle write
export function dexie(db, key, row) {
  db.delete(key);
  db.update(row);
  db.users.update(1, {});
}
