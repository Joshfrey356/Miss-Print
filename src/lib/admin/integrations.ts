import "server-only";

export type IntegrationStatus = {
  key: string;
  name: string;
  what: string;
  state: "connected" | "dev" | "not_connected" | "planned";
  stateLabel: string;
  details: string[];
};

const set = (name: string) => Boolean(process.env[name] && process.env[name]!.trim() !== "");

/** Integration status from environment variables. Never returns secret values, only whether they are set. */
export function getIntegrationStatuses(): IntegrationStatus[] {
  const email = (process.env.EMAIL_PROVIDER ?? "console").toLowerCase();
  const storage = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
  const accounting = (process.env.ACCOUNTING_PROVIDER ?? "none").toLowerCase();
  const ai = (process.env.AI_PROVIDER ?? "none").toLowerCase();

  const emailLive = email === "resend" && set("RESEND_API_KEY");
  return [
    {
      key: "email",
      name: "Email",
      what: "Sends quotes, proofs and invoices to customers.",
      state: emailLive ? "connected" : "dev",
      stateLabel: emailLive ? "Sending real email (Resend)" : email === "resend" ? "Resend chosen, but no API key" : "Test mode — emails are not sent",
      details: [
        emailLive
          ? "Emails go out through Resend."
          : "Emails are written to the server log instead of being sent. Set EMAIL_PROVIDER=resend and RESEND_API_KEY to send for real.",
        `From address: ${process.env.EMAIL_FROM ?? "Miss Print <orders@missprintusa.com>"}`,
      ],
    },
    {
      key: "storage",
      name: "File storage",
      what: "Where artwork, proofs, photos and receipts are kept.",
      state: storage === "local" ? "dev" : "connected",
      stateLabel: storage === "local" ? "Stored on this server's disk" : `Cloud storage (${storage})`,
      details: [
        storage === "local"
          ? "Fine for one server. Before going live, switch to cloud storage (Supabase or S3) with versioning and backups."
          : "Files are stored in the cloud.",
      ],
    },
    {
      key: "accounting",
      name: "Accounting (QuickBooks)",
      what: "QuickBooks stays the accounting record. This app would send invoices and payments to it.",
      state: accounting === "quickbooks" && set("QUICKBOOKS_CLIENT_ID") ? "connected" : "planned",
      stateLabel: accounting === "quickbooks" && set("QUICKBOOKS_CLIENT_ID") ? "Set up" : "Not connected — planned for Phase 3",
      details: ["Until then, enter invoices into QuickBooks as you do today."],
    },
    {
      key: "sms",
      name: "Text messages (Twilio)",
      what: "Text customers when their order is ready for pickup.",
      state: "planned",
      stateLabel: "Not connected",
      details: ["Not set up yet."],
    },
    {
      key: "payments",
      name: "Online payments (Stripe)",
      what: "Let customers pay invoices online by card.",
      state: "planned",
      stateLabel: "Not connected",
      details: ["Not set up yet. Record card, cash and check payments by hand in Money."],
    },
    {
      key: "ai",
      name: "Ask Miss Print (AI assistant)",
      what: "Answer questions from your own records, like “What did we charge ABC Plumbing for their last banner?”",
      state: ai !== "none" && set("ANTHROPIC_API_KEY") ? "connected" : "planned",
      stateLabel: ai !== "none" && set("ANTHROPIC_API_KEY") ? "Key set — feature coming in Phase 3" : "Off — planned for Phase 3",
      details: ["It will only answer from real records, and never sends anything to a customer on its own."],
    },
    {
      key: "calendar",
      name: "Google Calendar",
      what: "Show installs and deliveries on your phone's calendar.",
      state: "planned",
      stateLabel: "Not connected",
      details: ["Not set up yet. Use the Calendar page in the meantime."],
    },
  ];
}
