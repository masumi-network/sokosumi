import { describe, expect, it } from "vitest";

import {
  assigneePeopleLock,
  withCurrentProjectOption,
} from "./task-property-options";

describe("assigneePeopleLock", () => {
  it("needs an agent on a Scheduled Task, even a private one", () => {
    expect(
      assigneePeopleLock({ status: "QUEUED", visibility: "PRIVATE" }),
    ).toBe("agentRequired");
  });

  it("keeps people off a private Task", () => {
    expect(assigneePeopleLock({ status: "DRAFT", visibility: "PRIVATE" })).toBe(
      "private",
    );
  });

  it("leaves a public Ready Task open to people", () => {
    expect(
      assigneePeopleLock({ status: "READY", visibility: "PUBLIC" }),
    ).toBeNull();
  });
});

describe("withCurrentProjectOption", () => {
  const listed = [{ id: "proj_1", name: "Launch" }];

  it("adds the Task's project when the capped list misses it", () => {
    const options = withCurrentProjectOption(listed, "proj_9", {
      id: "proj_9",
      name: "Archive",
      logo: null,
    });
    expect(options?.map((option) => option.id)).toEqual(["proj_9", "proj_1"]);
  });

  it("returns null when the Task's project cannot be loaded at all", () => {
    expect(withCurrentProjectOption([], "proj_9", null)).toBeNull();
  });

  it("returns null when the project list itself failed", () => {
    expect(withCurrentProjectOption(null, null, null)).toBeNull();
  });

  it("keeps the list as is when it already holds the project", () => {
    expect(withCurrentProjectOption(listed, "proj_1", null)).toBe(listed);
  });
});
