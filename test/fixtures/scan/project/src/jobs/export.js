// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, never run
export const dump = (db, table) => db.query(`INSERT INTO ${table} (a) VALUES (1)`);
