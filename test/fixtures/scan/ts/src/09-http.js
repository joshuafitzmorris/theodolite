// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: fetch with a write method, axios, got and ky writes, bound clients, and a dynamic URL as "?"
import axios from "axios";
const stripe = axios.create({ baseURL: "https://api.stripe.com" }); // expect: external.stripe high
export async function http(got, ky, url) {
  await fetch("https://api.stripe.com/v1/charges", { method: "POST" }); // expect: external.stripe high
  await axios.post("https://api.stripe.com/v1/refunds", {}); // expect: external.stripe high
  await got.patch("https://api.stripe.com/v1/customers/1", {}); // expect: external.stripe high
  await ky.put("https://api.stripe.com/v1/x", {}); // expect: external.stripe high
  await axios.delete("https://api.stripe.com/v1/y"); // expect: external.stripe high
  await stripe.post("/charges", {}); // expect: external.stripe high
  await axios.post("https://hooks.example.org/in", {}); // expect: unmapped high
  await fetch(url, { method: "DELETE" }); // expect: ? medium
  await fetch(`${url}/items`, { method: "put" }); // expect: ? medium
}
