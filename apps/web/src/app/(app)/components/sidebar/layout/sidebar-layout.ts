import type { SidebarLayout } from "@sokosumi/core-client";
import { moveIdToSlot } from "@/lib/utils/move-id";

export type SidebarLayoutSection = SidebarLayout["sections"][number];

export interface SidebarFeature {
  id: string;
  label: string;
  defaultSection: string;
  available: boolean;
  /** An available collection with no rows still belongs in the editor. */
  hasContent?: boolean;
}

export const DEFAULT_SECTION_IDS = [
  "work",
  "records",
  "marketing",
  "chats",
] as const;
export const MAX_SIDEBAR_SECTIONS = 64;
export const MAX_SECTION_NAME_LENGTH = 64;

// This is the launch catalog. Future features live only in the current catalog,
// so old layouts gain them and the app can mark them New until the reader opens them.
const LAUNCH_FEATURE_IDS = new Set([
  "home",
  "projects",
  "overview",
  "explore-agents",
  "task-manager",
  "schedules",
  "calendar",
  "contacts",
  "drive",
  "studio",
  "tiktok-studio",
  "social",
  "seo",
  "ads",
  "competitors",
  "newsletter",
  "catch-up",
  "pinned",
  "channels",
  "external",
  "archived",
  "direct-messages",
]);

export function isNewSidebarFeature(id: string): boolean {
  return !LAUNCH_FEATURE_IDS.has(id);
}

export function resolveSidebarLayout(
  saved: SidebarLayout | null,
  features: readonly SidebarFeature[],
): SidebarLayout {
  const sections = saved
    ? saved.sections.map((section) => ({
        ...section,
        items: [...section.items],
      }))
    : DEFAULT_SECTION_IDS.map(
        (id): SidebarLayoutSection => ({ id, name: null, items: [] }),
      );
  const assigned = new Set([
    ...(saved?.hidden ?? []),
    ...sections.flatMap((section) => section.items),
  ]);
  for (const feature of features) {
    if (assigned.has(feature.id) || (saved && !isNewSidebarFeature(feature.id)))
      continue;
    let target = sections.find(
      (section) => section.id === feature.defaultSection,
    );
    // Preserve deleted default sections. A later release still gets a visible
    // destination, even if the reader previously removed every section.
    if (!target && saved) target = sections[0];
    if (!target) {
      target = { id: feature.defaultSection, name: null, items: [] };
      sections.push(target);
    }
    target.items.push(feature.id);
    assigned.add(feature.id);
  }
  return { sections, hidden: saved?.hidden ?? [] };
}

export function removeSidebarSection(
  layout: SidebarLayout,
  sectionId: string,
): SidebarLayout {
  const section = layout.sections.find(({ id }) => id === sectionId);
  if (!section) return layout;
  return {
    sections: layout.sections.filter(({ id }) => id !== sectionId),
    hidden: [...layout.hidden, ...section.items],
  };
}

export function hideSidebarFeature(
  layout: SidebarLayout,
  featureId: string,
): SidebarLayout {
  return {
    sections: layout.sections.map((section) => ({
      ...section,
      items: section.items.filter((id) => id !== featureId),
    })),
    hidden: [...new Set([...layout.hidden, featureId])],
  };
}

/** Drop onto a feature's slot or append to a section (including an empty one). */
export function placeSidebarFeature(
  layout: SidebarLayout,
  featureId: string,
  sectionId: string,
  targetId?: string,
): SidebarLayout {
  const target = layout.sections.find(({ id }) => id === sectionId);
  if (!target || featureId === targetId) return layout;
  const slot = targetId ? target.items.indexOf(targetId) : target.items.length;
  if (slot < 0) return layout;
  const items = target.items.filter((id) => id !== featureId);
  items.splice(slot, 0, featureId);
  return {
    sections: layout.sections.map((section) =>
      section.id === sectionId
        ? { ...section, items }
        : {
            ...section,
            items: section.items.filter((id) => id !== featureId),
          },
    ),
    hidden: layout.hidden.filter((id) => id !== featureId),
  };
}

export function moveSidebarSection(
  layout: SidebarLayout,
  sectionId: string,
  targetId: string,
): SidebarLayout {
  const sections = new Map(
    layout.sections.map((section) => [section.id, section]),
  );
  return {
    ...layout,
    sections: moveIdToSlot([...sections.keys()], sectionId, targetId).flatMap(
      (id) => sections.get(id) ?? [],
    ),
  };
}

/** Keep invisible IDs in their existing positions when sorting visible entries. */
export function sortSidebarFeatures(
  section: SidebarLayoutSection,
  labels: ReadonlyMap<string, string>,
  compare: (left: string, right: string) => number,
): SidebarLayoutSection {
  const sorted = section.items
    .flatMap((id) => {
      const label = labels.get(id);
      return label === undefined ? [] : [{ id, label }];
    })
    .sort((left, right) => compare(left.label, right.label));
  let index = 0;
  return {
    ...section,
    items: section.items.map((id) =>
      labels.has(id) ? sorted[index++].id : id,
    ),
  };
}
