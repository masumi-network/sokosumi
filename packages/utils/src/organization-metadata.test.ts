import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOrganizationMetadataWithDesignMd,
  buildOrganizationMetadataWithUrl,
  getOrganizationMetadata,
  parseOrganizationMetadata,
} from "./organization-metadata.js";

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
          designMdExtractionId: "  42  ",
          designMdUrl: "  https://blob.example/design.md  ",
          other: true,
          url: "  https://acme.com  ",
        }),
      ),
      {
        designMdExtractionId: "42",
        designMdUrl: "https://blob.example/design.md",
        url: "https://acme.com",
      },
    );
  });

  it("ignores legacy invoiceEmail values", () => {
    assert.deepEqual(
      getOrganizationMetadata(
        JSON.stringify({
          invoiceEmail: "billing@example.com",
          url: "https://acme.com",
        }),
      ),
      {
        designMdExtractionId: null,
        designMdUrl: null,
        url: "https://acme.com",
      },
    );
  });

  it("returns null supported fields when values are missing or empty", () => {
    assert.deepEqual(getOrganizationMetadata(JSON.stringify({})), {
      designMdExtractionId: null,
      designMdUrl: null,
      url: null,
    });
    assert.deepEqual(
      getOrganizationMetadata(
        JSON.stringify({
          designMdExtractionId: "   ",
          designMdUrl: "   ",
          url: "   ",
        }),
      ),
      {
        designMdExtractionId: null,
        designMdUrl: null,
        url: null,
      },
    );
  });
});

describe("buildOrganizationMetadataWithUrl", () => {
  it("sets a normalized url and preserves other metadata", () => {
    assert.deepEqual(
      buildOrganizationMetadataWithUrl(
        { invoiceEmail: "billing@example.com" },
        "  https://acme.com  ",
      ),
      {
        invoiceEmail: "billing@example.com",
        url: "https://acme.com/",
      },
    );
    assert.deepEqual(buildOrganizationMetadataWithUrl(null, "acme.com"), {
      url: "https://acme.com/",
    });
  });

  it("removes empty or invalid url and returns null for empty metadata", () => {
    assert.deepEqual(
      buildOrganizationMetadataWithUrl(
        { invoiceEmail: "billing@example.com", url: "https://acme.com" },
        "   ",
      ),
      {
        invoiceEmail: "billing@example.com",
      },
    );
    assert.equal(buildOrganizationMetadataWithUrl({ url: "x" }, ""), null);
    assert.equal(buildOrganizationMetadataWithUrl({ url: "x" }, "acme"), null);
  });
});

describe("buildOrganizationMetadataWithDesignMd", () => {
  it("sets normalized design.md fields and preserves other metadata", () => {
    assert.deepEqual(
      buildOrganizationMetadataWithDesignMd(
        { invoiceEmail: "billing@example.com", url: "https://acme.com" },
        {
          extractionId: "  42  ",
          url: "  https://blob.example/design.md  ",
        },
      ),
      {
        designMdExtractionId: "42",
        designMdUrl: "https://blob.example/design.md",
        invoiceEmail: "billing@example.com",
        url: "https://acme.com",
      },
    );
  });

  it("clears design.md fields when values are explicitly empty", () => {
    assert.deepEqual(
      buildOrganizationMetadataWithDesignMd(
        {
          designMdExtractionId: "42",
          designMdUrl: "https://blob.example/design.md",
          url: "https://acme.com",
        },
        { extractionId: "", url: "" },
      ),
      {
        url: "https://acme.com",
      },
    );
    assert.deepEqual(
      buildOrganizationMetadataWithDesignMd(
        {
          designMdExtractionId: "42",
          designMdUrl: "https://blob.example/design.md",
        },
        { extractionId: null, url: null },
      ),
      null,
    );
  });

  it("updates only provided design.md fields", () => {
    assert.deepEqual(
      buildOrganizationMetadataWithDesignMd(
        {
          designMdExtractionId: "42",
          designMdUrl: "https://blob.example/design.md",
          url: "https://acme.com",
        },
        { url: "https://blob.example/new-design.md" },
      ),
      {
        designMdExtractionId: "42",
        designMdUrl: "https://blob.example/new-design.md",
        url: "https://acme.com",
      },
    );
    assert.deepEqual(
      buildOrganizationMetadataWithDesignMd(
        {
          designMdExtractionId: "42",
          designMdUrl: "https://blob.example/design.md",
        },
        {},
      ),
      {
        designMdExtractionId: "42",
        designMdUrl: "https://blob.example/design.md",
      },
    );
  });
});
