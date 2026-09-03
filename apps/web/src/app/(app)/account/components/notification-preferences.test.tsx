import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationPreferences } from "./notification-preferences";

const updateUser = vi.fn();

/** Every value the email control was handed, in the order it was handed them. */
const painted: { enabled: boolean; saving: boolean }[] = [];

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    updateUser: (body: unknown) => updateUser(body),
  },
}));

/**
 * Stood in for, so the assertions read the prop rather than a cell. What the
 * grid does with the value has its own tests; this file is about the write.
 */
vi.mock("./notification-kinds", () => ({
  NotificationKinds: ({
    email,
  }: {
    email: {
      enabled: boolean;
      saving: boolean;
      onChange: (next: boolean) => void;
    };
  }) => {
    painted.push({ enabled: email.enabled, saving: email.saving });

    return (
      <button
        type="button"
        aria-pressed={email.enabled}
        onClick={() => {
          email.onChange(!email.enabled);
        }}
      >
        email
      </button>
    );
  },
}));

vi.mock("./push-notification-setting", () => ({
  PushNotificationSetting: () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    // The real one subscribes to the promise, so a rejection is handled and
    // the chain behind it runs to the end.
    promise: (promise: Promise<unknown>) => {
      promise.catch(() => {});
    },
  },
}));

function renderPreferences() {
  return render(
    <NotificationPreferences notificationsOptIn marketingOptIn={false} />,
  );
}

function emailControl() {
  return screen.getByRole("button", { name: "email" });
}

function marketingSwitch() {
  return screen.getByRole("switch", { name: "marketingEmailsAriaLabel" });
}

describe("NotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    painted.length = 0;
    updateUser.mockResolvedValue({ data: {}, error: null });
  });

  it("shows the picked value before the write lands", async () => {
    const user = userEvent.setup();
    updateUser.mockReturnValue(new Promise(() => {}));
    renderPreferences();

    await user.click(emailControl());

    expect(updateUser).toHaveBeenCalledWith({ notificationsOptIn: false });
    expect(painted.at(-1)).toEqual({ enabled: false, saving: true });
  });

  /**
   * The row reads the value the moment the write stops being busy, and speaks
   * it. So a failed write puts the value back on the promise chain rather than
   * inside the toast renderer, which runs only if the toast renders at all.
   * React coalesces the two updates today, so what this pins is the pair a row
   * can ever read: the state the write failed to store is never on screen with
   * the busy flag clear.
   */
  it("puts the value back before it stops being busy", async () => {
    const user = userEvent.setup();
    updateUser.mockResolvedValue({
      data: null,
      error: { message: "nope" },
    });
    renderPreferences();

    await user.click(emailControl());

    await waitFor(() => {
      expect(painted.at(-1)).toEqual({ enabled: true, saving: false });
    });
    // The state the write failed to store is never on screen unbusy.
    expect(painted).not.toContainEqual({ enabled: false, saving: false });
  });

  it("keeps the picked value when the write lands", async () => {
    const user = userEvent.setup();
    renderPreferences();

    await user.click(emailControl());

    await waitFor(() => {
      expect(painted.at(-1)).toEqual({ enabled: false, saving: false });
    });
  });

  /**
   * The flag is set before the write starts, so a client that throws on the
   * way out rather than rejecting would leave it set for the life of the page:
   * every control dimmed, every press refused, nothing to do but reload.
   */
  it("frees the controls when the write throws instead of rejecting", async () => {
    const user = userEvent.setup();
    updateUser.mockImplementation(() => {
      throw new Error("boom");
    });
    renderPreferences();

    await user.click(emailControl());

    await waitFor(() => {
      expect(painted.at(-1)).toEqual({ enabled: true, saving: false });
    });
  });

  /**
   * The handler refuses a second write while one is in flight, so both
   * controls report busy. Marked rather than disabled: a control the browser
   * disables leaves the tab order under the reader's finger, and a screen
   * reader loses the control it was on.
   */
  it("keeps the marketing switch reachable while the other write is in flight", async () => {
    const user = userEvent.setup();
    updateUser.mockReturnValue(new Promise(() => {}));
    renderPreferences();

    await user.click(emailControl());

    await waitFor(() => {
      expect(marketingSwitch()).toHaveAttribute("aria-disabled", "true");
    });
    expect(marketingSwitch()).toBeEnabled();

    await user.click(marketingSwitch());

    expect(updateUser).toHaveBeenCalledTimes(1);
  });
});
