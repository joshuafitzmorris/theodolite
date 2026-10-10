// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: a URL string, a regex literal holding quotes, and a division do not hide a later write
export async function literals(db, a, b) {
  const url = "http://x";
  const re = /['"]/g; const half = a / b; await db.query("DELETE FROM orders"); // expect: db.orders high
  return [url, re, half];
}
