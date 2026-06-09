import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMetadataWithDesignMd,
  buildMetadataWithUrl,
  parseMetadataRecord,
} from "../metadata-record.js";

describe("parseMetadataRecord", () => {
  it("returns null for empty values", () => {
    assert.equal(parseMetadataRecord(null), null);
    assert.equal(parseMetadataRecord(""), null);
  });

  it("returns parsed object from JSON string", () => {
    assert.deepEqual(parseMetadataRecord(JSON.stringify({ url: "x" })), {
      url: "x",
    });
  });
});

describe("buildMetadataWithUrl", () => {
  it("sets a normalized url and preserves other metadata", () => {
    assert.deepEqual(
      buildMetadataWithUrl({ invoiceEmail: "billing@example.com" }, "  x  "),
      {
        invoiceEmail: "billing@example.com",
        url: "x",
      },
    );
  });
});

describe("buildMetadataWithDesignMd", () => {
  it("sets normalized design.md fields and preserves other metadata", () => {
    assert.deepEqual(
      buildMetadataWithDesignMd(
        { invoiceEmail: "billing@example.com" },
        {
          extractionId: "  42  ",
          url: "  https://blob.example/design.md  ",
        },
      ),
      {
        designMdExtractionId: "42",
        designMdUrl: "https://blob.example/design.md",
        invoiceEmail: "billing@example.com",
      },
    );
  });

  it("updates only provided design.md fields", () => {
    assert.deepEqual(
      buildMetadataWithDesignMd(
        {
          designMdExtractionId: "42",
          designMdUrl: "https://blob.example/design.md",
        },
        { url: "https://blob.example/new-design.md" },
      ),
      {
        designMdExtractionId: "42",
        designMdUrl: "https://blob.example/new-design.md",
      },
    );
  });

  it("clears design.md fields when values are explicitly empty", () => {
    assert.deepEqual(
      buildMetadataWithDesignMd(
        {
          designMdExtractionId: "42",
          designMdUrl: "https://blob.example/design.md",
        },
        { extractionId: null, url: null },
      ),
      null,
    );
  });
});
