import assert from "node:assert/strict";

import { test } from "vitest";

import {
  getFallbackUserName,
  getFirstName,
  getStoredUserName,
} from "../user-name.js";

test("getStoredUserName preserves a trimmed name", () => {
  assert.equal(
    getStoredUserName("  Andreas  ", "andreas@example.com"),
    "Andreas",
  );
});

test("getStoredUserName falls back to the email prefix for blank names", () => {
  assert.equal(getStoredUserName("   ", "magic@example.com"), "magic");
});

test("getFallbackUserName falls back to the full email when the local part is empty", () => {
  assert.equal(getFallbackUserName("@example.com"), "@example.com");
});

test("getFallbackUserName falls back to User when the email is blank", () => {
  assert.equal(getFallbackUserName("   "), "User");
});

test("user name helpers trim surrounding whitespace consistently", () => {
  assert.equal(getFallbackUserName("  spaced@example.com  "), "spaced");
  assert.equal(getStoredUserName(null, "  @example.com  "), "@example.com");
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
