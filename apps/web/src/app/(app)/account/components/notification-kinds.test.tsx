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
 * a single kind, so it is drawn as a plain row with the delivery stops.
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

function stop(kind: string, delivery: string) {
  return within(stops(kind)).getByRole("button", { name: delivery });
}

async function pick(kind: string, delivery: string) {
  const user = userEvent.setup();
  await user.click(stop(kind, delivery));
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

    expect(stop("kindSystem", "deliveryInApp")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(stop("kindSystem", "deliveryBanner")).toHaveAttribute(
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
    expect(stop("kindJobAttention", "deliveryBanner")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /**
   * A group of one is drawn as its kind, with the delivery ladder. Its presets
   * would be that ladder under other names.
   */
  it("leaves a single kind with its delivery stops", () => {
    renderKinds();

    expect(
      screen.queryByRole("group", { name: "presetAriaLabel kindSystem" }),
    ).toBeNull();
    expect(stops("kindSystem")).toBeInTheDocument();
  });

  it("writes both channels of the kind the reader changed", async () => {
    renderKinds();

    await pick("kindSystem", "deliveryOff");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(2);
    expect(written("SYSTEM", "IN_APP")).toBe(false);
    expect(written("SYSTEM", "OS_BANNER")).toBe(false);
    expect(stop("kindSystem", "deliveryOff")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("turns a banner into both channels, so nothing arrives unseen", async () => {
    renderKinds();

    await pick("kindSystem", "deliveryBanner");

    await waitFor(() => {
      expect(written("SYSTEM", "OS_BANNER")).toBe(true);
    });
    expect(written("SYSTEM", "IN_APP")).toBe(true);
  });

  it("splits a job that needs you from one that merely happened", async () => {
    const user = userEvent.setup();
    renderKinds();

    await user.click(screen.getByRole("button", { name: /^groupJob/ }));
    await pick("kindJobUpdate", "deliveryOff");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    // The loud row keeps its banner while the quiet one goes silent, which is
    // the split this vocabulary exists for.
    expect(lastWrite()).toHaveLength(2);
    expect(written("JOB_UPDATE", "IN_APP")).toBe(false);
    expect(written("JOB_ATTENTION", "OS_BANNER")).toBeUndefined();
    expect(stop("kindJobAttention", "deliveryBanner")).toHaveAttribute(
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

    expect(stop("kindChatRoomMessage", "deliveryOff")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await pick("kindChatRoomMessage", "deliveryInApp");

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
    await pick("kindChatDirectMessage", "deliveryOff");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(2);
    expect(written("CHAT_DIRECT_MESSAGE", "IN_APP")).toBe(false);
    expect(written("CHAT_MENTION", "IN_APP")).toBeUndefined();
  });

  it("turns push on from the control that asked for a banner", async () => {
    isAccountEnabled = false;
    renderKinds();

    await pick("kindSystem", "deliveryBanner");

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledWith(true);
    });
  });

  /**
   * The banner cells start on and the account opt-in starts off, so a reader
   * who never opened this page has a stored banner and no way to receive one.
   * A preset that leaves those cells on is that reader asking for banners.
   */
  it("asks for push when a preset leaves a stored banner on", async () => {
    isAccountEnabled = false;
    renderKinds();

    await pickPreset("groupChat", "presetImportant");

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledWith(true);
    });
  });

  it("does not ask for push when the write leaves no banner on", async () => {
    isAccountEnabled = false;
    renderKinds();

    await pick("kindSystem", "deliveryInApp");

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
  it("shows the picked delivery before the write lands", async () => {
    patchMyPreferences.mockReturnValue(new Promise(() => {}));
    renderKinds();

    await pick("kindSystem", "deliveryOff");

    expect(setAccountEnabled).not.toHaveBeenCalled();
    expect(stop("kindSystem", "deliveryOff")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /**
   * Recording the account-wide consent writes its own preferences PATCH and
   * seeds this cache with the answer that write returned. That answer predates
   * the delivery this reader just picked, so a paint before the consent is
   * dropped again the moment the consent lands.
   */
  it("keeps the picked delivery on the row after the consent lands", async () => {
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

    await pick("kindSystem", "deliveryBanner");

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledWith(true);
    });
    expect(stop("kindSystem", "deliveryBanner")).toHaveAttribute(
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
   * A stop the browser disables drops out of the tab order under the reader's
   * finger, and a screen reader loses the control it was on. It stays
   * reachable and says it is busy instead, and presses do nothing until the
   * write lands.
   */
  it("keeps the stops reachable while a write is in flight", async () => {
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

    await pick("kindSystem", "deliveryOff");

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    expect(stop("kindSystem", "deliveryInApp")).toHaveAttribute(
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
