import { test } from "node:test";
import assert from "node:assert/strict";
import { jobNo, jobPrefixFor, normalizeJobPrefix, parseJobNumber, parseNumberInput } from "../src/lib/format";

test("jobNo shows the shop's prefix", () => {
  assert.equal(jobNo(10428, "MP"), "MP-10428");
  assert.equal(jobNo(1002, "LS"), "LS-1002");
  assert.equal(jobNo(1002, ""), "#1002");
});

test("parseJobNumber accepts any letter prefix, #, or a bare number", () => {
  assert.equal(parseJobNumber("MP-10428"), 10428);
  assert.equal(parseJobNumber("mp10428"), 10428);
  assert.equal(parseJobNumber(" LS-1002 "), 1002);
  assert.equal(parseJobNumber("ls 1002"), 1002);
  assert.equal(parseJobNumber("#1042"), 1042);
  assert.equal(parseJobNumber("10428"), 10428);
  assert.equal(parseJobNumber("ABCDEF-1"), null); // more than 5 letters
  assert.equal(parseJobNumber("MP-"), null);
  assert.equal(parseJobNumber("banner"), null);
  assert.equal(parseJobNumber(""), null);
});

test("parseJobNumber with the shop's prefix rejects other prefixes", () => {
  assert.equal(parseJobNumber("LS-1002", "LS"), 1002);
  assert.equal(parseJobNumber("ls1002", "LS"), 1002);
  assert.equal(parseJobNumber("1002", "LS"), 1002);
  assert.equal(parseJobNumber("MP-10428", "LS"), null);
  assert.equal(parseJobNumber("INV-7001", "MP"), null);
  assert.equal(parseJobNumber("Q-5012", "MP"), null);
});

test("parseNumberInput splits letters and number", () => {
  assert.deepEqual(parseNumberInput("inv-7001"), { letters: "INV", n: 7001 });
  assert.deepEqual(parseNumberInput("Q 5012"), { letters: "Q", n: 5012 });
  assert.deepEqual(parseNumberInput("#1042"), { letters: "", n: 1042 });
  assert.equal(parseNumberInput("4x8 banner"), null);
});

test("normalizeJobPrefix cleans settings input", () => {
  assert.equal(normalizeJobPrefix("mp"), "MP");
  assert.equal(normalizeJobPrefix(" ls "), "LS");
  assert.equal(normalizeJobPrefix("L-S"), "LS");
  assert.equal(normalizeJobPrefix("ABCDE"), "ABCDE");
  assert.equal(normalizeJobPrefix("ABCDEF"), null);
  assert.equal(normalizeJobPrefix(""), null);
  assert.equal(normalizeJobPrefix("M2"), null);
  assert.equal(normalizeJobPrefix("12"), null);
});

test("jobPrefixFor suggests the shop's initials", () => {
  assert.equal(jobPrefixFor("Lakeshore Signs"), "LS");
  assert.equal(jobPrefixFor("Miss Print"), "MP");
  assert.equal(jobPrefixFor("Joe's Signs & Print, LLC"), "JSP");
  assert.equal(jobPrefixFor("3D Print Co"), "DPC");
  assert.equal(jobPrefixFor("   "), "J");
  const p = jobPrefixFor("Anything At All Here");
  assert.equal(normalizeJobPrefix(p), p);
});
