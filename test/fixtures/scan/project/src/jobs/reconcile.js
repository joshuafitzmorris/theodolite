// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, never run
export const touch = (db) => db.query("UPDATE users SET a = 1");
