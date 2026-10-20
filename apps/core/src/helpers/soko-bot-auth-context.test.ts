import { describe, expect, it } from "vitest";

import {
  buildSokoBotKeyAuthContext,
  personalSokoBotAuthContext,
  type SokoBotKeyHolder,
  sokoBotKeyWorkspaceWhere,
} from "./soko-bot-auth-context";

const BOT_ID = "01960001-0001-7001-8001-000000000099";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";
const PROJECT_ID = "01960001-0001-7001-8001-000000000077";

const activeOwner = { banned: false, banExpires: null };

const personalBot: SokoBotKeyHolder = {
  archivedAt: null,
  deletedAt: null,
  userId: "user_123",
  projectId: null,
  workspaceId: WORKSPACE_ID,
  user: activeOwner,
};

const workspaceBot: SokoBotKeyHolder = {
  archivedAt: null,
  deletedAt: null,
  userId: null,
  projectId: null,
  workspaceId: WORKSPACE_ID,
  user: null,
};

const projectBot: SokoBotKeyHolder = { ...workspaceBot, projectId: PROJECT_ID };

const orgWorkspace = { organizationId: "org_1" };
const personalWorkspace = { organizationId: null };

const deadBots: Array<[string, SokoBotKeyHolder]> = [
  ["archived personal", { ...personalBot, archivedAt: new Date() }],
  ["deleted personal", { ...personalBot, deletedAt: new Date() }],
  [
    "personal with a banned owner",
    { ...personalBot, user: { banned: true, banExpires: null } },
  ],
  ["personal with no owner row", { ...personalBot, user: null }],
  ["archived shared", { ...workspaceBot, archivedAt: new Date() }],
  ["deleted shared", { ...projectBot, deletedAt: new Date() }],
];

describe("personalSokoBotAuthContext", () => {
  it("builds the owner context in the given workspace", () => {
    expect(
      personalSokoBotAuthContext(
        { sokoBotId: BOT_ID, userId: "user_123" },
        { id: WORKSPACE_ID, organizationId: "org_1" },
      ),
    ).toEqual({
      actor: "sokoBot",
      scope: "personal",
      sokoBotId: BOT_ID,
      userId: "user_123",
      workspaceId: WORKSPACE_ID,
      organizationId: "org_1",
    });
  });
});

describe("sokoBotKeyWorkspaceWhere", () => {
  it("asks whether the personal bot's owner still reaches the workspace", () => {
    expect(sokoBotKeyWorkspaceWhere(personalBot)).toEqual({
      id: WORKSPACE_ID,
      OR: [
        { userId: "user_123" },
        { organization: { members: { some: { userId: "user_123" } } } },
      ],
    });
  });

  it.each([
    ["workspace", workspaceBot],
    ["project", projectBot],
  ])("asks only for an Organization workspace for a %s bot", (_, bot) => {
    expect(sokoBotKeyWorkspaceWhere(bot)).toEqual({
      id: WORKSPACE_ID,
      organizationId: { not: null },
    });
  });

  it.each(deadBots)("skips the lookup for an %s bot", (_, bot) => {
    expect(sokoBotKeyWorkspaceWhere(bot)).toBeNull();
  });
});

describe("buildSokoBotKeyAuthContext", () => {
  it("builds a personal context, keeping a personal workspace", () => {
    expect(
      buildSokoBotKeyAuthContext(BOT_ID, personalBot, personalWorkspace),
    ).toEqual({
      actor: "sokoBot",
      scope: "personal",
      sokoBotId: BOT_ID,
      userId: "user_123",
      workspaceId: WORKSPACE_ID,
      organizationId: null,
    });
  });

  it("refuses a personal bot whose owner no longer reaches the workspace", () => {
    expect(buildSokoBotKeyAuthContext(BOT_ID, personalBot, null)).toBeNull();
  });

  it("builds a workspace-scoped shared context with no user", () => {
    expect(
      buildSokoBotKeyAuthContext(BOT_ID, workspaceBot, orgWorkspace),
    ).toEqual({
      actor: "sokoBot",
      scope: "workspace",
      sokoBotId: BOT_ID,
      userId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_1",
      projectId: null,
    });
  });

  it("builds a project-scoped shared context carrying the project", () => {
    expect(
      buildSokoBotKeyAuthContext(BOT_ID, projectBot, orgWorkspace),
    ).toEqual({
      actor: "sokoBot",
      scope: "project",
      sokoBotId: BOT_ID,
      userId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_1",
      projectId: PROJECT_ID,
    });
  });

  it("refuses a shared bot when the workspace is missing", () => {
    expect(buildSokoBotKeyAuthContext(BOT_ID, workspaceBot, null)).toBeNull();
  });

  it("refuses a shared bot in a personal workspace", () => {
    expect(
      buildSokoBotKeyAuthContext(BOT_ID, projectBot, personalWorkspace),
    ).toBeNull();
  });

  it.each(deadBots)("refuses an %s bot", (_, bot) => {
    expect(buildSokoBotKeyAuthContext(BOT_ID, bot, orgWorkspace)).toBeNull();
  });
});
