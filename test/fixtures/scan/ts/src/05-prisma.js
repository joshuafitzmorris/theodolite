// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: every Prisma write method on prisma, tx and bound clients, including model names that are common words
import { PrismaClient } from "@prisma/client";
const client = new PrismaClient();
export async function prismaWrites(prisma, tx) {
  await prisma.user.create({ data: {} }); // expect: db.users high
  await prisma.user.createMany({ data: [] }); // expect: db.users high
  await prisma.user.update({ where: {}, data: {} }); // expect: db.users high
  await prisma.user.updateMany({ data: {} }); // expect: db.users high
  await prisma.user.upsert({ where: {}, create: {}, update: {} }); // expect: db.users high
  await prisma.order.delete({ where: {} }); // expect: db.orders high
  await prisma.order.deleteMany({}); // expect: db.orders high
  await tx.group.create({ data: {} }); // expect: db.groups high
  await client.session.create({ data: {} }); // expect: db.sessions high
  await prisma.auditLog.create({ data: {} }); // expect: db.audit_logs high
  await prisma.webhook.create({ data: {} }); // expect: unmapped high
}
