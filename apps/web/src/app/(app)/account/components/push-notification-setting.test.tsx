import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import { PushNotificationSetting } from "./push-notification-setting";

const pushPreference = {
  enabled: false,
  isSupported: true,
  isBlocked: false,
  canToggle: true,
  canSubmit: true,
  enable: vi.fn(),
  disable: vi.fn(),
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
    isSupported: true,
    isBlocked: false,
    ...overrides,
  });
  render(<PushNotificationSetting />);
}

describe("PushNotificationSetting", () => {
  it("names the browser block, so the reader knows why enabling fails", () => {
    renderWith({ isBlocked: true });

    expect(
      screen.getByText("browserPermissionDeniedDescription"),
    ).toBeInTheDocument();
  });

  it("describes what push does while notifications are allowed", () => {
    renderWith({ isBlocked: false });

    expect(screen.getByText("pushDescription")).toBeInTheDocument();
  });

  it("says the browser cannot push at all before it says it is blocked", () => {
    renderWith({ isSupported: false, isBlocked: true });

    expect(screen.getByText("pushUnsupported")).toBeInTheDocument();
  });

  /**
   * Every failure reads the same on screen, so the reason has to reach the
   * console. A browser that refuses a push subscription and a Core write that
   * failed are one toast apart and worlds apart to debug.
   */
  it("logs why enabling failed, since the toast wording hides it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWith({ enabled: false });

    await userEvent.click(screen.getByRole("switch"));

    const options = vi.mocked(toast.promise).mock.calls.at(-1)?.[1] as {
      error: (error: unknown) => string;
    };
    const reason = new Error("The browser created no push subscription");

    expect(options.error(reason)).toBe("pushError");
    expect(logged).toHaveBeenCalledWith(
      "Failed to enable push notifications",
      reason,
    );

    logged.mockRestore();
  });
});
