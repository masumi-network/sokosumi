import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";

import UserCredits from "@/app/components/user-credits";
import type { Session } from "@/lib/auth/auth";

const getMyCreditsMock = jest.fn();
const getMyOrganizationsMock = jest.fn();

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

jest.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getMyCredits: () => getMyCreditsMock(),
    getMyOrganizations: () => getMyOrganizationsMock(),
  },
}));

jest.mock("../buy-credits-button", () => ({
  __esModule: true,
  default: ({ label, path }: { label?: string; path?: string }) => (
    <div data-testid="buy-credits-button" data-label={label} data-path={path} />
  ),
}));

jest.mock("../user-avatar", () => ({
  __esModule: true,
  default: () => <div data-testid="user-avatar" />,
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
  beforeEach(() => {
    getMyOrganizationsMock.mockResolvedValue({ data: [] });
  });

  it("routes free-plan header CTA to the subscription billing tab", async () => {
    getMyCreditsMock.mockResolvedValue(createCreditsResponse("free", 500));

    const view = await UserCredits({
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
    getMyCreditsMock.mockResolvedValue(createCreditsResponse("starter", 500));

    const view = await UserCredits({
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
    getMyCreditsMock.mockResolvedValue(createCreditsResponse("pro", 500));

    const view = await UserCredits({
      session,
      showAvatar: false,
    });

    render(view);

    expect(screen.getByTestId("buy-credits-button")).toHaveAttribute(
      "data-path",
      "/billing?tab=credits",
    );
  });

  it("shows the CTA when the plan is unavailable", async () => {
    getMyCreditsMock.mockResolvedValue(createCreditsResponse(null, 500));

    const view = await UserCredits({
      session,
      showAvatar: false,
    });

    render(view);

    expect(screen.getByTestId("buy-credits-button")).toHaveAttribute(
      "data-path",
      "/billing?tab=subscription",
    );
  });
});
