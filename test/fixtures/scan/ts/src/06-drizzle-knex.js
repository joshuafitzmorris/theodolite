// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: Drizzle writes are medium, knex writes need a write method in the same statement
import { drizzle } from "drizzle-orm/node-postgres";
const orm = drizzle(pool);
export async function builders(db, tx, knex, trx) {
  await db.insert(users).values({}); // expect: db.users medium
  await tx.update(schema.orders).set({}); // expect: db.orders medium
  await db.delete(groups); // expect: db.groups medium
  await orm.insert(sessions).values({}); // expect: db.sessions medium
  await knex("users").insert({ a: 1 }); // expect: db.users high
  await knex.table("orders").where({ id: 1 }).update({ a: 1 }); // expect: db.orders high
  await trx("groups") // expect: db.groups high
    .where({ id: 1 })
    .del();
  await knex.into("audit_logs").truncate(); // expect: db.audit_logs high
  await knex("users").where({ id: 1 }).first();
}
