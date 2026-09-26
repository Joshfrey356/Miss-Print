import "server-only";

/**
 * Email abstraction. EMAIL_PROVIDER=console (dev, logs only) | resend.
 * Every customer email should also be written to the `communications` table by the caller.
 */
/**
 * `fromName` white-labels the sender: "Joe's Signs <orders@platform-domain>". The address itself
 * always comes from EMAIL_FROM (it must be a domain verified with the provider); set `replyTo`
 * to the shop's own email so customer replies go to the shop.
 */
export type EmailMessage = { to: string; subject: string; text: string; html?: string; replyTo?: string; fromName?: string };
export type EmailResult = { ok: boolean; providerId?: string; error?: string };

export interface EmailProvider {
  send(msg: EmailMessage): Promise<EmailResult>;
}

class ConsoleEmail implements EmailProvider {
  async send(msg: EmailMessage): Promise<EmailResult> {
    console.info(`\n📧 [email:console] From: ${msg.fromName ?? "(default)"} To: ${msg.to}\n   Subject: ${msg.subject}\n   ${msg.text.split("\n").join("\n   ")}\n`);
    return { ok: true, providerId: `console-${Date.now()}` };
  }
}

class ResendEmail implements EmailProvider {
  constructor(private apiKey: string, private from: string) {}
  async send(msg: EmailMessage): Promise<EmailResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: withName(this.from, msg.fromName), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, reply_to: msg.replyTo }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    const json = (await res.json()) as { id?: string };
    return { ok: true, providerId: json.id };
  }
}

/** "Old Name <a@b.com>" + "Joe's Signs" → "Joe's Signs <a@b.com>" */
function withName(from: string, name?: string) {
  if (!name?.trim()) return from;
  const address = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  return `${name.replace(/["<>\r\n]/g, "").trim()} <${address}>`;
}

export function emailProvider(): EmailProvider {
  const from = process.env.EMAIL_FROM ?? "Command Center <orders@missprintusa.com>";
  if (process.env.EMAIL_PROVIDER === "resend" && process.env.RESEND_API_KEY) return new ResendEmail(process.env.RESEND_API_KEY, from);
  return new ConsoleEmail();
}
