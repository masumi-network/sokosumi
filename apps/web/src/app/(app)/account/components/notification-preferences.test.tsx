import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationPreferences } from "./notification-preferences";

const updateUser = vi.fn();

interface Choice {
  enabled: boolean;
  saving: boolean;
  onChange: (next: boolean) => void;
}

/** Every value each account row was handed, in the order it was handed them. */
const painted: Record<
  "email" | "news",
  { enabled: boolean; saving: boolean }[]
> = {
  email: [],
  news: [],
};

/** What the toast rendered, once the write it followed had settled. */
const toasted: string[] = [];

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    updateUser: (body: unknown) => updateUser(body),
  },
}));

/**
 * Stood in for, so the assertions read the props rather than two cells of a
 * grid. What the grid does with them has its own tests; this file is about the
 * writes behind them, and both account switches are rows of that grid now.
 */
vi.mock("./notification-kinds", () => ({
  NotificationKinds: ({ email, news }: { email: Choice; news: Choice }) => {
    painted.email.push({ enabled: email.enabled, saving: email.saving });
    painted.news.push({ enabled: news.enabled, saving: news.saving });

    return (
      <>
        {(["email", "news"] as const).map((name) => {
          const choice = name === "email" ? email : news;

          return (
            <button
              key={name}
              type="button"
              aria-pressed={choice.enabled}
              aria-disabled={choice.saving || undefined}
              onClick={() => {
                choice.onChange(!choice.enabled);
              }}
            >
              {name}
            </button>
          );
        })}
      </>
    );
  },
}));

vi.mock("sonner", () => ({
  toast: {
    // The real one subscribes to the promise, so a rejection is handled and
    // the chain behind it runs to the end. It also calls the renderer for the
    // side the promise took, which is where the wording lives: a card that
    // named the wrong setting would look right everywhere else.
    promise: (
      promise: Promise<unknown>,
      options: { success: () => string; error: () => string },
    ) => {
      promise
        .then(() => {
          toasted.push(options.success());
        })
        .catch(() => {
          toasted.push(options.error());
        });
    },
  },
}));

function renderPreferences() {
  return render(
    <NotificationPreferences notificationsOptIn marketingOptIn={false} />,
  );
}

function cell(name: "email" | "news") {
  return screen.getByRole("button", { name });
}

describe("NotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    painted.email.length = 0;
    painted.news.length = 0;
    toasted.length = 0;
    updateUser.mockResolvedValue({ data: {}, error: null });
  });

  it("shows the picked value before the write lands", async () => {
    const user = userEvent.setup();
    updateUser.mockReturnValue(new Promise(() => {}));
    renderPreferences();

    await user.click(cell("email"));

    expect(updateUser).toHaveBeenCalledWith({ notificationsOptIn: false });
    expect(painted.email.at(-1)).toEqual({ enabled: false, saving: true });
  });

  /**
   * The marketing switch is a row of the grid rather than a control under it,
   * so the card has to hand it down the same way. Written apart from the email
   * row, because the two write different fields and a row wired to the wrong
   * one would still look right on screen.
   */
  it("writes the marketing field from its own row", async () => {
    const user = userEvent.setup();
    updateUser.mockReturnValue(new Promise(() => {}));
    renderPreferences();

    await user.click(cell("news"));

    expect(updateUser).toHaveBeenCalledWith({ marketingOptIn: true });
    expect(painted.news.at(-1)).toEqual({ enabled: true, saving: true });
  });

  /**
   * The row reads the value the moment the write stops being busy, and speaks
   * it. So a failed write puts the value back on the promise chain rather than
   * inside the toast renderer, which runs only if the toast renders at all.
   *
   * What this pins is the pair a row can ever read: the state the write failed
   * to store is never on screen with the busy flag clear. It does not pin the
   * order of the two updates, and cannot: React coalesces them into one
   * render, so putting the value back after the flag clears looks identical
   * from here. The source orders them anyway, for the day it does not.
   */
  it("puts the value back when the write fails", async () => {
    const user = userEvent.setup();
    updateUser.mockResolvedValue({
      data: null,
      error: { message: "nope" },
    });
    renderPreferences();

    await user.click(cell("email"));

    await waitFor(() => {
      expect(painted.email.at(-1)).toEqual({ enabled: true, saving: false });
    });
    // The state the write failed to store is never on screen unbusy.
    expect(painted.email).not.toContainEqual({ enabled: false, saving: false });
  });

  it("keeps the picked value when the write lands", async () => {
    const user = userEvent.setup();
    renderPreferences();

    await user.click(cell("email"));

    await waitFor(() => {
      expect(painted.email.at(-1)).toEqual({ enabled: false, saving: false });
    });
  });

  /**
   * Both rows write through one handler, so the wording is the only thing that
   * says which setting moved. Named for the wrong one, the toast would report
   * a change to a setting the reader can see is untouched.
   */
  it("names the setting the write actually moved", async () => {
    const user = userEvent.setup();
    renderPreferences();

    await user.click(cell("email"));

    await waitFor(() => {
      expect(toasted).toEqual(["jobStatusEmailsDisabledSuccess"]);
    });

    await user.click(cell("news"));

    await waitFor(() => {
      expect(toasted).toEqual([
        "jobStatusEmailsDisabledSuccess",
        "marketingEmailsEnabledSuccess",
      ]);
    });
  });

  it("says one thing about a write that failed", async () => {
    const user = userEvent.setup();
    updateUser.mockResolvedValue({ data: null, error: { message: "nope" } });
    renderPreferences();

    await user.click(cell("news"));

    await waitFor(() => {
      expect(toasted).toEqual(["error"]);
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

    await user.click(cell("email"));

    await waitFor(() => {
      expect(painted.email.at(-1)).toEqual({ enabled: true, saving: false });
    });
  });

  /**
   * The handler refuses a second write while one is in flight, so both rows
   * report busy and neither writes. They share one flag because they share one
   * handler, and a row that looked free while its press did nothing would read
   * as broken.
   */
  it("reports the other row busy while a write is in flight", async () => {
    const user = userEvent.setup();
    updateUser.mockReturnValue(new Promise(() => {}));
    renderPreferences();

    await user.click(cell("email"));

    await waitFor(() => {
      expect(painted.news.at(-1)).toEqual({ enabled: false, saving: true });
    });

    await user.click(cell("news"));

    expect(updateUser).toHaveBeenCalledTimes(1);
  });
});
