import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { AdDataConsentForm } from "./ad-data-consent-form";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/actions/ad-data-consent/action", () => ({
  saveAdDataConsent: mocks.save,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

function renderForm(
  canEdit = true,
  shareForImprovement = false,
  allowTraining = false,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AdDataConsentForm
        workspaceId="workspace-1"
        canEdit={canEdit}
        shareForImprovement={shareForImprovement}
        allowTraining={allowTraining}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue({ ok: true, value: {} });
});

describe("AdDataConsentForm", () => {
  it("shows members the saved preferences without editing access", () => {
    renderForm(false, true, true);
    const switches = screen.getAllByRole("switch");
    for (const control of switches) {
      expect(control).toBeDisabled();
      expect(control).toBeChecked();
    }
    expect(
      screen.queryByRole("button", { name: "Save preferences" }),
    ).toBeNull();
    expect(
      screen.getByText("Only workspace admins can change these preferences."),
    ).toBeInTheDocument();
  });

  it("requires sharing before allowing training and saves both choices", async () => {
    const user = userEvent.setup();
    renderForm();
    const share = screen.getByRole("switch", { name: "Help improve Sokosumi" });
    const training = screen.getByRole("switch", { name: "Allow training use" });
    expect(training).toBeDisabled();
    await user.click(share);
    expect(training).toBeEnabled();
    await user.click(training);
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        shareForImprovement: true,
        allowTraining: true,
      }),
    );
    expect(mocks.success).toHaveBeenCalledWith("Ad data preferences saved");
  });

  it("revokes training when sharing is turned off", async () => {
    const user = userEvent.setup();
    renderForm(true, true, true);
    await user.click(
      screen.getByRole("switch", { name: "Help improve Sokosumi" }),
    );
    expect(
      screen.getByRole("switch", { name: "Allow training use" }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        shareForImprovement: false,
        allowTraining: false,
      }),
    );
  });

  it("keeps an unsuccessful change available for retry", async () => {
    mocks.save.mockResolvedValueOnce({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    const user = userEvent.setup();
    renderForm();
    await user.click(
      screen.getByRole("switch", { name: "Help improve Sokosumi" }),
    );
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "Failed to save preferences. Try again.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Save preferences" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("switch", { name: "Help improve Sokosumi" }),
    ).toBeChecked();
  });
});
