import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NotFound from "./not-found";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/components/impersonation/impersonation-banner", () => ({
  ImpersonationBanner: ({
    name,
    email,
    impersonatedBy,
  }: {
    name: string;
    email: string;
    impersonatedBy: string | null;
  }) => (
    <div
      data-testid="impersonation-banner"
      data-name={name}
      data-email={email}
      data-impersonated-by={impersonatedBy ?? ""}
    />
  ),
}));

const readRouteSessionMock = vi.fn();

vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: (...args: unknown[]) => readRouteSessionMock(...args),
}));

describe("NotFound impersonation banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts the banner while impersonating", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: {
        user: {
          id: "user_target",
          name: "Ada Lovelace",
          email: "ada@example.com",
        },
        session: {
          id: "sess_impersonated",
          userId: "user_target",
          impersonatedBy: "user_admin",
        },
      },
    });

    render(await NotFound());

    const banner = screen.getByTestId("impersonation-banner");
    expect(banner).toHaveAttribute("data-name", "Ada Lovelace");
    expect(banner).toHaveAttribute("data-email", "ada@example.com");
    expect(banner).toHaveAttribute("data-impersonated-by", "user_admin");
    expect(screen.getByText("title")).toBeInTheDocument();
  });

  it("mounts no banner when signed out", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    render(await NotFound());

    expect(
      screen.queryByTestId("impersonation-banner"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("title")).toBeInTheDocument();
  });
});
