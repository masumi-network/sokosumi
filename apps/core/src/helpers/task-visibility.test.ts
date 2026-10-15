import { TaskVisibility } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  publicWorkMadeBy,
  WORK_MAKERS,
} from "@/test-fixtures/responsible-work";

import {
  buildCoworkerJobParentTaskWhere,
  buildCoworkerPrivateTaskVisibilityWhere,
  buildHumanJobParentVisibilityWhere,
  buildHumanParentTaskVisibilityWhere,
  buildHumanTaskVisibilityWhere,
  buildResponsibleUserSql,
  buildResponsibleUserWhere,
  buildSokoBotAudienceJobParentTaskWhere,
  buildSokoBotAudienceTaskVisibilityWhere,
  buildSokoBotOwnerTaskVisibilityWhere,
  isPrivateTaskVisibleToCoworker,
  isPrivateTaskVisibleToHuman,
  isResponsibleUser,
  readSokoBotPacketAudience,
  resolveResponsibleUserId,
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

describe("resolveResponsibleUserId", () => {
  const none = {
    ownerId: null,
    creatorUserId: null,
    creatorCoworkerId: null,
    creatorSokoBotId: null,
    requestedByUserId: null,
  };

  it("is the Owner when the work has one", () => {
    expect(
      resolveResponsibleUserId({
        ...none,
        ownerId: "user_owner",
        creatorUserId: "user_creator",
        requestedByUserId: "user_requester",
      }),
    ).toBe("user_owner");
  });

  it("is the person Creator when there is no Owner", () => {
    expect(
      resolveResponsibleUserId({
        ...none,
        creatorUserId: "user_creator",
        requestedByUserId: null,
      }),
    ).toBe("user_creator");
  });

  it("is the Requester when a Coworker made the work and there is no Owner", () => {
    expect(
      resolveResponsibleUserId({
        ...none,
        creatorCoworkerId: "cow_1",
        requestedByUserId: "user_requester",
      }),
    ).toBe("user_requester");
  });

  it("is the Requester when a Soko Bot made the work and there is no Owner", () => {
    expect(
      resolveResponsibleUserId({
        ...none,
        creatorSokoBotId: "01960001-0001-7001-8001-000000000099",
        requestedByUserId: "user_requester",
      }),
    ).toBe("user_requester");
  });

  it("is nobody for work a Soko Bot started on its own", () => {
    expect(
      resolveResponsibleUserId({
        ...none,
        creatorSokoBotId: "01960001-0001-7001-8001-000000000099",
      }),
    ).toBeNull();
  });

  it("is nobody when the person who made the work is deleted", () => {
    expect(resolveResponsibleUserId(none)).toBeNull();
  });

  it("treats omitted columns as absent", () => {
    expect(resolveResponsibleUserId({})).toBeNull();
  });
});

describe("isResponsibleUser", () => {
  it.each(WORK_MAKERS)(
    "matches the person behind work made by a %s",
    (maker) => {
      const work = publicWorkMadeBy(maker, "user_1");
      expect(isResponsibleUser(work, "user_1")).toBe(true);
      expect(isResponsibleUser(work, "user_2")).toBe(false);
    },
  );

  it("matches the Owner of private work", () => {
    expect(
      isResponsibleUser(
        { ...publicWorkMadeBy("sokoBot", "user_1"), ownerId: "user_1" },
        "user_1",
      ),
    ).toBe(true);
  });

  it("matches nobody, not even a missing person, for work nobody is responsible for", () => {
    const work = publicWorkMadeBy("sokoBot", null);
    expect(isResponsibleUser(work, "user_1")).toBe(false);
    expect(isResponsibleUser(work, null)).toBe(false);
    expect(isResponsibleUser(work, undefined)).toBe(false);
  });
});

describe("buildResponsibleUserWhere", () => {
  it("selects work whose Owner is the person while every row has an Owner", () => {
    expect(buildResponsibleUserWhere("user_1")).toEqual({ ownerId: "user_1" });
  });

  it("has a raw SQL twin for queries that alias the task table as t", () => {
    const sql = buildResponsibleUserSql("user_1");

    expect(sql.sql).toBe('t."ownerId" = ?');
    expect(sql.values).toEqual(["user_1"]);
  });
});
