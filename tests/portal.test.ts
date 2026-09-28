import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPortalToken,
  isPortalToken,
  linkExpiry,
  linkState,
  newPortalToken,
  portalCookieHeaders,
  readCookieTokens,
  safePortalNext,
  sessionTouch,
  writeCookieTokens,
  LINK_DAYS,
  MAX_ACCOUNTS,
  SESSION_DAYS,
} from "../src/lib/portal/tokens";
import {
  allowedQuantities,
  AcceptQuoteInput,
  checkQuantityChoices,
  customerStatus,
  customerTimeline,
  DeclineQuoteInput,
  describeRequest,
  PortalRequestInput,
  quoteAnswerable,
  requestDetails,
  SignInEmail,
} from "../src/lib/portal/rules";

const DAY = 86400000;

// ---------------------------------------------------------------------------
// Tokens & links
// ---------------------------------------------------------------------------
test("tokens: random, 43 url-safe chars, stored only as a sha256 hash", () => {
  const a = newPortalToken();
  const b = newPortalToken();
  assert.notEqual(a, b);
  assert.ok(isPortalToken(a) && isPortalToken(b));
  assert.equal(hashPortalToken(a), hashPortalToken(a));
  assert.match(hashPortalToken(a), /^[a-f0-9]{64}$/);
  assert.notEqual(hashPortalToken(a), a);
  for (const bad of ["", "short", a + "x", a.slice(0, 42) + "!", "../../etc/passwd", null, 42]) assert.equal(isPortalToken(bad), false, String(bad));
});

test("link lifecycle: ok → used / expired / revoked", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const fresh = { expiresAt: linkExpiry(LINK_DAYS, now), usedAt: null, revokedAt: null };
  assert.equal(linkState(fresh, now), "ok");
  assert.equal(linkState(fresh, new Date(now.getTime() + (LINK_DAYS - 0.01) * DAY)), "ok");
  assert.equal(linkState(fresh, new Date(now.getTime() + LINK_DAYS * DAY)), "expired", "expires after 7 days");
  assert.equal(linkState({ ...fresh, usedAt: now }, now), "used", "single use");
  assert.equal(linkState({ ...fresh, revokedAt: now }, now), "revoked");
  assert.equal(linkState({ ...fresh, usedAt: now, revokedAt: now }, now), "revoked", "revoked wins");
  assert.equal(linkState(null, now), "missing");
});

test("sessions slide: touched at most every 10 minutes, extended to 60 days", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const s = { expiresAt: new Date(now.getTime() + 5 * DAY), lastSeenAt: new Date(now.getTime() - 60 * 1000) };
  assert.equal(sessionTouch(s, now), null, "seen a minute ago: no write");
  const t = sessionTouch({ ...s, lastSeenAt: new Date(now.getTime() - 11 * 60 * 1000) }, now);
  assert.ok(t);
  assert.equal(t!.expiresAt.getTime(), now.getTime() + SESSION_DAYS * DAY);
  assert.equal(t!.lastSeenAt.getTime(), now.getTime());
  assert.ok(sessionTouch({ ...s, lastSeenAt: null }, now), "never seen: touch");
});

test("cookie: several accounts, first is active, junk dropped, capped", () => {
  const toks = Array.from({ length: MAX_ACCOUNTS + 2 }, () => newPortalToken());
  assert.deepEqual(readCookieTokens(`${toks[0]}.${toks[1]}`), [toks[0], toks[1]]);
  assert.deepEqual(readCookieTokens(`${toks[0]}.junk.${toks[0]}`), [toks[0]], "dedupes and drops junk");
  assert.equal(readCookieTokens(toks.join(".")).length, MAX_ACCOUNTS);
  assert.deepEqual(readCookieTokens(undefined), []);
  assert.equal(writeCookieTokens([toks[1]!, toks[0]!, toks[1]!, "bad"]), `${toks[1]}.${toks[0]}`);
});

test("cookie headers: httpOnly, SameSite=Lax, one per portal path, Secure in production, cleared with Max-Age=0", () => {
  const t = newPortalToken();
  const prod = portalCookieHeaders(t, { secure: true });
  assert.equal(prod.length, 2);
  assert.ok(prod.some((h) => h.includes("Path=/portal;")) && prod.some((h) => h.includes("Path=/api/portal;")));
  for (const h of prod) {
    assert.match(h, /^mp_portal=/);
    assert.match(h, /HttpOnly/);
    assert.match(h, /SameSite=Lax/);
    assert.match(h, /Secure/);
  }
  assert.ok(portalCookieHeaders(t, { secure: false }).every((h) => !h.includes("Secure")));
  assert.ok(portalCookieHeaders("", { secure: false }).every((h) => h.includes("Max-Age=0")));
});

test("after sign-in, only go to portal pages (no open redirects)", () => {
  assert.equal(safePortalNext("/portal/quotes/12"), "/portal/quotes/12");
  assert.equal(safePortalNext("/portal/jobs/1042#proof"), "/portal/home");
  for (const bad of ["https://evil.example", "//evil.example", "/portal//evil.example", "/dashboard", "/portal/login/abc", "javascript:alert(1)", "", null, undefined])
    assert.equal(safePortalNext(bad as string), "/portal/home", String(bad));
});

// ---------------------------------------------------------------------------
// What customers see
// ---------------------------------------------------------------------------
test("friendly status words for customers", () => {
  assert.equal(customerStatus("production").label, "In production");
  assert.equal(customerStatus("quality_check").label, "In production");
  assert.equal(customerStatus("ready_pickup").label, "Ready for pickup");
  assert.equal(customerStatus("waiting_approval").label, "Waiting for your approval");
  assert.equal(customerStatus("waiting_artwork").label, "Waiting for your artwork");
  assert.equal(customerStatus("needs_quote").label, "Order received");
});

test("timeline: plain steps with the current one highlighted", () => {
  const created = new Date("2026-09-01T15:00:00Z");
  const h = (toStatus: Parameters<typeof customerStatus>[0], day: number) => ({ toStatus, changedAt: new Date(created.getTime() + day * DAY) });
  const steps = customerTimeline({ status: "production", needsDesign: true, needsProof: true, fulfillment: "pickup", createdAt: created }, [h("approved", 0), h("design", 1), h("waiting_approval", 2), h("approved_for_production", 3), h("production", 4)]);
  assert.deepEqual(
    steps.map((s) => [s.key, s.state]),
    [
      ["received", "done"],
      ["design", "done"],
      ["proof", "done"],
      ["production", "current"],
      ["ready", "todo"],
      ["done", "todo"],
    ],
  );
  assert.equal(steps.find((s) => s.key === "proof")!.at?.getTime(), created.getTime() + 3 * DAY, "proof approved when production started");
  assert.equal(steps.find((s) => s.key === "ready")!.label, "Ready for pickup");
  const waiting = customerTimeline({ status: "waiting_artwork", needsDesign: false, needsProof: false, fulfillment: "install", createdAt: created }, [h("waiting_artwork", 0)]);
  assert.equal(waiting.find((s) => s.state === "current")!.label, "Waiting for your artwork");
  assert.equal(waiting.at(-1)!.label, "Installed");
  const done = customerTimeline({ status: "completed", needsDesign: false, needsProof: false, fulfillment: "pickup", createdAt: created }, [h("completed", 5)]);
  assert.ok(done.every((s) => s.state === "done"));
  const held = customerTimeline({ status: "on_hold", needsDesign: false, needsProof: false, fulfillment: "pickup", createdAt: created }, [h("production", 1), h("on_hold", 2)]);
  assert.equal(held.find((s) => s.state === "current")!.key, "production", "on hold shows where it stopped");
});

// ---------------------------------------------------------------------------
// Quote acceptance rules
// ---------------------------------------------------------------------------
test("quotes: only sent, unexpired, unconverted quotes can be answered", () => {
  const today = "2026-09-28";
  assert.deepEqual(quoteAnswerable({ status: "sent", validUntil: "2026-10-10" }, today), { ok: true });
  assert.deepEqual(quoteAnswerable({ status: "sent", validUntil: today }, today), { ok: true }, "valid through its last day");
  assert.deepEqual(quoteAnswerable({ status: "sent", validUntil: null }, today), { ok: true });
  for (const [q, why] of [
    [{ status: "sent", validUntil: "2026-09-27" }, /expired/],
    [{ status: "expired", validUntil: null }, /expired/],
    [{ status: "draft", validUntil: null }, /isn't ready/],
    [{ status: "converted", validUntil: null }, /already an order/],
    [{ status: "accepted", validUntil: null }, /already accepted/],
    [{ status: "declined", validUntil: null }, /declined/],
    [{ status: "sent", validUntil: null, archivedAt: new Date() }, /no longer available/],
  ] as const) {
    const r = quoteAnswerable(q, today);
    assert.equal(r.ok, false, JSON.stringify(q));
    assert.match((r as { reason: string }).reason, why);
  }
});

test("quotes: accepting needs a typed name and the checkbox; declining needs a reason", () => {
  assert.equal(AcceptQuoteInput.safeParse({ name: "Jo Smith", agree: true }).success, true);
  assert.equal(AcceptQuoteInput.safeParse({ name: "J", agree: true }).success, false);
  assert.equal(AcceptQuoteInput.safeParse({ name: "Jo Smith", agree: false }).success, false);
  assert.equal(AcceptQuoteInput.safeParse({ name: "Jo Smith", agree: true, quantities: { abc: 5 } }).success, false);
  assert.equal(DeclineQuoteInput.safeParse({ reason: "" }).success, false);
  assert.equal(DeclineQuoteInput.safeParse({ reason: "Went with another shop" }).success, true);
});

test("quotes: quantity choices must be one of the offered quantities", () => {
  const items = [
    { id: 7, description: "Business cards", quantity: 500, options: [{ quantity: 250, recommendedCents: 4500 }, { quantity: 1000, recommendedCents: 7000 }] },
    { id: 8, description: "Setup", quantity: 1, options: null },
  ];
  assert.deepEqual(allowedQuantities(500, items[0]!.options), [250, 500, 1000]);
  assert.deepEqual(checkQuantityChoices(items, { "7": 500, "8": 1 }), { ok: true, lines: [] });
  const picked = checkQuantityChoices(items, { "7": 1000 });
  assert.ok(picked.ok && picked.lines[0]!.includes("1,000") && picked.lines[0]!.includes("quoted 500"));
  assert.equal(checkQuantityChoices(items, { "7": 750 }).ok, false);
  assert.equal(checkQuantityChoices(items, { "8": 2 }).ok, false);
  assert.equal(checkQuantityChoices(items, { "99": 1 }).ok, false, "a line from another quote");
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------
test("requests: reorder / quote / message validation", () => {
  const ok = PortalRequestInput.safeParse({ kind: "reorder", jobId: 3, quantity: 500, neededBy: "2026-10-15", sameArtwork: true, notes: "", fileIds: [] });
  assert.equal(ok.success, true);
  assert.equal(PortalRequestInput.safeParse({ kind: "reorder", jobId: 3, quantity: 0, sameArtwork: true }).success, false, "quantity required");
  assert.equal(PortalRequestInput.safeParse({ kind: "reorder", jobId: 3, quantity: Number.NaN, sameArtwork: true }).success, false);
  assert.equal(PortalRequestInput.safeParse({ kind: "reorder", jobId: 3, quantity: 5, neededBy: "soon", sameArtwork: true }).success, false, "bad date");
  const empty = PortalRequestInput.safeParse({ kind: "reorder", jobId: 3, quantity: 5, neededBy: "", sameArtwork: false });
  assert.ok(empty.success && empty.data.kind === "reorder" && empty.data.neededBy === null, "empty date = flexible");
  assert.equal(PortalRequestInput.safeParse({ kind: "quote", what: "" }).success, false);
  assert.equal(PortalRequestInput.safeParse({ kind: "quote", what: "Yard signs", quantity: "25", size: "18x24" }).success, true);
  assert.equal(PortalRequestInput.safeParse({ kind: "message", subject: "Hi", body: "" }).success, false);
  assert.equal(PortalRequestInput.safeParse({ kind: "message", subject: "Pickup", body: "Can I pick up at 4?", jobId: null }).success, true);
  assert.equal(PortalRequestInput.safeParse({ kind: "message", subject: "x".repeat(300), body: "hello" }).success, false, "long subject");
  assert.equal(PortalRequestInput.safeParse({ kind: "message", subject: "Files", body: "here", fileIds: Array.from({ length: 21 }, (_, i) => i + 1) }).success, false, "too many files");
  assert.equal(PortalRequestInput.safeParse({ kind: "delete", subject: "x" }).success, false, "unknown kind");
});

test("requests: stored details read back safely", () => {
  const parsed = PortalRequestInput.parse({ kind: "reorder", jobId: 3, quantity: 750, neededBy: "2026-10-15", sameArtwork: false, notes: "New phone", fileIds: [4, 5] });
  const d = describeRequest(parsed, { jobLabel: "MP-1042" });
  assert.equal(d.subject, "Reorder of MP-1042: 750");
  assert.equal(d.body, "New phone");
  const back = requestDetails(JSON.parse(JSON.stringify(d.details)));
  assert.deepEqual([back.quantity, back.neededBy, back.sameArtwork, back.fileIds], [750, "2026-10-15", false, [4, 5]]);
  const junk = requestDetails({ quantity: "lots", fileIds: [1, "2", -3, 4.5, 6], neededBy: 5 });
  assert.deepEqual([junk.quantity, junk.neededBy, junk.fileIds], [null, null, [1, 6]]);
  assert.deepEqual(requestDetails(null).fileIds, []);
});

test("sign-in email is normalized", () => {
  assert.equal(SignInEmail.parse("  Jo@Example.COM "), "jo@example.com");
  assert.equal(SignInEmail.safeParse("not an email").success, false);
});

// ---------------------------------------------------------------------------
// Shop settings
// ---------------------------------------------------------------------------
import { DEFAULT_PORTAL_SETTINGS, normalizePortalSettings, portalAllows, REQUEST_FEATURE } from "../src/lib/portal/config";

test("portal settings: on with everything allowed by default; stored values win; junk ignored", () => {
  assert.deepEqual(normalizePortalSettings(undefined), DEFAULT_PORTAL_SETTINGS);
  assert.deepEqual(normalizePortalSettings("nope"), DEFAULT_PORTAL_SETTINGS);
  const s = normalizePortalSettings({ enabled: false, welcome: "Hi!", features: { pay: false, uploads: "no", bogus: true } });
  assert.equal(s.enabled, false);
  assert.equal(s.welcome, "Hi!");
  assert.equal(s.features.pay, false);
  assert.equal(s.features.uploads, true, "non-boolean falls back to the default");
  assert.ok(!("bogus" in s.features));
  assert.equal(normalizePortalSettings({ welcome: "x".repeat(900) }).welcome.length, 500);
});

test("portal settings: a feature works only while the portal is on", () => {
  const on = normalizePortalSettings({ features: { reorders: false } });
  assert.equal(portalAllows(on, "quotes"), true);
  assert.equal(portalAllows(on, REQUEST_FEATURE.reorder), false);
  assert.equal(portalAllows({ ...on, enabled: false }, "quotes"), false);
  assert.deepEqual(REQUEST_FEATURE, { reorder: "reorders", quote: "quoteRequests", message: "messages" });
});
