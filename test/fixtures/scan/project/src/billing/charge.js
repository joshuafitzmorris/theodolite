// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, never run
export const charge = () => fetch("https://api.stripe.com/v1/charges", { method: "POST" });
