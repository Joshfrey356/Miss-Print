import "server-only";

/**
 * Email abstraction. EMAIL_PROVIDER=console (dev, logs only) | resend.
 * Every customer email should also be written to the `communications` table by the caller.
 */
export type EmailMessage = { to: string; subject: string; text: string; html?: string; replyTo?: string };
export type EmailResult = { ok: boolean; providerId?: string; error?: string };

export interface EmailProvider {
  send(msg: EmailMessage): Promise<EmailResult>;
}

class ConsoleEmail implements EmailProvider {
  async send(msg: EmailMessage): Promise<EmailResult> {
    console.info(`\n📧 [email:console] To: ${msg.to}\n   Subject: ${msg.subject}\n   ${msg.text.split("\n").join("\n   ")}\n`);
    return { ok: true, providerId: `console-${Date.now()}` };
  }
}

class ResendEmail implements EmailProvider {
  constructor(private apiKey: string, private from: string) {}
  async send(msg: EmailMessage): Promise<EmailResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, reply_to: msg.replyTo }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    const json = (await res.json()) as { id?: string };
    return { ok: true, providerId: json.id };
  }
}

export function emailProvider(): EmailProvider {
  const from = process.env.EMAIL_FROM ?? "Miss Print <orders@missprintusa.com>";
  if (process.env.EMAIL_PROVIDER === "resend" && process.env.RESEND_API_KEY) return new ResendEmail(process.env.RESEND_API_KEY, from);
  return new ConsoleEmail();
}
