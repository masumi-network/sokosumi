import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ default: { sokoBot: { findUnique } } }));

import {
  loadSokoBotTurnAuthContext,
  type SokoBotTurnPrincipal,
  sokoBotTurnAuthContext,
} from "./soko-bot-turn-auth-context";

const TURN = {
  sokoBotId: "bot_1",
  actingUserId: "member",
  workspaceId: "ws_1",
};
const ORG_WS = { id: "ws_1", organizationId: "org_1" };

function principal(
  overrides: Partial<SokoBotTurnPrincipal> = {},
): SokoBotTurnPrincipal {
  return { userId: "member", projectId: null, workspace: ORG_WS, ...overrides };
}

beforeEach(() => {
  findUnique.mockReset();
});

describe("sokoBotTurnAuthContext", () => {
  it("acts as the owner for their personal bot", () => {
    expect(sokoBotTurnAuthContext(TURN, principal())).toEqual({
      actor: "sokoBot",
      scope: "personal",
      sokoBotId: "bot_1",
      userId: "member",
      workspaceId: "ws_1",
      organizationId: "org_1",
    });
  });

  it("acts as the workspace bot itself for a shared workspace bot", () => {
    expect(sokoBotTurnAuthContext(TURN, principal({ userId: null }))).toEqual({
      actor: "sokoBot",
      scope: "workspace",
      sokoBotId: "bot_1",
      userId: null,
      workspaceId: "ws_1",
      organizationId: "org_1",
      projectId: null,
    });
  });

  it("acts as the project bot itself for a shared project bot", () => {
    expect(
      sokoBotTurnAuthContext(
        TURN,
        principal({ userId: null, projectId: "project_1" }),
      ),
    ).toMatchObject({ scope: "project", userId: null, projectId: "project_1" });
  });

  it("refuses a personal bot that is not the turn member's", () => {
    expect(
      sokoBotTurnAuthContext(TURN, principal({ userId: "someone-else" })),
    ).toBeNull();
  });

  it("refuses a shared bot outside an Organization workspace", () => {
    expect(
      sokoBotTurnAuthContext(
        TURN,
        principal({
          userId: null,
          workspace: { id: "ws_1", organizationId: null },
        }),
      ),
    ).toBeNull();
  });

  it("refuses a bot in another workspace than the turn's", () => {
    expect(
      sokoBotTurnAuthContext(
        TURN,
        principal({ workspace: { id: "ws_2", organizationId: "org_1" } }),
      ),
    ).toBeNull();
  });
});

describe("loadSokoBotTurnAuthContext", () => {
  it("loads the turn's bot and builds its context", async () => {
    findUnique.mockResolvedValue(principal({ userId: null }));
    expect(await loadSokoBotTurnAuthContext(TURN)).toMatchObject({
      scope: "workspace",
      userId: null,
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bot_1" } }),
    );
  });

  it("returns null for a missing bot", async () => {
    findUnique.mockResolvedValue(null);
    expect(await loadSokoBotTurnAuthContext(TURN)).toBeNull();
  });
});
