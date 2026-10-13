import { TaskVisibility } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  buildCoworkerJobParentTaskWhere,
  buildCoworkerPrivateTaskVisibilityWhere,
  buildHumanJobParentVisibilityWhere,
  buildHumanParentTaskVisibilityWhere,
  buildHumanTaskVisibilityWhere,
  buildSokoBotAudienceJobParentTaskWhere,
  buildSokoBotAudienceTaskVisibilityWhere,
  buildSokoBotOwnerTaskVisibilityWhere,
  buildSokoBotReaderJobWhere,
  buildSokoBotReaderTaskWhere,
  buildSokoBotScopeJobWhere,
  buildSokoBotScopeTaskWhere,
  isPrivateTaskVisibleToCoworker,
  isPrivateTaskVisibleToHuman,
  readSokoBotPacketAudience,
  sokoBotSharedScopeOf,
  sokoBotTurnReader,
} from "./task-visibility";

describe("task visibility helpers", () => {
  it("lets humans see public Tasks and their own private Tasks", () => {
    expect(buildHumanTaskVisibilityWhere("user_a")).toEqual({
      OR: [
        { visibility: TaskVisibility.PUBLIC },
        { visibility: TaskVisibility.PRIVATE, ownerId: "user_a" },
      ],
    });

    expect(
      isPrivateTaskVisibleToHuman(
        { visibility: TaskVisibility.PUBLIC, ownerId: "user_b" },
        "user_a",
      ),
    ).toBe(true);
    expect(
      isPrivateTaskVisibleToHuman(
        { visibility: TaskVisibility.PRIVATE, ownerId: "user_a" },
        "user_a",
      ),
    ).toBe(true);
    expect(
      isPrivateTaskVisibleToHuman(
        { visibility: TaskVisibility.PRIVATE, ownerId: "user_b" },
        "user_a",
      ),
    ).toBe(false);
  });

  it("reuses human visibility for parent-task and Soko Bot owner filters", () => {
    const humanWhere = buildHumanTaskVisibilityWhere("user_a");

    expect(buildHumanParentTaskVisibilityWhere("user_a")).toEqual(humanWhere);
    expect(buildSokoBotOwnerTaskVisibilityWhere("user_a")).toEqual(humanWhere);
    expect(buildHumanJobParentVisibilityWhere("user_a")).toEqual({
      OR: [{ taskId: null }, { task: { is: humanWhere } }],
    });
  });

  it("limits teammate and assistant Soko Bot reads to public Tasks", () => {
    expect(
      buildSokoBotAudienceTaskVisibilityWhere("user_a", "TEAMMATE"),
    ).toEqual({ visibility: TaskVisibility.PUBLIC });
    expect(
      buildSokoBotAudienceTaskVisibilityWhere("user_a", "ASSISTANT"),
    ).toEqual({ visibility: TaskVisibility.PUBLIC });
    expect(
      buildSokoBotAudienceTaskVisibilityWhere("user_a", undefined),
    ).toEqual({ visibility: TaskVisibility.PUBLIC });
    expect(buildSokoBotAudienceTaskVisibilityWhere("user_a", "OWNER")).toEqual(
      buildSokoBotOwnerTaskVisibilityWhere("user_a"),
    );
    expect(
      buildSokoBotAudienceJobParentTaskWhere("user_a", "TEAMMATE"),
    ).toEqual({
      OR: [
        { taskId: null },
        { task: { is: { visibility: TaskVisibility.PUBLIC } } },
      ],
    });
  });

  it("reads askedBy.kind from a stored Soko Bot packet", () => {
    expect(
      readSokoBotPacketAudience({
        trigger: { askedBy: { kind: "TEAMMATE" } },
      }),
    ).toBe("TEAMMATE");
    expect(
      readSokoBotPacketAudience({ memory: { version: 1 } }),
    ).toBeUndefined();
  });

  it("keeps private Tasks on the coworker vendor-family seam", () => {
    expect(
      buildCoworkerPrivateTaskVisibilityWhere({
        coworkerId: "cow_1",
        vendorId: "vendor_1",
      }),
    ).toEqual({
      OR: [
        { visibility: TaskVisibility.PUBLIC },
        { visibility: TaskVisibility.PRIVATE, assigneeId: "cow_1" },
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: { not: "cow_1" },
          assignee: { vendorId: "vendor_1" },
        },
      ],
    });

    expect(
      isPrivateTaskVisibleToCoworker(
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: "cow_1",
          assignee: { vendorId: "vendor_1" },
        },
        { coworkerId: "cow_1", vendorId: "vendor_1" },
      ),
    ).toBe(true);
    expect(
      isPrivateTaskVisibleToCoworker(
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: "cow_2",
          assignee: { vendorId: "vendor_1" },
        },
        { coworkerId: "cow_1", vendorId: "vendor_1" },
      ),
    ).toBe(true);
    expect(
      isPrivateTaskVisibleToCoworker(
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: "cow_3",
          assignee: { vendorId: "vendor_other" },
        },
        { coworkerId: "cow_1", vendorId: "vendor_1" },
      ),
    ).toBe(false);
    expect(
      isPrivateTaskVisibleToCoworker(
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: null,
          assignee: null,
        },
        { coworkerId: "cow_1", vendorId: "vendor_1" },
      ),
    ).toBe(false);

    expect(
      buildCoworkerJobParentTaskWhere({
        coworkerId: "cow_1",
        vendorId: "vendor_1",
      }),
    ).toEqual({
      task: {
        is: {
          OR: [
            { assigneeId: "cow_1" },
            {
              visibility: TaskVisibility.PRIVATE,
              assignee: { vendorId: "vendor_1" },
            },
          ],
        },
      },
    });
  });
});

describe("shared Soko Bot scope", () => {
  const project = { sokoBotId: "bot_1", workspaceId: "ws_1", projectId: "p_1" };
  const workspace = { ...project, projectId: null };

  it("has no scope for a personal bot and keeps a shared bot's columns", () => {
    const columns = { id: "bot_1", workspaceId: "ws_1", projectId: "p_1" };
    expect(sokoBotSharedScopeOf({ ...columns, userId: "owner" })).toBeNull();
    expect(sokoBotSharedScopeOf({ ...columns, userId: null })).toEqual(project);
  });

  it("pins the workspace and PUBLIC, and the Project for a project bot", () => {
    expect(buildSokoBotScopeTaskWhere(project)).toEqual({
      workspaceId: "ws_1",
      visibility: TaskVisibility.PUBLIC,
      projectId: "p_1",
    });
    expect(buildSokoBotScopeTaskWhere(workspace)).toEqual({
      workspaceId: "ws_1",
      visibility: TaskVisibility.PUBLIC,
    });
  });

  it("scopes Jobs to the bot's own hires or a visible Task", () => {
    expect(buildSokoBotScopeJobWhere(project)).toEqual({
      workspaceId: "ws_1",
      OR: [
        { sokoBotDelegations: { some: { turn: { sokoBotId: "bot_1" } } } },
        { task: { is: buildSokoBotScopeTaskWhere(project) } },
      ],
    });
  });

  it("never reads as OWNER for a shared bot", () => {
    expect(sokoBotTurnReader("member", "OWNER", project).audience).toBe(
      "TEAMMATE",
    );
    expect(sokoBotTurnReader("member", undefined, project).audience).toBe(
      "TEAMMATE",
    );
    expect(sokoBotTurnReader("member", "ASSISTANT", project).audience).toBe(
      "ASSISTANT",
    );
    expect(sokoBotTurnReader("owner", "OWNER", null).audience).toBe("OWNER");
  });

  it("routes reader wheres by scope and keeps the personal ones unchanged", () => {
    const owner = sokoBotTurnReader("owner", "OWNER", null);
    expect(buildSokoBotReaderTaskWhere(owner)).toEqual(
      buildSokoBotAudienceTaskVisibilityWhere("owner", "OWNER"),
    );
    expect(buildSokoBotReaderJobWhere(owner)).toEqual({
      ownerId: "owner",
      ...buildSokoBotAudienceJobParentTaskWhere("owner", "OWNER"),
    });
    const shared = sokoBotTurnReader("member", "OWNER", project);
    expect(buildSokoBotReaderTaskWhere(shared)).toEqual(
      buildSokoBotScopeTaskWhere(project),
    );
    expect(buildSokoBotReaderJobWhere(shared)).toEqual(
      buildSokoBotScopeJobWhere(project),
    );
  });
});
