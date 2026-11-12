import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LEGAL_URLS } from "@/lib/constants/legal-urls";

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

  it("opens the canonical policies without leaving onboarding", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    render(await FlowsLayout({ children: <p>gate content</p> }));

    for (const [name, href] of [
      ["privacyPolicy", LEGAL_URLS.PRIVACY_POLICY],
      ["termsOfServices", LEGAL_URLS.TERMS_OF_SERVICE],
    ]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
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

  it("lets the content column shrink to a phone screen", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    render(await FlowsLayout({ children: <p>gate content</p> }));

    // A row flex item keeps its min-content width unless min-w-0 says otherwise.
    const column =
      screen.getByText("gate content").parentElement?.parentElement;
    expect(column).toHaveClass("min-w-0", "flex-1");
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
