// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: model and repository methods resolve by receiver; lowercase receivers need an alias
export async function orm(User, Order, Group, userRepository, ordersRepository, connection, userStore, thing) {
  await User.create({}); // expect: db.users medium
  await Order.bulkCreate([]); // expect: db.orders medium
  await Group.insertOne({}); // expect: db.groups medium
  await Group.insertMany([]); // expect: db.groups medium
  await User.updateOne({}, {}); // expect: db.users medium
  await User.updateMany({}, {}); // expect: db.users medium
  await Order.deleteOne({}); // expect: db.orders medium
  await Order.deleteMany({}); // expect: db.orders medium
  await Group.findOneAndUpdate({}, {}); // expect: db.groups medium
  await Group.destroy({}); // expect: db.groups medium
  await userRepository.save(user); // expect: db.users medium
  await ordersRepository.insert({}); // expect: db.orders medium
  await connection.getRepository(Group).remove(g); // expect: db.groups medium
  await userStore.save(user); // expect: db.users low
  await thing.save(x);
}
