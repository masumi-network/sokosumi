import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isEmptyOrValidWebsiteUrl,
  isValidHttpUrl,
  normalizeWebsiteUrl,
} from "./website-url.js";

describe("isValidHttpUrl", () => {
  it("accepts absolute public http(s) URLs", () => {
    assert.equal(isValidHttpUrl("https://example.com"), true);
    assert.equal(isValidHttpUrl("https://example.com/"), true);
    assert.equal(isValidHttpUrl("http://sub.example.com/path?q=1"), true);
    assert.equal(isValidHttpUrl("https://example.com:8080"), true);
  });

  it("rejects missing scheme, non-http schemes, and bad hosts", () => {
    assert.equal(isValidHttpUrl("example.com"), false);
    assert.equal(isValidHttpUrl("ftp://example.com"), false);
    assert.equal(isValidHttpUrl("https://localhost"), false);
    assert.equal(isValidHttpUrl("https://127.0.0.1"), false);
    assert.equal(isValidHttpUrl("https://192.168.1.1"), false);
    assert.equal(isValidHttpUrl("https://acme"), false);
    assert.equal(isValidHttpUrl("https://a.b"), false);
    assert.equal(isValidHttpUrl("not-a-url"), false);
    assert.equal(isValidHttpUrl(""), false);
  });
});

describe("normalizeWebsiteUrl", () => {
  it("returns null for empty input", () => {
    assert.equal(normalizeWebsiteUrl(""), null);
    assert.equal(normalizeWebsiteUrl("   "), null);
  });

  it("prepends https and accepts bare domains", () => {
    assert.equal(normalizeWebsiteUrl("example.com"), "https://example.com/");
    assert.equal(
      normalizeWebsiteUrl("www.example.com/path"),
      "https://www.example.com/path",
    );
  });

  it("keeps explicit http(s) schemes", () => {
    assert.equal(
      normalizeWebsiteUrl("http://example.com"),
      "http://example.com/",
    );
    assert.equal(normalizeWebsiteUrl("https://acme.com"), "https://acme.com/");
  });

  it("rejects bare labels, localhost, and IPs (wizard leak cases)", () => {
    assert.equal(normalizeWebsiteUrl("acme"), null);
    assert.equal(normalizeWebsiteUrl("not-a-url"), null);
    assert.equal(normalizeWebsiteUrl("localhost"), null);
    assert.equal(normalizeWebsiteUrl("https://localhost"), null);
    assert.equal(normalizeWebsiteUrl("192.168.1.1"), null);
    assert.equal(normalizeWebsiteUrl("https://127.0.0.1"), null);
    assert.equal(normalizeWebsiteUrl("my company"), null);
  });
});

describe("isEmptyOrValidWebsiteUrl", () => {
  it("allows empty and valid websites", () => {
    assert.equal(isEmptyOrValidWebsiteUrl(""), true);
    assert.equal(isEmptyOrValidWebsiteUrl("  "), true);
    assert.equal(isEmptyOrValidWebsiteUrl("example.com"), true);
    assert.equal(isEmptyOrValidWebsiteUrl("https://example.com"), true);
  });

  it("rejects invalid non-empty input", () => {
    assert.equal(isEmptyOrValidWebsiteUrl("acme"), false);
    assert.equal(isEmptyOrValidWebsiteUrl("localhost"), false);
  });
});
