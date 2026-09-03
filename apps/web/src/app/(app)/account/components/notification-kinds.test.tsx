import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMyPreferencesQueryKey } from "@/queries/preferences";

import { NotificationKinds } from "./notification-kinds";

const patchMyPreferences = vi.fn();
const setAccountEnabled = vi.fn();
const setDeviceEnabled = vi.fn();
const setJobEmails = vi.fn();
const setMarketing = vi.fn();
let isAccountEnabled = true;
let isDeviceEnabled = true;
/** Null until the capability read lands, which is not an answer. */
let isSupported: boolean | null = true;
let isBlocked = false;
/** A push write of any kind is already running. */
let isSaving = false;
let jobEmails = true;
let marketing = false;
let session: { user: { id: string } } | null = { user: { id: "user_1" } };
let sessionPending = false;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: session, isPending: sessionPending }),
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
    isDeviceEnabled,
    isSupported,
    isBlocked,
    canToggleAccount: true,
    // The real hook's rule: a session, a browser that can subscribe, and
    // consent already standing.
    canToggleDevice: isSupported === true && !isBlocked && isAccountEnabled,
    isSaving,
    setAccountEnabled,
    setDeviceEnabled,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

/**
 * Jobs sit on no preset, so the group reports Custom. Tasks are Quiet and chat
 * is Important, so both report the preset they are on. Access requests is
 * a single kind, so it is drawn as a plain row with its channel cells.
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

/** Set before a press to make the write this host models fail. */
let emailWriteFails = false;
/** Settles the write the last press started, the way Core answering does. */
let finishEmailWrite: () => void = () => {};

/**
 * The two account switches live above this component, and the page hands their
 * values back down. This host writes the way the account page writes: it
 * paints the new value, marks itself busy, and on a failure puts the value
 * back before it stops being busy.
 */
function AccountHost() {
  const [enabled, setEnabled] = useState(jobEmails);
  const [saving, setSaving] = useState(false);
  const [news, setNews] = useState(marketing);

  return (
    <NotificationKinds
      email={{
        enabled,
        saving,
        onChange: (next: boolean) => {
          setJobEmails(next);
          setEnabled(next);
          setSaving(true);
          finishEmailWrite = () => {
            if (emailWriteFails) {
              setEnabled(!next);
            }

            setSaving(false);
          };
        },
      }}
      news={{
        enabled: news,
        saving: false,
        onChange: (next: boolean) => {
          setMarketing(next);
          setNews(next);
        },
      }}
    />
  );
}

function renderKinds(notificationPreferences = MATRIX) {
  current = notificationPreferences;

  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(getMyPreferencesQueryKey("user_1"), response());

  return render(
    <QueryClientProvider client={queryClient}>
      <AccountHost />
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

/** The cells carry an icon, so each one names its own channel and kind. */
function cellFor(kind: string, channel: string) {
  return within(stops(kind)).getByRole("button", {
    name: `channelCellLabel ${channel} ${kind}`,
  });
}

async function toggle(kind: string, channel: string) {
  const user = userEvent.setup();
  await user.click(cellFor(kind, channel));
}

/** The email cell sits in the row, in the same group as the channels. */
function emailCell(kind: string) {
  return within(stops(kind)).getByRole("button", {
    name: new RegExp(
      `^(channelCellLabel channelEmail|channelEmailSoonLabel) ${kind}$`,
    ),
  });
}

/** The marketing row, which names itself rather than naming a kind. */
function newsRow() {
  return screen.getByRole("group", { name: "newsDeliveryAriaLabel" });
}

/** The account switch on a row of its own, when no kind row carries it. */
function fallbackEmailCell() {
  return screen.getByRole("button", {
    name: "channelCellLabel channelEmail channelEmailLabel",
  });
}

/** What a screen reader reads out after the control's own name. */
function describedBy(element: HTMLElement) {
  const id = element.getAttribute("aria-describedby");

  return id ? document.getElementById(id)?.textContent : undefined;
}

/**
 * A job row carries two regions, one for the channels and one for email. Read
 * together, so an assertion says the row spoke once and says what it said,
 * whichever of them holds the sentence.
 */
function spoken(row: HTMLElement) {
  return within(row)
    .getAllByRole("status")
    .map((region) => region.textContent)
    .join("");
}

async function openGroup(group: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: new RegExp(`^${group}`) }),
  );
}

describe("NotificationKinds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAccountEnabled = true;
    isDeviceEnabled = true;
    isSupported = true;
    isBlocked = false;
    isSaving = false;
    jobEmails = true;
    marketing = false;
    emailWriteFails = false;
    finishEmailWrite = () => {};
    session = { user: { id: "user_1" } };
    sessionPending = false;
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
    setDeviceEnabled.mockResolvedValue(undefined);
  });

  it("marks where each kind arrives, without opening anything", () => {
    renderKinds();

    expect(cellFor("kindSystem", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(cellFor("kindSystem", "channelPush")).toHaveAttribute(
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
    expect(cellFor("kindJobAttention", "channelPush")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /**
   * A group of one is drawn as its kind, with its channels. Its presets would
   * be those same channels under other names.
   */
  it("leaves a single kind with its channel cells", () => {
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
    expect(cellFor("kindSystem", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // The cell that lost its channel is outlined rather than filled.
    expect(cellFor("kindSystem", "channelInApp")).not.toHaveClass("bg-primary");
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
   * Email is one account switch covering every job email, and the row draws it
   * where a reader looks for it. What it writes is still that one switch, so
   * both job rows read the same value and a press on either moves both.
   */
  it("carries the account's job emails on both job rows", async () => {
    const user = userEvent.setup();
    renderKinds();

    await openGroup("groupJob");

    expect(emailCell("kindJobAttention")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(emailCell("kindJobUpdate")).toHaveAttribute("aria-pressed", "true");
    // One value behind two rows is the thing a reader cannot see, so both
    // cells say it after their own name.
    expect(describedBy(emailCell("kindJobUpdate"))).toBe("channelEmailHint");
    // On is filled and off is outlined, so the answer survives without colour.
    expect(emailCell("kindJobUpdate")).toHaveClass("bg-primary");

    await user.click(emailCell("kindJobAttention"));

    // The account switch, and nothing in the matrix: email is not a cell Core
    // stores per kind.
    expect(setJobEmails).toHaveBeenCalledWith(false);
    expect(patchMyPreferences).not.toHaveBeenCalled();

    // The row nobody pressed reads the same value, which is the whole claim.
    // Two cells each holding their own copy would pass everything above.
    expect(emailCell("kindJobUpdate")).toHaveAttribute("aria-pressed", "false");
    expect(emailCell("kindJobAttention")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  /** Every kind answers the same three questions, in the same three places. */
  it("gives every kind the whole row of channels", async () => {
    renderKinds();

    await openGroup("groupChat");

    for (const kind of [
      "kindChatRoomMessage",
      "kindChatMention",
      "kindChatDirectMessage",
    ]) {
      expect(within(stops(kind)).getAllByRole("button")).toHaveLength(3);
    }
  });

  /**
   * Sokosumi mails job status and nothing else. The cell stays where the eye
   * expects it and loses the press, so the column has no hole in it and the
   * row still says what email would mean here.
   */
  it("marks a kind Sokosumi never mails, and presses nowhere", async () => {
    const user = userEvent.setup();
    renderKinds();

    const dead = emailCell("kindSystem");

    // Reachable by keyboard rather than dropped from the tab order, so a
    // reader who never uses a mouse still learns email is one of the places a
    // notification can arrive.
    expect(dead).toHaveAttribute("aria-disabled", "true");
    expect(dead).toBeEnabled();
    expect(dead).toHaveAttribute(
      "aria-label",
      "channelEmailSoonLabel kindSystem",
    );
    // The reason is in the name and in a description, not in a title a finger
    // never opens. The face is a mail icon with a clock on it, so the column
    // has no hole in it and the row says which cells are still waiting.
    expect(dead).toHaveTextContent("");
    expect(dead.querySelector("svg")).not.toBeNull();
    expect(describedBy(dead)).toBe("channelEmailSoonHint");

    await user.click(dead);

    expect(setJobEmails).not.toHaveBeenCalled();
    expect(patchMyPreferences).not.toHaveBeenCalled();
  });

  /**
   * The cells that mail nothing all carry one icon, so each one names its own
   * kind. Without that they would answer to the same name, and a reader
   * listening to them could not tell which row they had reached.
   */
  it("names the kind in every control that mails nothing", async () => {
    renderKinds();

    await openGroup("groupChat");

    expect(
      screen
        .getAllByRole("button", { name: /^channelEmailSoonLabel/ })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "channelEmailSoonLabel kindChatRoomMessage",
      "channelEmailSoonLabel kindChatMention",
      "channelEmailSoonLabel kindChatDirectMessage",
      "channelEmailSoonLabel kindSystem",
    ]);
  });

  /**
   * The cells read as two independent choices and one moves the other, so a
   * reader who cannot see the row is told where the kind now arrives.
   */
  it("says where a kind arrives after a channel moves its sibling", async () => {
    renderKinds();

    const row = stops("kindSystem");
    expect(within(row).getByRole("status")).toHaveTextContent("");

    await toggle("kindSystem", "channelPush");

    // The push took the in-app entry with it, and the announcement names both
    // rather than only the cell the reader pressed.
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
   * changes, so a sentence left standing would both contradict the cells and
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
    expect(cellFor("kindChatMention", "channelInApp")).toHaveAttribute(
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
    expect(cellFor("kindJobAttention", "channelPush")).toHaveAttribute(
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

    expect(cellFor("kindChatRoomMessage", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(cellFor("kindChatRoomMessage", "channelPush")).toHaveAttribute(
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

  /**
   * The cell writes one preference for the account, not one per browser, so a
   * browser that cannot show a push is still where the reader silences or
   * wakes the devices that can. It keeps the press, and says what it will and
   * will not do here.
   */
  it("keeps the push cell working on a browser that cannot push", async () => {
    isSupported = false;
    renderKinds();

    const cell = cellFor("kindSystem", "channelPush");

    expect(cell).toHaveAttribute("aria-pressed", "false");
    expect(describedBy(cell)).toBe("pushUnsupported pushOtherDevicesHint");

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(written("SYSTEM", "OS_BANNER")).toBe(true);
    });
  });

  /**
   * Two different states, and the reader can act on one of them: a block is
   * their own setting and reversible, and no browser support is not. Blocked
   * is reported as blocked, and a browser that cannot push at all is told that
   * first, because it can be both.
   */
  /**
   * The tooltip is where a cell says what its column means, and the trigger
   * writes its own `aria-describedby` to point at it. A cell that set that
   * attribute itself, to anything at all, would take the sentence away from
   * every reader who cannot see the tooltip open.
   */
  it("keeps the tooltip's own description on a cell that is not blocked", async () => {
    const user = userEvent.setup();
    renderKinds();

    const cell = cellFor("kindSystem", "channelInApp");

    expect(cell).not.toHaveAttribute("aria-describedby");

    await user.hover(cell);

    await waitFor(() => {
      expect(cell).toHaveAttribute("aria-describedby");
    });
    expect(describedBy(cell)).toContain("channelInAppHint");
  });

  it("says which of the two the browser is", () => {
    isBlocked = true;
    renderKinds();

    expect(describedBy(cellFor("kindSystem", "channelPush"))).toBe(
      "pushBlockedHint pushOtherDevicesHint",
    );
  });

  it("says the browser cannot push before it says it is blocked", () => {
    isSupported = false;
    isBlocked = true;
    renderKinds();

    expect(describedBy(cellFor("kindSystem", "channelPush"))).toBe(
      "pushUnsupported pushOtherDevicesHint",
    );
  });

  /**
   * The capability read needs `window`, so it lands after the first paint. An
   * unread answer is not a no: reported as one, every reader on every browser
   * would be told theirs cannot push, for a frame or forever.
   */
  it("says nothing about the browser until the capability read lands", () => {
    isSupported = null;
    renderKinds();

    const cell = cellFor("kindSystem", "channelPush");

    expect(cell).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("pushUnsupported")).toBeNull();
  });

  /**
   * Consent standing does not mean this browser holds a subscription. Signing
   * out drops the subscription and leaves the consent, and clearing site data
   * drops it without telling anyone. The press has to cover that, or the cells
   * sit on and this browser never pushes again, with nothing left to press.
   */
  it("subscribes a browser that lost its subscription", async () => {
    isDeviceEnabled = false;
    renderKinds();

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(setDeviceEnabled).toHaveBeenCalledWith(true);
    });
    expect(setAccountEnabled).not.toHaveBeenCalled();
  });

  /**
   * The busy flag the rows hold is per kind, so two kinds can ask for push
   * within one write of each other. Both would read the same stale answer,
   * subscribe on top of one another, and the first to finish would release a
   * shared read while the second still ran.
   */
  it("asks for push once while a push write is in flight", async () => {
    isAccountEnabled = false;
    isSaving = true;
    renderKinds();

    await openGroup("groupJob");
    await toggle("kindJobAttention", "channelPush");
    await toggle("kindJobUpdate", "channelPush");

    expect(setAccountEnabled).not.toHaveBeenCalled();
  });

  it("asks for nothing when the browser already pushes", async () => {
    renderKinds();

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(setDeviceEnabled).not.toHaveBeenCalled();
    expect(setAccountEnabled).not.toHaveBeenCalled();
  });

  /**
   * A browser that cannot subscribe still has consent to record for the ones
   * that can, and nothing here to subscribe.
   */
  it("does not try to subscribe a browser that cannot push", async () => {
    isAccountEnabled = true;
    isDeviceEnabled = false;
    isSupported = false;
    renderKinds();

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(setDeviceEnabled).not.toHaveBeenCalled();
  });

  /**
   * The reader is told what the write actually reached, rather than a flat
   * "enabled" that a silent browser would contradict.
   */
  it("says the consent reached the other devices when this one stays out", async () => {
    isAccountEnabled = false;
    setAccountEnabled.mockResolvedValue(false);
    renderKinds();

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        "pushEnabledOtherDevicesSuccess",
      );
    });
  });

  it("says push is on when the write subscribed this browser", async () => {
    isAccountEnabled = false;
    renderKinds();

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        "pushEnabledSuccess",
      );
    });
  });

  /**
   * One wording for every failure on screen, so the real reason has to reach
   * the console: a refused prompt and a failed Core write look identical here.
   */
  it("logs why the push failed, since the reader is told one thing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    isAccountEnabled = false;
    setAccountEnabled.mockRejectedValue(new Error("refused"));
    renderKinds();

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("pushError");
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
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
    expect(cellFor("kindSystem", "channelInApp")).toHaveAttribute(
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
    expect(cellFor("kindSystem", "channelPush")).toHaveAttribute(
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
    expect(cellFor("kindSystem", "channelInApp")).toHaveAttribute(
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

  /**
   * One value behind both job rows, so a press moves a cell the reader may not
   * have been looking at. The row that was pressed says what the value is now;
   * the other one stays quiet rather than reporting the same change twice.
   *
   * Not before the write settles, either. The account switch is what mails,
   * and a sentence spoken on the press would claim a state Core has not been
   * told about yet.
   */
  it("says what the job emails do now, once the write has landed", async () => {
    const user = userEvent.setup();
    renderKinds();

    await openGroup("groupJob");

    const pressed = stops("kindJobAttention");
    const sibling = stops("kindJobUpdate");

    expect(spoken(pressed)).toBe("");

    await user.click(emailCell("kindJobAttention"));

    expect(spoken(pressed)).toBe("");

    act(finishEmailWrite);

    await waitFor(() => {
      expect(spoken(pressed)).toBe("emailAnnounceOff");
    });
    expect(spoken(sibling)).toBe("");
  });

  /**
   * A region only speaks when its text changes, so a sentence left standing
   * would silence the next press that lands on the same value. The value here
   * moves from the other job row, which holds the same switch.
   */
  it("takes the email sentence down when the value moves under it", async () => {
    const user = userEvent.setup();
    renderKinds();

    await openGroup("groupJob");
    await user.click(emailCell("kindJobAttention"));
    act(finishEmailWrite);

    await waitFor(() => {
      expect(spoken(stops("kindJobAttention"))).toBe("emailAnnounceOff");
    });

    await user.click(emailCell("kindJobUpdate"));

    expect(spoken(stops("kindJobAttention"))).toBe("");
  });

  /**
   * The cells stay reachable while a write is in flight, so the guard is what
   * stops a second press landing on top of the first. Written for both kinds
   * of cell: they hold their own guards, and each also arms the row's live
   * region, so a press that got through would speak about a write nobody made.
   */
  it("takes no second press on the email cell while its write is in flight", async () => {
    const user = userEvent.setup();
    renderKinds();

    await openGroup("groupJob");
    await user.click(emailCell("kindJobAttention"));

    expect(emailCell("kindJobAttention")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.click(emailCell("kindJobAttention"));

    expect(setJobEmails).toHaveBeenCalledTimes(1);
  });

  it("takes no second press on a channel cell while its write is in flight", async () => {
    patchMyPreferences.mockReturnValue(new Promise(() => {}));
    renderKinds();

    await toggle("kindSystem", "channelInApp");

    const cell = cellFor("kindSystem", "channelInApp");
    await waitFor(() => {
      expect(cell).toHaveAttribute("aria-disabled", "true");
    });

    await toggle("kindSystem", "channelInApp");

    expect(patchMyPreferences).toHaveBeenCalledTimes(1);
  });

  /**
   * A failed write leaves the row where it started, and the sentence has to
   * report that rather than the press. The account page puts the value back
   * before it stops being busy, which is what makes this readable here.
   */
  it("reports the value the row ended on when the write fails", async () => {
    const user = userEvent.setup();
    emailWriteFails = true;
    renderKinds();

    await openGroup("groupJob");
    await user.click(emailCell("kindJobAttention"));

    act(finishEmailWrite);

    await waitFor(() => {
      expect(spoken(stops("kindJobAttention"))).toBe("emailAnnounceOn");
    });
    expect(emailCell("kindJobAttention")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /**
   * A session still coming is not an answer, and the preferences read cannot
   * start without one. The page waits for it rather than drawing the one row
   * it can build without the matrix and taking it away again a moment later.
   */
  /**
   * The matrix rows wait on a read: drawn from nothing, they would paint every
   * kind as off and settle onto the stored answer a moment later. The
   * marketing row comes from the account rather than the read, so it is drawn
   * at once. An empty card for the length of a round trip loses a control that
   * never needed the answer.
   */
  it("waits for the read before drawing the kinds, and not before the news", () => {
    sessionPending = true;

    renderKinds();

    expect(newsRow()).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: /^presetAriaLabel/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("group", { name: /^deliveryAriaLabel/ }),
    ).toBeNull();
    // The job emails wait too: whether they need a row of their own is
    // something only the matrix can say.
    expect(
      screen.queryByRole("button", {
        name: "channelCellLabel channelEmail channelEmailLabel",
      }),
    ).toBeNull();
  });

  /**
   * A session that fails is an answer. The preferences read cannot even run
   * then, so waiting on it would wait forever, and the job emails Core keeps
   * sending would have no control on the page at all.
   */
  it("keeps the job emails reachable when the session read fails", () => {
    session = null;

    renderKinds();

    expect(fallbackEmailCell()).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * The fallback row exists for a matrix with no job rows in it. Drawn beside
   * them, it is a second control on the same value, and the two would answer
   * the same question in two places on one card.
   */
  it("draws no row of its own while the job rows carry the emails", async () => {
    const user = userEvent.setup();
    renderKinds();

    expect(
      screen.queryByRole("button", {
        name: "channelCellLabel channelEmail channelEmailLabel",
      }),
    ).toBeNull();

    await openGroup("groupJob");

    expect(emailCell("kindJobAttention")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "channelCellLabel channelEmail channelEmailLabel",
      }),
    ).toBeNull();

    // Proving the query above can find it at all.
    await user.click(emailCell("kindJobAttention"));
    expect(setJobEmails).toHaveBeenCalledWith(false);
  });

  /**
   * Core stops sending a kind and the row for it disappears from the matrix,
   * by design. The job rows are the only ones that carry the account switch,
   * so a matrix that comes back without them leaves rows on screen and no
   * control for the emails Core keeps sending.
   */
  it("keeps the job emails reachable when the matrix drops the job kinds", async () => {
    const user = userEvent.setup();
    renderKinds(MATRIX.filter((cell) => !cell.category.startsWith("JOB_")));

    // The rows Core did send are still drawn.
    expect(presets("groupChat")).toBeInTheDocument();

    const email = fallbackEmailCell();

    expect(email).toHaveAttribute("aria-pressed", "true");

    await user.click(email);

    expect(setJobEmails).toHaveBeenCalledWith(false);
  });

  /**
   * The matrix comes from a read that can still be out, or can fail. Core goes
   * on mailing either way, and email is the one control here that the matrix
   * does not carry, so it cannot wait on it.
   */
  it("keeps the job emails reachable with no matrix at all", async () => {
    const user = userEvent.setup();
    renderKinds([]);

    expect(
      screen.queryByRole("group", { name: /^presetAriaLabel/ }),
    ).toBeNull();

    const email = fallbackEmailCell();

    expect(email).toHaveAttribute("aria-pressed", "true");

    await user.click(email);

    expect(setJobEmails).toHaveBeenCalledWith(false);
  });

  /**
   * Marketing is the one thing here Sokosumi sends rather than reports, and it
   * arrives by email only. It answers the same question in the same columns as
   * everything else, and the two columns it cannot use say why rather than
   * leaving a hole where an answer should be.
   */
  it("answers for the marketing emails in the grid, by email only", async () => {
    const user = userEvent.setup();
    renderKinds();

    const row = newsRow();

    for (const channel of ["channelInApp", "channelPush"]) {
      const dead = within(row).getByRole("button", {
        name: `channelUnavailableLabel ${channel} marketingEmailsTitle`,
      });

      expect(dead).toHaveAttribute("aria-disabled", "true");
      expect(dead).not.toHaveAttribute("aria-pressed");
      expect(describedBy(dead)).toBe("marketingEmailOnlyHint");
    }

    const email = within(row).getByRole("button", {
      name: "marketingEmailsTitle",
    });

    expect(email).toHaveAttribute("aria-pressed", "false");
    expect(describedBy(email)).toBe("marketingEmailsDescription");

    await user.click(email);

    expect(setMarketing).toHaveBeenCalledWith(true);
  });

  /**
   * One cell can sit on a value that several rows share, so every email cell
   * speaks for the value rather than for its row. This row's value is its own,
   * and saying "Job status emails on" here would name a different setting on
   * the same card, one the reader did not touch.
   */
  it("says which emails moved when the marketing row is pressed", async () => {
    const user = userEvent.setup();
    renderKinds();

    const row = newsRow();

    expect(spoken(row)).toBe("");

    await user.click(
      within(row).getByRole("button", {
        name: "marketingEmailsTitle",
      }),
    );

    await waitFor(() => {
      expect(spoken(row)).toBe("newsAnnounceOn");
    });
  });

  /**
   * The marketing row comes from the account rather than the matrix, so a read
   * that failed takes every other row with it and leaves this one standing.
   */
  it("keeps the marketing emails reachable with no matrix at all", () => {
    renderKinds([]);

    expect(
      within(newsRow()).getByRole("button", {
        name: "marketingEmailsTitle",
      }),
    ).toBeInTheDocument();
  });
});
