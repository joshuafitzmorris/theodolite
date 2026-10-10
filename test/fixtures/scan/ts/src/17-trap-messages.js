// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: log and error messages that mention SQL words are not sites
export function messages(logger) {
  logger.info("INSERT failed");
  console.log("Update user settings");
  throw new Error("delete from cart failed");
}
