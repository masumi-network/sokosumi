import { SEO_FULL_AUDIT_CREDITS, seoFullAuditPrice } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import type { RequestSeoAnalysis } from "@/schemas/project-seo.schema";

import { requireSeoFullAuditPriceApproval } from "./analysis-price";

const price = seoFullAuditPrice();

function fullAudit(extra: Partial<RequestSeoAnalysis>): RequestSeoAnalysis {
  return { kind: "audit_full", ...extra } as RequestSeoAnalysis;
}

function refusal(input: RequestSeoAnalysis): HTTPException {
  try {
    requireSeoFullAuditPriceApproval(input);
  } catch (error) {
    if (error instanceof HTTPException) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("requireSeoFullAuditPriceApproval", () => {
  it("accepts the current cost-plus terms", () => {
    expect(() =>
      requireSeoFullAuditPriceApproval(fullAudit({ fullAuditPrice: price })),
    ).not.toThrow();
  });

  // SOKD-483: agents read maxCredits as a spending cap and were told the price changed.
  it("names fullAuditPrice.maxCredits instead of saying the price changed", () => {
    const error = refusal(
      fullAudit({
        fullAuditPrice: seoFullAuditPrice(SEO_FULL_AUDIT_CREDITS),
      }),
    );
    expect(error.status).toBe(409);
    expect(error.message).toContain("Leave out fullAuditPrice.maxCredits");
    expect(error.message).not.toContain("price changed");
  });

  it("tells a caller without a price which fullAuditPrice to send", () => {
    const error = refusal(fullAudit({}));
    expect(error.status).toBe(409);
    expect(error.message).toContain("fullAuditPrice");
    expect(error.message).toContain(
      `"minimumCredits": ${SEO_FULL_AUDIT_CREDITS}`,
    );
  });

  it("keeps the stale-price refusal for a client that sends the old fixed credits", () => {
    const error = refusal(
      fullAudit({ fullAuditCredits: SEO_FULL_AUDIT_CREDITS }),
    );
    expect(error.status).toBe(409);
    expect(error.message).toContain("price changed");
  });
});
