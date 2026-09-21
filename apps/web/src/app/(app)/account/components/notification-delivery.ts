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
 * Email is drawn beside these and is not one of them. A row that offers it
 * writes a cell of this matrix like any other, on the `EMAIL` channel. It does
 * not belong in a column every row draws, because some rows have no email
 * behind them at all. See `KindSpec.email`.
 *
 * A channel Core adds later needs a cell here. Without one it is drawn
 * nowhere, and `cellsFor` still writes it `enabled: false` on every press from
 * this page, so the page would quietly turn off a channel it never showed.
 */
export const CHANNEL_SPECS: readonly ChannelSpec[] = [
  { id: "IN_APP", labelKey: "channelInApp", hintKey: "channelInAppHint" },
  { id: "OS_BANNER", labelKey: "channelPush", hintKey: "channelPushHint" },
];

/**
 * The email cell, for the rows that write it into the matrix.
 *
 * The same shape as the specs above, because the cell is the same thing: a
 * channel of this category, written by the same press. It sits apart from them
 * only so that the rows with no email behind them do not draw it.
 */
export const EMAIL_CHANNEL_SPEC: ChannelSpec = {
  id: "EMAIL",
  labelKey: "channelEmail",
  hintKey: "channelEmailHint",
};

/**
 * The channels this page writes.
 *
 * Every channel the matrix stores, not only the two the grid draws icons for.
 * `EMAIL` is here and absent from `CHANNEL_SPECS` on purpose: not every row
 * writes it, so it gets no column, but every write from this page sends a
 * category's whole set of channels and a channel missing from this list would
 * be written `enabled: false` by any press on the row. Listing it is what
 * stops a press on In app silently switching a reader's emails off.
 *
 * The cost: a press on a row that mails nothing stores an `EMAIL` cell of its
 * own, set off. Core reads no email cell for those categories, so the row does
 * nothing. The alternative is a per-category write set, which is a second
 * place to hold the same fact in step.
 */
const STORED_CHANNELS: readonly StoredChannel[] = [
  "IN_APP",
  "OS_BANNER",
  "EMAIL",
];

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

/**
 * Where a row's email answer is kept: this matrix, or nowhere.
 *
 * Two rather than a boolean, so a cell knows whether it can be pressed at all.
 * A third value stood for the job rows, which wrote one account-wide switch.
 * SOK-930 took the job notifications away, and the switch with them.
 */
export type EmailControl = "CHANNEL" | "NONE";

export interface KindSpec {
  category: NotificationCategory;
  labelKey: string;
  /** What happens, in the reader's terms, under the name. */
  hintKey: string;
  /**
   * What this row's email cell writes, if anything.
   *
   * `CHANNEL` is a row Sokosumi mails: what is addressed to the reader, the
   * reminders about it (SOK-1090, SOK-916), and billing that waits on the
   * reader (SOK-932). Its email is a cell of the same matrix as In app and
   * Push, on the `EMAIL` channel, so it is the reader's answer for that row
   * alone and nothing else moves with it.
   *
   * `NONE` is every message in a room, the other task updates, and billing
   * news. Nothing mails them, and the row says so rather than offering a
   * control that would reach nothing. Stripe already writes those receipts
   * and cancellations. Core's `NOTIFICATION_EMAIL_CATEGORIES` is the list
   * this has to agree with: a row marked `CHANNEL` there and `NONE` here
   * hides a cell Core reads, and the other way round draws a cell Core
   * ignores.
   */
  email: EmailControl;
}

/**
 * How far one kind reaches under a preset.
 *
 * Three rungs rather than a set of channels, because a preset is a situation
 * rather than a row of switches: the kind is off, it is in Sokosumi, or it is
 * on the device as well. `REACH_CHANNELS` turns each into the cells it means.
 * Email is not a rung: see `PRESET_CHANNELS`.
 */
type Reach = "NONE" | "IN_APP" | "PUSH";

/**
 * One situation a group can be in, as the whole of its cells.
 *
 * One press, and the group is set: which of its notifications the reader gets,
 * and which of them reach the device. The two questions are one decision here,
 * because they are one decision in life. A reader waiting on a task wants the
 * phone to say when it moves; the same reader on a Monday wants the list in
 * Sokosumi and a quiet phone.
 *
 * Written per group rather than shared. What a reader wants from Tasks and what
 * they want from Chat are different shapes: a task update is traffic to be
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
 * All four mean the same thing in every group, and the answer reads the same
 * across the card because of it: Most is as much as the group offers, Essential
 * is what is addressed to you, In app is all of it with a quiet phone, and Off
 * is none of it. What Most reaches differs by group, because what a reader opts
 * into differs; the word does not, because the amount it means does not.
 *
 * None of them touches email. So the loudest of these is loud in Sokosumi and
 * on the device, and a reader who picks it is not signing up for a mailbox as
 * well; and Off quiets the app and the device while the inbox keeps what the
 * reader set for it. See `PRESET_CHANNELS`.
 */
export type Preset = "MOST" | "ESSENTIAL" | "APP_ONLY" | "OFF";

/** A group whose kinds are set one by one. Reported on the group, never written. */
export type PresetState = Preset | "CUSTOM";

export const PRESET_LABEL_KEY: Record<PresetState, string> = {
  MOST: "presetMost",
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
    id: "TASK",
    labelKey: "groupTask",
    descriptionKey: "groupTaskDescription",
    kinds: [
      {
        category: "TASK_ATTENTION",
        labelKey: "kindTaskAttention",
        hintKey: "kindTaskAttentionHint",
        email: "CHANNEL",
      },
      {
        category: "TASK_COMPLETED",
        labelKey: "kindTaskCompleted",
        hintKey: "kindTaskCompletedHint",
        email: "CHANNEL",
      },
      {
        category: "TASK_UPDATE",
        labelKey: "kindTaskUpdate",
        hintKey: "kindTaskUpdateHint",
        email: "CHANNEL",
      },
    ],
    // The same four ids every other group offers, and deliberately: a reader
    // who answers this question once should not have to read a different set
    // of words to answer it again further down the panel.
    presets: [
      {
        id: "MOST",
        hintKey: "presetTaskMostHint",
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
        email: "NONE",
      },
      {
        category: "CHAT_MENTION",
        labelKey: "kindChatMention",
        hintKey: "kindChatMentionHint",
        email: "CHANNEL",
      },
      {
        category: "CHAT_DIRECT_MESSAGE",
        labelKey: "kindChatDirectMessage",
        hintKey: "kindChatDirectMessageHint",
        email: "CHANNEL",
      },
    ],
    // Chat is read where it is written, so these turn on the app rather than
    // the phone: every stop but Off keeps mentions and direct messages, and a
    // room is what the reader opts into. Core leaves the room row off until
    // they do, so only the first stop turns it on, and no stop puts a room on
    // the device, which is the one thing a busy room would be.
    presets: [
      {
        id: "MOST",
        hintKey: "presetChatMostHint",
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
    id: "BILLING",
    labelKey: "groupBilling",
    descriptionKey: "groupBillingDescription",
    kinds: [
      {
        category: "BILLING_ATTENTION",
        labelKey: "kindBillingAttention",
        hintKey: "kindBillingAttentionHint",
        email: "CHANNEL",
      },
      {
        category: "BILLING_UPDATE",
        labelKey: "kindBillingUpdate",
        hintKey: "kindBillingUpdateHint",
        email: "NONE",
      },
    ],
    // The task ladder with one rung fewer: two rows, so Most and Essential
    // differ only in whether a top-up or a plan that ends reaches the device.
    // A wallet that ran low or a payment that failed is the one billing
    // notice worth interrupting for, and every stop but Off keeps it in-app.
    presets: [
      {
        id: "MOST",
        hintKey: "presetBillingMostHint",
        reach: {
          BILLING_ATTENTION: "PUSH",
          BILLING_UPDATE: "PUSH",
        },
      },
      {
        id: "ESSENTIAL",
        hintKey: "presetBillingEssentialHint",
        reach: {
          BILLING_ATTENTION: "PUSH",
          BILLING_UPDATE: "IN_APP",
        },
      },
      {
        id: "APP_ONLY",
        hintKey: "presetBillingAppOnlyHint",
        reach: {
          BILLING_ATTENTION: "IN_APP",
          BILLING_UPDATE: "IN_APP",
        },
      },
      {
        id: "OFF",
        hintKey: "presetBillingOffHint",
        reach: {
          BILLING_ATTENTION: "NONE",
          BILLING_UPDATE: "NONE",
        },
      },
    ],
  },
  {
    id: "PROJECT",
    labelKey: "kindProjectUpdate",
    kinds: [
      {
        category: "PROJECT_UPDATE",
        labelKey: "kindProjectUpdate",
        hintKey: "kindProjectUpdateHint",
        email: "CHANNEL",
      },
    ],
    presets: [],
  },
  {
    id: "SYSTEM",
    labelKey: "kindSystem",
    kinds: [
      {
        category: "SYSTEM",
        labelKey: "kindSystem",
        hintKey: "kindSystemHint",
        email: "CHANNEL",
      },
    ],
    // A group of one is drawn as a plain row with its own cells. A rail over
    // it would offer four words for what two cells already say.
    presets: [],
  },
  {
    id: "FOLLOW_UP",
    labelKey: "kindFollowUp",
    kinds: [
      {
        category: "FOLLOW_UP",
        labelKey: "kindFollowUp",
        hintKey: "kindFollowUpHint",
        email: "CHANNEL",
      },
    ],
    // One row for reminders of every kind, and last, because it is about the
    // rows above it rather than beside them. Turning a group off above already
    // turns off its reminders: nothing that was never delivered is followed up.
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
 *
 * `EMAIL` is deliberately absent: a preset speaks for the channels in
 * `PRESET_CHANNELS` and leaves the rest as the reader had them.
 */
const REACH_CHANNELS: Record<Reach, readonly StoredChannel[]> = {
  NONE: [],
  IN_APP: ["IN_APP"],
  PUSH: ["IN_APP", "OS_BANNER"],
};

/**
 * The channels a preset speaks for.
 *
 * A preset is a situation in Sokosumi and on the device, and says nothing
 * about the inbox. So a press of one writes these two channels on every kind
 * of the group and carries each kind's email cell over as it was, and the
 * rail reads the group by these two alone. Without that, every preset would
 * switch a reader's emails off without saying so, because no preset's reach
 * names the inbox, and a reader who left one row's email on would see Custom
 * over a group that is otherwise exactly on Most.
 */
const PRESET_CHANNELS: readonly StoredChannel[] = ["IN_APP", "OS_BANNER"];

/** The channels of `channels` that a preset speaks for, or does not. */
function presetPart(
  channels: readonly StoredChannel[],
  spoken: boolean,
): StoredChannel[] {
  return channels.filter(
    (channel) => PRESET_CHANNELS.includes(channel) === spoken,
  );
}

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
 * Every cell a preset speaks for has to match. A preset that only nearly fits
 * would light up while the group is doing something else, and the reader
 * would read the word rather than the rows and believe it. The email cells are
 * not read: no preset writes them (`PRESET_CHANNELS`).
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
          sameChannels(
            presetPart(categoryChannels(cells, kind.category), true),
            channels,
          )
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

/** One kind of a group, with the channels it is on now. */
export interface KindChannels {
  spec: KindSpec;
  channels: readonly StoredChannel[];
}

/**
 * The cells a preset writes: every kind of the group, wherever it puts them.
 *
 * The reader's own cells are read for one thing only: the channels a preset
 * does not speak for (`PRESET_CHANNELS`), which each kind keeps as it had
 * them. For the rest a preset is the whole situation rather than a filter
 * over the one before it, which is what lets the rail say which one the group
 * is in: pick it, and the cells say exactly this.
 */
export function presetChanges(
  preset: PresetSpec,
  kinds: readonly KindChannels[],
): DeliveryChange[] {
  return kinds.flatMap((kind) => {
    const channels = presetChannels(preset, kind.spec);

    return channels
      ? [
          {
            category: kind.spec.category,
            channels: [...channels, ...presetPart(kind.channels, false)],
          },
        ]
      : [];
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
 * "What is essential" is two named things in Tasks and two different ones in
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
