import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FlowsLayout from "./layout";

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "x-pathname" ? "/setup" : null),
  }),
}));

vi.mock("next/server", () => ({
  connection: async () => {},
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, values?: Record<string, string>) => {
      if (key === "banner" && values) {
        return `banner:${values.name}:${values.email}`;
      }
      return key;
    },
}));

vi.mock("@/i18n/client-message-boundary", () => ({
  ClientMessageBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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

const impersonatedSession = {
  user: { id: "user_target", name: "Ada Lovelace", email: "ada@example.com" },
  session: {
    id: "sess_impersonated",
    userId: "user_target",
    impersonatedBy: "user_admin",
  },
};

const plainSession = {
  user: { id: "user_plain", name: "Plain", email: "plain@example.com" },
  session: { id: "sess_plain", userId: "user_plain" },
};

describe("FlowsLayout impersonation banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts the banner with the target identity while impersonating", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: impersonatedSession,
    });

    render(await FlowsLayout({ children: <p>gate content</p> }));

    const banner = screen.getByTestId("impersonation-banner");
    expect(banner).toHaveAttribute("data-name", "Ada Lovelace");
    expect(banner).toHaveAttribute("data-email", "ada@example.com");
    expect(banner).toHaveAttribute("data-impersonated-by", "user_admin");
    expect(screen.getByText("gate content")).toBeInTheDocument();
  });

  it("mounts the banner without a marker for a plain session", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: plainSession,
    });

    render(await FlowsLayout({ children: <p>gate content</p> }));

    // The banner itself renders nothing without the marker (covered by its
    // own tests); the layout always passes the session through.
    expect(screen.getByTestId("impersonation-banner")).toHaveAttribute(
      "data-impersonated-by",
      "",
    );
    expect(screen.getByText("gate content")).toBeInTheDocument();
  });

  it("mounts no banner when signed out", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    render(await FlowsLayout({ children: <p>gate content</p> }));

    expect(
      screen.queryByTestId("impersonation-banner"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("gate content")).toBeInTheDocument();
  });
});
