import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getOrganizationMetadata,
  parseOrganizationMetadata,
} from "../organization-metadata.js";

describe("parseOrganizationMetadata", () => {
  it("returns null for empty values", () => {
    assert.equal(parseOrganizationMetadata(null), null);
    assert.equal(parseOrganizationMetadata(""), null);
    assert.equal(parseOrganizationMetadata("   "), null);
  });

  it("returns parsed object from JSON string", () => {
    assert.deepEqual(
      parseOrganizationMetadata(JSON.stringify({ url: "https://acme.com" })),
      { url: "https://acme.com" },
    );
  });

  it("returns null for invalid JSON or non-object JSON", () => {
    assert.equal(parseOrganizationMetadata("{"), null);
    assert.equal(parseOrganizationMetadata(JSON.stringify("value")), null);
    assert.equal(parseOrganizationMetadata(JSON.stringify(["a"])), null);
  });
});

describe("getOrganizationMetadata", () => {
  it("returns normalized supported fields from metadata", () => {
    assert.deepEqual(
      getOrganizationMetadata(
        JSON.stringify({
          invoiceEmail: "  billing@example.com  ",
          other: true,
          url: "  https://acme.com  ",
        }),
      ),
      {
        invoiceEmail: "billing@example.com",
        url: "https://acme.com",
      },
    );
  });

  it("returns null supported fields when values are missing or empty", () => {
    assert.deepEqual(getOrganizationMetadata(JSON.stringify({})), {
      invoiceEmail: null,
      url: null,
    });
    assert.deepEqual(
      getOrganizationMetadata(
        JSON.stringify({ invoiceEmail: "   ", url: "   " }),
      ),
      {
        invoiceEmail: null,
        url: null,
      },
    );
  });
});
