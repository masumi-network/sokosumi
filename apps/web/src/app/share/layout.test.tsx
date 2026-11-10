import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SharePageLayout from "./(page)/layout";
import ShareLayout, { ShareImpersonationBanner } from "./layout";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
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

vi.mock("./(page)/components/header", () => ({
  default: () => <div data-testid="share-header" />,
}));

vi.mock("./(page)/components/share-page-cta", () => ({
  default: () => <div data-testid="share-page-cta" />,
}));

const readRouteSessionMock = vi.fn();

vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: (...args: unknown[]) => readRouteSessionMock(...args),
}));

describe("ShareLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stays synchronous so the public shell keeps prerendering", () => {
    expect(ShareLayout.constructor.name).toBe("Function");
  });

  it("renders children without the share chrome, so data rooms stay clean", () => {
    render(
      <ShareLayout>
        <div data-testid="share-child" />
      </ShareLayout>,
    );

    expect(screen.getByTestId("share-child")).toBeInTheDocument();
    expect(screen.queryByTestId("share-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("share-page-cta")).not.toBeInTheDocument();
  });

  it("gives shared Tasks and files the share chrome", () => {
    render(
      <SharePageLayout>
        <div data-testid="share-child" />
      </SharePageLayout>,
    );

    expect(screen.getByTestId("share-child")).toBeInTheDocument();
    expect(screen.getByTestId("share-header")).toBeInTheDocument();
    expect(screen.getByTestId("share-page-cta")).toBeInTheDocument();
  });
});

describe("ShareImpersonationBanner", () => {
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

    render(await ShareImpersonationBanner());

    const banner = screen.getByTestId("impersonation-banner");
    expect(banner).toHaveAttribute("data-name", "Ada Lovelace");
    expect(banner).toHaveAttribute("data-email", "ada@example.com");
    expect(banner).toHaveAttribute("data-impersonated-by", "user_admin");
  });

  it("mounts no banner when signed out", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    const { container } = render(await ShareImpersonationBanner());

    expect(container).toBeEmptyDOMElement();
  });

  it("mounts no banner when the session read is unavailable", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "unavailable",
      reason: "timeout",
    });

    const { container } = render(await ShareImpersonationBanner());

    expect(container).toBeEmptyDOMElement();
  });
});
