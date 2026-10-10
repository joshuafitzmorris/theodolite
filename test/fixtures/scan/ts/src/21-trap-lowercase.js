// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: lowercase "delete from" and "insert into" outside a SQL position are prose, not SQL
export function prose() {
  const a = "delete from the list";
  const b = "insert into cart";
  console.log("update users set the flag");
  return [a, b];
}
