import type { NotificationPreference } from "@/lib/clients/generated/core";
import type { ScopeRung } from "./notification-scopes";

export type NotificationCategory = NotificationPreference["category"];
export type StoredChannel = NotificationPreference["channel"];

/**
 * The channels the settings screen draws. `EMAIL` is a preview column: nothing
 * stores it and nothing sends on it yet, so it renders disabled.
 */
export type DisplayChannel = StoredChannel | "EMAIL";

export const DISPLAY_CHANNELS: readonly DisplayChannel[] = [
  "IN_APP",
  "OS_BANNER",
  "EMAIL",
];

/** How a control stands when it covers more than one cell. */
export type TriState = "on" | "off" | "mixed";

export interface StoredCell {
  category: NotificationCategory;
  channel: StoredChannel;
  enabled: boolean;
}

export interface ChannelChoice {
  channel: DisplayChannel;
  label: string;
  enabled: boolean;
  available: boolean;
  saving: boolean;
  unavailableReason: string | null;
}

export interface CategoryChoice {
  category: NotificationCategory;
  label: string;
  channels: ChannelChoice[];
}

/**
 * A heading the reader recognises, holding two independent questions.
 *
 * **What** counts as an event, on a ladder whose rungs contain each other, and
 * **where** it arrives. Keeping them apart is what stops the settings from
 * multiplying: chat has four breadths and three deliveries, and that is seven
 * controls rather than twelve combinations.
 */
export interface CategoryGroup {
  id: string;
  label: string;
  description: string;
  categories: CategoryChoice[];
  rungs: readonly ScopeRung[];
  defaultScope: number;
}

/** Where a group's events arrive. */
export const GROUP_LEVELS = ["ALL", "IN_APP", "OFF"] as const;
export type GroupLevel = (typeof GROUP_LEVELS)[number];
export type GroupLevelState = GroupLevel | "CUSTOM";

export const LEVEL_COPY: Record<
  GroupLevelState,
  { label: string; short: string; sentence: string; inline: string }
> = {
  ALL: {
    label: "In Sokosumi and a banner",
    short: "All",
    sentence: "In Sokosumi and a banner on your devices",
    inline: "in Sokosumi and a banner",
  },
  IN_APP: {
    label: "Only in Sokosumi",
    short: "In app",
    sentence: "Waiting for you in Sokosumi, no banners",
    inline: "only in Sokosumi",
  },
  OFF: {
    label: "Nowhere",
    short: "Off",
    sentence: "Nothing arrives, anywhere",
    inline: "nowhere",
  },
  CUSTOM: {
    label: "Set per subject",
    short: "Custom",
    sentence: "Set per subject",
    inline: "per subject",
  },
};

/**
 * A named pair of one breadth and one delivery.
 *
 * The two ladders are the honest model and four words are what a reader wants,
 * so a preset is a shortcut across both rather than a third thing to learn.
 * `scope: null` means "leave the breadth alone", which is why turning the noise
 * down does not also forget what you had asked to hear about.
 */
export const PRESET_IDS = ["EVERYTHING", "IMPORTANT", "QUIET", "OFF"] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export type PresetState = PresetId | "CUSTOM";

export const PRESET_COPY: Record<PresetState, { label: string; hint: string }> =
  {
    EVERYTHING: { label: "Everything", hint: "The widest this group goes." },
    IMPORTANT: { label: "Important", hint: "The part that usually matters." },
    QUIET: { label: "Quiet", hint: "Same events, no banners." },
    OFF: { label: "Off", hint: "Nothing from this group." },
    CUSTOM: { label: "Custom", hint: "Your own mix. Open it to see." },
  };

const PRESET_SHAPE: Record<
  PresetId,
  { scope: "last" | "default" | null; level: GroupLevel }
> = {
  EVERYTHING: { scope: "last", level: "ALL" },
  IMPORTANT: { scope: "default", level: "ALL" },
  QUIET: { scope: null, level: "IN_APP" },
  OFF: { scope: null, level: "OFF" },
};

export function presetLevel(preset: PresetId) {
  return PRESET_SHAPE[preset].level;
}

/** Which rung a preset means here, or null when it leaves the breadth alone. */
export function presetScope(group: CategoryGroup, preset: PresetId) {
  const shape = PRESET_SHAPE[preset].scope;

  if (shape === "last") {
    return Math.max(group.rungs.length - 1, 0);
  }

  return shape === "default" ? group.defaultScope : null;
}

/**
 * The presets worth showing for this group.
 *
 * A group with one rung cannot tell "Everything" from "Important", and an
 * earlier round proved what that costs: a stop that never lights looks broken.
 * So a preset that would write what an earlier one writes is dropped here
 * rather than drawn and explained away.
 */
export function groupPresets(group: CategoryGroup): PresetId[] {
  const kept: PresetId[] = [];

  for (const preset of PRESET_IDS) {
    const scope = presetScope(group, preset);
    const level = PRESET_SHAPE[preset].level;
    const same = kept.some(
      (earlier) =>
        (presetScope(group, earlier) ?? scope) === scope &&
        PRESET_SHAPE[earlier].level === level,
    );

    if (!same) {
      kept.push(preset);
    }
  }

  return kept;
}

/** The stored categories rungs 0..index bring in. */
export function scopeCategories(group: CategoryGroup, index: number) {
  return group.rungs
    .slice(0, index + 1)
    .flatMap((rung) => [...rung.categories]);
}

/**
 * The rung the stored cells imply.
 *
 * Only the rungs that store something can be read back, and only while the
 * group still delivers somewhere. `-1` says the cells cannot answer, and the
 * caller falls back to what the reader picked, then to the group's default.
 */
export function derivedScope(
  group: CategoryGroup,
  cells: readonly StoredCell[],
) {
  let derived = -1;

  for (const [index, rung] of group.rungs.entries()) {
    if (rung.categories.length === 0) {
      break;
    }

    const on = rung.categories.every((category) =>
      cells.some((cell) => cell.category === category && cell.enabled),
    );

    if (!on) {
      break;
    }

    derived = index;
  }

  return derived;
}

export function tri(subset: readonly { enabled: boolean }[]): TriState {
  if (subset.length === 0 || subset.every((cell) => !cell.enabled)) {
    return "off";
  }

  return subset.every((cell) => cell.enabled) ? "on" : "mixed";
}

/** What one delivery level writes over the subjects a breadth includes. */
export function cellsFor(
  cells: readonly StoredCell[],
  group: CategoryGroup,
  scope: number,
  level: GroupLevel,
): StoredCell[] {
  const wanted = scopeCategories(group, scope);

  return cells.map((cell) => ({
    ...cell,
    enabled:
      wanted.includes(cell.category) &&
      (level === "ALL" || (level === "IN_APP" && cell.channel === "IN_APP")),
  }));
}

function matches(cells: readonly StoredCell[], wanted: readonly StoredCell[]) {
  return wanted.every(
    (cell) =>
      cells.find(
        (candidate) =>
          candidate.category === cell.category &&
          candidate.channel === cell.channel,
      )?.enabled === cell.enabled,
  );
}

/**
 * Read rather than stored, so a level stays selected only while it is still
 * true. Editing one chip drops it to `CUSTOM` instead of leaving a label that
 * lies about what the group does.
 */
export function levelOf(
  cells: readonly StoredCell[],
  group: CategoryGroup,
  scope: number,
): GroupLevelState {
  return (
    GROUP_LEVELS.find((level) =>
      matches(cells, cellsFor(cells, group, scope, level)),
    ) ?? "CUSTOM"
  );
}

export function presetOf(
  cells: readonly StoredCell[],
  group: CategoryGroup,
  scope: number,
): PresetState {
  const level = levelOf(cells, group, scope);

  return (
    groupPresets(group).find((preset) => {
      const wanted = presetScope(group, preset);

      return (
        PRESET_SHAPE[preset].level === level &&
        (wanted === null || wanted === scope)
      );
    }) ?? "CUSTOM"
  );
}
