import { describe, expect, it } from "vitest";
import { seoPageChangeBody } from "./seo-page-change-model";
import { seoTestWorkspace } from "./seo-test-fixture";

describe("manual page change intent", () => {
  it("keeps explicit pages and occurrence time instead of using import time", () => {
    const form = new FormData();
    form.set("occurredAt", "2026-01-01T14:30:00.000Z");
    form.set("title", " Updated page title ");
    form.set("note", "Published by the website team");
    expect(seoPageChangeBody(form, seoTestWorkspace())).toEqual({
      pageIds: seoTestWorkspace().scope.pageIds,
      occurredAt: new Date("2026-01-01T14:30:00.000Z"),
      title: "Updated page title",
      note: "Published by the website team",
    });
  });
  it("rejects an invalid time or empty selection before recording history", () => {
    const form = new FormData();
    form.set("occurredAt", "invalid");
    expect(() => seoPageChangeBody(form, seoTestWorkspace())).toThrow();
    form.set("occurredAt", "2026-01-01T14:30:00.000Z");
    const workspace = seoTestWorkspace();
    workspace.scope.pageIds = [];
    expect(() => seoPageChangeBody(form, workspace)).toThrow();
  });
});
