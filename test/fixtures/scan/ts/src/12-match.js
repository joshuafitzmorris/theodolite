// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// guards: match entries find calls, constructions and URLs, and a definition of the matched name (function, method, object method) is not a write
export async function notify(to) {
  await sendEmail(to); // expect: effect.email high
  await resend.emails.send({ to }); // expect: effect.email high
  const client = new Stripe(key); // expect: external.stripe high
  const base = "https://api.stripe.com/v1"; // expect: external.stripe high
  await s3.putObject({}); // expect: bucket.assets high
}
function sendEmail(to) {
  return to;
}
export async function sendEmailLater(to) {
  return to;
}
export class Mailer {
  sendEmail(to) {
    return to;
  }
}
export const api = {
  sendEmail(to, opts) {
    return to;
  },
};
