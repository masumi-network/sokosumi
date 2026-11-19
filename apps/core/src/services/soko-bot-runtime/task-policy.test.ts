import { describe, expect, it } from "vitest";

import { refuseCusoPersonTask } from "./task-policy";

const REFUSAL = "Here a Task is work for a Coworker";

describe("refuseCusoPersonTask", () => {
  it.each([
    ["the owner", { assignToOwner: true as const }],
    ["a teammate", { memberId: "user-2" }],
    ["nobody", {}],
  ])("refuses a Task Cuso creates for %s", (_who, input) => {
    expect(() => refuseCusoPersonTask("cmo-v2", input, true)).toThrow(REFUSAL);
  });

  it("lets Cuso create and assign a Coworker's Task", () => {
    expect(() =>
      refuseCusoPersonTask("cmo-v2", { coworkerId: "hannah" }, true),
    ).not.toThrow();
    expect(() =>
      refuseCusoPersonTask("cmo-v2", { coworkerId: "hannah" }, false),
    ).not.toThrow();
    // Unassigning hands the Task to nobody new; it stays what it was.
    expect(() =>
      refuseCusoPersonTask("cmo-v2", { coworkerId: null }, false),
    ).not.toThrow();
  });

  it("refuses assigning an existing Task to a person", () => {
    expect(() =>
      refuseCusoPersonTask("cmo-v2", { assignToOwner: true }, false),
    ).toThrow(REFUSAL);
    expect(() =>
      refuseCusoPersonTask("cmo-v2", { memberId: "user-2" }, false),
    ).toThrow(REFUSAL);
  });

  it("leaves every other bot's Tasks alone", () => {
    for (const versionId of ["v33", null, undefined])
      expect(() =>
        refuseCusoPersonTask(versionId, { assignToOwner: true }, true),
      ).not.toThrow();
  });
});
