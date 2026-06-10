import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildUserMetadataWithDesignMd,
  buildUserMetadataWithUrl,
  getUserMetadata,
  parseUserMetadata,
} from "../user-metadata.js";

describe("parseUserMetadata", () => {
  it("returns null for empty values", () => {
    assert.equal(parseUserMetadata(null), null);
    assert.equal(parseUserMetadata(""), null);
    assert.equal(parseUserMetadata("   "), null);
  });

  it("returns parsed object from JSON string", () => {
    assert.deepEqual(parseUserMetadata(JSON.stringify({ url: "x" })), {
      url: "x",
    });
  });

  it("returns null for invalid JSON or non-object JSON", () => {
    assert.equal(parseUserMetadata("{"), null);
    assert.equal(parseUserMetadata(JSON.stringify("value")), null);
    assert.equal(parseUserMetadata(JSON.stringify(["a"])), null);
  });
});

describe("getUserMetadata", () => {
  it("returns normalized supported fields from metadata", () => {
    assert.deepEqual(
      getUserMetadata(
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

  it("returns null supported fields when values are missing or empty", () => {
    assert.deepEqual(getUserMetadata(JSON.stringify({})), {
      designMdExtractionId: null,
      designMdUrl: null,
      url: null,
    });
    assert.deepEqual(
      getUserMetadata(
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

describe("buildUserMetadataWithUrl", () => {
  it("sets a normalized url and preserves other metadata", () => {
    assert.deepEqual(
      buildUserMetadataWithUrl(
        { designMdUrl: "https://blob.example/design.md" },
        "  https://acme.com  ",
      ),
      {
        designMdUrl: "https://blob.example/design.md",
        url: "https://acme.com",
      },
    );
  });

  it("removes empty url and returns null for empty metadata", () => {
    assert.deepEqual(
      buildUserMetadataWithUrl(
        { designMdUrl: "https://blob.example/design.md", url: "x" },
        "   ",
      ),
      {
        designMdUrl: "https://blob.example/design.md",
      },
    );
    assert.equal(buildUserMetadataWithUrl({ url: "x" }, ""), null);
  });
});

describe("buildUserMetadataWithDesignMd", () => {
  it("sets normalized design.md fields and preserves other metadata", () => {
    assert.deepEqual(
      buildUserMetadataWithDesignMd(
        { url: "https://acme.com" },
        {
          extractionId: "  42  ",
          url: "  https://blob.example/design.md  ",
        },
      ),
      {
        designMdExtractionId: "42",
        designMdUrl: "https://blob.example/design.md",
        url: "https://acme.com",
      },
    );
  });

  it("clears design.md fields when values are explicitly empty", () => {
    assert.deepEqual(
      buildUserMetadataWithDesignMd(
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
      buildUserMetadataWithDesignMd(
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
      buildUserMetadataWithDesignMd(
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
  });
});
