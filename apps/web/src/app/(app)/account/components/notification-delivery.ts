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
   * Whether Sokosumi ever sends this kind by email.
   *
   * Only job status is mailed, and one account-wide switch gates it, so the
   * job kinds hold the same answer and move together. Nothing else has an
   * email behind it yet, and a row says so rather than offering a control that
   * would reach nothing.
   */
  email: boolean;
}

/**
 * How far one kind reaches under a preset.
 *
 * Three rungs rather than a set of channels, because a preset is a situation
 * rather than a row of switches: the kind is off, it is in Sokosumi, or it is
 * on the device as well. `REACH_CHANNELS` turns each into the cells it means.
 */
type Reach = "NONE" | "IN_APP" | "PUSH";

/**
 * One situation a group can be in, as the whole of its cells.
 *
 * One press, and the group is set: which of its notifications the reader gets,
 * and which of them reach the device. The two questions are one decision here,
 * because they are one decision in life. A reader watching a job run wants the
 * phone to say so; the same reader on a Monday wants the list in Sokosumi and
 * a quiet phone.
 *
 * Written per group rather than shared. What a reader wants from Jobs and what
 * they want from Chat are different shapes: a job update is traffic to be
 * turned down, and every message in a room is a thing to opt into. A shared
 * list would have to name both in one word, and did.
 *
 * A preset is picked from the rail only while the cells say exactly what it
 * writes, so the rail never claims a situation the reader is not in. Anything
 * else is Custom.
 */
export interface PresetSpec {
  id: Preset;
  /** What it does, in this group's own kinds. Written once per group. */
  hintKey: string;
  /**
   * Where each of the group's kinds lands.
   *
   * Keyed by category rather than listed beside the kinds, so the table can be
   * read a row at a time and a group whose kinds Core does not all return
   * still writes the right ones. A kind the preset does not name is left
   * exactly as it was: `notification-delivery.test` holds that every preset
   * names every kind of its group, so that is a bug rather than a silence.
   */
  reach: Partial<Record<NotificationCategory, Reach>>;
}

/**
 * The situations, by name.
 *
 * Three of them mean the same thing in every group, and the rail reads across
 * the card because of it: Essential is what is addressed to you, In app is all
 * of it with a quiet phone, and Off is none of it. The first stop is the one
 * that differs, because what a reader opts into differs.
 *
 * None of them touches email, which is one switch for the account rather than
 * a cell per kind. So the loudest of these is loud in Sokosumi and on the
 * device, and a reader who picks it is not signing up for a mailbox as well.
 */
export type Preset =
  | "RESULTS"
  | "EVERYTHING"
  | "ESSENTIAL"
  | "APP_ONLY"
  | "OFF";

/** A group whose kinds are set one by one. Reported on the group, never written. */
export type PresetState = Preset | "CUSTOM";

export const PRESET_LABEL_KEY: Record<PresetState, string> = {
  RESULTS: "presetResults",
  EVERYTHING: "presetEverything",
  ESSENTIAL: "presetEssential",
  APP_ONLY: "presetAppOnly",
  OFF: "presetOff",
  CUSTOM: "presetCustom",
};

export interface GroupSpec {
  id: string;
  labelKey: string;
  /** Says what the group holds while it is closed. Only groups that fold. */
  descriptionKey?: string;
  kinds: readonly KindSpec[];
  /** The situations this group offers, loudest first. Empty for a group of one. */
  presets: readonly PresetSpec[];
}

/**
 * The kinds, grouped by what a reader would decide about at once.
 *
 * A group of one is drawn as a plain row: folding a single kind away behind a
 * chevron hides it without shortening anything, and one kind is already its
 * own situation. The rest fold, because each holds something the reader keeps
 * next to something they would rather be rid of, and those are the ones they
 * want to set apart.
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
        email: true,
      },
      {
        category: "JOB_COMPLETED",
        labelKey: "kindJobCompleted",
        hintKey: "kindJobCompletedHint",
        email: true,
      },
      {
        category: "JOB_UPDATE",
        labelKey: "kindJobUpdate",
        hintKey: "kindJobUpdateHint",
        email: true,
      },
    ],
    // A job is work the reader started and is waiting on, so the loudest thing
    // worth offering is the answer arriving. What a job reports on the way
    // there asks nothing of them, and no stop here pushes it.
    presets: [
      {
        id: "RESULTS",
        hintKey: "presetJobResultsHint",
        reach: {
          JOB_ATTENTION: "PUSH",
          JOB_COMPLETED: "PUSH",
          JOB_UPDATE: "IN_APP",
        },
      },
      {
        id: "ESSENTIAL",
        hintKey: "presetJobEssentialHint",
        reach: {
          JOB_ATTENTION: "PUSH",
          JOB_COMPLETED: "IN_APP",
          JOB_UPDATE: "IN_APP",
        },
      },
      {
        id: "APP_ONLY",
        hintKey: "presetJobAppOnlyHint",
        reach: {
          JOB_ATTENTION: "IN_APP",
          JOB_COMPLETED: "IN_APP",
          JOB_UPDATE: "IN_APP",
        },
      },
      {
        id: "OFF",
        hintKey: "presetJobOffHint",
        reach: {
          JOB_ATTENTION: "NONE",
          JOB_COMPLETED: "NONE",
          JOB_UPDATE: "NONE",
        },
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
        email: false,
      },
      {
        category: "TASK_COMPLETED",
        labelKey: "kindTaskCompleted",
        hintKey: "kindTaskCompletedHint",
        email: false,
      },
      {
        category: "TASK_UPDATE",
        labelKey: "kindTaskUpdate",
        hintKey: "kindTaskUpdateHint",
        email: false,
      },
    ],
    // The same four as Jobs, and deliberately: a task is work of the same
    // shape, and a reader who has just answered this question one row above
    // should not have to read a different set of words to answer it again.
    presets: [
      {
        id: "RESULTS",
        hintKey: "presetTaskResultsHint",
        reach: {
          TASK_ATTENTION: "PUSH",
          TASK_COMPLETED: "PUSH",
          TASK_UPDATE: "IN_APP",
        },
      },
      {
        id: "ESSENTIAL",
        hintKey: "presetTaskEssentialHint",
        reach: {
          TASK_ATTENTION: "PUSH",
          TASK_COMPLETED: "IN_APP",
          TASK_UPDATE: "IN_APP",
        },
      },
      {
        id: "APP_ONLY",
        hintKey: "presetTaskAppOnlyHint",
        reach: {
          TASK_ATTENTION: "IN_APP",
          TASK_COMPLETED: "IN_APP",
          TASK_UPDATE: "IN_APP",
        },
      },
      {
        id: "OFF",
        hintKey: "presetTaskOffHint",
        reach: {
          TASK_ATTENTION: "NONE",
          TASK_COMPLETED: "NONE",
          TASK_UPDATE: "NONE",
        },
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
        email: false,
      },
      {
        category: "CHAT_MENTION",
        labelKey: "kindChatMention",
        hintKey: "kindChatMentionHint",
        email: false,
      },
      {
        category: "CHAT_DIRECT_MESSAGE",
        labelKey: "kindChatDirectMessage",
        hintKey: "kindChatDirectMessageHint",
        email: false,
      },
    ],
    // Chat is read where it is written, so these turn on the app rather than
    // the phone: every stop but Off keeps mentions and direct messages, and a
    // room is what the reader opts into. Core leaves the room row off until
    // they do, so only the first stop turns it on, and no stop puts a room on
    // the device, which is the one thing a busy room would be.
    presets: [
      {
        id: "EVERYTHING",
        hintKey: "presetChatEverythingHint",
        reach: {
          CHAT_ROOM_MESSAGE: "IN_APP",
          CHAT_MENTION: "PUSH",
          CHAT_DIRECT_MESSAGE: "PUSH",
        },
      },
      {
        id: "ESSENTIAL",
        hintKey: "presetChatEssentialHint",
        reach: {
          CHAT_ROOM_MESSAGE: "NONE",
          CHAT_MENTION: "PUSH",
          CHAT_DIRECT_MESSAGE: "PUSH",
        },
      },
      {
        id: "APP_ONLY",
        hintKey: "presetChatAppOnlyHint",
        reach: {
          CHAT_ROOM_MESSAGE: "NONE",
          CHAT_MENTION: "IN_APP",
          CHAT_DIRECT_MESSAGE: "IN_APP",
        },
      },
      {
        id: "OFF",
        hintKey: "presetChatOffHint",
        reach: {
          CHAT_ROOM_MESSAGE: "NONE",
          CHAT_MENTION: "NONE",
          CHAT_DIRECT_MESSAGE: "NONE",
        },
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
        email: false,
      },
    ],
    // A group of one is drawn as a plain row with its own cells. A rail over
    // it would offer four words for what two cells already say.
    presets: [],
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

/**
 * The channels a preset gives one kind, or nothing for a kind it does not name.
 *
 * A preset names every kind of its group, and a test holds that. Where one
 * does not, the kind is left exactly as the reader had it rather than being
 * silenced by a press that never mentioned it.
 */
function presetChannels(
  preset: PresetSpec,
  kind: KindSpec,
): StoredChannel[] | null {
  const reach = preset.reach[kind.category];

  return reach ? [...REACH_CHANNELS[reach]] : null;
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
  presets: readonly PresetSpec[],
  kinds: readonly KindSpec[],
): PresetState {
  return (
    presets.find((preset) =>
      kinds.every((kind) => {
        const channels = presetChannels(preset, kind);

        return (
          channels !== null &&
          sameChannels(categoryChannels(cells, kind.category), channels)
        );
      }),
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
 * rather than a filter over the one before it, which is what lets the rail say
 * which one the group is in: pick it, and the cells say exactly this.
 */
export function presetChanges(
  preset: PresetSpec,
  kinds: readonly KindSpec[],
): DeliveryChange[] {
  return kinds.flatMap((kind) => {
    const channels = presetChannels(preset, kind);

    return channels ? [{ category: kind.category, channels }] : [];
  });
}

/** The kinds a preset puts at one reach, in the order the group holds them. */
function presetKinds(
  preset: PresetSpec,
  kinds: readonly KindSpec[],
  reach: Reach,
): KindSpec[] {
  return kinds.filter((kind) => preset.reach[kind.category] === reach);
}

/**
 * The kinds a preset sends to the device, in the order the group holds them.
 *
 * "What is essential" is two named things in Jobs and two different ones in
 * Chat, and no sentence shared by every group can say which. The panel names
 * them under the word instead. A situation that pushes all of them says
 * nothing here, and neither does one that pushes none: its own word already
 * says so.
 */
export function presetPushes(
  preset: PresetSpec,
  kinds: readonly KindSpec[],
): KindSpec[] {
  const pushed = presetKinds(preset, kinds, "PUSH");

  return pushed.length === kinds.length ? [] : pushed;
}

/**
 * The kinds a preset stops entirely, in the order the group holds them.
 *
 * The panel names them under the word. A preset that keeps everything says
 * nothing here, and neither does one that stops everything: its own word
 * already says so, and a list of every kind in the group under it is noise.
 */
export function presetStops(
  preset: PresetSpec,
  kinds: readonly KindSpec[],
): KindSpec[] {
  const stopped = presetKinds(preset, kinds, "NONE");

  return stopped.length === kinds.length ? [] : stopped;
}
