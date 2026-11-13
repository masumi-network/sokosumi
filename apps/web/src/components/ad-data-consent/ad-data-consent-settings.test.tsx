import { MemberRole } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { AdDataConsentSettings } from "./ad-data-consent-settings";

const mocks = vi.hoisted(() => ({ workspaces: vi.fn(), getConsent: vi.fn() }));
vi.mock("@/lib/services/user.service", () => ({
  userService: { getMyWorkspaces: mocks.workspaces },
}));
vi.mock("@/lib/services/ad-data-consent.service", () => ({
  adDataConsentService: { get: mocks.getConsent },
}));
vi.mock("@/lib/actions/ad-data-consent/action", () => ({
  saveAdDataConsent: vi.fn(),
}));
vi.mock("@/components/auth/core-auth-read-retry", () => ({
  CoreAuthReadRetry: ({
    description,
    retryLabel,
  }: {
    description: string;
    retryLabel: string;
  }) => (
    <div role="alert">
      {description}
      <button type="button">{retryLabel}</button>
    </div>
  ),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace: "App.AdDataConsent",
    }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getConsent.mockResolvedValue({
    shareForImprovement: true,
    allowTraining: false,
  });
});

async function renderSettings(organizationId: string | null) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {await AdDataConsentSettings({ organizationId })}
    </NextIntlClientProvider>,
  );
}

describe("AdDataConsentSettings", () => {
  it("resolves the organization to its workspace id and enables admin editing", async () => {
    mocks.workspaces.mockResolvedValue({
      workspaces: [
        {
          id: "workspace-1",
          organizationId: "org-1",
          kind: "organization",
          role: MemberRole.ADMIN,
        },
      ],
    });
    await renderSettings("org-1");
    expect(mocks.getConsent).toHaveBeenCalledWith("workspace-1");
    expect(
      screen.getByRole("switch", { name: "Help improve Sokosumi" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Save preferences" }),
    ).toBeInTheDocument();
  });

  it("keeps a regular organization member read-only", async () => {
    mocks.workspaces.mockResolvedValue({
      workspaces: [
        {
          id: "workspace-1",
          organizationId: "org-1",
          kind: "organization",
          role: MemberRole.MEMBER,
        },
      ],
    });
    await renderSettings("org-1");
    expect(
      screen.getByRole("switch", { name: "Help improve Sokosumi" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save preferences" }),
    ).toBeNull();
  });

  it("lets the personal workspace owner edit their own consent", async () => {
    mocks.workspaces.mockResolvedValue({
      workspaces: [
        {
          id: "personal-1",
          organizationId: null,
          kind: "personal",
          role: null,
        },
        {
          id: "workspace-1",
          organizationId: "org-1",
          kind: "organization",
          role: MemberRole.MEMBER,
        },
      ],
    });
    await renderSettings(null);
    expect(mocks.getConsent).toHaveBeenCalledWith("personal-1");
    expect(
      screen.getByRole("switch", { name: "Help improve Sokosumi" }),
    ).toBeEnabled();
  });

  it("does not read consent for an organization outside the person's workspaces", async () => {
    mocks.workspaces.mockResolvedValue({ workspaces: [] });
    expect(await AdDataConsentSettings({ organizationId: "org-1" })).toBeNull();
    expect(mocks.getConsent).not.toHaveBeenCalled();
  });

  it("shows a retry state instead of editable defaults when loading fails", async () => {
    mocks.workspaces.mockResolvedValue({
      workspaces: [
        {
          id: "workspace-1",
          organizationId: "org-1",
          kind: "organization",
          role: MemberRole.OWNER,
        },
      ],
    });
    mocks.getConsent.mockRejectedValue(new Error("Core unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderSettings("org-1");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to load ad data preferences. Try again.",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    consoleError.mockRestore();
  });
});
