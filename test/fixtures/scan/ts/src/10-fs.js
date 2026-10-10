// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: filesystem writes on fs, fsp and promises, Bun.write, path.join prefixes, and a dynamic path as "?"
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
export async function files(name, p) {
  fs.writeFileSync("uploads/a.png", ""); // expect: fs.uploads high
  await fsp.appendFile("uploads/log.txt", ""); // expect: fs.uploads high
  await fs.promises.rm("uploads/old", { recursive: true }); // expect: fs.uploads high
  fs.unlinkSync("uploads/b.png"); // expect: fs.uploads high
  fs.mkdirSync("uploads/new"); // expect: fs.uploads high
  fs.renameSync("tmp/a", "uploads/a"); // expect: fs.uploads high
  fs.copyFileSync("tmp/a", "uploads/c"); // expect: fs.uploads high
  fs.createWriteStream("uploads/d.png"); // expect: fs.uploads high
  await Bun.write("uploads/e.png", ""); // expect: fs.uploads high
  fs.writeFileSync(path.join("uploads", name), ""); // expect: fs.uploads medium
  fs.writeFileSync(p, ""); // expect: ? medium
  fs.writeFileSync("out.log", ""); // expect: unmapped high
  fs.readFileSync("uploads/a.png");
}
