/**
 * Shop-level customer portal settings (company_settings key "portal"). Pure and client-safe;
 * read them on the server with getPortalSettings() from ./settings.
 */
import type { RequestKind } from "./rules";

export type PortalFeature = "quotes" | "pay" | "reorders" | "quoteRequests" | "messages" | "uploads";

export type PortalSettings = {
  /** Master switch. Off: nobody can sign in or use the portal, and no portal links are sent. */
  enabled: boolean;
  /** Short welcome shown on the portal home page. */
  welcome: string;
  features: Record<PortalFeature, boolean>;
};

export const PORTAL_FEATURES: { key: PortalFeature; label: string; help: string }[] = [
  { key: "quotes", label: "Accept or decline quotes online", help: "Customers answer quotes themselves. Quote emails say “View and accept online”." },
  { key: "pay", label: "Pay invoices online", help: "A “Pay online” button on unpaid invoices. Needs card payments (Stripe) connected." },
  { key: "reorders", label: "Reorder past jobs", help: "“Reorder” on finished orders sends you a reorder request." },
  { key: "quoteRequests", label: "Request a quote", help: "Customers describe something new and ask for a price." },
  { key: "messages", label: "Send you messages", help: "“Message us” and “Question about this order?”." },
  { key: "uploads", label: "Upload artwork", help: "Customers add files to open orders and to their requests." },
];

/** New and existing shops start with the portal on and everything allowed. */
export const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  enabled: true,
  welcome: "",
  features: { quotes: true, pay: true, reorders: true, quoteRequests: true, messages: true, uploads: true },
};

export const MAX_WELCOME = 500;

/** Stored value → settings, with defaults for anything missing or malformed. */
export function normalizePortalSettings(raw: unknown): PortalSettings {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const f = v.features && typeof v.features === "object" ? (v.features as Record<string, unknown>) : {};
  const features = Object.fromEntries(
    PORTAL_FEATURES.map(({ key }) => [key, typeof f[key] === "boolean" ? (f[key] as boolean) : DEFAULT_PORTAL_SETTINGS.features[key]]),
  ) as PortalSettings["features"];
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_PORTAL_SETTINGS.enabled,
    welcome: typeof v.welcome === "string" ? v.welcome.slice(0, MAX_WELCOME) : "",
    features,
  };
}

/** Which feature a customer request needs. */
export const REQUEST_FEATURE: Record<RequestKind, PortalFeature> = { reorder: "reorders", quote: "quoteRequests", message: "messages" };

/** Whether a feature can be used right now (the portal must be on, too). */
export const portalAllows = (s: PortalSettings, f: PortalFeature) => s.enabled && s.features[f];
