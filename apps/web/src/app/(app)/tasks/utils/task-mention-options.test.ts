import { describe, expect, it } from "vitest";
import { mockCoworkerOption } from "@/test-fixtures/coworker";
import {
  buildTaskMentionOptions,
  mentionableUsersFromAssigneeOptions,
  withoutExcludedMentionUsers,
} from "./task-mention-options";

describe("mentionableUsersFromAssigneeOptions", () => {
  it("returns only user-kind coworker options", () => {
    const users = mentionableUsersFromAssigneeOptions([
      mockCoworkerOption({ id: "coworker-1", name: "Elena" }),
      mockCoworkerOption({ id: "user-a", name: "Amy", kind: "user" }),
      mockCoworkerOption({ id: "user-b", name: "Bea", kind: "user" }),
      mockCoworkerOption({ id: "bot-1", name: "Soko", kind: "sokoBot" }),
    ]);

    expect(users).toEqual([
      { id: "user-a", name: "Amy" },
      { id: "user-b", name: "Bea" },
    ]);
  });
});

describe("withoutExcludedMentionUsers", () => {
  it("removes users whose ids appear in the exclusion set", () => {
    const users = [
      { id: "user-a", name: "Amy" },
      { id: "user-b", name: "Bea" },
      { id: "user-c", name: "Cal" },
    ];

    expect(withoutExcludedMentionUsers(users, ["user-a", "user-c"])).toEqual([
      { id: "user-b", name: "Bea" },
    ]);
  });
});

describe("buildTaskMentionOptions", () => {
  it("merges agent and human mention options", () => {
    const options = buildTaskMentionOptions(
      new Map([["agent-1", "Writer Agent"]]),
      [{ id: "user-b", name: "Bea" }],
    );

    expect(options).toEqual({
      "agent-1": { value: "Writer Agent" },
      "user-b": { value: "Bea" },
    });
  });
});
