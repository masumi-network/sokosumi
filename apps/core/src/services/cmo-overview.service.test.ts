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

import { cmoOnboardingStep, cmoUpNext } from "./cmo-overview.service";

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
  };

  it("resumes on the Brand Brain until a member confirms it", () => {
    expect(cmoOnboardingStep(start)).toBe("brandBrain");
  });

  it("resumes on the strategy until a version is approved", () => {
    expect(cmoOnboardingStep({ ...start, brandBrainConfirmed: true })).toBe(
      "strategy",
    );
    // A plan paid for early still waits for an approved version.
    expect(
      cmoOnboardingStep({
        ...start,
        brandBrainConfirmed: true,
        subscribed: true,
      }),
    ).toBe("strategy");
  });

  it("resumes on the accounts until one is connected", () => {
    const approved = {
      ...start,
      brandBrainConfirmed: true,
      strategyApproved: true,
    };
    expect(cmoOnboardingStep(approved)).toBe("accounts");
    expect(cmoOnboardingStep({ ...approved, connected: true })).toBe("plan");
  });

  it("is done once a version is approved and a CMO plan is active", () => {
    expect(
      cmoOnboardingStep({
        ...start,
        brandBrainConfirmed: true,
        strategyApproved: true,
        subscribed: true,
      }),
    ).toBe("done");
  });
});
