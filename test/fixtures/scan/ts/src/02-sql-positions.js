// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: SQL is recognised by tag, by call position, or by an uppercase leading keyword, and not by lowercase prose; $btn.text("Delete from cart") is a label
export async function positions(db, prisma, sql, Prisma, n) {
  await sql`UPDATE users SET name = ${n}`; // expect: db.users high
  await prisma.$executeRaw`INSERT INTO "public"."orders" (a) VALUES (${n})`; // expect: db.orders high
  await db.raw("DELETE FROM legacy_accounts"); // expect: db.legacy_accounts high
  await db.execute("insert into users values (1)"); // expect: db.users high
  await prisma.$queryRaw(Prisma.sql`DELETE FROM groups WHERE id = ${n}`); // expect: db.groups high
  const text = (x) => x;
  await db.query(text("TRUNCATE sessions")); // expect: db.sessions high
  const stmt = "DELETE FROM sessions WHERE expires < now()"; // expect: db.sessions high
  const note = "delete from cart";
  await db.raw("delete from legacy_accounts"); // lowercase outside query( and execute( is prose
  $btn.text("Delete from cart");
  $btn.text("Insert into the cart");
  return [stmt, note];
}
