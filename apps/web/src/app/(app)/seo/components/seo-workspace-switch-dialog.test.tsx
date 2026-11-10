import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updatePreferredOrganization } from "@/lib/actions/organization/action";
import { authClient } from "@/lib/auth/auth.client";
import messages from "../../../../../messages/en.json";
import { SeoWorkspaceSwitchDialog } from "./seo-workspace-switch-dialog";

const router = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/seo",
  useRouter: () => router,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { organization: { setActive: vi.fn() } },
}));
vi.mock("@/lib/actions/organization/action", () => ({
  updatePreferredOrganization: vi.fn(),
}));

const TARGET = "org_globex";
function show() {
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <SeoWorkspaceSwitchDialog
        auditName="Battery audit"
        currentAccountName="Acme"
        currentOrganization={null}
        sessionUser={{
          createdAt: "2025-01-01T00:00:00.000Z",
          email: "owner@example.com",
          emailVerified: true,
          id: "owner",
          image: null,
          marketingOptIn: false,
          name: "Owner",
          termsAccepted: true,
          updatedAt: "2025-01-01T00:00:00.000Z",
        }}
        targetAccountName="Globex"
        targetOrganization={null}
        targetOrganizationId={TARGET}
        successMessage="Switched to Globex account"
      />
    </NextIntlClientProvider>,
  );
}
function historyLength(value: number) {
  Object.defineProperty(window.history, "length", {
    configurable: true,
    value,
  });
}

describe("SEO workspace switch prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authClient.organization.setActive).mockResolvedValue({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValue({
      ok: true,
      value: { organizationId: TARGET },
    });
  });

  it("switches workspace and keeps the address of the Audit link", async () => {
    show();
    expect(authClient.organization.setActive).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Switch workspace" }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(authClient.organization.setActive).toHaveBeenCalledWith({
      organizationId: TARGET,
    });
    // A switch on the SEO page opens the audit list. Here the Audit is the reason for the switch.
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("opens the audit list on Stay here when there is no earlier page", async () => {
    historyLength(1);
    show();
    await userEvent.click(screen.getByRole("button", { name: "Stay here" }));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/seo");
    expect(router.back).not.toHaveBeenCalled();
    expect(authClient.organization.setActive).not.toHaveBeenCalled();
  });
});
