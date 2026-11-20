import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { parseRequeueEmptyCompanyLookupsArgs } from "./requeue-empty-company-lookups.js";

describe("parseRequeueEmptyCompanyLookupsArgs", () => {
  const now = Date.parse("2026-11-20T12:00:00.000Z");

  it("parses a past UTC cutover with optional --apply and pnpm -- separator", () => {
    assert.deepEqual(
      parseRequeueEmptyCompanyLookupsArgs(
        ["--", "--before=2026-11-20T11:00:00.000Z"],
        now,
      ),
      {
        before: new Date("2026-11-20T11:00:00.000Z"),
        apply: false,
      },
    );
    assert.deepEqual(
      parseRequeueEmptyCompanyLookupsArgs(
        ["--before", "2026-11-20T11:00:00.000Z", "--apply"],
        now,
      ),
      {
        before: new Date("2026-11-20T11:00:00.000Z"),
        apply: true,
      },
    );
  });

  it("rejects missing, non-UTC, invalid, or future --before timestamps", () => {
    for (const argv of [
      [],
      ["--before=2026-11-20T11:00:00+00:00"],
      ["--before=not-a-dateZ"],
      ["--before=2026-11-20T13:00:00.000Z"],
    ]) {
      assert.throws(
        () => parseRequeueEmptyCompanyLookupsArgs(argv, now),
        /Pass the Core cutover as a past UTC timestamp with --before\./,
      );
    }
  });
});
