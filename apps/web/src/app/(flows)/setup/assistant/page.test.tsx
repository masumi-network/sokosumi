import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readRouteSessionMock = vi.fn();
const redirectMock = vi.fn();
const getWorkspaceAccessMock = vi.fn();
const hasAssignedSeatMock = vi.fn();
const getMineMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  signInRedirectPath: async () => "/signin",
}));

vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: (...args: unknown[]) => readRouteSessionMock(...args),
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getWorkspaceAccess: (...args: unknown[]) => getWorkspaceAccessMock(...args),
  },
}));

vi.mock("@/lib/services/organization-seat.service", () => ({
  organizationSeatService: {
    hasAssignedSeat: (...args: unknown[]) => hasAssignedSeatMock(...args),
  },
}));

vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getMine: (...args: unknown[]) => getMineMock(...args) },
}));

vi.mock("@/i18n/client-message-boundary", () => ({
  ClientMessageBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/app/components/core-unavailable-notice.client", () => ({
  CoreUnavailableNotice: () => <div data-testid="core-unavailable-notice" />,
}));

vi.mock("./components/assistant-create-step.client", () => ({
  AssistantCreateStep: ({
    laterUrl,
    connectUrl,
    paidByOrganization,
  }: {
    laterUrl: string;
    connectUrl: string;
    paidByOrganization: boolean;
  }) => (
    <div data-testid="assistant-first-run">
      {laterUrl}|{connectUrl}|{paidByOrganization ? "org" : "personal"}
    </div>
  ),
}));

function session(activeOrganizationId: string | null = null) {
  return {
    status: "authenticated",
    session: {
      user: { id: "user-1" },
      session: { id: "session-1", activeOrganizationId },
    },
  };
}

function pageProps(searchParams: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(searchParams) };
}

async function renderPage(searchParams: Record<string, string> = {}) {
  const { default: SetupAssistantPage } = await import("./page");
  return SetupAssistantPage(pageProps(searchParams));
}

describe("SetupAssistantPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The real `redirect` throws NEXT_REDIRECT and stops the render.
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    readRouteSessionMock.mockResolvedValue(session());
    getWorkspaceAccessMock.mockResolvedValue({ gate: "ready" });
    hasAssignedSeatMock.mockResolvedValue(true);
    getMineMock.mockResolvedValue(null);
  });

  it("offers the assistant to a ready user without a Soko Bot", async () => {
    render(await renderPage({ next: "/chat/join/abc" }));

    expect(screen.getByTestId("assistant-first-run").textContent).toBe(
      "/chat/join/abc|/setup/assistant/connect?next=%2Fchat%2Fjoin%2Fabc|personal",
    );
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("bills an organization user's assistant to the organization", async () => {
    readRouteSessionMock.mockResolvedValue(session("org-1"));

    render(await renderPage());

    expect(hasAssignedSeatMock).toHaveBeenCalledWith("org-1");
    expect(screen.getByTestId("assistant-first-run").textContent).toBe(
      "/|/setup/assistant/connect|org",
    );
  });

  it("moves on to the connect step once the bot exists", async () => {
    getMineMock.mockResolvedValue({ id: "bot-1" });

    await expect(renderPage({ next: "/tasks" })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/setup/assistant/connect?next=%2Ftasks",
    );
  });

  it.each([
    [
      "the workspace is not ready",
      () =>
        getWorkspaceAccessMock.mockResolvedValue({
          gate: "identity-onboarding",
        }),
    ],
    [
      "the organization seat is missing",
      () => {
        readRouteSessionMock.mockResolvedValue(session("org-1"));
        hasAssignedSeatMock.mockResolvedValue(false);
      },
    ],
    [
      "Soko Bot is off or failing",
      () => getMineMock.mockRejectedValue(new Error("404")),
    ],
  ])("goes straight on when %s", async (_label, arrange) => {
    arrange();

    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("keeps `next` on this origin", async () => {
    getWorkspaceAccessMock.mockResolvedValue({ gate: "identity-onboarding" });

    await expect(renderPage({ next: "https://evil.example" })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("sends a signed-out browser to sign-in", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/signin");
    expect(getMineMock).not.toHaveBeenCalled();
  });
});
