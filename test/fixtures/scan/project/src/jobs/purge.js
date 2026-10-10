// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, never run
export const purge = (db) => db.query("DELETE FROM legacy_accounts WHERE x = 1");
