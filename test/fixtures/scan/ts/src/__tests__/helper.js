// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: files under __tests__ are never scanned
export async function t(prisma) {
  await prisma.user.create({});
}
