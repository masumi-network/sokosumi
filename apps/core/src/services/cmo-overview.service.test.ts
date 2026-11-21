import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCmoServiceMocks, strategy } from "@/test-fixtures/cmo-service";

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);
vi.mock(
  "@/services/social-posts.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.socialPosts,
);
vi.mock(
  "@/services/soko-bot-shared-create.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.sharedCreate,
);
vi.mock(
  "@/services/soko-bot-control-plane.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.controlPlane,
);
vi.mock(
  "@/helpers/organization-workspace",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .organizationWorkspace,
);
vi.mock(
  "@/helpers/user-workspaces",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .userWorkspaces,
);
vi.mock(
  "@/helpers/subscription",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.subscription,
);
vi.mock(
  "@/services/soko-bot-billing.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.billing,
);
vi.mock(
  "@vercel/functions",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .vercelFunctions,
);
vi.mock(
  "@/services/soko-bot-integration-connection.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .integrationConnection,
);
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

import {
  cmoOnboardingStep,
  cmoUpNext,
  withoutSkippedPieces,
} from "./cmo-overview.service";

beforeEach(resetCmoServiceMocks);

describe("cmoUpNext", () => {
  const plan = {
    ...strategy,
    calendar: [
      ...strategy.calendar,
      {
        id: "w",
        date: "2026-10-21",
        channel: "website",
        title: "Pricing page",
        format: "article",
        status: "idea" as const,
      },
    ],
  };
  const today = new Date("2026-10-05T10:00:00Z");

  it("lists only open entries on connected accounts, soonest first", () => {
    expect(cmoUpNext(plan, today, ["LinkedIn"]).map((item) => item.id)).toEqual(
      ["a"],
    );
  });

  it("is empty until a channel Cuso can publish to is connected", () => {
    expect(cmoUpNext(plan, today, [])).toEqual([]);
  });
});

describe("cmoOnboardingStep", () => {
  const start = {
    brandBrainConfirmed: false,
    strategyApproved: false,
    connected: false,
    subscribed: false,
    hasTesterCredits: false,
  };

  it("resumes on the Brand Brain until a member confirms it", () => {
    expect(cmoOnboardingStep(start)).toBe("brandBrain");
  });

  it("resumes on the strategy until a version is approved", () => {
    expect(cmoOnboardingStep({ ...start, brandBrainConfirmed: true })).toBe(
      "strategy",
    );
  });

  const approved = {
    ...start,
    brandBrainConfirmed: true,
    strategyApproved: true,
  };

  it("resumes on the checkout until he has a CMO subscription, then on the accounts", () => {
    expect(cmoOnboardingStep(approved)).toBe("checkout");
    // A connection made before paying (the old order) still owes the checkout.
    expect(cmoOnboardingStep({ ...approved, connected: true })).toBe(
      "checkout",
    );
    expect(cmoOnboardingStep({ ...approved, subscribed: true })).toBe(
      "accounts",
    );
  });

  it("is done once he is paid for and an account is connected", () => {
    expect(
      cmoOnboardingStep({ ...approved, connected: true, subscribed: true }),
    ).toBe("done");
  });

  it("skips the checkout for a Cuso with Tester credits", () => {
    expect(cmoOnboardingStep({ ...approved, hasTesterCredits: true })).toBe(
      "accounts",
    );
    expect(
      cmoOnboardingStep({
        ...approved,
        connected: true,
        hasTesterCredits: true,
      }),
    ).toBe("done");
  });
});

describe("withoutSkippedPieces", () => {
  it("leaves out pieces a patch skipped, for every screen that shows the plan", () => {
    const [kept, dropped] = strategy.calendar;
    if (!kept || !dropped) throw new Error("The fixture needs two entries");
    const plan = {
      ...strategy,
      calendar: [kept, { ...dropped, status: "skipped" as const }],
    };
    expect(withoutSkippedPieces(plan)?.calendar).toEqual([kept]);
    expect(withoutSkippedPieces(strategy)).toBe(strategy);
    expect(withoutSkippedPieces(null)).toBeNull();
  });
});
