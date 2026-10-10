// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: calls on constructed or imported SDK clients are external writes; reads, Supabase table chains and local helpers are not
import Stripe from "stripe";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { createClient as redis } from "redis";
export const stripe = new Stripe(key); // expect: external.stripe high
const emails = new Resend(key); // expect: external.resend high
const supabase = createClient(url, key); // expect: external.supabase high
const s3 = new S3Client({}); // expect: external.s3 high
const cache = redis();
export async function calls(openaiClient, file) {
  await stripe.paymentIntents.create({}); // expect: external.stripe high
  await stripe.customers.retrieve("c");
  stripe.webhooks.constructEvent(body, sig, secret);
  await emails.emails.send({}); // expect: external.resend high
  await openaiClient.chat.completions.create({}); // expect: external.openai medium
  await openaiClient.models.list();
  await supabase.auth.admin.createUser({}); // expect: external.supabase high
  await supabase.storage.from("avatars").upload("a.png", file); // expect: external.supabase high
  await supabase.from("users").insert({}); // expect: db.users high
  await supabase.from("users").select("*");
  await s3.send(new PutObjectCommand({})); // expect: external.s3 high
  await s3.send(new GetObjectCommand({}));
  await cache.set("k", "v");
}
