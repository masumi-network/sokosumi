import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";

import UserCredits from "@/app/components/user-credits";
import type { Session } from "@/lib/auth/auth";

jest.mock("next-intl/server", () => ({
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

jest.mock("../buy-credits-button", () => ({
  __esModule: true,
  default: ({ label, path }: { label?: string; path?: string }) => (
    <div data-testid="buy-credits-button" data-label={label} data-path={path} />
  ),
}));

jest.mock("../user-avatar", () => ({
  __esModule: true,
  default: ({
    creditsLabel,
    secondaryLabel,
  }: {
    creditsLabel?: string;
    secondaryLabel?: string;
  }) => (
    <div
      data-testid="user-avatar"
      data-credits-label={creditsLabel}
      data-secondary-label={secondaryLabel}
    />
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
        subscription:
          plan === null
            ? null
            : {
                plan,
                periodEnd: null,
                credits: null,
              },
      },
    },
  };
}

describe("UserCredits", () => {
  it("routes free-plan header CTA to the subscription billing tab", async () => {
    const view = await UserCredits({
      creditsData: createCreditsResponse("free", 500).data.credits,
      currentTimestampMs: 0,
      organizationName: null,
      session,
      showAvatar: false,
    });

    render(view);

    expect(screen.getByTestId("buy-credits-button")).toHaveAttribute(
      "data-label",
      "Get more credits",
    );
    expect(screen.getByTestId("buy-credits-button")).toHaveAttribute(
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
    });

    render(view);

    expect(screen.getByTestId("buy-credits-button")).toHaveAttribute(
      "data-label",
      "Get more credits",
    );
    expect(screen.getByTestId("buy-credits-button")).toHaveAttribute(
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
    });

    render(view);

    expect(screen.getByTestId("buy-credits-button")).toHaveAttribute(
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
    });

    render(view);

    expect(screen.getByTestId("buy-credits-button")).toHaveAttribute(
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
    });

    render(view);

    expect(screen.queryByTestId("buy-credits-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("user-avatar")).toHaveAttribute(
      "data-secondary-label",
      "Starter (Acme)",
    );
  });
});
