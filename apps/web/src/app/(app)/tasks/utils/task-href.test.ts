import { describe, expect, it } from "vitest";

import { taskHref, taskLinkHref } from "./task-href";

const base = { id: "9c1f0000-0000-4000-8000-000000000001" };

describe("taskHref", () => {
  it("uses the identifier and a kebab slug of the name", () => {
    expect(
      taskHref({ ...base, identifier: "SOK-12", name: "Fix the login bug" }),
    ).toBe("/tasks/SOK-12-fix-the-login-bug");
  });

  it("falls back to the id without an identifier", () => {
    expect(taskHref({ ...base, identifier: null, name: "Fix login" })).toBe(
      `/tasks/${base.id}`,
    );
  });

  it("strips accents and emoji", () => {
    expect(
      taskHref({ ...base, identifier: "SOK-1", name: "Café Übergabe 🚀 plan" }),
    ).toBe("/tasks/SOK-1-cafe-ubergabe-plan");
  });

  it("drops the slug, and its dash, when the name has nothing usable", () => {
    expect(taskHref({ ...base, identifier: "SOK-12", name: "🚀🚀" })).toBe(
      "/tasks/SOK-12",
    );
    expect(taskHref({ ...base, identifier: "SOK-12", name: "  " })).toBe(
      "/tasks/SOK-12",
    );
  });

  it("truncates long names at a dash boundary within 60 characters", () => {
    const name =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo";
    const href = taskHref({ ...base, identifier: "SOK-7", name });
    const slug = href.replace("/tasks/SOK-7-", "");

    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
    expect(name.replaceAll(" ", "-")).toContain(slug);
    expect(slug).toBe(
      "alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india",
    );
  });

  it("keeps a whole word that ends exactly at the limit", () => {
    const first = "a".repeat(59);
    const href = taskHref({
      ...base,
      identifier: "SOK-7",
      name: `${first} b tail`,
    });

    expect(href).toBe(`/tasks/SOK-7-${first}`);
  });

  it("hard-cuts a single word longer than the limit", () => {
    const href = taskHref({
      ...base,
      identifier: "SOK-7",
      name: "x".repeat(100),
    });

    expect(href).toBe(`/tasks/SOK-7-${"x".repeat(60)}`);
  });
});

describe("taskLinkHref", () => {
  it("uses the identifier URL on the workspace task surface", () => {
    expect(
      taskLinkHref({ ...base, identifier: "SOK-12", name: "Fix login" }),
    ).toBe("/tasks/SOK-12-fix-login");
  });

  it("uses the id under an admin or developer base path", () => {
    expect(
      taskLinkHref(
        { ...base, identifier: "SOK-12", name: "Fix login" },
        "/admin/tasks",
      ),
    ).toBe(`/admin/tasks/${base.id}`);
  });
});
