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
    expect(getOwnerOrchestratorOption(null)).toBeNull();
  });

  it("maps the owner bot as an orchestrator option", () => {
    expect(getOwnerOrchestratorOption(baseBot())).toMatchObject({
      id: "bot-1",
      slug: "personal-assistant",
      name: "Jarvis",
      kind: "orchestrator",
      vendor: { id: "personal-assistant", slug: "personal-assistant" },
    });
  });

  it("prepends the owner option once", () => {
    const options = getCoworkerOptions([baseCoworker()]);
    const withBot = withOwnerOrchestratorOption(options, baseBot());
    expect(withBot[0]?.kind).toBe("orchestrator");
    expect(withOwnerOrchestratorOption(withBot, baseBot())).toHaveLength(
      withBot.length,
    );
  });

  it("resolves selected ids onto the matching assignee field", () => {
    const options = withOwnerOrchestratorOption(
      getCoworkerOptions([baseCoworker()]),
      baseBot(),
    );
    expect(resolveTaskAssigneeFields("bot-1", options)).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: "bot-1",
    });
    expect(resolveTaskAssigneeFields("cow_1", options)).toEqual({
      assigneeId: "cow_1",
      assigneeOrchestratorId: null,
    });
    expect(resolveTaskAssigneeFields("", options)).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: null,
    });
  });

  it("prefers orchestrator id for the task form initial value", () => {
    expect(
      taskFormAssigneeId({
        assigneeId: "cow_1",
        assigneeOrchestratorId: "bot-1",
      }),
    ).toBe("bot-1");
    expect(
      taskFormAssigneeId({ assigneeId: "cow_1", assigneeOrchestratorId: null }),
    ).toBe("cow_1");
  });
});
