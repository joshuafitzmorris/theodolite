// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: table names resolve across case, quotes, schema prefix, camelCase, plural, tables and unmapped names
export async function targets(db) {
  await db.query('INSERT INTO "Users" (a) VALUES (1)'); // expect: db.users high
  await db.query("INSERT INTO public.users (a) VALUES (1)"); // expect: db.users high
  await db.query("INSERT INTO `order` (a) VALUES (1)"); // expect: db.orders high
  await db.query("INSERT INTO [dbo].[Orders] (a) VALUES (1)"); // expect: db.orders high
  await db.query("INSERT INTO purchase_orders (a) VALUES (1)"); // expect: db.orders high
  await db.query("INSERT INTO AuditLog (a) VALUES (1)"); // expect: db.audit_logs high
  await db.query("INSERT INTO webhooks_inbox (a) VALUES (1)"); // expect: unmapped high
}
