import type { SessionUser } from "@sokosumi/utils";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    [key, ...Object.values(values ?? {})].join(" "),
}));

const pushMock = vi.fn();
const showLogoutModalMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/modals/global-modals-context", () => ({
  useGlobalModalsContext: () => ({ showLogoutModal: showLogoutModalMock }),
}));

import { HeaderAccountControl } from "@/app/components/header/header-account-control.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";

const sessionUser: SessionUser = {
  id: "user_1",
  name: "Patrick Tobler",
  email: "patrick@example.com",
  emailVerified: true,
  image: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  termsAccepted: true,
  marketingOptIn: false,
  onboardingCompleted: true,
};

const members: MemberWithOrganization[] = [];

function renderControl(
  overrides: Partial<React.ComponentProps<typeof HeaderAccountControl>> = {},
) {
  return render(
    <HeaderAccountControl
      sessionUser={sessionUser}
      planName="Pro"
      totalCredits={15_750}
      extraCredits={750}
      creditUsage={null}
      subscriptionPeriodEndMs={null}
      currentTimestampMs={1_700_000_000_000}
      lowCreditsThreshold={100}
      buyCreditsLabel="getMoreCredits"
      buyCreditsPath="/billing?tab=credits"
      mobileAdminSettings={{
        adminMenuEnabled: true,
        members,
        activeOrganizationId: null,
        showDeveloperVendors: false,
      }}
      {...overrides}
    />,
  );
}

function openControl() {
  fireEvent.click(screen.getByRole("button", { name: /openSummary/ }));
}

describe("HeaderAccountControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Admin and Settings before Logout when admin is enabled", () => {
    renderControl();
    openControl();

    const admin = screen.getByRole("button", { name: "admin" });
    const settings = screen.getByRole("button", { name: "settings" });
    const logout = screen.getByRole("button", { name: "logout" });

    expect(
      admin.compareDocumentPosition(settings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      settings.compareDocumentPosition(logout) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides Admin when adminMenuEnabled is false", () => {
    renderControl({
      mobileAdminSettings: {
        adminMenuEnabled: false,
        members,
        activeOrganizationId: null,
        showDeveloperVendors: false,
      },
    });
    openControl();

    expect(screen.queryByRole("button", { name: "admin" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "settings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "logout" })).toBeInTheDocument();
  });

  it("opens settings drill and navigates to an account destination", () => {
    renderControl();
    openControl();

    fireEvent.click(screen.getByRole("button", { name: "settings" }));

    expect(screen.getByRole("button", { name: "account" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "developer" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "help" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "legal" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "account" }));

    expect(pushMock).toHaveBeenCalledWith("/account");
  });

  it("moves keyboard focus into the settings drill when Settings is activated", async () => {
    renderControl();
    openControl();

    const settings = screen.getByRole("button", { name: "settings" });
    settings.focus();
    expect(settings).toHaveFocus();

    fireEvent.click(settings);
    await flushAnimationFrame();

    const back = screen.getByRole("button", { name: "back" });
    const active = document.activeElement;
    expect(active).not.toBeNull();
    expect(active).not.toBe(settings);
    expect(active?.contains(back)).toBe(true);
  });

  it("moves keyboard focus into nested drill panels", async () => {
    renderControl();
    openControl();

    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    await flushAnimationFrame();

    fireEvent.click(screen.getByRole("button", { name: "developer" }));
    await flushAnimationFrame();

    const back = screen.getByRole("button", { name: "back" });
    const active = document.activeElement;
    expect(active).not.toBeNull();
    expect(active?.contains(back)).toBe(true);
    expect(screen.getByRole("button", { name: "apiKeys" })).toBeInTheDocument();
  });

  it("navigates to Admin from the root panel", () => {
    renderControl();
    openControl();

    fireEvent.click(screen.getByRole("button", { name: "admin" }));

    expect(pushMock).toHaveBeenCalledWith("/admin");
  });

  it("drills into developer destinations", () => {
    renderControl();
    openControl();

    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    fireEvent.click(screen.getByRole("button", { name: "developer" }));
    fireEvent.click(screen.getByRole("button", { name: "apiKeys" }));

    expect(pushMock).toHaveBeenCalledWith("/developer/api-keys");
  });
});
