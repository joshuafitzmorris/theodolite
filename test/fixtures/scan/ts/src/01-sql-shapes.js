// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: each SQL write shape (INSERT, UPDATE, DELETE, TRUNCATE, MERGE, ALTER, DROP, CREATE) is found with its table
export async function shapes(db, n) {
  await db.query("INSERT INTO users (name) VALUES ($1)", [n]); // expect: db.users high
  await db.query("UPDATE users SET name = $1 WHERE id = $2", [n, 1]); // expect: db.users high
  await db.query("DELETE FROM orders WHERE id = $1", [1]); // expect: db.orders high
  await db.query("TRUNCATE TABLE audit_logs"); // expect: db.audit_logs high
  await db.query("MERGE INTO groups g USING src s ON g.id = s.id WHEN MATCHED THEN DELETE"); // expect: db.groups high
  await db.query("ALTER TABLE users ADD COLUMN age int"); // expect: db.users high
  await db.query("DROP TABLE IF EXISTS orders"); // expect: db.orders high
  await db.query("CREATE TABLE IF NOT EXISTS audit_logs (id int)"); // expect: db.audit_logs high
  await db.query("UPDATE users u SET name = 'x'"); // expect: db.users high
}
