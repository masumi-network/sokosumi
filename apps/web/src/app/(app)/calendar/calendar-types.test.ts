import { describe, expect, it } from "vitest";
import {
  availableCalendarTypes,
  selectedCalendarTypes,
} from "./calendar-types";

describe("availableCalendarTypes", () => {
  it("offers every feature when Newsletter is on", () => {
    expect(availableCalendarTypes(true)).toEqual([
      "tasks",
      "social",
      "newsletter",
      "contacts",
      "marketing",
    ]);
  });

  it("hides Newsletter when the workspace has none", () => {
    expect(availableCalendarTypes(false)).toEqual([
      "tasks",
      "social",
      "contacts",
      "marketing",
    ]);
  });

  it("hides Follow-ups under a Project, as Core does", () => {
    expect(availableCalendarTypes(true, { projectId: "project-1" })).toEqual([
      "tasks",
      "social",
      "newsletter",
      "marketing",
    ]);
  });

  it("hides the Marketing plan under scope=owned, as Core does", () => {
    expect(availableCalendarTypes(true, { scope: "owned" })).toEqual([
      "tasks",
      "social",
      "newsletter",
      "contacts",
    ]);
  });

  it("applies both Project and owned drops together", () => {
    expect(
      availableCalendarTypes(false, {
        projectId: "project-1",
        scope: "owned",
      }),
    ).toEqual(["tasks", "social"]);
  });
});

describe("selectedCalendarTypes", () => {
  it("falls back to what is offered when the URL names only a dropped feature", () => {
    expect(
      selectedCalendarTypes(
        ["contacts"],
        availableCalendarTypes(true, { projectId: "project-1" }),
      ),
    ).toEqual(["tasks", "social", "newsletter", "marketing"]);
  });
});
