import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  IPFS_GATEWAY_PREFIX,
  normalizeOrganizationLogo,
  resolveIpfsOrHttpUrl,
  sanitizeOrganizationLogoForApi,
} from "./ipfs-url.js";

describe("resolveIpfsOrHttpUrl", () => {
  it("returns trimmed string for https URLs", () => {
    assert.equal(
      resolveIpfsOrHttpUrl("  https://example.com/x.png  "),
      "https://example.com/x.png",
    );
  });

  it("resolves ipfs:// to gateway URL", () => {
    assert.equal(
      resolveIpfsOrHttpUrl("ipfs://QmXyz"),
      `${IPFS_GATEWAY_PREFIX}QmXyz`,
    );
  });

  it("resolves bare v0 CID", () => {
    assert.equal(
      resolveIpfsOrHttpUrl("QmV0ExampleCID0123456789012345678901234567890"),
      `${IPFS_GATEWAY_PREFIX}QmV0ExampleCID0123456789012345678901234567890`,
    );
  });

  it("resolves bare v1 CID prefix", () => {
    assert.equal(
      resolveIpfsOrHttpUrl("bafybeigexample"),
      `${IPFS_GATEWAY_PREFIX}bafybeigexample`,
    );
  });
});

describe("normalizeOrganizationLogo", () => {
  it("maps null and undefined to null", () => {
    assert.equal(normalizeOrganizationLogo(null), null);
    assert.equal(normalizeOrganizationLogo(undefined), null);
  });

  it("maps empty and whitespace to null", () => {
    assert.equal(normalizeOrganizationLogo(""), null);
    assert.equal(normalizeOrganizationLogo("   "), null);
  });

  it("normalizes IPFS values to https", () => {
    assert.equal(
      normalizeOrganizationLogo("ipfs://acme-logo"),
      `${IPFS_GATEWAY_PREFIX}acme-logo`,
    );
  });

  it("passes through https URLs", () => {
    assert.equal(
      normalizeOrganizationLogo("https://blob.example/logo.png"),
      "https://blob.example/logo.png",
    );
  });
});

describe("sanitizeOrganizationLogoForApi", () => {
  it("preserves explicit empty string", () => {
    assert.equal(sanitizeOrganizationLogoForApi(""), "");
  });

  it("maps invalid URLs to null", () => {
    assert.equal(sanitizeOrganizationLogoForApi("not-a-url"), null);
    assert.equal(
      sanitizeOrganizationLogoForApi("ftp://example.com/logo"),
      null,
    );
  });

  it("normalizes IPFS logos to https gateway URLs", () => {
    assert.equal(
      sanitizeOrganizationLogoForApi("ipfs://acme-logo"),
      `${IPFS_GATEWAY_PREFIX}acme-logo`,
    );
  });

  it("passes through valid https URLs", () => {
    assert.equal(
      sanitizeOrganizationLogoForApi("https://blob.example/logo.png"),
      "https://blob.example/logo.png",
    );
  });

  it("maps null and undefined to null", () => {
    assert.equal(sanitizeOrganizationLogoForApi(null), null);
    assert.equal(sanitizeOrganizationLogoForApi(undefined), null);
  });

  it("maps non-string values to null without throwing", () => {
    assert.equal(sanitizeOrganizationLogoForApi(42), null);
    assert.equal(sanitizeOrganizationLogoForApi({ url: "x" }), null);
  });

  it("maps whitespace-only values to null", () => {
    assert.equal(sanitizeOrganizationLogoForApi("   "), null);
  });

  it("maps non-http(s) schemes to null", () => {
    assert.equal(
      sanitizeOrganizationLogoForApi("data:image/png;base64,iVBORw0KGgo="),
      null,
    );
  });

  it("does not normalize non-lowercase ipfs schemes", () => {
    assert.equal(sanitizeOrganizationLogoForApi("IPFS://acme-logo"), null);
  });
});
