// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: an upsert with ON CONFLICT DO UPDATE SET is one site, not two
export async function upsert(db) {
  await db.query("INSERT INTO users (id, name) VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET name = excluded.name"); // expect: db.users high
}
