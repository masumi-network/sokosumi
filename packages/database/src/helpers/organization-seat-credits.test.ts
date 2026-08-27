import { describe, expect, it, vi } from "vitest";

import {
  buildOrganizationSeatAssignmentSubscriptionReferenceId,
  countOrganizationSubscriptionPeriodSeatGrants,
  getUnusedSubscriptionSeatCreditSlots,
  hasOrganizationMemberSubscriptionPeriodGrant,
} from "./organization-seat-credits.js";

describe("organization-seat-credits helpers", () => {
  it("builds a stable seat-assignment subscription reference id", () => {
    const periodEnd = new Date("2026-06-01T00:00:00.000Z");

    expect(
      buildOrganizationSeatAssignmentSubscriptionReferenceId(
        "user-1",
        "org-1",
        periodEnd,
      ),
    ).toBe("member:user-1:seat-assign:org-1:2026-06-01T00:00:00.000Z");
  });

  it("computes unused subscription seat credit slots", () => {
    expect(
      getUnusedSubscriptionSeatCreditSlots({
        grantedSeatSlots: 3,
        purchasedSeats: 5,
      }),
    ).toBe(2);

    expect(
      getUnusedSubscriptionSeatCreditSlots({
        grantedSeatSlots: 5,
        purchasedSeats: 5,
      }),
    ).toBe(0);
  });

  it("counts only not-yet-expired subscription period seat grants", async () => {
    const countMock = vi.fn().mockResolvedValue(4);
    const now = new Date("2026-05-15T00:00:00.000Z");

    await expect(
      countOrganizationSubscriptionPeriodSeatGrants("org-1", now, {
        creditBucket: {
          count: countMock,
        },
      } as never),
    ).resolves.toBe(4);

    expect(countMock).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [{ activatesAt: null }, { activatesAt: { lte: now } }],
          },
          {
            organizationId: "org-1",
            expiresAt: {
              gt: now,
            },
            referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
            referenceId: {
              startsWith: "member:",
            },
            NOT: {
              referenceId: {
                contains: ":local-free:",
              },
            },
          },
        ],
      },
    });
  });

  it("detects when a member already has a subscription period grant", async () => {
    const findFirstMock = vi.fn().mockResolvedValue({ id: "bucket-1" });
    const now = new Date("2026-05-15T00:00:00.000Z");

    await expect(
      hasOrganizationMemberSubscriptionPeriodGrant("org-1", "user-1", now, {
        creditBucket: {
          findFirst: findFirstMock,
        },
      } as never),
    ).resolves.toBe(true);

    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [{ activatesAt: null }, { activatesAt: { lte: now } }],
          },
          {
            organizationId: "org-1",
            expiresAt: {
              gt: now,
            },
            userId: "user-1",
            referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
            referenceId: {
              startsWith: "member:user-1:",
            },
            NOT: {
              referenceId: {
                contains: ":local-free:",
              },
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });
  });

  it("excludes local-free buckets when counting paid seat grants", async () => {
    const countMock = vi.fn().mockResolvedValue(2);
    const now = new Date("2026-05-15T00:00:00.000Z");

    await countOrganizationSubscriptionPeriodSeatGrants("org-1", now, {
      creditBucket: {
        count: countMock,
      },
    } as never);

    const scopeWhere = countMock.mock.calls[0]?.[0].where.AND[1] as {
      NOT: { referenceId: { contains: string } };
    };
    expect(scopeWhere.NOT).toEqual({
      referenceId: {
        contains: ":local-free:",
      },
    });
  });

  it("does not let a held free-tier grant block a paid seat grant", async () => {
    const findFirstMock = vi.fn().mockResolvedValue(null);
    const now = new Date("2026-05-15T00:00:00.000Z");

    await expect(
      hasOrganizationMemberSubscriptionPeriodGrant("org-1", "user-1", now, {
        creditBucket: {
          findFirst: findFirstMock,
        },
      } as never),
    ).resolves.toBe(false);

    const scopeWhere = findFirstMock.mock.calls[0]?.[0].where.AND[1] as {
      NOT: { referenceId: { contains: string } };
    };
    expect(scopeWhere.NOT).toEqual({
      referenceId: {
        contains: ":local-free:",
      },
    });
  });
});
