import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// src/lib/secrets.ts imports "server-only", which throws outside a React Server environment.
const load = Module.prototype.require;
Module.prototype.require = function (this: NodeJS.Module, id: string) {
  return id === "server-only" ? {} : load.apply(this, [id] as never);
} as typeof Module.prototype.require;

test("secrets round-trip and detect tampering", async () => {
  process.env.APP_SECRET_KEY = "test-key";
  const { sealSecret, openSecret } = await import("../src/lib/secrets");
  const sealed = sealSecret({ accessToken: "abc", n: 1 });
  assert.ok(!sealed.includes("abc"));
  assert.deepEqual(openSecret(sealed), { accessToken: "abc", n: 1 });
  assert.notEqual(sealSecret("x"), sealSecret("x")); // fresh IV every time
  const [v, iv, tag, data] = sealed.split(".");
  const flipped = data!.slice(0, -2) + (data!.endsWith("AA") ? "AB" : "AA");
  assert.throws(() => openSecret([v, iv, tag, flipped].join(".")));
  process.env.APP_SECRET_KEY = "another-key";
  assert.throws(() => openSecret(sealed));
});
