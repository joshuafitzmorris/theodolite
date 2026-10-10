// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: tRPC and T3 context clients, Kysely, MongoDB, Mongoose and Sequelize writes are found
export async function more(opts, db, trx, mongo, User, Order, Group, Session) {
  await opts.ctx.db.user.create({ data: {} }); // expect: db.users high
  await opts.ctx.db.order.createManyAndReturn({ data: [] }); // expect: db.orders high
  await opts.ctx.db.group.updateManyAndReturn({}); // expect: db.groups high
  await db.insertInto("users").values({}).execute(); // expect: db.users high
  await trx.updateTable("orders").set({}).execute(); // expect: db.orders high
  await db.deleteFrom("sessions").execute(); // expect: db.sessions high
  await mongo.collection("users").insertOne({}); // expect: db.users high
  await mongo.collection("groups").findOneAndDelete({}); // expect: db.groups high
  const trail = mongo.collection("audit_logs");
  await trail.updateMany({}, {}); // expect: db.audit_logs high
  await User.findByIdAndUpdate(1, {}); // expect: db.users medium
  await Order.findByIdAndDelete(1); // expect: db.orders medium
  await Group.update({}, {}); // expect: db.groups medium
  await Session.destroy({}); // expect: db.sessions medium
  await opts.ctx.db.user.findMany({});
  await db.users.update(1, {});
}
