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

export const DELIVERY_LABEL_KEY: Record<Delivery, string> = {
  OFF: "deliveryOff",
  IN_APP: "deliveryInApp",
  BANNER: "deliveryBanner",
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
  /**
   * Whether this kind waits on the reader.
   *
   * The presets read it: "Important" keeps these and drops the rest. It is a
   * property of the kind rather than a preset's private list, so a kind added
   * later answers the question once instead of in every preset.
   */
  important: boolean;
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
        important: true,
      },
      {
        category: "JOB_UPDATE",
        labelKey: "kindJobUpdate",
        hintKey: "kindJobUpdateHint",
        important: false,
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
      },
      {
        category: "TASK_UPDATE",
        labelKey: "kindTaskUpdate",
        hintKey: "kindTaskUpdateHint",
        important: false,
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
      },
      {
        category: "CHAT_MENTION",
        labelKey: "kindChatMention",
        hintKey: "kindChatMentionHint",
        important: true,
      },
      {
        category: "CHAT_DIRECT_MESSAGE",
        labelKey: "kindChatDirectMessage",
        hintKey: "kindChatDirectMessageHint",
        important: true,
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
      },
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

/**
 * The answers a group's own control offers.
 *
 * Ordered loudest first, and each one means the same thing in every group:
 * everything, only what waits on you, only what waits on you and quietly, or
 * nothing. What they write differs by group, because what waits on you differs
 * by group.
 */
export const PRESETS = ["EVERYTHING", "IMPORTANT", "QUIET", "OFF"] as const;
export type Preset = (typeof PRESETS)[number];

/** A group whose kinds match no preset. Reported, never written. */
export type PresetState = Preset | "CUSTOM";

export const PRESET_LABEL_KEY: Record<PresetState, string> = {
  EVERYTHING: "presetEverything",
  IMPORTANT: "presetImportant",
  QUIET: "presetQuiet",
  OFF: "presetOff",
  CUSTOM: "presetCustom",
};

export const PRESET_HINT_KEY: Record<PresetState, string> = {
  EVERYTHING: "presetEverythingHint",
  IMPORTANT: "presetImportantHint",
  QUIET: "presetQuietHint",
  OFF: "presetOffHint",
  CUSTOM: "presetCustomHint",
};

/** What one preset sets one kind to. */
export function presetDelivery(preset: Preset, kind: KindSpec): Delivery {
  if (preset === "OFF") {
    return "OFF";
  }

  if (preset === "EVERYTHING") {
    return "BANNER";
  }

  if (!kind.important) {
    return "OFF";
  }

  return preset === "IMPORTANT" ? "BANNER" : "IN_APP";
}

/**
 * Whether these deliveries silence the group.
 *
 * The one tie `PRESETS` order settles wrongly. That order runs loudest first,
 * so the loudest preset writing a shape is the one that describes it, except
 * at the quiet end: a group of kinds that none of them wait on the reader is
 * silenced by Important as well, and Important is not what a reader calls a
 * stop that silences a group.
 */
function silencesEverything(shape: readonly Delivery[]): boolean {
  return shape.every((delivery) => delivery === "OFF");
}

/**
 * The presets worth showing for this group.
 *
 * A group whose kinds all wait on the reader cannot tell "Everything" from
 * "Important": both write the same cells, and a control that never changes
 * anything reads as broken. So a preset that writes what another one writes is
 * dropped rather than explained.
 *
 * Which of the two survives is the one whose name describes what it writes:
 * the loudest, since `PRESETS` runs loudest first, except where the shape
 * silences the group (`silencesEverything`).
 */
export function groupPresets(kinds: readonly KindSpec[]): Preset[] {
  const shapeOf = (preset: Preset): Delivery[] =>
    kinds.map((kind) => presetDelivery(preset, kind));
  const keyOf = (preset: Preset): string => shapeOf(preset).join("|");
  const kept = new Map<string, Preset>();

  for (const preset of PRESETS) {
    const key = keyOf(preset);
    kept.set(
      key,
      silencesEverything(shapeOf(preset)) ? "OFF" : (kept.get(key) ?? preset),
    );
  }

  return PRESETS.filter((preset) => kept.get(keyOf(preset)) === preset);
}

/** Which preset the group is on, or that the reader set its kinds one by one. */
export function groupPreset(
  cells: readonly NotificationPreference[],
  kinds: readonly KindSpec[],
): PresetState {
  return (
    groupPresets(kinds).find((preset) =>
      kinds.every(
        (kind) =>
          categoryDelivery(cells, kind.category) ===
          presetDelivery(preset, kind),
      ),
    ) ?? "CUSTOM"
  );
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

/** One category, and where the reader wants it. */
export interface DeliveryChange {
  category: NotificationCategory;
  delivery: Delivery;
}

/**
 * The cells a set of changes writes.
 *
 * A delivery per category rather than one for all of them, because a preset
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
      ? [
          {
            ...cell,
            enabled: DELIVERY_CHANNELS[change.delivery].includes(cell.channel),
          },
        ]
      : [];
  });
}

/** The changes a preset writes for a group. */
export function presetChanges(
  preset: Preset,
  kinds: readonly KindSpec[],
): DeliveryChange[] {
  return kinds.map((kind) => ({
    category: kind.category,
    delivery: presetDelivery(preset, kind),
  }));
}
