// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import { likelyPages, readVisitCounts, recordVisit } from "./likely-pages";

describe("likely pages", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("counts visits only to pages whose content can preload", () => {
    recordVisit("/tasks");
    recordVisit("/tasks");
    recordVisit("/drive");
    recordVisit("/tasks/task-1");

    expect(readVisitCounts()).toEqual({ "/tasks": 2 });
  });

  it("picks the most visited pages other than the one showing", () => {
    const counts = {
      "/seo": 1,
      "/agents": 3,
      "/": 7,
      "/projects": 5,
      "/tasks": 9,
    };

    expect(likelyPages(counts, "/")).toEqual([
      "/tasks",
      "/projects",
      "/agents",
    ]);
  });

  // A page that leaves the content list must stop costing a render.
  it("skips a stored page that can no longer preload", () => {
    expect(likelyPages({ "/drive": 9, "/tasks": 1 }, "/")).toEqual(["/tasks"]);
  });

  it("starts over from a stored value it cannot read", () => {
    window.localStorage.setItem("sokosumi:likely-pages:v1", "[1,2]");
    recordVisit("/tasks");

    expect(readVisitCounts()).toEqual({ "/tasks": 1 });
  });
});
