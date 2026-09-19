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

/** Every value the marketing row was handed, in the order it was handed them. */
const painted: { enabled: boolean; saving: boolean }[] = [];

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
 * Stood in for, so the assertions read the props rather than a cell of a grid.
 * What the grid does with them has its own tests; this file is about the write
 * behind them, and the marketing switch is a row of that grid now.
 */
vi.mock("./notification-kinds", () => ({
  NotificationKinds: ({ news }: { news: Choice }) => {
    painted.push({ enabled: news.enabled, saving: news.saving });

    return (
      <button
        type="button"
        aria-pressed={news.enabled}
        aria-disabled={news.saving || undefined}
        onClick={() => {
          news.onChange(!news.enabled);
        }}
      >
        news
      </button>
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
  return render(<NotificationPreferences marketingOptIn={false} />);
}

function newsCell() {
  return screen.getByRole("button", { name: "news" });
}

describe("NotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    painted.length = 0;
    toasted.length = 0;
    updateUser.mockResolvedValue({ data: {}, error: null });
  });

  /**
   * The route holds this card and nothing else, so the card's title is the
   * page's heading. `CardTitle` is a div, and heading navigation is how a
   * settings page is read: without a level on it the page has no landmark to
   * arrive at.
   */
  it("titles the page with a heading", () => {
    renderPreferences();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "title",
    );
  });

  /**
   * The marketing switch is a row of the grid rather than a control under it,
   * so the card hands it down and reads the press back. The field it writes is
   * named here: a row wired to another one would still look right on screen.
   */
  it("shows the picked value before the write lands", async () => {
    const user = userEvent.setup();
    updateUser.mockReturnValue(new Promise(() => {}));
    renderPreferences();

    await user.click(newsCell());

    expect(updateUser).toHaveBeenCalledWith({ marketingOptIn: true });
    expect(painted.at(-1)).toEqual({ enabled: true, saving: true });
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

    await user.click(newsCell());

    await waitFor(() => {
      expect(painted.at(-1)).toEqual({ enabled: false, saving: false });
    });
    // The state the write failed to store is never on screen unbusy.
    expect(painted).not.toContainEqual({ enabled: true, saving: false });
  });

  it("keeps the picked value when the write lands", async () => {
    const user = userEvent.setup();
    renderPreferences();

    await user.click(newsCell());

    await waitFor(() => {
      expect(painted.at(-1)).toEqual({ enabled: true, saving: false });
    });
  });

  /**
   * One handler, two wordings, and the value decides which one the reader
   * reads. A toast that named the other direction would report a change the
   * reader can see did not happen.
   */
  it("names the direction the write actually moved", async () => {
    const user = userEvent.setup();
    renderPreferences();

    await user.click(newsCell());

    await waitFor(() => {
      expect(toasted).toEqual(["marketingEmailsEnabledSuccess"]);
    });

    await user.click(newsCell());

    await waitFor(() => {
      expect(toasted).toEqual([
        "marketingEmailsEnabledSuccess",
        "marketingEmailsDisabledSuccess",
      ]);
    });
  });

  it("says one thing about a write that failed", async () => {
    const user = userEvent.setup();
    updateUser.mockResolvedValue({ data: null, error: { message: "nope" } });
    renderPreferences();

    await user.click(newsCell());

    await waitFor(() => {
      expect(toasted).toEqual(["error"]);
    });
  });

  /**
   * The flag is set before the write starts, so a client that throws on the
   * way out rather than rejecting would leave it set for the life of the page:
   * the control dimmed, every press refused, nothing to do but reload.
   */
  it("frees the control when the write throws instead of rejecting", async () => {
    const user = userEvent.setup();
    updateUser.mockImplementation(() => {
      throw new Error("boom");
    });
    renderPreferences();

    await user.click(newsCell());

    await waitFor(() => {
      expect(painted.at(-1)).toEqual({ enabled: false, saving: false });
    });
  });

  /**
   * The handler refuses a second write while one is in flight, and the row
   * reports itself busy so the refusal is visible. A row that looked free
   * while its press did nothing would read as broken.
   */
  it("refuses a second press while a write is in flight", async () => {
    const user = userEvent.setup();
    updateUser.mockReturnValue(new Promise(() => {}));
    renderPreferences();

    await user.click(newsCell());

    await waitFor(() => {
      expect(painted.at(-1)).toEqual({ enabled: true, saving: true });
    });

    await user.click(newsCell());

    expect(updateUser).toHaveBeenCalledTimes(1);
  });
});
