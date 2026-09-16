import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NotFound, { NotFoundImpersonationBanner } from "./not-found";

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

describe("NotFound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the boundary synchronous (async breaks every route, SOK-1080)", () => {
    expect(NotFound.constructor.name).toBe("Function");
  });

  it("renders the card", () => {
    render(<NotFound />);

    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("message")).toBeInTheDocument();
    expect(screen.getByText("returnHome")).toBeInTheDocument();
  });
});

describe("NotFoundImpersonationBanner", () => {
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

    render(await NotFoundImpersonationBanner());

    const banner = screen.getByTestId("impersonation-banner");
    expect(banner).toHaveAttribute("data-name", "Ada Lovelace");
    expect(banner).toHaveAttribute("data-email", "ada@example.com");
    expect(banner).toHaveAttribute("data-impersonated-by", "user_admin");
  });

  it("mounts no banner when signed out", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    const { container } = render(await NotFoundImpersonationBanner());

    expect(container).toBeEmptyDOMElement();
  });

  it("mounts no banner when the session read is unavailable", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "unavailable",
      reason: "timeout",
    });

    const { container } = render(await NotFoundImpersonationBanner());

    expect(container).toBeEmptyDOMElement();
  });
});
