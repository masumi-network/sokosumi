import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMyPreferencesQueryKey } from "@/queries/preferences";

import { NotificationKinds } from "./notification-kinds";

const patchMyPreferences = vi.fn();
const setAccountEnabled = vi.fn();
let isAccountEnabled = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
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
 * Jobs sit on no preset, so the group reports Custom. Tasks are Quiet and chat
 * is Important, so both report the preset they are on. Access requests is
 * a single kind, so it is drawn as a plain row with its channel chips.
 */
const MATRIX = [
  { category: "JOB_ATTENTION", channel: "IN_APP", enabled: true },
  { category: "JOB_ATTENTION", channel: "OS_BANNER", enabled: true },
  { category: "JOB_UPDATE", channel: "IN_APP", enabled: true },
  { category: "JOB_UPDATE", channel: "OS_BANNER", enabled: false },
  { category: "TASK_ATTENTION", channel: "IN_APP", enabled: true },
  { category: "TASK_ATTENTION", channel: "OS_BANNER", enabled: false },
  { category: "TASK_UPDATE", channel: "IN_APP", enabled: false },
  { category: "TASK_UPDATE", channel: "OS_BANNER", enabled: false },
  { category: "CHAT_ROOM_MESSAGE", channel: "IN_APP", enabled: false },
  { category: "CHAT_ROOM_MESSAGE", channel: "OS_BANNER", enabled: false },
  { category: "CHAT_MENTION", channel: "IN_APP", enabled: true },
  { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: true },
  { category: "CHAT_DIRECT_MESSAGE", channel: "IN_APP", enabled: true },
  { category: "CHAT_DIRECT_MESSAGE", channel: "OS_BANNER", enabled: true },
  { category: "SYSTEM", channel: "IN_APP", enabled: true },
  { category: "SYSTEM", channel: "OS_BANNER", enabled: false },
];

/** The stored matrix as the fake Core holds it, so a write can be read back. */
let current: typeof MATRIX = MATRIX;

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

/** Held so a test can write into the same cache the page reads. */
let queryClient: QueryClient;

function renderKinds(notificationPreferences = MATRIX) {
  current = notificationPreferences;

  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(getMyPreferencesQueryKey("user_1"), response());

  render(
    <QueryClientProvider client={queryClient}>
      <NotificationKinds />
    </QueryClientProvider>,
  );
}

function lastWrite() {
  const calls = patchMyPreferences.mock.calls;
  return calls[calls.length - 1][0].notificationPreferences;
}

function written(category: string, channel: string) {
  return lastWrite().find(
    (cell: { category: string; channel: string }) =>
      cell.category === category && cell.channel === channel,
  )?.enabled;
}

/** Translations are mocked to the key, so the aria-label is key plus values. */
function stops(kind: string) {
  return screen.getByRole("group", { name: `deliveryAriaLabel ${kind}` });
}

function presets(group: string) {
  return screen.getByRole("group", { name: `presetAriaLabel ${group}` });
}

function preset(group: string, name: string) {
  return within(presets(group)).getByRole("button", { name });
}

async function pickPreset(group: string, name: string) {
  const user = userEvent.setup();
  await user.click(preset(group, name));
}

function chip(kind: string, channel: string) {
  return within(stops(kind)).getByRole("button", { name: channel });
}

async function toggle(kind: string, channel: string) {
  const user = userEvent.setup();
  await user.click(chip(kind, channel));
}

describe("NotificationKinds", () => {
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

  it("marks where each kind arrives, without opening anything", () => {
    renderKinds();

    expect(chip("kindSystem", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(chip("kindSystem", "channelPush")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // The groups answer with the preset they are on, without being opened.
    expect(preset("groupTask", "presetQuiet")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(preset("groupChat", "presetImportant")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Jobs match none of them, and say so rather than reporting one.
    expect(preset("groupJob", "presetCustom")).toBeInTheDocument();
  });

  it("offers a group the four answers that mean something for it", () => {
    renderKinds();

    expect(
      within(presets("groupJob"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "presetEverything",
      "presetImportant",
      "presetQuiet",
      "presetOff",
      // Custom is not an answer to pick: it reports that the reader set the
      // kinds one by one, and opens the group.
      "presetCustom",
    ]);
  });

  /**
   * Custom reports a state rather than offering one, so it is the fold's own
   * trigger. Pressing it shows the kinds the reader set one by one, which is
   * the only place that state can be read or changed.
   */
  it("opens the group from the Custom stop", async () => {
    const user = userEvent.setup();
    renderKinds();

    const custom = preset("groupJob", "presetCustom");
    expect(custom).toHaveAttribute("aria-expanded", "false");

    await user.click(custom);

    expect(custom).toHaveAttribute("aria-expanded", "true");
    expect(chip("kindJobAttention", "channelPush")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /**
   * A group of one is drawn as its kind, with its channels. Its presets would
   * be those same channels under other names.
   */
  it("leaves a single kind with its channel chips", () => {
    renderKinds();

    expect(
      screen.queryByRole("group", { name: "presetAriaLabel kindSystem" }),
    ).toBeNull();
    expect(stops("kindSystem")).toBeInTheDocument();
  });

  it("writes both channels of the kind the reader changed", async () => {
    renderKinds();

    await toggle("kindSystem", "channelInApp");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    // Both cells, not only the one pressed: the row says where the kind
    // arrives, so a write states every channel it names.
    expect(lastWrite()).toHaveLength(2);
    expect(written("SYSTEM", "IN_APP")).toBe(false);
    expect(written("SYSTEM", "OS_BANNER")).toBe(false);
    expect(chip("kindSystem", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  /**
   * A push that leaves nothing behind cannot be found again once the banner is
   * gone: the feed and the unread count both read the in-app cell. So picking
   * a push picks the entry with it.
   */
  it("turns the in-app entry on with the push", async () => {
    renderKinds();

    await toggle("kindSystem", "channelInApp");
    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(written("SYSTEM", "OS_BANNER")).toBe(true);
    });
    expect(written("SYSTEM", "IN_APP")).toBe(true);
  });

  /** The same rule the other way: dropping the entry drops the push with it. */
  it("takes the push away with the in-app entry", async () => {
    const user = userEvent.setup();
    renderKinds();

    await user.click(screen.getByRole("button", { name: /^groupJob/ }));
    await toggle("kindJobAttention", "channelInApp");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(written("JOB_ATTENTION", "IN_APP")).toBe(false);
    expect(written("JOB_ATTENTION", "OS_BANNER")).toBe(false);
  });

  /**
   * Email reaches the reader for job status and for nothing else. Naming it
   * keeps the row honest about where a kind can arrive; saying the same thing
   * on every row would send most readers to a switch that cannot reach them.
   */
  it("names email, reachable, and says it cannot be set here", async () => {
    const user = userEvent.setup();
    renderKinds();

    await user.click(screen.getByRole("button", { name: /^groupJob/ }));

    const email = within(stops("kindJobAttention")).getByRole("button", {
      name: "channelEmailUnavailable",
    });

    // Reachable by keyboard and marked unavailable, rather than dropped from
    // the tab order: a reader who never uses a mouse still learns email is one
    // of the places this kind can reach them, and why it is not theirs to set.
    expect(email).toHaveAttribute("aria-disabled", "true");
    expect(email).toBeEnabled();
    expect(email).toHaveTextContent("channelEmail");

    await user.click(email);
    expect(patchMyPreferences).not.toHaveBeenCalled();
  });

  /**
   * Core mails job status and nothing else. The chip on every other row would
   * otherwise point at the account switch, which would never mail that kind.
   */
  it("says no email is sent for a kind that is never mailed", async () => {
    const user = userEvent.setup();
    renderKinds();

    const unmailed = within(stops("kindSystem")).getByRole("button", {
      name: "channelEmailNone",
    });

    expect(unmailed).toBeInTheDocument();
    expect(
      within(stops("kindSystem")).queryByRole("button", {
        name: "channelEmailUnavailable",
      }),
    ).not.toBeInTheDocument();

    // The accessible name carries the difference, and the `title` only opens
    // under a mouse. Struck through, a sighted reader on a keyboard or a
    // touchscreen can see this row apart from one that can be mailed.
    expect(unmailed).toHaveClass("line-through");

    await user.click(screen.getByRole("button", { name: /^groupJob/ }));
    expect(
      within(stops("kindJobAttention")).getByRole("button", {
        name: "channelEmailUnavailable",
      }),
    ).not.toHaveClass("line-through");
  });

  /**
   * The chips read as two independent choices and one moves the other, so a
   * reader who cannot see the row is told where the kind now arrives.
   */
  it("says where a kind arrives after a channel moves its sibling", async () => {
    renderKinds();

    const row = stops("kindSystem");
    expect(within(row).getByRole("status")).toHaveTextContent("");

    await toggle("kindSystem", "channelPush");

    // The push took the in-app entry with it, and the announcement names both
    // rather than only the chip the reader pressed.
    await waitFor(() => {
      expect(within(row).getByRole("status")).toHaveTextContent(
        "channelsAnnounce kindSystem channelInApp, channelPush",
      );
    });

    await toggle("kindSystem", "channelInApp");

    await waitFor(() => {
      expect(within(row).getByRole("status")).toHaveTextContent(
        "channelsAnnounce kindSystem channelsNone",
      );
    });
  });

  /**
   * Turning a push on waits on the account consent, which waits on a person.
   * The row still holds the old channels for all of that time, so a region
   * that spoke on the press would read out the state the reader just changed
   * away from, in the one case it exists for.
   */
  it("says nothing until the write that asked for push has landed", async () => {
    isAccountEnabled = false;

    let allowPush: (subscribedHere: boolean) => void = () => {};
    setAccountEnabled.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          allowPush = resolve;
        }),
    );

    renderKinds();

    const row = stops("kindSystem");
    await toggle("kindSystem", "channelPush");

    // The consent still stands. `kindSystem` starts on the in-app entry alone,
    // so a region reading the cache here would announce exactly that.
    expect(within(row).getByRole("status")).toHaveTextContent("");

    allowPush(true);

    await waitFor(() => {
      expect(within(row).getByRole("status")).toHaveTextContent(
        "channelsAnnounce kindSystem channelInApp, channelPush",
      );
    });
  });

  /**
   * A preset writes every row in the group at once, under its own control,
   * which says what it did. A row that spoke again on that write would report
   * one row of three as if it were all that moved.
   *
   * The sentence comes down all the same. A live region speaks when its text
   * changes, so a sentence left standing would both contradict the chips and
   * swallow the next press that lands back on the channels it names.
   */
  it("takes its sentence down when a preset writes the row", async () => {
    const user = userEvent.setup();
    renderKinds();

    await user.click(screen.getByRole("button", { name: /^groupChat/ }));
    await toggle("kindChatMention", "channelPush");

    const row = stops("kindChatMention");

    await waitFor(() => {
      expect(within(row).getByRole("status")).toHaveTextContent(
        "channelsAnnounce kindChatMention channelInApp",
      );
    });

    await pickPreset("groupChat", "presetOff");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(2);
    });
    expect(chip("kindChatMention", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(row).getByRole("status")).toHaveTextContent("");

    // Back to both channels, which is what the row said before the preset.
    // With the old sentence still up this press would say nothing at all.
    await toggle("kindChatMention", "channelPush");

    await waitFor(() => {
      expect(within(row).getByRole("status")).toHaveTextContent(
        "channelsAnnounce kindChatMention channelInApp, channelPush",
      );
    });
  });

  it("splits a job that needs you from one that merely happened", async () => {
    const user = userEvent.setup();
    renderKinds();

    await user.click(screen.getByRole("button", { name: /^groupJob/ }));
    await toggle("kindJobUpdate", "channelInApp");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    // The loud row keeps its push while the quiet one goes silent, which is
    // the split this vocabulary exists for.
    expect(lastWrite()).toHaveLength(2);
    expect(written("JOB_UPDATE", "IN_APP")).toBe(false);
    expect(written("JOB_ATTENTION", "OS_BANNER")).toBeUndefined();
    expect(chip("kindJobAttention", "channelPush")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("sets every kind in a group from the group's own control", async () => {
    renderKinds();

    await pickPreset("groupChat", "presetOff");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    // One request, so the group cannot end up half applied with the reader
    // watching its kinds settle one by one.
    expect(lastWrite()).toHaveLength(6);
    expect(written("CHAT_MENTION", "IN_APP")).toBe(false);
    expect(written("CHAT_DIRECT_MESSAGE", "OS_BANNER")).toBe(false);
  });

  /**
   * The point of the split rows: one press keeps the job that is stuck loud
   * and silences the one that merely finished.
   */
  it("keeps what waits on you and drops the rest, in one request", async () => {
    renderKinds();

    await pickPreset("groupJob", "presetImportant");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(4);
    expect(written("JOB_ATTENTION", "OS_BANNER")).toBe(true);
    expect(written("JOB_UPDATE", "IN_APP")).toBe(false);
    expect(written("JOB_UPDATE", "OS_BANNER")).toBe(false);
  });

  it("keeps the same kinds quietly when the reader asks for quiet", async () => {
    renderKinds();

    await pickPreset("groupJob", "presetQuiet");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(written("JOB_ATTENTION", "IN_APP")).toBe(true);
    expect(written("JOB_ATTENTION", "OS_BANNER")).toBe(false);
    expect(written("JOB_UPDATE", "IN_APP")).toBe(false);
  });

  /**
   * Chat's quiet answer leaves every message in a room off, because that row
   * never waits on the reader.
   */
  it("leaves every message in a room off under a quiet chat", async () => {
    renderKinds();

    await pickPreset("groupChat", "presetQuiet");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(written("CHAT_ROOM_MESSAGE", "IN_APP")).toBe(false);
    expect(written("CHAT_MENTION", "IN_APP")).toBe(true);
    expect(written("CHAT_MENTION", "OS_BANNER")).toBe(false);
  });

  /**
   * Nobody receives every message in a room today, so the row starts off and
   * the reader turns it on. It is the one row where an untouched account is
   * quieter than the ones around it.
   */
  it("shows every message in a room as off until the reader asks", async () => {
    const user = userEvent.setup();
    renderKinds();

    await user.click(screen.getByRole("button", { name: /^groupChat/ }));

    expect(chip("kindChatRoomMessage", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(chip("kindChatRoomMessage", "channelPush")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await toggle("kindChatRoomMessage", "channelInApp");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(written("CHAT_ROOM_MESSAGE", "IN_APP")).toBe(true);
    expect(written("CHAT_ROOM_MESSAGE", "OS_BANNER")).toBe(false);
  });

  it("keeps the kinds in a group separately selectable", async () => {
    const user = userEvent.setup();
    renderKinds();

    await user.click(screen.getByRole("button", { name: /^groupChat/ }));
    await toggle("kindChatDirectMessage", "channelPush");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(2);
    expect(written("CHAT_DIRECT_MESSAGE", "OS_BANNER")).toBe(false);
    expect(written("CHAT_DIRECT_MESSAGE", "IN_APP")).toBe(true);
    expect(written("CHAT_MENTION", "IN_APP")).toBeUndefined();
  });

  it("turns push on from the control that asked for it", async () => {
    isAccountEnabled = false;
    renderKinds();

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledWith(true);
    });
  });

  /**
   * The push cells start on and the account opt-in starts off, so a reader who
   * never opened this page has a stored push and no way to receive one. A
   * preset that leaves those cells on is that reader asking for pushes.
   */
  it("asks for push when a preset leaves a stored push on", async () => {
    isAccountEnabled = false;
    renderKinds();

    await pickPreset("groupChat", "presetImportant");

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledWith(true);
    });
  });

  it("does not ask for push when the write leaves no push on", async () => {
    isAccountEnabled = false;
    renderKinds();

    await toggle("kindSystem", "channelInApp");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(setAccountEnabled).not.toHaveBeenCalled();
  });

  /**
   * The stop the reader pressed has to still read as pressed once Core answers.
   * A preset that wrote cells the same preset does not describe would settle
   * back onto Custom, which is the reader's press being undone in front of them.
   */
  it("stays on the preset the reader picked once the write lands", async () => {
    renderKinds();

    await pickPreset("groupChat", "presetQuiet");

    await waitFor(() => {
      expect(preset("groupChat", "presetQuiet")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  /**
   * The common write needs no consent at all, and it still paints before the
   * network answers. That is the whole point of painting: the row moves under
   * the press rather than a round trip later.
   */
  it("shows the picked channels before the write lands", async () => {
    patchMyPreferences.mockReturnValue(new Promise(() => {}));
    renderKinds();

    await toggle("kindSystem", "channelInApp");

    expect(setAccountEnabled).not.toHaveBeenCalled();
    expect(chip("kindSystem", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  /**
   * Recording the account-wide consent writes its own preferences PATCH and
   * seeds this cache with the answer that write returned. That answer predates
   * the delivery this reader just picked, so a paint before the consent is
   * dropped again the moment the consent lands.
   */
  it("keeps the picked channel on the row after the consent lands", async () => {
    isAccountEnabled = false;
    setAccountEnabled.mockImplementation(async () => {
      queryClient.setQueryData(getMyPreferencesQueryKey("user_1"), {
        data: { ...response(MATRIX).data, pushOptIn: true },
      });
      return true;
    });
    // Still in flight, so the row shows the optimistic paint and nothing else.
    patchMyPreferences.mockReturnValue(new Promise(() => {}));
    renderKinds();

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledWith(true);
    });
    expect(chip("kindSystem", "channelPush")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /**
   * The permission prompt waits on a person, and it can stand for as long as
   * they leave it standing. The group is busy from the press, not from the
   * answer, so a second press cannot land a write the first one then
   * overwrites on its way back.
   */
  it("marks the group busy while the permission prompt stands", async () => {
    isAccountEnabled = false;
    setAccountEnabled.mockReturnValue(new Promise(() => {}));
    renderKinds();

    await pickPreset("groupChat", "presetEverything");

    await waitFor(() => {
      expect(preset("groupChat", "presetEverything")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    await pickPreset("groupChat", "presetQuiet");
    expect(patchMyPreferences).not.toHaveBeenCalled();
  });

  /**
   * A control the browser disables drops out of the tab order under the
   * reader's finger, and a screen reader loses the control it was on. It stays
   * reachable and says it is busy instead, and presses do nothing until the
   * write lands.
   */
  it("keeps the controls reachable while a write is in flight", async () => {
    patchMyPreferences.mockReturnValue(new Promise(() => {}));
    renderKinds();

    await pickPreset("groupChat", "presetQuiet");

    const quiet = preset("groupChat", "presetQuiet");
    await waitFor(() => {
      expect(quiet).toHaveAttribute("aria-disabled", "true");
    });
    expect(quiet).toBeEnabled();

    await pickPreset("groupChat", "presetOff");
    expect(patchMyPreferences).toHaveBeenCalledTimes(1);
  });

  it("puts the group back on its preset when a preset write fails", async () => {
    patchMyPreferences.mockRejectedValueOnce(new Error("nope"));
    renderKinds();

    await pickPreset("groupChat", "presetOff");

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    expect(preset("groupChat", "presetImportant")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("puts the row back when the write fails", async () => {
    patchMyPreferences.mockRejectedValueOnce(new Error("nope"));
    renderKinds();

    await toggle("kindSystem", "channelInApp");

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    expect(chip("kindSystem", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("draws nothing for a kind Core does not send", () => {
    renderKinds(MATRIX.filter((cell) => cell.category !== "SYSTEM"));

    expect(
      screen.queryByRole("group", { name: "deliveryAriaLabel kindSystem" }),
    ).toBeNull();
    expect(presets("groupJob")).toBeInTheDocument();
  });
});
