import type { NotificationPreference } from "@/lib/clients/generated/core";

export type NotificationCategory = NotificationPreference["category"];

/** A channel the matrix stores a cell for, per kind. */
export type StoredChannel = NotificationPreference["channel"];

interface ChannelSpec {
  id: StoredChannel;
  labelKey: string;
  /** What picking it means, in the reader's terms. */
  hintKey: string;
}

/**
 * Where one kind of notification can arrive, and this page can set it.
 *
 * Each channel is its own choice rather than a step on a ladder, so the row
 * says where a kind reaches you rather than how loud it is. Nothing picked
 * means the kind does not arrive. The one pairing the row does not offer is a
 * push with no entry behind it: see `withChannel`.
 *
 * Email is drawn beside these and is not one of them: it is one switch for the
 * whole account rather than a cell per kind, and it does not exist for every
 * kind. See `KindSpec.email`.
 *
 * A channel Core adds later needs a cell here. Without one it is drawn
 * nowhere, and `cellsFor` still writes it `enabled: false` on every press from
 * this page, so the page would quietly turn off a channel it never showed.
 */
export const CHANNEL_SPECS: readonly ChannelSpec[] = [
  { id: "IN_APP", labelKey: "channelInApp", hintKey: "channelInAppHint" },
  { id: "OS_BANNER", labelKey: "channelPush", hintKey: "channelPushHint" },
];

/** The channels this page writes, in the order the row draws them. */
const STORED_CHANNELS: readonly StoredChannel[] = CHANNEL_SPECS.map(
  (spec) => spec.id,
);

/**
 * Why this browser cannot show a push, when it cannot.
 *
 * The cells keep the press. What they write is one preference for the account,
 * not one per browser, so this browser is still where the reader silences or
 * wakes the devices that can push. Only the words change: the cell says why
 * nothing will arrive here, and that the reader's other devices still hear it.
 *
 * The third one is the browser's own doing rather than a refusal: signing out
 * drops this browser's subscription, and clearing site data drops it without
 * asking anyone. The account consent stands through both, so the cells stay on
 * and this browser hears nothing until something subscribes it again.
 */
export type PushBlock = "unsupported" | "denied" | "unsubscribed";

/** Why nothing arrives here, in the reader's terms. */
export const PUSH_BLOCK_HINT_KEY: Record<PushBlock, string> = {
  unsupported: "pushUnsupported",
  denied: "pushBlockedHint",
  unsubscribed: "pushUnsubscribedHint",
};

export interface KindSpec {
  category: NotificationCategory;
  labelKey: string;
  /** What happens, in the reader's terms, under the name. */
  hintKey: string;
  /**
   * Whether this kind is one the reader is waiting for or one that waits on
   * them.
   *
   * Every preset reads it: the ones that ask something of the reader, and the
   * results they started the work for, are what a preset keeps loud or keeps
   * at all. A job that needs input asks; a finished job answers; a mention and
   * a direct message ask. Progress updates and the ordinary traffic of a room
   * do neither, and those are what a reader turns down first.
   *
   * It is a property of the kind rather than a list inside each preset, so a
   * kind added later answers the question once instead of six times.
   */
  important: boolean;
  /**
   * Whether Sokosumi ever sends this kind by email.
   *
   * Only job status is mailed, and one account-wide switch gates it, so the
   * job kinds hold the same answer and move together. Nothing else has an
   * email behind it yet, and a row says so rather than offering a control that
   * would reach nothing.
   */
  email: boolean;
}

export interface GroupSpec {
  id: string;
  labelKey: string;
  /** Says what the group holds while it is closed. Only groups that fold. */
  descriptionKey?: string;
  kinds: readonly KindSpec[];
}

/**
 * The kinds, grouped by what a reader would decide about at once.
 *
 * A group of one is drawn as a plain row: folding a single kind away behind a
 * chevron hides it without shortening anything. The rest fold, because each
 * holds something the reader keeps next to something they would rather be rid
 * of, and those are the ones they want to set apart.
 */
export const NOTIFICATION_GROUPS: readonly GroupSpec[] = [
  {
    id: "JOB",
    labelKey: "groupJob",
    descriptionKey: "groupJobDescription",
    kinds: [
      {
        category: "JOB_ATTENTION",
        labelKey: "kindJobAttention",
        hintKey: "kindJobAttentionHint",
        important: true,
        email: true,
      },
      {
        category: "JOB_COMPLETED",
        labelKey: "kindJobCompleted",
        hintKey: "kindJobCompletedHint",
        important: true,
        email: true,
      },
      {
        category: "JOB_UPDATE",
        labelKey: "kindJobUpdate",
        hintKey: "kindJobUpdateHint",
        important: false,
        email: true,
      },
    ],
  },
  {
    id: "TASK",
    labelKey: "groupTask",
    descriptionKey: "groupTaskDescription",
    kinds: [
      {
        category: "TASK_ATTENTION",
        labelKey: "kindTaskAttention",
        hintKey: "kindTaskAttentionHint",
        important: true,
        email: false,
      },
      {
        category: "TASK_COMPLETED",
        labelKey: "kindTaskCompleted",
        hintKey: "kindTaskCompletedHint",
        important: true,
        email: false,
      },
      {
        category: "TASK_UPDATE",
        labelKey: "kindTaskUpdate",
        hintKey: "kindTaskUpdateHint",
        important: false,
        email: false,
      },
    ],
  },
  {
    id: "CHAT",
    labelKey: "groupChat",
    descriptionKey: "groupChatDescription",
    kinds: [
      {
        category: "CHAT_ROOM_MESSAGE",
        labelKey: "kindChatRoomMessage",
        hintKey: "kindChatRoomMessageHint",
        important: false,
        email: false,
      },
      {
        category: "CHAT_MENTION",
        labelKey: "kindChatMention",
        hintKey: "kindChatMentionHint",
        important: true,
        email: false,
      },
      {
        category: "CHAT_DIRECT_MESSAGE",
        labelKey: "kindChatDirectMessage",
        hintKey: "kindChatDirectMessageHint",
        important: true,
        email: false,
      },
    ],
  },
  {
    id: "SYSTEM",
    labelKey: "kindSystem",
    kinds: [
      {
        category: "SYSTEM",
        labelKey: "kindSystem",
        hintKey: "kindSystemHint",
        important: true,
        email: false,
      },
    ],
  },
];

/** The channels one kind is currently set to arrive on. */
export function categoryChannels(
  cells: readonly NotificationPreference[],
  category: NotificationCategory,
): StoredChannel[] {
  return STORED_CHANNELS.filter((channel) =>
    cells.some(
      (cell) =>
        cell.category === category && cell.channel === channel && cell.enabled,
    ),
  );
}

/**
 * The same channels, however each side names them.
 *
 * The row reads it to tell its own write from someone else's.
 *
 * Asked one channel at a time rather than by comparing the two lists, so
 * neither the order nor a repeated entry can make two different sets look
 * alike. Every caller here builds its list from `STORED_CHANNELS` and so can
 * do neither, but this way that stays a fact about the callers rather than
 * something this function needs to be true.
 */
export function sameChannels(
  left: readonly StoredChannel[],
  right: readonly StoredChannel[],
): boolean {
  return STORED_CHANNELS.every(
    (channel) => left.includes(channel) === right.includes(channel),
  );
}

/**
 * One kind's channels with `channel` added or removed, in the row's order.
 *
 * A push carries the in-app entry with it, in both directions: turning the
 * push on turns the entry on, and turning the entry off turns the push off. A
 * push that leaves nothing behind is a notification the reader cannot find
 * again once the banner is gone, because the feed and the unread count both
 * read the in-app cell. So the row does not offer that pairing.
 *
 * The entry on its own stays available, which is the quiet answer: it does not
 * interrupt. Chat is the exception, and not one this page can fix: `CHAT` is a
 * browser-only kind, so it never reaches the feed whatever its in-app cell
 * says. The cells still write honestly; no hint here promises an entry that
 * waits.
 */
export function withChannel(
  channels: readonly StoredChannel[],
  channel: StoredChannel,
  on: boolean,
): StoredChannel[] {
  const next = new Set(channels);

  if (on) {
    next.add(channel);
  } else {
    next.delete(channel);
  }

  if (channel === "OS_BANNER" && on) {
    next.add("IN_APP");
  }

  if (channel === "IN_APP" && !on) {
    next.delete("OS_BANNER");
  }

  return STORED_CHANNELS.filter((candidate) => next.has(candidate));
}

/**
 * A situation the reader is in, as the whole of a group's cells.
 *
 * One press, and the group is set: how many of its notifications reach the
 * reader, and whether they push to the device. The two questions are one
 * decision here, because they are one decision in life. A reader who is
 * watching a job run wants the phone to say so; the same reader on a Monday
 * wants the list in Sokosumi and nothing on the phone.
 *
 * `key` is where the ones that need the reader land, and `rest` is where the
 * others do. `KindSpec.important` says which is which, so a kind added later
 * answers that once rather than in six places.
 *
 * A preset writes every cell of the group. It is picked from the list only
 * while the cells say exactly what it writes, so the row never claims a
 * situation the reader is not in. Anything else is Custom.
 */
type Reach = "NONE" | "IN_APP" | "PUSH";

interface PresetSpec {
  id: Preset;
  key: Reach;
  rest: Reach;
}

/**
 * The situations, loudest first.
 *
 * The pushing ones come first and the quiet ones after, so the list reads down
 * from the phone to Sokosumi to nothing. Inside each pair, the one that keeps
 * everything comes before the one that drops what does not need the reader.
 *
 * None of them touches email, which is one switch for the account rather than
 * a cell per kind. So the loudest of these is loud in Sokosumi and on the
 * device, and a reader who picks it is not signing up for a mailbox as well.
 */
const PRESET_SPECS = [
  { id: "ALL_PUSH", key: "PUSH", rest: "PUSH" },
  { id: "NEEDED_PUSH", key: "PUSH", rest: "IN_APP" },
  { id: "NEEDED_PUSH_ONLY", key: "PUSH", rest: "NONE" },
  { id: "ALL_QUIET", key: "IN_APP", rest: "IN_APP" },
  { id: "NEEDED_QUIET", key: "IN_APP", rest: "NONE" },
  { id: "NOTHING", key: "NONE", rest: "NONE" },
] as const;

/**
 * The name of one situation.
 *
 * Read off the list rather than written twice: a spec whose `key` or `rest` is
 * not a reach fails where `groupPresetSpecs` promises `PresetSpec[]`.
 */
export type Preset = (typeof PRESET_SPECS)[number]["id"];

/** A group whose kinds are set one by one. Reported on the group, never written. */
export type PresetState = Preset | "CUSTOM";

export const PRESET_LABEL_KEY: Record<PresetState, string> = {
  ALL_PUSH: "presetAllPush",
  NEEDED_PUSH: "presetNeededPush",
  NEEDED_PUSH_ONLY: "presetNeededPushOnly",
  ALL_QUIET: "presetAllQuiet",
  NEEDED_QUIET: "presetNeededQuiet",
  NOTHING: "presetNothing",
  CUSTOM: "presetCustom",
};

export const PRESET_HINT_KEY: Record<PresetState, string> = {
  ALL_PUSH: "presetAllPushHint",
  NEEDED_PUSH: "presetNeededPushHint",
  NEEDED_PUSH_ONLY: "presetNeededPushOnlyHint",
  ALL_QUIET: "presetAllQuietHint",
  NEEDED_QUIET: "presetNeededQuietHint",
  NOTHING: "presetNothingHint",
  CUSTOM: "presetCustomHint",
};

/** Where a preset sends one kind. */
function reach(preset: PresetSpec, kind: KindSpec): Reach {
  return kind.important ? preset.key : preset.rest;
}

/**
 * The cells one reach means.
 *
 * A push carries the in-app entry with it, the same pairing the cells hold
 * themselves: a push that leaves nothing behind is a notification the reader
 * cannot find again once the banner is gone.
 *
 * A channel Core adds later needs a place in each of these, the same way it
 * needs a cell in `CHANNEL_SPECS`. Without one, every press of a preset writes
 * it `enabled: false` for the whole group, and this page would quietly turn
 * off a channel it never showed.
 */
const REACH_CHANNELS: Record<Reach, readonly StoredChannel[]> = {
  NONE: [],
  IN_APP: ["IN_APP"],
  PUSH: ["IN_APP", "OS_BANNER"],
};

/** The channels a preset gives one kind. */
function presetChannels(preset: PresetSpec, kind: KindSpec): StoredChannel[] {
  return [...REACH_CHANNELS[reach(preset, kind)]];
}

/**
 * The situations worth offering for this group.
 *
 * Three of the six tell the kinds that need the reader from the ones that do
 * not, and a group holding only one sort cannot hear the difference: in a
 * group where everything matters, "only what matters" is every row of it, and
 * in a group where nothing does, it is none of them. Either way the words
 * would describe a group the reader is not looking at, and two stops would
 * write the same cells. So such a group is offered the three that speak about
 * all of it.
 */
function groupPresetSpecs(kinds: readonly KindSpec[]): PresetSpec[] {
  const both =
    kinds.some((kind) => kind.important) &&
    kinds.some((kind) => !kind.important);

  return PRESET_SPECS.filter((preset) => both || preset.key === preset.rest);
}

/** The situations worth offering for this group, in the order they are drawn. */
export function groupPresets(kinds: readonly KindSpec[]): Preset[] {
  return groupPresetSpecs(kinds).map((preset) => preset.id);
}

/**
 * The situation the stored cells are in, or that the reader set the kinds one
 * by one.
 *
 * Every cell has to match. A preset that only nearly fits would light up while
 * the group is doing something else, and the reader would read the word rather
 * than the rows and believe it.
 */
export function groupPreset(
  cells: readonly NotificationPreference[],
  kinds: readonly KindSpec[],
): PresetState {
  return (
    groupPresetSpecs(kinds).find((preset) =>
      kinds.every((kind) =>
        sameChannels(
          categoryChannels(cells, kind.category),
          presetChannels(preset, kind),
        ),
      ),
    )?.id ?? "CUSTOM"
  );
}

/** One category, and the channels the reader wants it on. */
export interface DeliveryChange {
  category: NotificationCategory;
  channels: readonly StoredChannel[];
}

/**
 * The cells a set of changes writes.
 *
 * A channel set per category rather than one for all of them, because a preset
 * sets the kinds of a group to different things and has to write them in one
 * request.
 */
export function cellsFor(
  cells: readonly NotificationPreference[],
  changes: readonly DeliveryChange[],
): NotificationPreference[] {
  return cells.flatMap((cell) => {
    const change = changes.find((one) => one.category === cell.category);

    return change
      ? [{ ...cell, enabled: change.channels.includes(cell.channel) }]
      : [];
  });
}

/**
 * The cells a preset writes: every kind of the group, wherever it puts them.
 *
 * The reader's own cells are not consulted. A preset is the whole situation
 * rather than a filter over the one before it, which is what lets the row say
 * which one the group is in: pick it, and the cells say exactly this.
 *
 * A name no spec claims writes nothing at all. It cannot arrive from the row,
 * which offers what `groupPresets` returned, and silencing a group would be a
 * strange thing to do about a name this file does not know.
 */
export function presetChanges(
  preset: Preset,
  kinds: readonly KindSpec[],
): DeliveryChange[] {
  const spec = PRESET_SPECS.find((candidate) => candidate.id === preset);

  if (!spec) {
    return [];
  }

  return kinds.map((kind) => ({
    category: kind.category,
    channels: presetChannels(spec, kind),
  }));
}

/**
 * The kinds a preset sends to the device, in the order the group holds them.
 *
 * "What matters" is two named things in Jobs and two different ones in Chat,
 * and no sentence shared by every group can say which. The row names them
 * under the answer instead. A situation that pushes all of them says nothing
 * here, and neither does one that pushes none: its own word already says so.
 */
export function presetPushes(
  preset: Preset,
  kinds: readonly KindSpec[],
): KindSpec[] {
  const changes = presetChanges(preset, kinds);
  const pushed = kinds.filter((kind) =>
    changes.some(
      (change) =>
        change.category === kind.category &&
        change.channels.includes("OS_BANNER"),
    ),
  );

  return pushed.length === kinds.length ? [] : pushed;
}

/**
 * The kinds a preset stops entirely, in the order the group holds them.
 *
 * The row names them under the answer. A preset that keeps everything says
 * nothing here, and neither does one that stops everything: its own word
 * already says so, and a list of every kind in the group under it is noise.
 */
export function presetStops(
  preset: Preset,
  kinds: readonly KindSpec[],
): KindSpec[] {
  const changes = presetChanges(preset, kinds);
  const stopped = kinds.filter((kind) =>
    changes.some(
      (change) =>
        change.category === kind.category && change.channels.length === 0,
    ),
  );

  return stopped.length === kinds.length ? [] : stopped;
}
