// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: named imports from fs modules are tracked, including renamed ones; other writeFile functions are not
import { writeFile, rm as remove } from "node:fs/promises";
import { mkdir } from "./my-helpers.js";
export async function named() {
  await writeFile("uploads/x", ""); // expect: fs.uploads high
  await remove("uploads/y"); // expect: fs.uploads high
  await mkdir("uploads/z");
}
