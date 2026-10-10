// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, never run
import { client } from "../db/client.js";
export const rename = (prisma) => prisma.user.update({ data: {} });
export const add = (prisma) => prisma.user.create({ data: {} });
export const handle = client;
