import { describe, expect, it } from "vitest";

import {
  readProjectScope,
  scopedHref,
  switchScopeHref,
} from "./project-scope-href";

function params(query = "") {
  return new URLSearchParams(query);
}

describe("readProjectScope", () => {
  it("reads the project from a project page and its sections", () => {
    expect(readProjectScope("/projects/p1", params())).toBe("p1");
    expect(readProjectScope("/projects/p1/calendar", params())).toBe("p1");
  });

  it("reads the filter on a scoped workspace page", () => {
    expect(readProjectScope("/tasks", params("projectId=p2"))).toBe("p2");
    expect(readProjectScope("/drive", params("view=tasks&projectId=p3"))).toBe(
      "p3",
    );
  });

  it("is the workspace everywhere else", () => {
    expect(readProjectScope("/tasks", params())).toBeNull();
    expect(readProjectScope("/projects", params())).toBeNull();
    expect(readProjectScope("/agents", params("projectId=p1"))).toBeNull();
  });
});

describe("scopedHref", () => {
  it("carries the scope onto every scoped page", () => {
    expect(scopedHref("/tasks", "p1")).toBe("/tasks?projectId=p1");
    expect(scopedHref("/schedules", "p1")).toBe("/schedules?projectId=p1");
    expect(scopedHref("/calendar", "p1")).toBe("/calendar?projectId=p1");
    expect(scopedHref("/history", "p1")).toBe("/history?projectId=p1");
    expect(scopedHref("/drive", "p1")).toBe("/drive?view=tasks&projectId=p1");
  });

  it("leaves unscoped links and the workspace view alone", () => {
    expect(scopedHref("/agents", "p1")).toBe("/agents");
    expect(scopedHref("/tasks", null)).toBe("/tasks");
  });
});

describe("switchScopeHref", () => {
  it("shows the other version of a scoped page and resets its filters", () => {
    expect(switchScopeHref("/tasks", "p2")).toBe("/tasks?projectId=p2");
    expect(switchScopeHref("/tasks", null)).toBe("/tasks");
  });

  it("keeps the section when switching between projects", () => {
    expect(switchScopeHref("/projects/p1/calendar", "p2")).toBe(
      "/projects/p2/calendar",
    );
    expect(switchScopeHref("/projects/p1/edit", "p2")).toBe("/projects/p2");
  });

  it("leaves a project page for the list when the workspace is chosen", () => {
    expect(switchScopeHref("/projects/p1/social", null)).toBe("/projects");
  });

  it("opens the project from an unscoped page", () => {
    expect(switchScopeHref("/agents", "p 1")).toBe("/projects/p%201");
    expect(switchScopeHref("/agents", null)).toBe("/agents");
  });
});
