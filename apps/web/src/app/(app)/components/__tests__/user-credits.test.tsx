import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import UserCredits from "@/app/components/user-credits";
import type { Session } from "@/lib/auth/auth";

vi.mock("next-intl/server", () => ({
  getTranslations: (namespace: string) =>
    Promise.resolve((key: string, values?: Record<string, string | number>) => {
      if (namespace === "App.Header.Credit") {
        if (key === "unavailable") return "Credits unavailable";
        if (key === "extraCredits")
          return `${values?.credits ?? "0"} available`;
      }

      if (namespace === "App.Header.Plan") {
        if (key === "getMoreCredits") return "Get more credits";
        if (key === "unavailable") return "Plan unavailable";
        if (key === "userPlan")
          return `${values?.plan ?? "Unknown"} (Personal)`;
        if (key === "organizationPlan") {
          return `${values?.plan ?? "Unknown"} (${values?.organization ?? "Unknown"})`;
        }
      }

      if (namespace === "App.Subscriptions") {
        if (key === "Plans.free.name") return "Free";
        if (key === "Plans.starter.name") return "Starter";
        if (key === "Plans.pro.name") return "Pro";
      }

      return key;
    }),
}));

vi.mock("../credit-cta", () => ({
  __esModule: true,
  default: ({ currentPlan }: { currentPlan: string | null }) => {
    const path =
      currentPlan === null || currentPlan === "free"
        ? "/billing?tab=subscription"
        : "/billing?tab=credits";
    return (
      <div
        data-testid="credit-cta"
        data-label="Get more credits"
        data-path={path}
      />
    );
  },
}));

const creditUsageMock = vi.fn((_: unknown) => (
  <div data-testid="credit-usage" />
));

vi.mock("../credit-usage", () => ({
  __esModule: true,
  default: (props: unknown) => creditUsageMock(props),
}));

vi.mock("../user-avatar", () => ({
  __esModule: true,
  default: ({ secondaryLabel }: { secondaryLabel?: string }) => (
    <div data-testid="user-avatar" data-secondary-label={secondaryLabel} />
  ),
}));

const session = {
  session: {
    activeOrganizationId: null,
  },
  user: {
    email: "user@example.com",
    name: "User",
  },
} as unknown as Session;

function createCreditsResponse(plan: string | null, buffer: number) {
  return {
    data: {
      credits: {
        buffer,
        total: buffer,
        subscription:
          plan === null
            ? null
            : {
                plan,
                status: "active",
                periodEnd: null,
                credits: null,
              },
      },
    },
  };
}

describe("UserCredits", () => {
  beforeEach(() => {
    creditUsageMock.mockClear();
  });

  it("routes free-plan header CTA to the subscription billing tab", async () => {
    const view = await UserCredits({
      creditsData: createCreditsResponse("free", 500).data.credits,
      currentTimestampMs: 0,
      organizationName: null,
      session,
      showAvatar: false,
      lowCreditsThreshold: 100,
    });

    render(view);

    expect(screen.getByTestId("credit-cta")).toHaveAttribute(
      "data-label",
      "Get more credits",
    );
    expect(screen.getByTestId("credit-cta")).toHaveAttribute(
      "data-path",
      "/billing?tab=subscription",
    );
  });

  it("routes paid-plan header CTA to the credits billing tab", async () => {
    const view = await UserCredits({
      creditsData: createCreditsResponse("starter", 500).data.credits,
      currentTimestampMs: 0,
      organizationName: null,
      session,
      showAvatar: false,
      lowCreditsThreshold: 100,
    });

    render(view);

    expect(screen.getByTestId("credit-cta")).toHaveAttribute(
      "data-label",
      "Get more credits",
    );
    expect(screen.getByTestId("credit-cta")).toHaveAttribute(
      "data-path",
      "/billing?tab=credits",
    );
  });

  it("shows the CTA for pro plans", async () => {
    const view = await UserCredits({
      creditsData: createCreditsResponse("pro", 500).data.credits,
      currentTimestampMs: 0,
      organizationName: null,
      session,
      showAvatar: false,
      lowCreditsThreshold: 100,
    });

    render(view);

    expect(screen.getByTestId("credit-cta")).toHaveAttribute(
      "data-path",
      "/billing?tab=credits",
    );
  });

  it("falls back to subscription billing when subscription data is missing", async () => {
    const view = await UserCredits({
      creditsData: createCreditsResponse(null, 500).data.credits,
      currentTimestampMs: 0,
      organizationName: null,
      session,
      showAvatar: false,
      lowCreditsThreshold: 100,
    });

    render(view);

    expect(screen.getByTestId("credit-cta")).toHaveAttribute(
      "data-path",
      "/billing?tab=subscription",
    );
  });

  it("uses the provided active organization name in the plan label", async () => {
    const organizationSession = {
      ...session,
      session: {
        activeOrganizationId: "org_123",
      },
    } as Session;

    const view = await UserCredits({
      creditsData: createCreditsResponse("starter", 500).data.credits,
      currentTimestampMs: 0,
      organizationName: "Acme",
      session: organizationSession,
      showAvatar: true,
      showCtaButtons: false,
      showCreditUsage: false,
      lowCreditsThreshold: 100,
    });

    render(view);

    expect(screen.queryByTestId("credit-cta")).not.toBeInTheDocument();
    expect(screen.getByTestId("user-avatar")).toHaveAttribute(
      "data-secondary-label",
      "Starter (Acme)",
    );
  });

  it("passes the buffer balance through as extra credits", async () => {
    const view = await UserCredits({
      creditsData: createCreditsResponse("starter", 500).data.credits,
      currentTimestampMs: 0,
      organizationName: null,
      session,
      showAvatar: false,
      lowCreditsThreshold: 100,
    });

    render(view);

    expect(creditUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extraCredits: 500,
      }),
    );
  });
});
