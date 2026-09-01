import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMyPreferencesQueryKey } from "@/queries/preferences";

import { E1PresetStops } from "./e1-preset-stops";
import { E2PresetMenu } from "./e2-preset-menu";
import { E10PagePreset } from "./e10-page-preset";
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
 * Chat starts on its default rung with its two subjects disagreeing about the
 * banner, so it is custom from the first paint. Requests and access has one
 * rung, which is what the preset de-duplication is checked against.
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

/** Each layout alone, so its controls are the only ones on screen. */
const Only = {
  E1: () => <E1PresetStops choices={useNotificationChoices()} />,
  E2: () => <E2PresetMenu choices={useNotificationChoices()} />,
  E10: () => <E10PagePreset choices={useNotificationChoices()} />,
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

function ladder(group: string) {
  return screen.getByRole("radiogroup", {
    name: `${group}, what to tell you about`,
  });
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

    for (let index = 1; index <= 10; index += 1) {
      expect(
        screen.getByText(new RegExp(`^E${index}\\. `)),
      ).toBeInTheDocument();
    }
  });

  it("marks the rungs under the chosen one as included, and only checks one", async () => {
    const user = userEvent.setup();
    renderWith(<Only.E1 />);

    await user.click(opener("Chat"));
    const rungs = ladder("Chat");
    await user.click(
      within(rungs).getByRole("radio", { name: /Every message in your rooms/ }),
    );

    // Three rungs sit under the fourth, and none of them is a separate switch.
    expect(within(rungs).getAllByText("included")).toHaveLength(3);
    expect(within(rungs).getAllByRole("radio", { checked: true })).toHaveLength(
      1,
    );
  });

  it("turns the added subject on when the ladder widens", async () => {
    const user = userEvent.setup();
    renderWith(<Only.E1 />);

    await user.click(opener("Chat"));
    const rungs = ladder("Chat");
    await user.click(
      within(rungs).getByRole("radio", { name: /Direct messages/ }),
    );

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalled();
    });
    expect(written("CHAT_MENTION", "IN_APP")).toBe(false);

    await user.click(within(rungs).getByRole("radio", { name: /Mentions/ }));

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(2);
    });
    expect(written("CHAT_MENTION", "IN_APP")).toBe(true);
    // The rung below came along. Asking for mentions cannot drop the direct
    // messages, which is the whole claim the ladder makes.
    expect(written("CHAT_DIRECT_MESSAGE", "IN_APP")).toBe(true);
  });

  it("reads the delivery from the subjects in scope, not from the ones left out", async () => {
    const user = userEvent.setup();
    renderWith(<Only.E1 />);
    await user.click(opener("Chat"));

    // The two chat subjects disagree about the banner, so the group is custom.
    expect(
      within(
        screen.getByRole("group", { name: "Chat, where it arrives" }),
      ).getByRole("button", { name: "All" }),
    ).toHaveAttribute("aria-pressed", "false");

    await user.click(
      within(ladder("Chat")).getByRole("radio", { name: /Direct messages/ }),
    );

    // Narrowed to the one subject that has both channels on, the group is not
    // custom any more: the subject it no longer listens to cannot outvote it.
    await waitFor(() => {
      expect(
        within(
          screen.getByRole("group", { name: "Chat, where it arrives" }),
        ).getByRole("button", { name: "All" }),
      ).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("drops a preset that would write what an earlier one writes", () => {
    renderWith(<Only.E1 />);

    const chat = screen.getByRole("group", { name: "Chat preset" });
    const system = screen.getByRole("group", {
      name: "Requests and access preset",
    });

    expect(
      within(chat).getByRole("button", { name: "Everything" }),
    ).toBeInTheDocument();
    expect(
      within(chat).getByRole("button", { name: "Important" }),
    ).toBeInTheDocument();
    // One rung, so "Everything" and "Important" would be the same press.
    expect(
      within(system).queryByRole("button", { name: "Important" }),
    ).not.toBeInTheDocument();
    expect(
      within(system).getByRole("button", { name: "Everything" }),
    ).toBeInTheDocument();
  });

  it("writes both questions from one preset", async () => {
    const user = userEvent.setup();
    renderWith(<Only.E1 />);

    const chat = screen.getByRole("group", { name: "Chat preset" });
    await user.click(within(chat).getByRole("button", { name: "Everything" }));

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalled();
    });
    const cells = lastWrite();
    expect(cells).toHaveLength(4);
    expect(
      cells.every((cell: { enabled: boolean }) => cell.enabled === true),
    ).toBe(true);
    // The widest rung, not just the loudest delivery.
    expect(
      within(screen.getByRole("group", { name: "Chat preset" })).getByRole(
        "button",
        { name: "Everything" },
      ),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves the breadth alone when only the noise goes down", async () => {
    const user = userEvent.setup();
    renderWith(<Only.E1 />);

    await user.click(opener("Chat"));
    await user.click(
      within(ladder("Chat")).getByRole("radio", { name: /Direct messages/ }),
    );
    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });

    const chat = screen.getByRole("group", { name: "Chat preset" });
    await user.click(within(chat).getByRole("button", { name: "Quiet" }));

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(2);
    });
    // Quiet is about where, so the narrowed breadth survives it.
    expect(written("CHAT_MENTION", "IN_APP")).toBe(false);
    expect(written("CHAT_DIRECT_MESSAGE", "IN_APP")).toBe(true);
    expect(written("CHAT_DIRECT_MESSAGE", "OS_BANNER")).toBe(false);
  });

  it("turns push on from the control that asked for a banner", async () => {
    isAccountEnabled = false;
    const user = userEvent.setup();
    renderWith(<Only.E1 />);

    await user.click(opener("Tasks"));
    await user.click(
      screen.getByRole("button", {
        name: "matrixCategoryTask, matrixChannelOsBanner",
      }),
    );

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledWith(true);
    });
    expect(lastWrite()).toEqual([
      { category: "TASK", channel: "OS_BANNER", enabled: true },
    ]);
  });

  it("does not ask for push when a wider ladder rewrites a banner it already had", async () => {
    isAccountEnabled = false;
    const user = userEvent.setup();
    renderWith(<Only.E1 />);

    await user.click(opener("Chat"));
    await user.click(
      within(ladder("Chat")).getByRole("radio", { name: /Direct messages/ }),
    );

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalled();
    });
    // The direct message banner was already on. Writing it again is not a new
    // request, so the browser must not be asked for the permission.
    expect(written("CHAT_DIRECT_MESSAGE", "OS_BANNER")).toBe(true);
    expect(setAccountEnabled).not.toHaveBeenCalled();
  });

  it("says what a closed group listens for", () => {
    renderWith(<Only.E1 />);

    // The row that opens the group says it, so a reader never has to open it.
    expect(opener("Chat")).toHaveAccessibleName(/Direct messages and mentions/);
  });

  it("opens the group from the menu that also holds the presets", async () => {
    const user = userEvent.setup();
    renderWith(<Only.E2 />);

    expect(ladderIsAbsent("Chat")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Chat preset" }));
    await user.click(
      screen.getByRole("menuitem", { name: /Choose what and where/ }),
    );

    expect(ladder("Chat")).toBeInTheDocument();
    expect(patchMyPreferences).not.toHaveBeenCalled();
  });

  it("puts every group on one preset in a single write", async () => {
    const user = userEvent.setup();
    renderWith(<Only.E10 />);

    const everything = screen.getByRole("group", { name: "All notifications" });
    await user.click(within(everything).getByRole("button", { name: "Off" }));

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    const cells = lastWrite();
    expect(cells).toHaveLength(MATRIX.length);
    expect(
      cells.every((cell: { enabled: boolean }) => cell.enabled === false),
    ).toBe(true);
  });
});

function ladderIsAbsent(group: string) {
  return (
    screen.queryByRole("radiogroup", {
      name: `${group}, what to tell you about`,
    }) === null
  );
}
