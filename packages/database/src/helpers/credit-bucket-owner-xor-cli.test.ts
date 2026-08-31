import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { parseCreditBucketOwnerXorArgs } from "./credit-bucket-owner-xor-cli.js";

describe("parseCreditBucketOwnerXorArgs", () => {
  it("parses dry-run, verbose, and organization id", () => {
    assert.deepEqual(
      parseCreditBucketOwnerXorArgs([
        "--dry-run",
        "-v",
        "--organization-id",
        "org-1",
      ]),
      {
        dryRun: true,
        organizationId: "org-1",
        verbose: true,
      },
    );
  });

  it("rejects a missing or flag-shaped --organization-id value", () => {
    assert.throws(
      () => parseCreditBucketOwnerXorArgs(["--organization-id"]),
      /--organization-id requires a value/,
    );
    assert.throws(
      () => parseCreditBucketOwnerXorArgs(["--organization-id", "--dry-run"]),
      /--organization-id requires a value/,
    );
  });

  it("rejects unknown arguments so a mistyped dry-run cannot mutate", () => {
    assert.throws(
      () => parseCreditBucketOwnerXorArgs(["--dryrun"]),
      /unknown argument "--dryrun"/,
    );
  });
});
