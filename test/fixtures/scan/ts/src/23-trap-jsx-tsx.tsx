// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// @ts-nocheck
// guards: a generic arrow function in a .tsx file is not read as an element, and text in a fragment opens nothing
const id = <T,>(x: T) => x;
const same = <T extends object>(x: T) => x;
export const Page = () => <>Check `a /* b</>;
export async function afterGenerics(prisma: Prisma) {
  const n = 1 < 2 && 3 > 2;
  await prisma.order.update({ data: {} }); // expect: db.orders high
}
