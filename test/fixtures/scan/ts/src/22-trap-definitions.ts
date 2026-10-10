// biome-ignore-all assist: fixture, never run
// biome-ignore-all lint: fixture, never run
// biome-ignore-all format: fixture, the expect markers must stay on their lines
// @ts-nocheck
// guards: interface members and abstract signatures that name a match entry are definitions, a call beside them is still a write
export interface Mailer {
  sendEmail(to: string): Promise<void>;
  sendEmail(to: string, opts?: Options): void;
  ping(): void;
}
export abstract class Base {
  abstract sendEmail(to: string): void;
  protected async sendEmail({ to }: Args): Promise<void> {
    return;
  }
}
export async function use(mailer: Mailer, ok: boolean, to: string) {
  const x = ok ? sendEmail(to) : null; // expect: effect.email high
  await mailer.sendEmail(to); // expect: effect.email high
}
