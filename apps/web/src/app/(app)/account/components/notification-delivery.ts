import type { NotificationPreference } from "@/lib/clients/generated/core";

export type NotificationCategory = NotificationPreference["category"];

/**
 * How loudly one kind of notification arrives.
 *
 * Ordered, and each step contains the one below: a banner is also waiting in
 * Sokosumi when you get back. One control per kind instead of one switch per
 * channel, because the two switches could describe a state nobody wants and
 * the reader had to work out which pair meant what.
 */
export const DELIVERIES = ["OFF", "IN_APP", "BANNER"] as const;
export type Delivery = (typeof DELIVERIES)[number];

/** A group whose kinds disagree. Reported, never written. */
export type GroupDelivery = Delivery | "MIXED";

export const DELIVERY_LABEL_KEY: Record<GroupDelivery, string> = {
  OFF: "deliveryOff",
  IN_APP: "deliveryInApp",
  BANNER: "deliveryBanner",
  MIXED: "deliveryMixed",
};

export const DELIVERY_HINT_KEY: Record<Delivery, string> = {
  OFF: "deliveryOffHint",
  IN_APP: "deliveryInAppHint",
  BANNER: "deliveryBannerHint",
};

export interface KindSpec {
  category: NotificationCategory;
  labelKey: string;
  /** What happens, in the reader's terms, under the name. */
  hintKey: string;
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
 * holds something that waits on the reader next to something that merely
 * happened, and those are the two the reader wants to set apart.
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
      },
      {
        category: "JOB_UPDATE",
        labelKey: "kindJobUpdate",
        hintKey: "kindJobUpdateHint",
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
      },
      {
        category: "TASK_UPDATE",
        labelKey: "kindTaskUpdate",
        hintKey: "kindTaskUpdateHint",
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
      },
      {
        category: "CHAT_MENTION",
        labelKey: "kindChatMention",
        hintKey: "kindChatMentionHint",
      },
      {
        category: "CHAT_DIRECT_MESSAGE",
        labelKey: "kindChatDirectMessage",
        hintKey: "kindChatDirectMessageHint",
      },
    ],
  },
  {
    id: "SYSTEM",
    labelKey: "kindSystem",
    kinds: [
      { category: "SYSTEM", labelKey: "kindSystem", hintKey: "kindSystemHint" },
    ],
  },
];

/**
 * What one kind's stored cells describe.
 *
 * A banner with the in-app cell off still arrives loudly, so it reads as a
 * banner. Writing that kind again normalises it, which loses a combination the
 * two switches could express and nobody asked for.
 */
export function categoryDelivery(
  cells: readonly NotificationPreference[],
  category: NotificationCategory,
): Delivery {
  const mine = cells.filter((cell) => cell.category === category);

  if (mine.some((cell) => cell.channel === "OS_BANNER" && cell.enabled)) {
    return "BANNER";
  }

  return mine.some((cell) => cell.enabled) ? "IN_APP" : "OFF";
}

/** What a group's control shows: one answer, or that its kinds disagree. */
export function groupDelivery(
  cells: readonly NotificationPreference[],
  kinds: readonly KindSpec[],
): GroupDelivery {
  const deliveries = kinds.map((kind) =>
    categoryDelivery(cells, kind.category),
  );
  const first = deliveries[0];

  return first !== undefined && deliveries.every((one) => one === first)
    ? first
    : "MIXED";
}

/**
 * The channels each step lights up.
 *
 * Written out rather than derived, so a channel Core adds later stays off
 * until someone decides which step it belongs to.
 */
const DELIVERY_CHANNELS: Record<
  Delivery,
  readonly NotificationPreference["channel"][]
> = {
  OFF: [],
  IN_APP: ["IN_APP"],
  BANNER: ["IN_APP", "OS_BANNER"],
};

/** The cells one delivery writes for the given categories. */
export function cellsFor(
  cells: readonly NotificationPreference[],
  categories: readonly NotificationCategory[],
  delivery: Delivery,
): NotificationPreference[] {
  return cells
    .filter((cell) => categories.includes(cell.category))
    .map((cell) => ({
      ...cell,
      enabled: DELIVERY_CHANNELS[delivery].includes(cell.channel),
    }));
}
