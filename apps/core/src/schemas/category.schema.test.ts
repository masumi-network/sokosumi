import type { Category as DatabaseCategory } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { mapCategoryForApi, parseCategoryStyles } from "./category.schema";

describe("parseCategoryStyles", () => {
  it("parses a valid JSON string into a structured styles object", () => {
    expect(
      parseCategoryStyles(
        JSON.stringify({
          light: {
            color: "text-default-foreground",
          },
        }),
      ),
    ).toEqual({
      light: {
        color: "text-default-foreground",
      },
    });
  });

  it("returns null when styles are null", () => {
    expect(parseCategoryStyles(null)).toBeNull();
  });

  it("returns null when styles are invalid JSON", () => {
    expect(parseCategoryStyles("{invalid json}")).toBeNull();
  });

  it("returns null when parsed JSON has the wrong shape", () => {
    expect(
      parseCategoryStyles(
        JSON.stringify({
          light: {
            color: 123,
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("mapCategoryForApi", () => {
  it("preserves category fields and parses styles", () => {
    const category: DatabaseCategory = {
      id: "cat_123",
      createdAt: new Date("2026-03-17T10:00:00.000Z"),
      updatedAt: new Date("2026-03-17T10:00:00.000Z"),
      name: "Research",
      slug: "research",
      description: "Agents for research tasks",
      image: null,
      icon: null,
      priority: 0,
      styles: JSON.stringify({
        dark: {
          color: "text-white",
        },
      }),
    };

    expect(mapCategoryForApi(category)).toEqual({
      id: "cat_123",
      name: "Research",
      slug: "research",
      description: "Agents for research tasks",
      image: null,
      icon: null,
      priority: 0,
      styles: {
        dark: {
          color: "text-white",
        },
      },
    });
  });
});
