import { describe, expect, it } from "vitest";
import { type SeoAuditLastCheck, seoAuditCheckState } from "./seo-audit-status";

const START = new Date("2026-11-25T10:00:00Z");
const check = (status: SeoAuditLastCheck["status"]): SeoAuditLastCheck => ({
  kind: "audit_full",
  status,
  createdAt: START,
  updatedAt: START,
});
const after = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

describe("seoAuditCheckState", () => {
  it("says a requested or running check runs until the longest check would have ended", () => {
    expect(seoAuditCheckState(check("requested"), after(1))).toBe("running");
    expect(seoAuditCheckState(check("running"), after(179))).toBe("running");
  });

  it("says an open check did not finish after three hours", () => {
    expect(seoAuditCheckState(check("running"), after(180))).toBe("unfinished");
  });

  it("keeps a saved result or a failure whatever its age", () => {
    expect(seoAuditCheckState(check("completed"), after(600))).toBe("finished");
    expect(seoAuditCheckState(check("failed"), after(1))).toBe("failed");
  });
});
