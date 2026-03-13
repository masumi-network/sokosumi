import assert from "node:assert/strict";
import test from "node:test";

import { getFallbackUserName, getStoredUserName } from "../user-name.js";

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
