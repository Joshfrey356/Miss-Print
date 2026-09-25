import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStatus, afterApproval, readyStatusFor, columnForStatus, BOARD_COLUMNS, STATUS_LABELS } from "../src/lib/jobs/workflow";

const base = { needsDesign: false, needsProof: false, needsInstall: false, fulfillment: "pickup" as const };

test("simple repeat job skips design and proof", () => {
  assert.equal(nextStatus({ ...base, status: "approved" }), "approved_for_production");
});

test("vehicle wrap goes through design, proof, install", () => {
  const wrap = { ...base, needsDesign: true, needsProof: true, needsInstall: true, fulfillment: "install" as const };
  assert.equal(afterApproval({ ...wrap, status: "approved", hasArtwork: false }), "design");
  assert.equal(afterApproval({ ...base, needsProof: true, status: "approved", hasArtwork: false }), "waiting_artwork");
  assert.equal(afterApproval({ ...base, needsProof: true, status: "approved", hasArtwork: true }), "design");
  assert.equal(nextStatus({ ...wrap, status: "design" }), "proof_ready");
  assert.equal(nextStatus({ ...wrap, status: "quality_check" }), "scheduled_install");
  assert.equal(nextStatus({ ...wrap, status: "scheduled_install" }), "completed");
});

test("ready status follows fulfillment", () => {
  assert.equal(readyStatusFor({ needsInstall: false, fulfillment: "delivery" }), "scheduled_delivery");
  assert.equal(readyStatusFor({ needsInstall: false, fulfillment: "pickup" }), "ready_pickup");
});

test("every board status maps to exactly one column", () => {
  for (const s of Object.keys(STATUS_LABELS)) {
    const cols = BOARD_COLUMNS.filter((c) => c.statuses.includes(s as never));
    if (s === "on_hold" || s === "cancelled") assert.equal(cols.length, 0);
    else assert.equal(cols.length, 1, s);
  }
  assert.equal(columnForStatus("waiting_approval")!.key, "proof");
});
