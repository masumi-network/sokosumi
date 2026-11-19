import type { SidebarLayout } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  hideSidebarFeature,
  isNewSidebarFeature,
  moveSidebarSection,
  placeSidebarFeature,
  removeSidebarSection,
  resolveSidebarLayout,
  type SidebarFeature,
  sortSidebarFeatures,
} from "./sidebar-layout";

const catalog: SidebarFeature[] = [
  {
    id: "home",
    label: "Home",
    defaultSection: "work",
    available: true,
  },
  {
    id: "overview",
    label: "Overview",
    defaultSection: "work",
    available: false,
  },
  {
    id: "studio",
    label: "Studio",
    defaultSection: "marketing",
    available: true,
  },
  {
    id: "future-feature",
    label: "Future",
    defaultSection: "marketing",
    available: true,
  },
];

describe("account sidebar layout", () => {
  it("resolves the latest defaults even when the workspace has no access to an entry", () => {
    const defaults = resolveSidebarLayout(null, catalog);
    expect(defaults.sections.map(({ id }) => id)).toEqual([
      "work",
      "records",
      "marketing",
      "chats",
    ]);
    expect(defaults.sections[0].items).toEqual(["home", "overview"]);
    expect(defaults.sections[2].items).toEqual(["studio", "future-feature"]);
    expect(isNewSidebarFeature("overview")).toBe(false);
    expect(isNewSidebarFeature("future-feature")).toBe(true);
  });

  it("merges a later release once without undoing moves, explicit hides or future-client entries", () => {
    const saved: SidebarLayout = {
      sections: [
        {
          id: "marketing",
          name: "Team",
          items: ["home", "future-client-only"],
        },
        { id: "my-section", name: "My work", items: ["overview"] },
      ],
      hidden: ["studio"],
    };
    const merged = resolveSidebarLayout(saved, catalog);
    expect(merged.sections[0].items).toEqual([
      "home",
      "future-client-only",
      "future-feature",
    ]);
    expect(merged.sections[1]).toEqual(saved.sections[1]);
    expect(merged.hidden).toEqual(["studio"]);
    expect(saved.sections[0].items).toEqual(["home", "future-client-only"]);
    expect(resolveSidebarLayout(merged, catalog)).toEqual(merged);
    const moved = placeSidebarFeature(merged, "future-feature", "my-section");
    expect(resolveSidebarLayout(moved, catalog)).toEqual(moved);
    const hidden = hideSidebarFeature(moved, "future-feature");
    expect(resolveSidebarLayout(hidden, catalog)).toEqual(hidden);
  });

  it("keeps a deleted default section deleted, including after removing its whole contents", () => {
    const original = resolveSidebarLayout(null, catalog.slice(0, -1));
    const saved = removeSidebarSection(original, "marketing");
    const merged = resolveSidebarLayout(saved, catalog);
    expect(merged.sections.map(({ id }) => id)).toEqual([
      "work",
      "records",
      "chats",
    ]);
    expect(merged.sections[0].items).toContain("future-feature");
    expect(merged.hidden).toContain("studio");
    const empty = { sections: [], hidden: ["home", "overview", "studio"] };
    expect(resolveSidebarLayout(empty, catalog.slice(0, -1))).toEqual(empty);
    expect(resolveSidebarLayout(empty, catalog).sections).toEqual([
      { id: "marketing", name: null, items: ["future-feature"] },
    ]);
  });

  it("moves slots in both directions, appends to an empty section, and restores a hidden feature", () => {
    const initial = resolveSidebarLayout(null, catalog);
    const down = placeSidebarFeature(initial, "home", "work", "overview");
    expect(down.sections[0].items).toEqual(["overview", "home"]);
    expect(placeSidebarFeature(down, "home", "work", "overview")).toEqual(
      initial,
    );
    const hidden = hideSidebarFeature(initial, "home");
    const restored = placeSidebarFeature(hidden, "home", "records");
    expect(restored.hidden).toEqual([]);
    expect(restored.sections[0].items).toEqual(["overview"]);
    expect(restored.sections[1].items).toEqual(["home"]);
    expect(placeSidebarFeature(restored, "home", "gone")).toBe(restored);
    expect(
      moveSidebarSection(restored, "records", "work").sections[0].items,
    ).toEqual(["home"]);
  });

  it("leaves unavailable and unknown features in place during a localized sort", () => {
    const section = {
      id: "work",
      name: null,
      items: ["home", "overview", "studio", "unknown"],
    };
    const sorted = sortSidebarFeatures(
      section,
      new Map([
        ["home", "Z"],
        ["studio", "Ä"],
      ]),
      new Intl.Collator("de").compare,
    );
    expect(sorted.items).toEqual(["studio", "overview", "home", "unknown"]);
    expect(section.items).toEqual(["home", "overview", "studio", "unknown"]);
  });
});
