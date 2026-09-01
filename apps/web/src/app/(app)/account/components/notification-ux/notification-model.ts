import type { NotificationPreference } from "@/lib/clients/generated/core";
import type { SubjectSpec } from "./notification-subjects";

export type NotificationCategory = NotificationPreference["category"];
export type StoredChannel = NotificationPreference["channel"];

export interface StoredCell {
  category: NotificationCategory;
  channel: StoredChannel;
  enabled: boolean;
}

/**
 * How loudly one subject arrives.
 *
 * Ordered, and each step contains the one below: a banner is also waiting in
 * Sokosumi when you get back. That is why one control can carry it, and why a
 * subject can be compared with the subject that covers it.
 */
export const DELIVERIES = ["OFF", "IN_APP", "BANNER"] as const;
export type Delivery = (typeof DELIVERIES)[number];

export const DELIVERY_RANK: Record<Delivery, number> = {
  OFF: 0,
  IN_APP: 1,
  BANNER: 2,
};

export const DELIVERY_COPY: Record<
  Delivery,
  { label: string; short: string; sentence: string }
> = {
  OFF: { label: "Off", short: "Off", sentence: "nothing" },
  IN_APP: {
    label: "In Sokosumi",
    short: "In app",
    sentence: "in Sokosumi only",
  },
  BANNER: {
    label: "In Sokosumi and a banner",
    short: "Banner",
    sentence: "with a banner",
  },
};

/** The channels a delivery lights up. `EMAIL` is drawn, never stored. */
export type DisplayChannel = StoredChannel | "EMAIL";
export const DISPLAY_CHANNELS: readonly DisplayChannel[] = [
  "IN_APP",
  "OS_BANNER",
  "EMAIL",
];

export function deliveryChannels(delivery: Delivery): DisplayChannel[] {
  if (delivery === "BANNER") {
    return ["IN_APP", "OS_BANNER"];
  }

  return delivery === "IN_APP" ? ["IN_APP"] : [];
}

export interface SubjectChoice {
  spec: SubjectSpec;
  /** What the reader set on this row. */
  own: Delivery;
  /** The loudest delivery the subjects covering this one already give it. */
  floor: Delivery;
  /** What actually happens, once the subject covering it is taken in. */
  effective: Delivery;
  /** The subject that already carries this one at this loudness, if any. */
  coveredBy: SubjectSpec | null;
  /** True when this row asks for more than the subject covering it. */
  louder: boolean;
  /** Nothing stores it yet, so it is drawn and remembered for the visit only. */
  stored: boolean;
  saving: boolean;
}

export interface CategoryGroup {
  id: string;
  label: string;
  subjects: SubjectChoice[];
}

export const PRESET_IDS = ["EVERYTHING", "IMPORTANT", "QUIET", "OFF"] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export type PresetState = PresetId | "CUSTOM";

export const PRESET_COPY: Record<PresetState, { label: string }> = {
  EVERYTHING: { label: "Everything" },
  IMPORTANT: { label: "Important" },
  QUIET: { label: "Quiet" },
  OFF: { label: "Off" },
  CUSTOM: { label: "Custom" },
};

/** What a preset sets one subject to. */
export function presetDelivery(
  preset: PresetId,
  subject: SubjectSpec,
): Delivery {
  if (preset === "OFF") {
    return "OFF";
  }

  if (preset === "EVERYTHING") {
    return "BANNER";
  }

  if (!subject.important) {
    return "OFF";
  }

  return preset === "IMPORTANT" ? "BANNER" : "IN_APP";
}

/**
 * The presets worth showing for this group.
 *
 * A group whose subjects are all important cannot tell "Everything" from
 * "Important", and a stop that never lights looks broken. So a preset that
 * would write what an earlier one writes is dropped rather than explained away.
 */
export function groupPresets(subjects: readonly SubjectSpec[]): PresetId[] {
  const kept: PresetId[] = [];

  for (const preset of PRESET_IDS) {
    const shape = subjects.map((subject) => presetDelivery(preset, subject));
    const same = kept.some((earlier) =>
      subjects.every(
        (subject, index) => presetDelivery(earlier, subject) === shape[index],
      ),
    );

    if (!same) {
      kept.push(preset);
    }
  }

  return kept;
}

export function loudest(...deliveries: Delivery[]): Delivery {
  return deliveries.reduce(
    (best, candidate) =>
      DELIVERY_RANK[candidate] > DELIVERY_RANK[best] ? candidate : best,
    "OFF",
  );
}

/**
 * Turns what the reader set into what actually happens.
 *
 * A subject that another subject already carries cannot be quieter than its
 * cover, so the row reports the cover's delivery instead of its own. It can be
 * louder, and that is the one combination worth having: every message in
 * Sokosumi, and a banner only when you are named.
 */
export function resolve(
  specs: readonly SubjectSpec[],
  own: (spec: SubjectSpec) => Delivery,
): Omit<SubjectChoice, "stored" | "saving">[] {
  return specs.map((spec) => {
    const covers = specs.filter((candidate) =>
      candidate.covers.includes(spec.id),
    );
    const fromCover = loudest(...covers.map((cover) => own(cover)));
    const mine = own(spec);
    // The cover to name. Loudest first, and a cover that is itself off carries
    // nothing, so it is not one.
    const strongest = covers
      .filter((cover) => own(cover) !== "OFF")
      .sort((a, b) => DELIVERY_RANK[own(b)] - DELIVERY_RANK[own(a)])[0];

    return {
      spec,
      own: mine,
      floor: fromCover,
      effective: loudest(mine, fromCover),
      coveredBy: strongest ?? null,
      louder:
        DELIVERY_RANK[mine] > DELIVERY_RANK[fromCover] &&
        DELIVERY_RANK[fromCover] > 0,
    };
  });
}

export function groupPreset(group: CategoryGroup): PresetState {
  return (
    groupPresets(group.subjects.map((subject) => subject.spec)).find((preset) =>
      group.subjects.every(
        (subject) => subject.own === presetDelivery(preset, subject.spec),
      ),
    ) ?? "CUSTOM"
  );
}

/**
 * A few subjects as one phrase.
 *
 * Two get both names, because "Direct messages and mentions of you" is the
 * whole answer. More than two would be a list nobody reads in a closed row, so
 * the first one leads and the rest are counted.
 */
export function nameSpecs(specs: readonly SubjectSpec[]) {
  if (specs.length === 0) {
    return "Nothing";
  }

  if (specs.length <= 2) {
    return specs.map((spec) => spec.label).join(" and ");
  }

  return `${specs[0].label} and ${specs.length - 1} more`;
}

/** The subjects a summary should name: the ones no other subject speaks for. */
export function headline(group: CategoryGroup) {
  return group.subjects.filter(
    (subject) =>
      subject.effective !== "OFF" &&
      (subject.coveredBy === null || subject.louder),
  );
}

/**
 * One line for a closed group: what arrives, then how loudly.
 *
 * Covered subjects are left out of the naming. Listing "mentions" next to
 * "every message in your rooms" is the duplication this whole screen exists to
 * avoid.
 */
export function groupSummary(group: CategoryGroup) {
  const named = headline(group);

  if (named.length === 0) {
    return "Nothing arrives";
  }

  const labels = nameSpecs(named.map((subject) => subject.spec));
  const deliveries = new Set(named.map((subject) => subject.effective));
  const how =
    deliveries.size === 1
      ? DELIVERY_COPY[[...deliveries][0]].sentence
      : "mixed delivery";

  return `${labels} · ${how}`;
}

/** The delivery one subject's stored cells describe. */
export function deliveryOf(
  cells: readonly StoredCell[],
  spec: SubjectSpec,
): Delivery {
  const mine = cells.filter((cell) => spec.categories.includes(cell.category));

  if (mine.length === 0 || mine.every((cell) => !cell.enabled)) {
    return "OFF";
  }

  return mine.some((cell) => cell.channel === "OS_BANNER" && cell.enabled)
    ? "BANNER"
    : "IN_APP";
}

/** The cells one delivery writes for one subject. */
export function cellsFor(
  cells: readonly StoredCell[],
  spec: SubjectSpec,
  delivery: Delivery,
): StoredCell[] {
  const channels = deliveryChannels(delivery);

  return cells
    .filter((cell) => spec.categories.includes(cell.category))
    .map((cell) => ({ ...cell, enabled: channels.includes(cell.channel) }));
}

/**
 * What one preset would do to this group, in the group's own subjects.
 *
 * A preset that cannot say what it means has to be taken on trust, and the
 * meaning differs per group: "Important" is one subject in Requests and access
 * and two in Chat.
 */
export function presetHint(group: CategoryGroup, preset: PresetId) {
  if (preset === "OFF") {
    return "Nothing arrives";
  }

  const specs = group.subjects.map((subject) => subject.spec);
  const on = specs.filter((spec) => presetDelivery(preset, spec) !== "OFF");

  if (on.length === 0) {
    return "Nothing arrives";
  }

  const covered = new Set(on.flatMap((spec) => spec.covers));
  const named = on.filter((spec) => !covered.has(spec.id));
  const labels =
    on.length === specs.length && specs.length > 1
      ? "Everything here"
      : nameSpecs(named);

  return `${labels} · ${DELIVERY_COPY[presetDelivery(preset, on[0])].sentence}`;
}

/**
 * The line under one subject's name.
 *
 * A covered subject says so instead of repeating its hint, because "someone
 * names you in a room you are in" is not the thing the reader needs once every
 * message in that room already arrives.
 */
export function subjectNote(subject: SubjectChoice) {
  if (subject.louder && subject.coveredBy) {
    return `Covered by ${subject.coveredBy.label}, and louder here`;
  }

  if (subject.coveredBy) {
    return `Covered by ${subject.coveredBy.label}`;
  }

  return subject.spec.hint;
}
