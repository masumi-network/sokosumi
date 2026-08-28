import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PushNotificationSetting } from "./push-notification-setting";

const pushPreference = {
  isAccountEnabled: false,
  isDeviceEnabled: false,
  isSupported: true as boolean | null,
  isBlocked: false,
  canToggleAccount: true,
  canToggleDevice: true,
  isSaving: false,
  setAccountEnabled: vi.fn(),
  setDeviceEnabled: vi.fn(),
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { user: { id: "user_1" } } }),
}));

vi.mock("@/lib/ably/use-push-preference", () => ({
  usePushPreference: () => pushPreference,
}));

vi.mock("sonner", () => ({
  toast: { promise: vi.fn() },
}));

function renderWith(overrides: Partial<typeof pushPreference>) {
  Object.assign(pushPreference, {
    isAccountEnabled: false,
    isDeviceEnabled: false,
    isSupported: true,
    isBlocked: false,
    canToggleAccount: true,
    canToggleDevice: true,
    isSaving: false,
    ...overrides,
  });
  render(<PushNotificationSetting />);
}

/** Translations are mocked to the key, so the aria-label is the key. */
const accountSwitch = () =>
  screen.getByRole("switch", { name: "pushAriaLabel" });
const deviceSwitch = () =>
  screen.getByRole("switch", { name: "pushDeviceAriaLabel" });

describe("PushNotificationSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Both browser messages describe this browser, beside a switch that writes
   * the account. Without the hint the row reads as dead, and the reader stops
   * short of silencing the devices that can push.
   */
  it("names the browser block and says the switch still works", () => {
    renderWith({ isBlocked: true });

    expect(
      screen.getByText(
        "browserPermissionDeniedDescription pushOtherDevicesHint",
      ),
    ).toBeInTheDocument();
  });

  it("describes what push does while notifications are allowed", () => {
    renderWith({ isBlocked: false });

    expect(screen.getByText("pushDescription")).toBeInTheDocument();
  });

  it("says the browser cannot push at all before it says it is blocked", () => {
    renderWith({ isSupported: false, isBlocked: true });

    expect(
      screen.getByText("pushUnsupported pushOtherDevicesHint"),
    ).toBeInTheDocument();
  });

  it("keeps the browser message off the screen until the read lands", () => {
    // Null, not false: the answer needs `window`, and an unread answer told
    // every reader on every browser that theirs does not support push.
    renderWith({ isSupported: null });

    expect(screen.getByText("pushDescription")).toBeInTheDocument();
    expect(
      screen.queryByText("pushDeviceUnavailableDescription"),
    ).not.toBeInTheDocument();
  });

  it("says the device row is unavailable when this browser cannot push", () => {
    renderWith({ isSupported: false, canToggleDevice: false });

    expect(
      screen.getByText("pushDeviceUnavailableDescription"),
    ).toBeInTheDocument();
    expect(deviceSwitch()).toBeDisabled();
  });

  it("locks the device row and says why while the account is off", () => {
    renderWith({ isAccountEnabled: false, canToggleDevice: false });

    expect(deviceSwitch()).toBeDisabled();
    expect(
      screen.getByText("pushDeviceInactiveDescription"),
    ).toBeInTheDocument();
  });

  it("describes the device row once the account is on", () => {
    renderWith({ isAccountEnabled: true });

    expect(screen.getByText("pushDeviceDescription")).toBeInTheDocument();
  });

  /**
   * The state one switch could not reach. A browser holding no subscription
   * read as off, so the disable path never opened and account-wide consent
   * could not be withdrawn from it.
   */
  it("withdraws account consent from a browser holding no subscription", async () => {
    renderWith({ isAccountEnabled: true, isDeviceEnabled: false });

    expect(accountSwitch()).toBeEnabled();
    await userEvent.click(accountSwitch());

    expect(pushPreference.setAccountEnabled).toHaveBeenCalledWith(false);
  });

  it("turns off only this browser from the device row", async () => {
    renderWith({ isAccountEnabled: true, isDeviceEnabled: true });

    await userEvent.click(deviceSwitch());

    expect(pushPreference.setDeviceEnabled).toHaveBeenCalledWith(false);
    expect(pushPreference.setAccountEnabled).not.toHaveBeenCalled();
  });

  /**
   * Every failure reads the same on screen, so the reason has to reach the
   * console. A browser that refuses a push subscription and a Core write that
   * failed are one toast apart and worlds apart to debug.
   */
  it("logs why the change failed, since the toast wording hides it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWith({ isAccountEnabled: false });

    await userEvent.click(accountSwitch());

    const options = vi.mocked(toast.promise).mock.calls.at(-1)?.[1] as {
      error: (error: unknown) => string;
    };
    const reason = new Error("The browser created no push subscription");

    expect(options.error(reason)).toBe("pushError");
    expect(logged).toHaveBeenCalledWith(
      "Failed to update push notifications",
      reason,
    );

    logged.mockRestore();
  });
});
