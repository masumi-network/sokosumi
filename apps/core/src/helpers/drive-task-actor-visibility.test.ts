import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";
import type {
  AuthenticationContext,
  SharedSokoBotAuthenticationContext,
} from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  driveActorProjectPageParams,
  driveActorTaskWhere,
} from "./drive-task-actor-visibility";
import {
  buildHumanTaskVisibilityWhere,
  buildSokoBotOwnerTaskVisibilityWhere,
} from "./task-visibility";

const BOT_ID = "01960001-0001-7001-8001-000000000099";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";

const user: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const coworker: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: null },
};

const personalBot: AuthenticationContext = {
  actor: "sokoBot",
  scope: "personal",
  sokoBotId: BOT_ID,
  userId: "owner_1",
  workspaceId: WORKSPACE_ID,
  organizationId: null,
};

const sharedBots: SharedSokoBotAuthenticationContext[] = [
  {
    actor: "sokoBot",
    scope: "workspace",
    sokoBotId: BOT_ID,
    userId: null,
    workspaceId: WORKSPACE_ID,
    organizationId: "org_1",
    projectId: null,
  },
  {
    actor: "sokoBot",
    scope: "project",
    sokoBotId: BOT_ID,
    userId: null,
    workspaceId: WORKSPACE_ID,
    organizationId: "org_1",
    projectId: "01960001-0001-7001-8001-000000000077",
  },
];

describe("driveActorTaskWhere", () => {
  it("applies Task visibility for a person", () => {
    expect(driveActorTaskWhere(user, "user_123")).toEqual({
      AND: [buildHumanTaskVisibilityWhere("user_123")],
    });
  });

  it("adds nothing for a coworker, whose access filter is separate", () => {
    expect(driveActorTaskWhere(coworker, "user_123")).toEqual({});
  });

  it("limits a personal bot to its own non-draft tasks under its owner's visibility", () => {
    expect(driveActorTaskWhere(personalBot, "reader_1")).toEqual({
      assigneeSokoBotId: BOT_ID,
      status: { not: TaskStatus.DRAFT },
      AND: [buildSokoBotOwnerTaskVisibilityWhere("owner_1")],
    });
  });

  it.each(sharedBots)("answers 403 for a shared $scope bot", (sharedBot) => {
    expect(() => driveActorTaskWhere(sharedBot, "user_123")).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
});

describe("driveActorProjectPageParams", () => {
  it("passes the reader for a person", () => {
    expect(driveActorProjectPageParams(user, "user_123")).toEqual({
      readerUserId: "user_123",
    });
  });

  it("passes nothing for a coworker", () => {
    expect(driveActorProjectPageParams(coworker, "user_123")).toEqual({});
  });

  it("passes the bot and its owner for a personal bot", () => {
    expect(driveActorProjectPageParams(personalBot, "reader_1")).toEqual({
      assigneeSokoBotId: BOT_ID,
      sokoBotOwnerUserId: "owner_1",
    });
  });

  it.each(sharedBots)("answers 403 for a shared $scope bot", (sharedBot) => {
    expect(() => driveActorProjectPageParams(sharedBot, "user_123")).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
});
