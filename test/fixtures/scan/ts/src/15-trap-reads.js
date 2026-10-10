// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: reads are never sites, including SELECT with updated_at, FOR UPDATE with a lock mode joined on, and ORM read calls
export async function reads(db, prisma, supabase) {
  await db.query("SELECT * FROM users WHERE updated_at > $1", [1]);
  await db.query("SELECT * FROM orders WHERE id = 1 FOR UPDATE");
  await db.query("SELECT * FROM orders WHERE id = 1 FOR UPDATE " + lockMode);
  await db.query("SELECT * FROM orders FOR NO KEY UPDATE " + lockMode);
  await db.query("WITH x AS (SELECT 1) SELECT * FROM x");
  await prisma.user.findMany({});
  await db.select().from(users);
  await supabase.from("users").select("*");
  await fetch(url);
  await axios.get("https://example.org/v1/charges");
  await fs.readFile("uploads/a.png");
}
