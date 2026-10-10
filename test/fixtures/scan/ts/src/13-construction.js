// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: new on an alias is a construction site, not a write; other classes named like a resource are ignored
import { EventRecord } from "./events.js";
export function build() {
  const a = new Event("change");
  const b = new EventRecord({});
  return [a, b];
}
