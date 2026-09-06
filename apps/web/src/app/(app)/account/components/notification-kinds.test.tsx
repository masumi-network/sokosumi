import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMyPreferencesQueryKey } from "@/queries/preferences";

import { NotificationKinds } from "./notification-kinds";

const patchMyPreferences = vi.fn();
const getMyPreferences = vi.fn();
const setAccountEnabled = vi.fn();
const setDeviceEnabled = vi.fn();
const setJobEmails = vi.fn();
const setMarketing = vi.fn();
let isAccountEnabled = true;
let isDeviceEnabled = true;
/** Whether the browser has answered whether it holds a subscription. */
let isDeviceKnown = true;
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
    getMyPreferences: (...args: unknown[]) => getMyPreferences(...args),
    patchMyPreferences: (body: unknown) => patchMyPreferences(body),
  },
}));

vi.mock("@/lib/ably/use-push-preference", () => ({
  usePushPreference: () => ({
    isAccountEnabled,
    isDeviceEnabled,
    isDeviceKnown,
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
 * Jobs push what waits on the reader, keep finished jobs in the app and stop
 * the rest, which is no situation the presets write, so that group reads
 * Custom. Tasks are on Results and chat on Essential. Access requests is a
 * single kind, so it is drawn as a plain row with its channel cells.
 */
const MATRIX = [
  { category: "JOB_ATTENTION", channel: "IN_APP", enabled: true },
  { category: "JOB_ATTENTION", channel: "OS_BANNER", enabled: true },
  { category: "JOB_COMPLETED", channel: "IN_APP", enabled: true },
  { category: "JOB_COMPLETED", channel: "OS_BANNER", enabled: false },
  { category: "JOB_UPDATE", channel: "IN_APP", enabled: false },
  { category: "JOB_UPDATE", channel: "OS_BANNER", enabled: false },
  { category: "TASK_ATTENTION", channel: "IN_APP", enabled: true },
  { category: "TASK_ATTENTION", channel: "OS_BANNER", enabled: true },
  { category: "TASK_COMPLETED", channel: "IN_APP", enabled: true },
  { category: "TASK_COMPLETED", channel: "OS_BANNER", enabled: true },
  { category: "TASK_UPDATE", channel: "IN_APP", enabled: true },
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

/** Renders with the read still out, the way a first visit meets the page. */
function renderPending() {
  getMyPreferences.mockReturnValue(new Promise(() => {}));
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

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

/**
 * Opens every row that is still folded.
 *
 * The cells live inside the fold now, so a test that reaches for one means
 * the row it is in. The accessors below open it rather than every test
 * spelling out the press that gets there, and a test about the folded state
 * never asks for a cell and so never opens anything.
 *
 * Only the rows: a group's answer is a menu, and its trigger reports itself
 * closed the same way a folded row does.
 */
function openFolds() {
  for (const trigger of screen.queryAllByRole("button", { expanded: false })) {
    if (trigger.dataset.slot === "collapsible-trigger") {
      fireEvent.click(trigger);
    }
  }
}

/** Translations are mocked to the key, so the aria-label is key plus values. */
function stops(kind: string) {
  const name = `deliveryAriaLabel ${kind}`;

  if (!screen.queryByRole("group", { name })) {
    openFolds();
  }

  return screen.getByRole("group", { name });
}

/**
 * A group's one control: the situation its cells are in.
 *
 * Its own word is its name, and the group it belongs to is its description,
 * so four of them on a page are told apart by the group rather than by the
 * word they happen to be showing.
 */
function presetButton(group: string) {
  return screen.getByRole("button", {
    description: `presetAriaLabel ${group}`,
  });
}

/** The situations that group offers, once its menu is open. */
async function openPresets(group: string) {
  const user = userEvent.setup();
  await user.click(presetButton(group));

  return screen.findByRole("menu");
}

/**
 * One situation in an open menu.
 *
 * Named by its own word, which is followed by the sentence under it and by
 * the kinds it stops, so the match is anchored to where the name ends.
 */
function presetItem(name: string) {
  return screen.getByRole("menuitemradio", { name: new RegExp(`^${name} `) });
}

async function pickPreset(group: string, name: string) {
  const user = userEvent.setup();
  await openPresets(group);
  await user.click(presetItem(name));
}

/** The way into the rows, under the situations rather than among them. */
function customItem() {
  return screen.getByRole("menuitem", { name: /^presetCustom / });
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
  if (!screen.queryByRole("group", { name: "newsDeliveryAriaLabel" })) {
    openFolds();
  }

  return screen.getByRole("group", { name: "newsDeliveryAriaLabel" });
}

/** The account switch on a row of its own, when no kind row carries it. */
function fallbackEmailCell() {
  const name = "channelEmailLabel";

  if (!screen.queryByRole("button", { name })) {
    openFolds();
  }

  return screen.getByRole("button", { name });
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

/**
 * The row's own trigger, which is the one thing that reports whether the group
 * stands open. Read it before reaching for a cell: the cell accessors open
 * every folded row to find one.
 */
function groupTrigger(group: string) {
  return screen.getByRole("button", { name: new RegExp(`^${group}`) });
}

/** The expanded panel owned by one row. */
function fold(group: string) {
  const row = groupTrigger(group).closest('[data-slot="collapsible"]');

  if (!(row instanceof HTMLElement)) {
    throw new Error(`No fold found for ${group}`);
  }

  return row;
}

async function openGroup(group: string) {
  const user = userEvent.setup();
  await user.click(groupTrigger(group));
}

describe("NotificationKinds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAccountEnabled = true;
    isDeviceEnabled = true;
    isDeviceKnown = true;
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

  it("marks where each kind arrives, and says what each group is set to", () => {
    renderKinds();

    // Read before any cell: the groups answer while every row is still folded,
    // and the cell accessors open the rows to reach a cell.
    expect(groupTrigger("groupChat")).toHaveAttribute("aria-expanded", "false");
    expect(presetButton("groupTask")).toHaveTextContent("presetMost");
    expect(presetButton("groupChat")).toHaveTextContent("presetEssential");
    // The jobs waiting on the reader push, the finished ones stay in the app,
    // and what a job merely reports is off. No situation writes that, so the
    // group says the reader set it by hand.
    expect(presetButton("groupJob")).toHaveTextContent("presetCustom");

    expect(cellFor("kindSystem", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(cellFor("kindSystem", "channelPush")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  /**
   * The promise the whole redesign rests on: the word on the button is true of
   * the rows under it. One cell off the situation, and the button says so.
   */
  it("leaves the situation for Custom when a single cell is set by hand", async () => {
    renderKinds();

    expect(presetButton("groupChat")).toHaveTextContent("presetEssential");

    await toggle("kindChatMention", "channelPush");

    await waitFor(() => {
      expect(presetButton("groupChat")).toHaveTextContent("presetCustom");
    });
  });

  it("offers a group the situations it can be in", async () => {
    renderKinds();

    const menu = await openPresets("groupJob");

    // The same elements in the same order, loudest first: the list reads down
    // from the device to Sokosumi to nothing.
    expect(within(menu).getAllByRole("menuitemradio")).toEqual([
      presetItem("presetMost"),
      presetItem("presetEssential"),
      presetItem("presetAppOnly"),
      presetItem("presetOff"),
    ]);
  });

  /**
   * What Core answers for an account that has stored nothing: every row on in
   * Sokosumi except the rooms, and no row on the device. It is written out
   * here rather than imported, because the point is that the two agree.
   *
   * Every group has to open on a word. A default that matched no situation
   * would tell a reader who has touched nothing that they set their
   * notifications by hand.
   */
  it("opens every group on a situation for an account that stored nothing", () => {
    renderKinds(
      MATRIX.map((cell) => ({
        ...cell,
        enabled:
          cell.channel === "IN_APP" && cell.category !== "CHAT_ROOM_MESSAGE",
      })),
    );

    expect(presetButton("groupJob")).toHaveTextContent("presetAppOnly");
    expect(presetButton("groupTask")).toHaveTextContent("presetAppOnly");
    expect(presetButton("groupChat")).toHaveTextContent("presetAppOnly");
  });

  /**
   * Every situation is written as the whole group. Missing a kind, its
   * sentence names a row that is not on screen, and two of them can come to
   * write the same cells, so the answer would show a word nobody picked.
   */
  it("offers no situation for a group Core answered in part", () => {
    renderKinds(MATRIX.filter((cell) => cell.category !== "CHAT_ROOM_MESSAGE"));

    expect(
      screen.queryByRole("button", {
        description: "presetAriaLabel groupChat",
      }),
    ).toBeNull();
    // The rows still answer for themselves, one kind at a time.
    expect(cellFor("kindChatMention", "channelPush")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /** One press of one situation writes every kind of the group. */
  it("writes the whole group from one situation", async () => {
    renderKinds();

    await pickPreset("groupChat", "presetOff");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(6);
    expect(written("CHAT_MENTION", "IN_APP")).toBe(false);
    expect(presetButton("groupChat")).toHaveTextContent("presetOff");
  });

  /**
   * A control the browser disables drops out of the tab order under the
   * reader's finger. The answer stays reachable, says it is busy, and refuses
   * the second press until the first write lands.
   */
  it("keeps the answer reachable while a write is in flight", async () => {
    const user = userEvent.setup();
    patchMyPreferences.mockReturnValue(new Promise(() => {}));
    renderKinds();

    await pickPreset("groupChat", "presetOff");

    const answer = presetButton("groupChat");
    await waitFor(() => {
      expect(answer).toHaveAttribute("aria-disabled", "true");
    });
    expect(answer).toBeEnabled();

    await user.click(answer);
    await user.click(presetItem("presetMost"));
    expect(patchMyPreferences).toHaveBeenCalledTimes(1);
  });

  /**
   * Custom is not one of the situations, so it sits under them. It writes
   * nothing: it opens the rows, which is where that state is set.
   */
  it("opens the group from Custom, and writes nothing", async () => {
    const user = userEvent.setup();
    renderKinds();

    expect(groupTrigger("groupChat")).toHaveAttribute("aria-expanded", "false");

    await openPresets("groupChat");
    await user.click(customItem());

    expect(groupTrigger("groupChat")).toHaveAttribute("aria-expanded", "true");
    expect(patchMyPreferences).not.toHaveBeenCalled();
  });

  /**
   * A name says how much arrives and how loudly, and the sentence under it
   * says what that means. Which kinds are "the ones that matter" is the one
   * thing neither can say, and it is different in every group, so the ones a
   * situation stops are named under it.
   */
  it("explains every situation it offers, and names the kinds it stops", async () => {
    renderKinds();

    await openPresets("groupJob");

    expect(presetItem("presetMost")).toHaveTextContent("presetJobMostHint");
    // Which kinds this group sends to the device, named here rather than left
    // to a sentence every group shares.
    expect(presetItem("presetMost")).toHaveTextContent(
      "channelPush: kindJobAttention, kindJobCompleted",
    );
    // It stops none of them, so it names none.
    expect(presetItem("presetMost")).not.toHaveTextContent("presetStopsLabel");
    expect(presetItem("presetEssential")).toHaveTextContent(
      "presetJobEssentialHint",
    );
    expect(presetItem("presetEssential")).toHaveTextContent(
      "channelPush: kindJobAttention",
    );
    // It pushes none of them, and its own word says where they land instead.
    expect(presetItem("presetAppOnly")).not.toHaveTextContent("channelPush:");
    // Off stops all three, and its own word says so.
    expect(presetItem("presetOff")).not.toHaveTextContent("presetStopsLabel");
  });

  /**
   * A situation says how much arrives and how loudly, and one press writes
   * both. A reader who asks for all of their tasks in Sokosumi gets the row
   * that was off as well, and no device starts buzzing.
   */
  it("writes where the kinds arrive as well as which of them do", async () => {
    renderKinds();

    await pickPreset("groupTask", "presetAppOnly");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(written("TASK_UPDATE", "IN_APP")).toBe(true);
    expect(written("TASK_UPDATE", "OS_BANNER")).toBe(false);
    expect(written("TASK_ATTENTION", "IN_APP")).toBe(true);
    expect(written("TASK_ATTENTION", "OS_BANNER")).toBe(false);
  });

  /**
   * Custom reports a state rather than offering one, so it is the fold's own
   * trigger. Pressing it shows the kinds the reader set one by one, which is
   * the only place that state can be read or changed.
   */
  it("opens the group from the Custom item", async () => {
    const user = userEvent.setup();
    // The one job kind that waits on the reader is off and the other is on,
    // which is no situation the presets write.
    renderKinds(
      MATRIX.map((cell) =>
        cell.category === "JOB_ATTENTION" ? { ...cell, enabled: false } : cell,
      ),
    );

    expect(presetButton("groupJob")).toHaveTextContent("presetCustom");
    expect(groupTrigger("groupJob")).toHaveAttribute("aria-expanded", "false");

    await openPresets("groupJob");
    await user.click(customItem());

    expect(groupTrigger("groupJob")).toHaveAttribute("aria-expanded", "true");
    expect(cellFor("kindJobCompleted", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /**
   * It opens the rows rather than toggling them. A reader who picked it from
   * a menu asked to see the group, and a second press that closed it again
   * would be the word doing the opposite of what it says.
   */
  it("leaves the group open when Custom is picked twice", async () => {
    const user = userEvent.setup();
    renderKinds();

    await openPresets("groupChat");
    await user.click(customItem());
    await openPresets("groupChat");
    await user.click(customItem());

    expect(groupTrigger("groupChat")).toHaveAttribute("aria-expanded", "true");
  });

  /**
   * A group of one is drawn as its kind, with its channels. Its presets would
   * be those same channels under other names.
   */
  /**
   * It is the way into the kinds, not only a report on them. A group that
   * sits on an answer still offers it, so a reader who wants one kind
   * different does not have to find the chevron to say so.
   */
  it("offers the way in from a group that is on a situation", async () => {
    const user = userEvent.setup();
    renderKinds();

    expect(presetButton("groupChat")).toHaveTextContent("presetEssential");
    expect(groupTrigger("groupChat")).toHaveAttribute("aria-expanded", "false");

    await openPresets("groupChat");
    await user.click(customItem());

    expect(groupTrigger("groupChat")).toHaveAttribute("aria-expanded", "true");
    expect(cellFor("kindChatMention", "channelInApp")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("leaves a single kind with its channel cells", () => {
    renderKinds();

    expect(
      screen.queryByRole("toolbar", { name: "presetAriaLabel kindSystem" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        description: "presetAriaLabel kindSystem",
      }),
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
  it("carries the account's job emails on every job row", async () => {
    const user = userEvent.setup();
    renderKinds();

    await openGroup("groupJob");

    expect(emailCell("kindJobAttention")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(emailCell("kindJobCompleted")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(emailCell("kindJobUpdate")).toHaveAttribute("aria-pressed", "true");
    // One value behind three rows is the thing a reader cannot see, and the
    // Email head over the column is where the card says it, once.
    expect(describedBy(emailCell("kindJobUpdate"))).toBeUndefined();
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
  /**
   * An opened group is where the reader reads what each kind is. The cells
   * name their kind to a screen reader either way, so nothing else here would
   * notice a grid that lost every visible name and hint.
   */
  it("names every kind of an opened group, and says what it is", async () => {
    renderKinds();

    await openGroup("groupJob");

    for (const kind of ["kindJobAttention", "kindJobUpdate"]) {
      expect(screen.getByText(kind)).toBeInTheDocument();
      expect(screen.getByText(`${kind}Hint`)).toBeInTheDocument();
    }
  });

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
   * The head and the cells under it are two right-aligned lines, so they line
   * up only while both hold the same width. Left to their own widths, the
   * words sat wherever they ended and named no column at all.
   *
   * The width itself is not the invariant. That the head and its column agree
   * on one is.
   */
  it("gives a column name the width of the cells it names", async () => {
    renderKinds();
    await openGroup("groupJob");

    const width = (element: Element | null | undefined) =>
      [...(element?.classList ?? [])].find((name) => name.startsWith("w-"));

    for (const [channel, kind] of [
      ["channelInApp", "kindJobAttention"],
      ["channelPush", "kindJobAttention"],
    ]) {
      const head = within(fold("groupJob")).getByRole("button", {
        name: channel,
      });
      const track = cellFor(kind, channel).parentElement;

      expect(width(head)).toBeDefined();
      expect(width(track)).toBe(width(head));
    }
  });

  it("puts the channel legend inside each expanded section", async () => {
    renderKinds();

    expect(
      screen.queryByRole("group", { name: "channelsLegendLabel" }),
    ).toBeNull();

    for (const group of ["groupJob", "groupTask", "groupChat"]) {
      await openGroup(group);
      expect(
        within(fold(group)).getByRole("group", {
          name: "channelsLegendLabel",
        }),
      ).toBeInTheDocument();
    }
  });

  /**
   * Sokosumi mails job status and nothing else. The cell stays where the eye
   * expects it and loses the press, so the column has no hole in it and the
   * row still says what email would mean here.
   */
  /**
   * Every cell names its own channel, so a column's name is said once, by the
   * control that explains it. Read out again as loose text, the group would
   * say "In app" before the reader reached a control. The same holds for the
   * sentence a dead cell is described by: in the tree as well, it is read
   * twice.
   */
  it("names each column once and keeps the dead hints out of the tree", async () => {
    isBlocked = true;
    renderKinds();

    await openGroup("groupJob");

    // Every column, not just the first: a head that went missing entirely
    // would leave the eye a nameless column and read as nothing at all.
    for (const channel of ["channelInApp", "channelPush", "channelEmail"]) {
      const heads = screen.getAllByText(channel);

      expect(heads).toHaveLength(1);
      expect(heads[0]?.tagName).toBe("BUTTON");
    }

    // Both kinds of hidden sentence: the one a dead cell is described by, and
    // the one a blocked push cell carries. In the tree as well, each is read
    // twice, once as text and once as the description.
    const described = [
      within(newsRow()).getByRole("button", {
        name: "channelUnavailableLabel channelInApp marketingEmailsTitle",
      }),
      cellFor("kindSystem", "channelPush"),
    ];

    for (const cell of described) {
      const hintId = cell.getAttribute("aria-describedby");

      expect(hintId).not.toBeNull();
      expect(document.getElementById(hintId ?? "")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
  });

  /**
   * Every cell is a button inside a card that may one day sit in a form. Left
   * to the default, each one is a submit button: a press would send the form
   * rather than write the preference, and the page would navigate away.
   */
  it("presses without submitting anything", async () => {
    renderKinds();

    await openGroup("groupJob");

    const cells = screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("size-9"));

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell).toHaveAttribute("type", "button");
    }
  });

  /**
   * A description that names an element nobody rendered is read as nothing,
   * and the cell that carries it is the one cell of its row a reader meets
   * with no explanation. Radix writes one of these on every tooltip trigger
   * the moment it opens, whether or not the tooltip has any content, so this
   * walks the card with every cell open as well as at rest.
   */
  it("describes only the cells that need more than their name", async () => {
    isBlocked = true;
    renderKinds();

    openFolds();

    const cells = screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("size-9"));

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const id = cell.getAttribute("aria-describedby");

      // A description that points at nothing is worse than none: a reader is
      // told there is more and then hears silence.
      if (id) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    }

    // The two that need one: the column nothing can arrive on in this
    // browser, and the columns a row never uses at all.
    expect(describedBy(cellFor("kindSystem", "channelPush"))).toContain(
      "pushBlockedHint",
    );
    expect(
      describedBy(
        within(newsRow()).getByRole("button", {
          name: "channelUnavailableLabel channelInApp marketingEmailsTitle",
        }),
      ),
    ).toBe("marketingEmailOnlyHint");
  });

  /**
   * The push column's reason belongs to the push cell. Given to the row, the
   * In-app cell would tell a reader their browser is blocked from showing
   * banners, about a channel that never leaves the page.
   */
  it("keeps the push reason off the cells beside it", async () => {
    isBlocked = true;
    renderKinds();

    expect(describedBy(cellFor("kindSystem", "channelPush"))).toBe(
      "channelPushHint pushBlockedHint pushOtherDevicesHint",
    );
    expect(describedBy(cellFor("kindSystem", "channelInApp"))).toBeUndefined();
  });

  /**
   * A polite region is how the sentence reaches a reader who cannot see the
   * row. Silenced, every announcement test here still passes on the text in
   * the DOM, and no reader ever hears it.
   */
  it("speaks its sentences politely", async () => {
    renderKinds();

    await openGroup("groupJob");

    const regions = screen.getAllByRole("status");

    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region).toHaveAttribute("aria-live", "polite");
    }
  });

  /**
   * The cells stay in the tree while a write is in flight, and say they are
   * busy. Dimming is the same answer for the eye, and the card's own comment
   * promises it.
   */
  it("dims a cell whose write is in flight", async () => {
    patchMyPreferences.mockReturnValue(new Promise(() => {}));
    renderKinds();

    await toggle("kindSystem", "channelInApp");

    await waitFor(() => {
      expect(cellFor("kindSystem", "channelInApp").className).toContain(
        "opacity-50",
      );
    });
  });

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

    // Chat's three kinds and the access request sit in two different folds.
    openFolds();

    expect(
      screen
        .getAllByRole("button", { name: /^channelEmailSoonLabel/ })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "channelEmailSoonLabel kindTaskAttention",
      "channelEmailSoonLabel kindTaskCompleted",
      "channelEmailSoonLabel kindTaskUpdate",
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
    // The quiet row comes back on its own while the loud one keeps its push,
    // which is the split this vocabulary exists for.
    expect(lastWrite()).toHaveLength(2);
    expect(written("JOB_UPDATE", "IN_APP")).toBe(true);
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
   * The point of the split rows: one press pushes what is addressed to the
   * reader and stops the traffic of a room they happen to be in.
   */
  it("keeps what is essential and stops the rest, in one request", async () => {
    renderKinds();

    await pickPreset("groupChat", "presetEssential");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(6);
    expect(written("CHAT_MENTION", "OS_BANNER")).toBe(true);
    expect(written("CHAT_ROOM_MESSAGE", "IN_APP")).toBe(false);
    expect(written("CHAT_ROOM_MESSAGE", "OS_BANNER")).toBe(false);
  });

  /**
   * Why the row was split off. A finished task is the result the reader
   * started it for, so it counts as one that matters and stays while the
   * cancellations go quiet.
   */
  it("keeps a finished task in the app when the tasks group quiets down", async () => {
    renderKinds();

    await pickPreset("groupTask", "presetEssential");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(written("TASK_ATTENTION", "OS_BANNER")).toBe(true);
    expect(written("TASK_COMPLETED", "IN_APP")).toBe(true);
    expect(written("TASK_COMPLETED", "OS_BANNER")).toBe(false);
    expect(written("TASK_UPDATE", "OS_BANNER")).toBe(false);
  });

  /** The same split, on the kind that also carries the email switch. */
  it("keeps a finished job in the app when the jobs group quiets down", async () => {
    renderKinds();

    await pickPreset("groupJob", "presetEssential");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(written("JOB_ATTENTION", "OS_BANNER")).toBe(true);
    expect(written("JOB_COMPLETED", "IN_APP")).toBe(true);
    expect(written("JOB_COMPLETED", "OS_BANNER")).toBe(false);
    expect(written("JOB_UPDATE", "OS_BANNER")).toBe(false);
  });

  it("draws the finished jobs as their own row", async () => {
    renderKinds();

    await openGroup("groupJob");

    expect(
      screen
        .getAllByRole("group", { name: /^deliveryAriaLabel kindJob/ })
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual([
      "deliveryAriaLabel kindJobAttention",
      "deliveryAriaLabel kindJobCompleted",
      "deliveryAriaLabel kindJobUpdate",
    ]);
  });

  /** Between the row that waits on the reader and everything else. */
  it("draws the finished tasks as their own row", async () => {
    renderKinds();

    await openGroup("groupTask");

    expect(
      screen
        .getAllByRole("group", { name: /^deliveryAriaLabel kindTask/ })
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual([
      "deliveryAriaLabel kindTaskAttention",
      "deliveryAriaLabel kindTaskCompleted",
      "deliveryAriaLabel kindTaskUpdate",
    ]);
  });

  it("writes the finished row alone when its push is pressed", async () => {
    renderKinds();

    await openGroup("groupTask");
    await toggle("kindTaskCompleted", "channelPush");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(2);
    expect(written("TASK_COMPLETED", "OS_BANNER")).toBe(false);
    // The entry stays: dropping the push is not the same as silencing the row.
    expect(written("TASK_COMPLETED", "IN_APP")).toBe(true);
  });

  /**
   * Every message in a room is the one kind that starts off, and one stop
   * turns it on. It lands in Sokosumi and nowhere else, which is the wish the
   * old ladder could not write: it took six cells by hand, because the only
   * stop that dropped the push also dropped the rows nobody waits on.
   */
  it("turns on a kind that was arriving nowhere, where the situation says", async () => {
    renderKinds();

    await pickPreset("groupChat", "presetMost");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(written("CHAT_ROOM_MESSAGE", "IN_APP")).toBe(true);
    expect(written("CHAT_ROOM_MESSAGE", "OS_BANNER")).toBe(false);
    expect(written("CHAT_MENTION", "IN_APP")).toBe(true);
    expect(written("CHAT_MENTION", "OS_BANNER")).toBe(true);
  });

  /**
   * The quiet end of the chat rail leaves the rooms where Core leaves them.
   * An account that has stored nothing is on this word, so a stop that turned
   * every room on would be the reader's first press adding notifications.
   */
  it("leaves the rooms off where the chat situation is the quiet one", async () => {
    renderKinds();

    await pickPreset("groupChat", "presetAppOnly");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(written("CHAT_ROOM_MESSAGE", "IN_APP")).toBe(false);
    expect(written("CHAT_MENTION", "IN_APP")).toBe(true);
    expect(written("CHAT_MENTION", "OS_BANNER")).toBe(false);
  });

  /**
   * A group the reader has silenced holds no channel at all, and asking for
   * it back has to land somewhere. The situation says where, so the group
   * comes back exactly as loud as the word the reader pressed.
   */
  it("turns a silenced group back on where the situation says", async () => {
    renderKinds();

    await pickPreset("groupChat", "presetOff");
    await waitFor(() => {
      expect(presetButton("groupChat")).toHaveTextContent("presetOff");
    });

    await pickPreset("groupChat", "presetMost");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(2);
    });
    expect(written("CHAT_MENTION", "IN_APP")).toBe(true);
    expect(written("CHAT_MENTION", "OS_BANNER")).toBe(true);
    expect(written("CHAT_ROOM_MESSAGE", "IN_APP")).toBe(true);
    // Everything is every message in the room, in Sokosumi. No situation puts
    // a room on the device.
    expect(written("CHAT_ROOM_MESSAGE", "OS_BANNER")).toBe(false);
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

    await pickPreset("groupChat", "presetEssential");

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
    expect(describedBy(cell)).toBe(
      "channelPushHint pushUnsupported pushOtherDevicesHint",
    );

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(written("SYSTEM", "OS_BANNER")).toBe(true);
    });
  });

  /**
   * The tooltip is where a cell says what its column means, and the trigger
   * writes its own `aria-describedby` to point at it. A cell that set that
   * attribute itself, to anything at all, would take the sentence away from
   * every reader who cannot see the tooltip open.
   */
  it("leaves an ordinary cell to its name, and explains the column in its section", async () => {
    const user = userEvent.setup();
    renderKinds();

    // Every cell carrying the same sentence would repeat it down the section.
    // The head over this section's column says it once.
    expect(cellFor("kindSystem", "channelInApp")).not.toHaveAttribute(
      "aria-describedby",
    );

    await user.click(
      within(fold("kindSystem")).getByRole("button", {
        name: "channelInApp",
      }),
    );

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "channelInAppHint",
    );
  });

  /**
   * Two different states, and the reader can act on one of them: a block is
   * their own setting and reversible, and no browser support is not. Blocked
   * is reported as blocked, and a browser that cannot push at all is told that
   * first, because it can be both.
   */
  it("says which of the two the browser is", async () => {
    const user = userEvent.setup();
    isBlocked = true;
    renderKinds();

    const cell = cellFor("kindSystem", "channelPush");

    expect(describedBy(cell)).toBe(
      "channelPushHint pushBlockedHint pushOtherDevicesHint",
    );

    // The same words a sighted reader gets, from this section's column head
    // rather than from every cell in the blocked column.
    await user.click(
      within(fold("kindSystem")).getByRole("button", {
        name: "channelPush",
      }),
    );

    const explained = await screen.findByRole("dialog");

    expect(explained).toHaveTextContent("channelPushHint");
    expect(explained).toHaveTextContent("pushBlockedHint");
    expect(explained).toHaveTextContent("pushOtherDevicesHint");
  });

  it("says the browser cannot push before it says it is blocked", () => {
    isSupported = false;
    isBlocked = true;
    renderKinds();

    expect(describedBy(cellFor("kindSystem", "channelPush"))).toBe(
      "channelPushHint pushUnsupported pushOtherDevicesHint",
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
   * Consent stands, the cell is on, and this browser was dropped from push
   * behind the reader's back. Left saying what a push is for, the cell would
   * promise one that never arrives, and the reader would have no reason to
   * press the one thing that fixes it.
   */
  it("says when this browser holds no push subscription", () => {
    isDeviceEnabled = false;
    renderKinds();

    expect(describedBy(cellFor("kindSystem", "channelPush"))).toBe(
      "channelPushHint pushUnsubscribedHint pushOtherDevicesHint",
    );
  });

  /**
   * A browser the reader blocked cannot hold a subscription either, and it has
   * its own words: the block is the thing they can act on.
   */
  it("says a browser is blocked before it says it is missing", () => {
    isBlocked = true;
    isDeviceEnabled = false;
    renderKinds();

    expect(describedBy(cellFor("kindSystem", "channelPush"))).toBe(
      "channelPushHint pushBlockedHint pushOtherDevicesHint",
    );
  });

  /**
   * The subscription read needs `window` as well, so it lands after the first
   * paint and every browser reports none until it does. Reported as an answer,
   * a subscribed browser would be told it is missing from push on every load.
   */
  it("says nothing about the subscription until the browser answers", () => {
    isDeviceEnabled = false;
    isDeviceKnown = false;
    renderKinds();

    expect(cellFor("kindSystem", "channelPush")).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  /** Consent withdrawn silences every device, which is the louder answer. */
  it("says nothing about the subscription while consent is off", () => {
    isAccountEnabled = false;
    isDeviceEnabled = false;
    renderKinds();

    expect(cellFor("kindSystem", "channelPush")).not.toHaveAttribute(
      "aria-describedby",
    );
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
    // The write the first press starts, reported the way the hook reports it:
    // busy from the press, and never settling.
    setAccountEnabled.mockImplementation(() => {
      isSaving = true;
      return new Promise(() => {});
    });
    renderKinds();

    // Two kinds whose push is stored off, so each press is a kind asking for
    // one. A press that turned a push off would ask for nothing and prove
    // nothing.
    await openGroup("groupJob");
    await toggle("kindJobUpdate", "channelPush");

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledTimes(1);
    });

    await toggle("kindSystem", "channelPush");

    expect(setAccountEnabled).toHaveBeenCalledTimes(1);
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
   * Consent and the cells both gate a push, and nothing else on this page
   * takes the consent back. Left standing over an empty banner column, it says
   * push is welcome on an account that sends none, until the reader signs out.
   */
  it("releases the consent when the last banner goes off", async () => {
    renderKinds(
      MATRIX.map((cell) =>
        cell.channel === "OS_BANNER"
          ? { ...cell, enabled: cell.category === "SYSTEM" }
          : cell,
      ),
    );

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledWith(false);
    });
  });

  /** Every other kind that still pushes needs the consent this one held. */
  it("keeps the consent while another kind still pushes", async () => {
    renderKinds(
      MATRIX.map((cell) =>
        cell.channel === "OS_BANNER"
          ? {
              ...cell,
              enabled:
                cell.category === "SYSTEM" || cell.category === "CHAT_MENTION",
            }
          : cell,
      ),
    );

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(setAccountEnabled).not.toHaveBeenCalled();
  });

  /**
   * The stop the reader pressed has to still read as pressed once Core answers.
   * A stop that wrote cells it does not itself describe would settle back onto
   * another one, which is the reader's press being undone in front of them.
   */
  it("stays on the stop the reader picked once the write lands", async () => {
    renderKinds();

    await pickPreset("groupChat", "presetOff");

    await waitFor(() => {
      expect(presetButton("groupChat")).toHaveTextContent("presetOff");
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

    await pickPreset("groupChat", "presetMost");

    await waitFor(() => {
      expect(presetButton("groupChat")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    await pickPreset("groupChat", "presetOff");
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

    await pickPreset("groupChat", "presetMost");

    const answer = presetButton("groupChat");
    await waitFor(() => {
      expect(answer).toHaveAttribute("aria-disabled", "true");
    });
    expect(answer).toBeEnabled();

    await pickPreset("groupChat", "presetOff");
    expect(patchMyPreferences).toHaveBeenCalledTimes(1);
  });

  it("puts the group back on its answer when a group write fails", async () => {
    patchMyPreferences.mockRejectedValueOnce(new Error("nope"));
    renderKinds();

    await pickPreset("groupChat", "presetOff");

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    expect(presetButton("groupChat")).toHaveTextContent("presetEssential");
  });

  /**
   * The row speaks the moment its write stops being busy. A rollback that
   * lands later than that flag is a row that says the kind now arrives where
   * the write failed to put it, and then falls silent: the correction changes
   * the sentence to nothing, and a region that goes empty says nothing at all.
   */
  it("never speaks the channels a failed write did not store", async () => {
    patchMyPreferences.mockRejectedValueOnce(new Error("nope"));
    renderKinds();

    // Every sentence the region ever holds, not just the one it ends on: a
    // wrong sentence is spoken when it lands, and taking it down again does
    // not unsay it.
    const said: string[] = [];
    const row = stops("kindSystem");
    const observer = new MutationObserver(() => {
      said.push(spoken(row));
    });
    observer.observe(row, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    await toggle("kindSystem", "channelPush");

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(cellFor("kindSystem", "channelPush")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
    observer.disconnect();

    expect(said.filter(Boolean)).not.toContain(
      "channelsAnnounce kindSystem channelInApp, channelPush",
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
    expect(presetButton("groupJob")).toBeInTheDocument();
  });

  /**
   * One value behind both job rows, and only one voice for it. The write
   * raises a toast that names the account switch, so a sentence here as well
   * would announce one press twice, in two wordings, on a row the reader may
   * not have pressed. The channel cells raise no toast and still speak.
   */
  it("leaves the job email cells to the toast behind them", async () => {
    const user = userEvent.setup();
    renderKinds();

    await openGroup("groupJob");

    const pressed = stops("kindJobAttention");

    await user.click(emailCell("kindJobAttention"));
    act(finishEmailWrite);

    await waitFor(() => {
      expect(emailCell("kindJobAttention")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
    expect(spoken(pressed)).toBe("");
    expect(spoken(stops("kindJobUpdate"))).toBe("");
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
   * A failed write leaves the row where it started. The cell reads from the
   * account switch above it, so a cell that kept the press would be reporting
   * a setting the card knows it failed to store.
   */
  it("puts the email cell back when the write fails", async () => {
    const user = userEvent.setup();
    emailWriteFails = true;
    renderKinds();

    await openGroup("groupJob");
    await user.click(emailCell("kindJobAttention"));

    act(finishEmailWrite);

    await waitFor(() => {
      expect(emailCell("kindJobAttention")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
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
  /**
   * The session is only half of the wait. The preferences read is the other,
   * and a page that watched the session alone would draw the kinds from an
   * empty matrix: every cell off, then the stored answer a moment later.
   */
  it("waits for the preferences read as well as the session", () => {
    renderPending();

    expect(newsRow()).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: /^deliveryAriaLabel/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "channelEmailLabel" }),
    ).toBeNull();
  });

  it("waits for the read before drawing the kinds, and not before the news", () => {
    sessionPending = true;

    renderKinds();

    expect(newsRow()).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { description: /^presetAriaLabel/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("group", { name: /^deliveryAriaLabel/ }),
    ).toBeNull();
    // The job emails wait too: whether they need a row of their own is
    // something only the matrix can say.
    expect(
      screen.queryByRole("button", {
        name: "channelEmailLabel",
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
        name: "channelEmailLabel",
      }),
    ).toBeNull();

    await openGroup("groupJob");

    expect(emailCell("kindJobAttention")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "channelEmailLabel",
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
    expect(presetButton("groupChat")).toBeInTheDocument();

    const email = fallbackEmailCell();

    expect(email).toHaveAttribute("aria-pressed", "true");
    // Described by the row's own line, like the marketing cell under it.
    expect(describedBy(email)).toBe("channelEmailFallbackHint");
    // And a row of the same box. Outside it, this row draws unpadded and out
    // of column, directly below a marketing row that is neither.
    expect(newsRow().closest("div.divide-y")).toContainElement(email);

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
      screen.queryByRole("button", { description: /^presetAriaLabel/ }),
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
    // Described by the row's own visible line rather than by a copy of it.
    // Undescribed, this one live control would be the only cell of the row a
    // reader meets with nothing said about it, between two dead ones that
    // both carry a reason.
    expect(describedBy(email)).toBe("marketingEmailsDescription");

    await user.click(email);

    expect(setMarketing).toHaveBeenCalledWith(true);
  });

  /**
   * The write behind this row raises a toast that names the setting, so the
   * row says nothing of its own. Two voices for one press would report the
   * same change twice, in two wordings.
   */
  it("leaves the marketing row to the toast behind it", async () => {
    const user = userEvent.setup();
    renderKinds();

    const row = newsRow();

    await user.click(
      within(row).getByRole("button", {
        name: "marketingEmailsTitle",
      }),
    );

    await waitFor(() => {
      expect(setMarketing).toHaveBeenCalledWith(true);
    });
    expect(within(row).queryAllByRole("status")).toHaveLength(0);
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
    // The heading describes the groups. Left standing over a box holding one
    // row about marketing, it tells the reader to set groups that are not
    // there.
    expect(screen.queryByText("kindsTitle")).toBeNull();
  });
});
