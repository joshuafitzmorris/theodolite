// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: files named *.test.* are never scanned
export async function t(db) {
  await db.query("INSERT INTO users (a) VALUES (1)");
}
