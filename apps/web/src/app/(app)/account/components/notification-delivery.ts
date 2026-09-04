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
   * Whether this kind survives when the reader trims the group.
   *
   * The presets read it: "Important" keeps these and drops the rest. Nearly
   * every one of them waits on the reader. A finished job or task is the
   * exception: there is nothing to do about it, and it is the answer the
   * reader started the work for. It is a property of the kind rather than a
   * preset's private list, so a kind added later answers the question once
   * instead of in every preset.
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
 * A group's answer: which of its kinds arrive at all.
 *
 * One question, and only one. Where a kind arrives is the grid's answer and
 * it is asked per kind, so an answer here keeps the places the reader already
 * chose: a group they set to the app alone stays that way when they trim it
 * to the kinds that matter. The old ladder answered both at once, and its
 * step from Everything to Important dropped kinds while its step from
 * Important to Quiet dropped a channel, so no stop told the reader what the
 * next one would do.
 */
export const PRESET_SCOPES = ["ALL", "IMPORTANT", "NONE"] as const;
export type PresetScope = (typeof PRESET_SCOPES)[number];

/** A group whose kinds are on one by one. Reported on the scope, never written. */
export type ScopeState = PresetScope | "CUSTOM";

export const PRESET_SCOPE_LABEL_KEY: Record<ScopeState, string> = {
  ALL: "scopeAll",
  IMPORTANT: "scopeImportant",
  NONE: "scopeNone",
  CUSTOM: "scopeCustom",
};

export const PRESET_SCOPE_HINT_KEY: Record<ScopeState, string> = {
  ALL: "scopeAllHint",
  IMPORTANT: "scopeImportantHint",
  NONE: "scopeNoneHint",
  CUSTOM: "scopeCustomHint",
};

/** Whether a scope keeps a kind. */
function keeps(scope: PresetScope, kind: KindSpec): boolean {
  return scope === "ALL" || (scope === "IMPORTANT" && kind.important);
}

/** Whether this kind arrives anywhere as the cells stand. */
function isOn(
  cells: readonly NotificationPreference[],
  kind: KindSpec,
): boolean {
  return categoryChannels(cells, kind.category).length > 0;
}

/**
 * The scopes worth showing for this group.
 *
 * Important keeps every kind of a group whose kinds all matter, and none of a
 * group where none of them do. Either way it writes what a neighbour writes,
 * and a stop that changes nothing reads as broken, so it is dropped rather
 * than explained. All and Nothing always mean something and always show.
 */
export function groupScopes(kinds: readonly KindSpec[]): PresetScope[] {
  const some = kinds.some((kind) => kind.important);
  const every = kinds.every((kind) => kind.important);

  return PRESET_SCOPES.filter(
    (scope) => scope !== "IMPORTANT" || (some && !every),
  );
}

/** Which scope the stored cells are on, or that the reader set the kinds one by one. */
export function groupScope(
  cells: readonly NotificationPreference[],
  kinds: readonly KindSpec[],
): ScopeState {
  return (
    groupScopes(kinds).find((scope) =>
      kinds.every((kind) => isOn(cells, kind) === keeps(scope, kind)),
    ) ?? "CUSTOM"
  );
}

/**
 * Where a group arrives as the cells stand, for a kind that arrives nowhere.
 *
 * An answer says which kinds arrive, never where, so a kind it keeps holds on
 * to the channels it already has and only a kind that is on nowhere needs
 * somewhere to land. It lands where the rest of the group already does. In a
 * group that is silent everywhere there is nothing to copy, so it lands on
 * every channel: the reader just asked to hear about this, and the grid under
 * it takes any of that back in one press.
 *
 * Folded through `withChannel` rather than collected, so the pairing rule
 * holds here too: a group whose only banner cell somehow stands without its
 * entry does not hand that pairing to a kind this writes.
 */
function groupChannels(kinds: readonly KindState[]): StoredChannel[] {
  const used = STORED_CHANNELS.filter((channel) =>
    kinds.some((kind) => kind.channels.includes(channel)),
  );

  if (used.length === 0) {
    return [...STORED_CHANNELS];
  }

  return used.reduce<StoredChannel[]>(
    (channels, channel) => withChannel(channels, channel, true),
    [],
  );
}

/**
 * One kind as the row that draws it holds it.
 *
 * An answer reads these rather than the stored matrix, because the row that
 * calls it is drawn from them. Asking the matrix again would let the two
 * disagree while a write is in flight.
 */
export interface KindState {
  spec: KindSpec;
  channels: readonly StoredChannel[];
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
 * The changes an answer writes: the kinds it keeps, where they already are.
 *
 * A kind it keeps that already arrives somewhere is left exactly where it is,
 * so picking Everything on a group the reader had quieted does not start it
 * buzzing. Only a kind that arrives nowhere needs a place, and it takes the
 * group's. A kind the answer drops is written empty, which is what off means
 * here: no channel at all.
 */
export function scopeChanges(
  scope: PresetScope,
  kinds: readonly KindState[],
): DeliveryChange[] {
  const fallback = groupChannels(kinds);

  return kinds.map((kind) => ({
    category: kind.spec.category,
    channels: keeps(scope, kind.spec)
      ? kind.channels.length > 0
        ? [...kind.channels]
        : fallback
      : [],
  }));
}
