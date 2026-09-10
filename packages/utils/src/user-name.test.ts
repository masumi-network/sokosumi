import assert from "node:assert/strict";

import { test } from "vitest";

import { getFirstName, resolveAccountDisplayName } from "./user-name.js";

test("resolveAccountDisplayName prefers a non-empty trimmed name", () => {
  assert.equal(resolveAccountDisplayName("  Ada  ", "ada@example.com"), "Ada");
});

test("resolveAccountDisplayName falls back to the full email when the name is blank", () => {
  assert.equal(
    resolveAccountDisplayName("   ", "ada@example.com"),
    "ada@example.com",
  );
});

test("getFirstName returns the given name from a full name", () => {
  assert.equal(getFirstName("Alexa Kuk"), "Alexa");
  assert.equal(getFirstName("  Jean-Luc Picard  "), "Jean-Luc");
});

test("getFirstName supports mononyms", () => {
  assert.equal(getFirstName("Francis"), "Francis");
  assert.equal(getFirstName("Madonna"), "Madonna");
});

test("getFirstName returns undefined for blank input", () => {
  assert.equal(getFirstName(undefined), undefined);
  assert.equal(getFirstName(null), undefined);
  assert.equal(getFirstName("   "), undefined);
});
