// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: an apostrophe, a /* and a backtick in JSX text open no string, comment or template, so a later write is still found
export function View({ prisma }) {
  const save = async () => {
    await prisma.user.create({ data: {} }); // expect: db.users high
  };
  return <p>Don't save</p>;
}
export async function later(prisma) {
  await prisma.order.delete({ where: {} }); // expect: db.orders high
}
export function Docs({ prisma }) {
  return (
    <section title="a `tick">
      <p>Use /* to match and ` for code, or // for a comment</p>
      {items.map((i) => <b key={i}>{`${i}`}</b>)}
    </section>
  );
}
export async function afterDocs(prisma) {
  await prisma.user.deleteMany({}); // expect: db.users high
}
