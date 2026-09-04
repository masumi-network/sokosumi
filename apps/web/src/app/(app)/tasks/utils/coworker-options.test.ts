import { describe, expect, it } from "vitest";
import {
  type Coworker,
  type SokoBot,
  SokoBotStatus,
} from "@/lib/clients/generated/core";

import {
  findCoworkerIdBySlug,
  getCoworkerOptions,
  getOwnerOrchestratorOption,
  getUserOptions,
  resolveTaskAssigneeFields,
  taskFormAssigneeId,
  withOwnerOrchestratorOption,
} from "./coworker-options";

function baseCoworker(overrides: Partial<Coworker> = {}): Coworker {
  return {
    id: "cow_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: "ops-agent",
    name: "Ops Agent",
    baseURL: null,
    vendor: {
      id: "01960001-0001-7001-8001-000000000001",
      createdAt: new Date(),
      updatedAt: new Date(),
      name: "Serviceplan",
      slug: "serviceplan",
      logos: {
        light: null,
        dark: null,
      },
    },
    capabilities: ["tasks"],
    metadata: null,
    ...overrides,
  };
}

describe("getCoworkerOptions", () => {
  it("maps id, name, image, and description", () => {
    const options = getCoworkerOptions([
      baseCoworker({
        id: "id-1",
        name: "Alex",
        slug: "alex",
        image: "https://example.com/a.png",
        description: "Helps with ops",
      }),
    ]);
    expect(options[0]).toMatchObject({
      id: "id-1",
      slug: "alex",
      name: "Alex",
      image: "https://example.com/a.png",
      description: "Helps with ops",
    });
  });

  it("omits description when absent", () => {
    const options = getCoworkerOptions([baseCoworker({ description: null })]);
    expect(options[0]).toMatchObject({
      id: "cow_1",
      slug: "ops-agent",
      name: "Ops Agent",
      image: "",
    });
    expect(options[0]?.description).toBeUndefined();
  });
});

describe("findCoworkerIdBySlug", () => {
  it("returns id for case-insensitive slug match", () => {
    const options = getCoworkerOptions([
      baseCoworker({ id: "a", slug: "alpha", name: "Alpha" }),
      baseCoworker({ id: "b", slug: "beta", name: "Beta" }),
    ]);
    expect(findCoworkerIdBySlug(options, "BETA")).toBe("b");
    expect(findCoworkerIdBySlug(options, "alpha")).toBe("a");
  });

  it("returns null when slug is missing or unknown", () => {
    const options = getCoworkerOptions([baseCoworker()]);
    expect(findCoworkerIdBySlug(options, "nope")).toBeNull();
    expect(findCoworkerIdBySlug(options, "   ")).toBeNull();
  });
});

const OWNER_ORCHESTRATOR_COPY = {
  fallbackName: "Soko Bot",
  vendorName: "Soko Bots",
};

function baseBot(overrides: Partial<SokoBot> = {}): SokoBot {
  return {
    id: "bot-1",
    userId: "user-1",
    name: "Jarvis",
    avatarSeed: "orb:jewel-sky:user-1",
    personalityTone: null,
    personalityDetail: null,
    personalityStyle: null,
    status: SokoBotStatus.IDLE,
    runtimeVersion: null,
    lastSandboxStatus: null,
    memoryVersion: 0,
    memoryHash: null,
    lastActivityAt: null,
    lastTurnAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    consecutiveTurnFailures: 0,
    avatarImageUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("owner orchestrator option", () => {
  it("returns null when the signed-in user has no bot", () => {
    expect(
      getOwnerOrchestratorOption(null, OWNER_ORCHESTRATOR_COPY),
    ).toBeNull();
  });

  it("maps the owner bot as an orchestrator option", () => {
    expect(
      getOwnerOrchestratorOption(baseBot(), OWNER_ORCHESTRATOR_COPY),
    ).toMatchObject({
      id: "bot-1",
      slug: "soko-bots",
      name: "Jarvis",
      kind: "orchestrator",
      vendor: { id: "soko-bots", name: "Soko Bots", slug: "soko-bots" },
    });
  });

  it("prepends the owner option once", () => {
    const options = getCoworkerOptions([baseCoworker()]);
    const withBot = withOwnerOrchestratorOption(
      options,
      baseBot(),
      OWNER_ORCHESTRATOR_COPY,
    );
    expect(withBot[0]?.kind).toBe("orchestrator");
    expect(
      withOwnerOrchestratorOption(withBot, baseBot(), OWNER_ORCHESTRATOR_COPY),
    ).toHaveLength(withBot.length);
  });

  it("resolves selected ids onto the matching assignee field", () => {
    const options = withOwnerOrchestratorOption(
      getCoworkerOptions([baseCoworker()]),
      baseBot(),
      OWNER_ORCHESTRATOR_COPY,
    );
    expect(resolveTaskAssigneeFields("bot-1", options)).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: "bot-1",
      assigneeUserId: null,
    });
    expect(resolveTaskAssigneeFields("cow_1", options)).toEqual({
      assigneeId: "cow_1",
      assigneeOrchestratorId: null,
      assigneeUserId: null,
    });
    expect(resolveTaskAssigneeFields("", options)).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: null,
      assigneeUserId: null,
    });
  });

  it("treats options without kind as marketplace coworkers", () => {
    expect(
      resolveTaskAssigneeFields("coworker-2", [{ id: "coworker-2" }]),
    ).toEqual({
      assigneeId: "coworker-2",
      assigneeOrchestratorId: null,
      assigneeUserId: null,
    });
  });

  it("does not treat an unknown selected id as an orchestrator", () => {
    const options = withOwnerOrchestratorOption(
      getCoworkerOptions([baseCoworker()]),
      baseBot(),
      OWNER_ORCHESTRATOR_COPY,
    );
    expect(resolveTaskAssigneeFields("missing-coworker", options)).toEqual({
      assigneeId: "missing-coworker",
      assigneeOrchestratorId: null,
      assigneeUserId: null,
    });
  });

  it("keeps a known orchestrator id when getMine options are missing", () => {
    expect(
      resolveTaskAssigneeFields(
        "bot-1",
        getCoworkerOptions([baseCoworker()]),
        "bot-1",
      ),
    ).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: "bot-1",
      assigneeUserId: null,
    });
  });

  it("prefers orchestrator id for the task form initial value", () => {
    expect(
      taskFormAssigneeId({
        assigneeId: "cow_1",
        assigneeOrchestratorId: "bot-1",
        assigneeUserId: null,
      }),
    ).toBe("bot-1");
    expect(
      taskFormAssigneeId({ assigneeId: "cow_1", assigneeOrchestratorId: null }),
    ).toBe("cow_1");
    expect(
      taskFormAssigneeId({
        assigneeId: null,
        assigneeOrchestratorId: null,
        assigneeUserId: "user_1",
      }),
    ).toBe("user_1");
  });

  it("resolves a user option onto assigneeUserId", () => {
    expect(
      resolveTaskAssigneeFields("user_1", [
        { id: "user_1", kind: "user" },
        { id: "cow_1", kind: "coworker" },
      ]),
    ).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: null,
      assigneeUserId: "user_1",
    });
  });

  it("builds sorted user options from members", () => {
    expect(
      getUserOptions([
        {
          id: "m_2",
          user: {
            id: "user_2",
            name: "Zoe",
            email: "zoe@example.com",
            image: null,
          },
        },
        {
          id: "m_1",
          user: {
            id: "user_1",
            name: "Amy",
            email: "amy@example.com",
            image: null,
          },
        },
      ] as never),
    ).toMatchObject([
      { id: "user_1", kind: "user", name: "Amy" },
      { id: "user_2", kind: "user", name: "Zoe" },
    ]);
  });

  it("uses translated copy for an unnamed bot and the Soko Bots group", () => {
    expect(
      getOwnerOrchestratorOption(
        baseBot({ name: "  " }),
        OWNER_ORCHESTRATOR_COPY,
      ),
    ).toMatchObject({
      name: "Soko Bot",
      vendor: { name: "Soko Bots" },
    });
  });
});
