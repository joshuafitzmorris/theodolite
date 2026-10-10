// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: Supabase writes need insert, update, upsert or delete in the chain; a select chain is a read
export async function supa(supabase) {
  await supabase.from("users").insert({ a: 1 }); // expect: db.users high
  await supabase.from("orders").update({ a: 1 }).eq("id", 1); // expect: db.orders high
  await supabase.from("groups").upsert({ a: 1 }); // expect: db.groups high
  await supabase // expect: db.sessions high
    .from("sessions")
    .delete()
    .eq("id", 1);
  await supabase.from("users").select("*");
}
