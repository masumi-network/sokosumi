import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMyPreferencesQueryKey } from "@/queries/preferences";

import { F1SubjectStops } from "./f1-subject-stops";
import { F3SubjectSwitches } from "./f3-subject-switches";
import { NotificationUxOptions } from "./notification-ux-options";
import { useNotificationChoices } from "./use-notification-choices";

const patchMyPreferences = vi.fn();
const setAccountEnabled = vi.fn();
let isAccountEnabled = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { user: { id: "user_1" } } }),
}));

vi.mock("@/lib/clients/core.preferences.browser.client", () => ({
  preferencesBrowserClient: {
    getMyPreferences: vi.fn(),
    patchMyPreferences: (body: unknown) => patchMyPreferences(body),
  },
}));

vi.mock("@/lib/ably/use-push-preference", () => ({
  usePushPreference: () => ({
    isAccountEnabled,
    isDeviceEnabled: false,
    isSupported: true,
    isBlocked: false,
    canToggleAccount: true,
    canToggleDevice: true,
    isSaving: false,
    setAccountEnabled,
    setDeviceEnabled: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

/**
 * Chat starts with its two stored subjects disagreeing about the banner, so the
 * group is custom from the first paint and the summary has a mixture to report.
 * Requests and access has one subject, which is what the preset de-duplication
 * is checked against.
 */
const MATRIX = [
  { category: "TASK", channel: "IN_APP", enabled: true },
  { category: "TASK", channel: "OS_BANNER", enabled: false },
  { category: "CHAT_MENTION", channel: "IN_APP", enabled: true },
  { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
  { category: "CHAT_DIRECT_MESSAGE", channel: "IN_APP", enabled: true },
  { category: "CHAT_DIRECT_MESSAGE", channel: "OS_BANNER", enabled: true },
  { category: "SYSTEM", channel: "IN_APP", enabled: true },
  { category: "SYSTEM", channel: "OS_BANNER", enabled: true },
];

/** The stored matrix as the fake Core holds it, so a write can be read back. */
let current = MATRIX;

function response(notificationPreferences = current) {
  return {
    data: {
      marketingOptIn: true,
      notificationsOptIn: true,
      pushOptIn: isAccountEnabled,
      notificationPreferences,
    },
  };
}

function renderWith(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(getMyPreferencesQueryKey("user_1"), response());

  render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

/** One layout alone, so its controls are the only ones on screen. */
const Only = {
  F1: () => <F1SubjectStops choices={useNotificationChoices()} />,
  F3: () => <F3SubjectSwitches choices={useNotificationChoices()} />,
};

function lastWrite() {
  const calls = patchMyPreferences.mock.calls;
  return calls[calls.length - 1][0].notificationPreferences;
}

/** The written state of one cell, by name. */
function written(category: string, channel: string) {
  return lastWrite().find(
    (cell: { category: string; channel: string }) =>
      cell.category === category && cell.channel === channel,
  )?.enabled;
}

/** The row that opens a group: the only button whose name leads with it. */
function opener(group: string) {
  return screen.getByRole("button", { name: new RegExp(`^${group}`) });
}

/** One subject's delivery control, named after the subject and nothing else. */
function row(subject: string) {
  return screen.getByRole("group", { name: subject });
}

function stop(subject: string, delivery: string) {
  return within(row(subject)).getByRole("button", { name: delivery });
}

describe("NotificationUxOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAccountEnabled = true;
    current = MATRIX;
    // Echoing the write back matters: a mock that always answers with the
    // original matrix would undo every optimistic paint, and a control that
    // never settles would look identical to one that writes nothing.
    patchMyPreferences.mockImplementation(
      (body: { notificationPreferences: typeof MATRIX }) => {
        current = current.map((cell) => {
          const next = body.notificationPreferences.find(
            (candidate) =>
              candidate.category === cell.category &&
              candidate.channel === cell.channel,
          );

          return next ? { ...cell, enabled: next.enabled } : cell;
        });

        return Promise.resolve(response());
      },
    );
    setAccountEnabled.mockResolvedValue(true);
  });

  it("draws every layout that is up for evaluation", () => {
    renderWith(<NotificationUxOptions />);

    for (let index = 1; index <= 4; index += 1) {
      expect(
        screen.getByText(new RegExp(`^F${index}\\. `)),
      ).toBeInTheDocument();
    }
  });

  it("gives every subject its own row, once", async () => {
    const user = userEvent.setup();
    renderWith(<Only.F1 />);

    await user.click(opener("Chat"));

    for (const subject of [
      "Direct messages",
      "Mentions of you",
      "Threads you follow",
      "Every message in your rooms",
    ]) {
      expect(screen.getAllByRole("group", { name: subject })).toHaveLength(1);
    }
  });

  it("names only the subjects nothing else speaks for", () => {
    renderWith(<Only.F1 />);

    expect(opener("Chat")).toHaveAccessibleName(
      /Direct messages and Mentions of you/,
    );
  });

  it("makes a covered subject report its cover instead of repeating it", async () => {
    const user = userEvent.setup();
    renderWith(<Only.F1 />);

    await user.click(opener("Chat"));
    await user.click(stop("Every message in your rooms", "In app"));

    expect(
      screen.getAllByText("Covered by Every message in your rooms"),
    ).toHaveLength(2);
    // The summary drops what the wider subject already carries, which is the
    // duplication this round exists to remove.
    expect(opener("Chat")).toHaveAccessibleName(
      /Direct messages and Every message in your rooms/,
    );
    expect(opener("Chat")).not.toHaveAccessibleName(/Mentions of you/);
  });

  it("reports the cover's delivery on a subject that is off by itself", async () => {
    const user = userEvent.setup();
    renderWith(<Only.F1 />);

    await user.click(opener("Chat"));
    await user.click(stop("Every message in your rooms", "Banner"));

    // Threads you follow is off on its own and still arrives, because every
    // message in the room carries it. The row has to say what happens, not
    // what was last set on it.
    expect(stop("Threads you follow", "Banner")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(stop("Threads you follow", "Off")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("refuses to make a covered subject quieter than its cover", async () => {
    const user = userEvent.setup();
    renderWith(<Only.F1 />);

    await user.click(opener("Chat"));
    await user.click(stop("Every message in your rooms", "In app"));

    expect(stop("Mentions of you", "Off")).toBeDisabled();
    expect(stop("Mentions of you", "Off")).toHaveAttribute(
      "title",
      "Every message in your rooms already delivers this in Sokosumi only",
    );
    expect(stop("Mentions of you", "Banner")).toBeEnabled();
  });

  it("lets a covered subject stay louder than its cover", async () => {
    const user = userEvent.setup();
    renderWith(<Only.F1 />);

    await user.click(opener("Chat"));
    await user.click(stop("Every message in your rooms", "In app"));
    await user.click(stop("Mentions of you", "Banner"));

    await waitFor(() => {
      expect(written("CHAT_MENTION", "OS_BANNER")).toBe(true);
    });
    expect(
      screen.getByText(
        "Covered by Every message in your rooms, and louder here",
      ),
    ).toBeInTheDocument();
  });

  it("writes only the categories the row owns", async () => {
    const user = userEvent.setup();
    renderWith(<Only.F1 />);

    await user.click(opener("Chat"));
    await user.click(stop("Direct messages", "Off"));

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(2);
    expect(written("CHAT_DIRECT_MESSAGE", "IN_APP")).toBe(false);
    expect(written("CHAT_DIRECT_MESSAGE", "OS_BANNER")).toBe(false);
    expect(written("CHAT_MENTION", "IN_APP")).toBeUndefined();
  });

  it("remembers a subject nothing stores yet without writing it", async () => {
    const user = userEvent.setup();
    renderWith(<Only.F1 />);

    await user.click(opener("Chat"));
    await user.click(stop("Threads you follow", "Banner"));

    expect(patchMyPreferences).not.toHaveBeenCalled();
    expect(stop("Threads you follow", "Banner")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("drops a preset that would write what another one writes", () => {
    renderWith(<Only.F1 />);

    const presets = within(
      screen.getByRole("group", { name: "Requests and access preset" }),
    )
      .getAllByRole("button")
      .map((button) => button.textContent);

    // One subject, and it is important, so "Everything" and "Important" would
    // be the same press. A stop that cannot light is not drawn.
    expect(presets).toEqual(["Everything", "Quiet", "Off"]);
    // Chat can tell all four apart, and starts on none of them because its two
    // stored subjects disagree about the banner.
    expect(
      within(screen.getByRole("group", { name: "Chat preset" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Everything", "Important", "Quiet", "Off", "Custom"]);
  });

  it("writes every stored subject of a group in one request", async () => {
    const user = userEvent.setup();
    renderWith(<Only.F1 />);

    await user.click(
      within(screen.getByRole("group", { name: "Chat preset" })).getByRole(
        "button",
        { name: "Everything" },
      ),
    );

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(4);
    expect(written("CHAT_MENTION", "OS_BANNER")).toBe(true);
    expect(written("CHAT_DIRECT_MESSAGE", "OS_BANNER")).toBe(true);
  });

  it("writes the whole account in one request", async () => {
    const user = userEvent.setup();
    renderWith(<NotificationUxOptions />);

    await user.click(
      within(
        screen.getByRole("group", { name: "All notifications" }),
      ).getByRole("button", { name: "Off" }),
    );

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(8);
    expect(
      lastWrite().every((cell: { enabled: boolean }) => !cell.enabled),
    ).toBe(true);
  });

  it("turns push on from the control that asked for a banner", async () => {
    const user = userEvent.setup();
    isAccountEnabled = false;
    renderWith(<Only.F1 />);

    await user.click(opener("Tasks"));
    await user.click(stop("Tasks that wait on you", "Banner"));

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledWith(true);
    });
  });

  it("does not ask for push when the banner it writes was already on", async () => {
    const user = userEvent.setup();
    isAccountEnabled = false;
    renderWith(<Only.F1 />);

    await user.click(
      within(
        screen.getByRole("group", { name: "Requests and access preset" }),
      ).getByRole("button", { name: "Everything" }),
    );

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(setAccountEnabled).not.toHaveBeenCalled();
  });

  it("puts the row back when the write fails", async () => {
    const user = userEvent.setup();
    patchMyPreferences.mockRejectedValueOnce(new Error("nope"));
    renderWith(<Only.F1 />);

    await user.click(opener("Tasks"));
    await user.click(stop("Tasks that wait on you", "Off"));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    expect(stop("Tasks that wait on you", "In app")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows one change in every layout", async () => {
    const user = userEvent.setup();
    renderWith(<NotificationUxOptions />);

    await user.click(
      within(
        screen.getAllByRole("group", { name: "Tasks preset" })[0],
      ).getByRole("button", { name: "Off" }),
    );

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    // The preset menu in F2 is also named after the group, so the openers are
    // the buttons named after it and nothing else.
    const openers = screen.getAllByRole("button", {
      name: /^Tasks(?! preset)/,
    });
    expect(openers).toHaveLength(4);
    for (const button of openers) {
      expect(button).toHaveAccessibleName(/Nothing arrives/);
    }
  });

  it("hides the banner control until the subject is on", async () => {
    const user = userEvent.setup();
    renderWith(<Only.F3 />);

    await user.click(opener("Tasks"));
    const rows = screen.getByText("Other task updates").closest("div")
      ?.parentElement as HTMLElement;

    expect(within(rows).queryByRole("button", { name: "Banner" })).toBeNull();
    await user.click(
      screen.getByRole("switch", { name: "Other task updates" }),
    );
    expect(
      within(rows).getByRole("button", { name: "Banner" }),
    ).toBeInTheDocument();
  });
});
