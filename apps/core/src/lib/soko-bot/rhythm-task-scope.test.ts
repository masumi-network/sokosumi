import { describe, expect, it } from "vitest";
import {
  buildSokoBotOwnerTaskVisibilityWhere,
  buildSokoBotScopeTaskWhere,
} from "@/helpers/task-visibility";
import { rhythmTaskScope } from "./rhythm-task-scope";

describe("rhythmTaskScope", () => {
  it("follows a personal bot's owner", () => {
    const scope = rhythmTaskScope({
      id: "bot",
      workspaceId: "ws",
      userId: "owner",
    });
    expect(scope.ownerUserId).toBe("owner");
    expect(scope.visible).toEqual(
      buildSokoBotOwnerTaskVisibilityWhere("owner"),
    );
    expect(scope.own).toEqual([
      { ownerId: "owner" },
      { assigneeSokoBotId: "bot" },
    ]);
    expect(scope.chased).toEqual({ ownerId: "owner" });
    // Every arm keeps the rows whose column is null: a Task with no Owner
    // or no bot is never the bot's own.
    expect(scope.notOwn).toEqual([
      { OR: [{ ownerId: { not: "owner" } }, { ownerId: null }] },
      {
        OR: [
          { assigneeSokoBotId: null },
          { assigneeSokoBotId: { not: "bot" } },
        ],
      },
    ]);
  });

  it("follows a shared bot's scope and its own Tasks", () => {
    const scope = rhythmTaskScope({
      id: "bot",
      workspaceId: "ws",
      userId: null,
      projectId: "project",
    });
    const visible = buildSokoBotScopeTaskWhere({
      sokoBotId: "bot",
      workspaceId: "ws",
      projectId: "project",
    });
    expect(scope.ownerUserId).toBeNull();
    expect(scope.visible).toEqual(visible);
    expect(scope.own).toEqual([
      { assigneeSokoBotId: "bot" },
      { creatorSokoBotId: "bot" },
    ]);
    expect(scope.chased).toEqual(visible);
    expect(scope.notOwn).toEqual([
      {
        OR: [
          { assigneeSokoBotId: null },
          { assigneeSokoBotId: { not: "bot" } },
        ],
      },
      {
        OR: [{ creatorSokoBotId: null }, { creatorSokoBotId: { not: "bot" } }],
      },
    ]);
  });

  it("refuses a shared bot read without its projectId", () => {
    expect(() =>
      rhythmTaskScope({
        id: "bot",
        workspaceId: "ws",
        userId: null,
      } as never),
    ).toThrow("projectId");
  });
});
