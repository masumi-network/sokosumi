import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatDisplayPreferences } from "./chat-display-preferences";

const updateUser = vi.fn();

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

vi.mock("sonner", () => ({
  toast: {
    // The real one subscribes to the promise, so a rejection is handled and the
    // chain behind it runs to the end. It also calls the renderer for the side
    // the promise took, which is where the wording lives.
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

function switchControl() {
  return screen.getByRole("switch", { name: "roomUnreadCountTitle" });
}

describe("ChatDisplayPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toasted.length = 0;
    updateUser.mockResolvedValue({ data: {}, error: null });
  });

  it("starts from the reader's stored answer", () => {
    render(<ChatDisplayPreferences showRoomUnreadCount />);

    expect(switchControl()).toBeChecked();
  });

  it("is off for a reader who never chose", () => {
    render(<ChatDisplayPreferences showRoomUnreadCount={false} />);

    expect(switchControl()).not.toBeChecked();
  });

  it("writes the one field it owns and nothing else", async () => {
    render(<ChatDisplayPreferences showRoomUnreadCount={false} />);

    await userEvent.click(switchControl());

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith({ showRoomUnreadCount: true });
    });
    expect(switchControl()).toBeChecked();
    await waitFor(() => {
      expect(toasted).toEqual(["roomUnreadCountEnabledSuccess"]);
    });
  });

  it("turns the count back off", async () => {
    render(<ChatDisplayPreferences showRoomUnreadCount />);

    await userEvent.click(switchControl());

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith({ showRoomUnreadCount: false });
    });
    await waitFor(() => {
      expect(toasted).toEqual(["roomUnreadCountDisabledSuccess"]);
    });
  });

  // A reader must never be shown a setting the server did not store.
  it("puts the switch back and says so when the write is refused", async () => {
    updateUser.mockResolvedValue({
      data: null,
      error: { message: "nope" },
    });
    render(<ChatDisplayPreferences showRoomUnreadCount={false} />);

    await userEvent.click(switchControl());

    await waitFor(() => {
      expect(switchControl()).not.toBeChecked();
    });
    await waitFor(() => {
      expect(toasted).toEqual(["error"]);
    });
  });

  it("puts the switch back when the write never reaches the server", async () => {
    updateUser.mockRejectedValue(new Error("offline"));
    render(<ChatDisplayPreferences showRoomUnreadCount />);

    await userEvent.click(switchControl());

    await waitFor(() => {
      expect(switchControl()).toBeChecked();
    });
    await waitFor(() => {
      expect(toasted).toEqual(["error"]);
    });
  });

  it("refuses a second press while the first write is in flight", async () => {
    let settle: (value: { data: unknown; error: null }) => void = () => {};
    updateUser.mockReturnValue(
      new Promise<{ data: unknown; error: null }>((resolve) => {
        settle = resolve;
      }),
    );
    render(<ChatDisplayPreferences showRoomUnreadCount={false} />);

    await userEvent.click(switchControl());
    await userEvent.click(switchControl());

    expect(updateUser).toHaveBeenCalledTimes(1);

    settle({ data: {}, error: null });
    await waitFor(() => {
      expect(toasted).toEqual(["roomUnreadCountEnabledSuccess"]);
    });
  });
});
