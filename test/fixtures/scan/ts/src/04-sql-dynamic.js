// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: a variable, interpolation or concatenation as the table reports "?" unless its text is an alias
export async function dynamic(db, table, schema, usersTable) {
  await db.query(`INSERT INTO ${table} (a) VALUES (1)`); // expect: ? high
  await db.query("INSERT INTO " + table + " (a) VALUES (1)"); // expect: ? high
  await db.query(`DELETE FROM ${schema}.${table}`); // expect: ? high
  await db.query(`DELETE FROM ${schema}.users`); // expect: db.users high
  await db.query(`UPDATE ${usersTable} SET a = 1`); // expect: db.users high
}
