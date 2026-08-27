import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serializeMetadataRecord } from "./metadata-record.js";

describe("serializeMetadataRecord", () => {
  it("returns null for empty metadata", () => {
    assert.equal(serializeMetadataRecord(null), null);
    assert.equal(serializeMetadataRecord({}), null);
  });

  it("serializes non-empty metadata", () => {
    assert.equal(
      serializeMetadataRecord({ url: "https://example.com" }),
      JSON.stringify({ url: "https://example.com" }),
    );
  });
});
