import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";

const mocks = vi.hoisted(() => ({
  bot: vi.fn(),
  catalog: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBot: { findUnique: mocks.bot } },
}));
vi.mock("@/services/soko-bot-integrations.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/soko-bot-integrations.service")
  >()),
  searchSokoBotIntegrationCatalog: mocks.catalog,
}));
vi.mock("@/services/soko-bot-integration-list.service", () => ({
  listSokoBotIntegrationsForBot: mocks.list,
}));

import { SokoBotRuntimeService } from "../soko-bot-runtime.service";

const userId = randomUUID();
const workspaceId = randomUUID();
const sokoBotId = randomUUID();
const turnId = randomUUID();

const authorized = {
  toolCallLimit: 64,
  turn: {
    id: turnId,
    actingUserId: userId,
    requestedByUserId: userId,
    workspaceId,
    sokoBotId,
    eveSessionId: "find-integrations-test",
    versionId: null,
    source: "CHAT",
    chainDepth: 0,
  },
  classificationConfidence: 1,
  reader: { userId, audience: undefined, sharedScope: null },
} as unknown as AuthorizedSokoBotRuntime;

function run(query: string) {
  const service = new SokoBotRuntimeService();
  vi.spyOn(service, "authorize").mockResolvedValue(authorized);
  return service["executeAuthorizedTool"]({
    turnId,
    toolCallId: "call_1",
    capability: "find_integrations",
    input: { query },
  } as never);
}

const entry = (provider: string, name: string) => ({
  provider,
  name,
  description: `${name} things`,
  logoUrl: null,
  kinds: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.catalog.mockResolvedValue([
    entry("hubspot", "HubSpot"),
    entry("notion", "Notion"),
  ]);
  mocks.list.mockResolvedValue({
    configured: true,
    integrations: [{ provider: "notion", status: "ACTIVE" }],
  });
});

describe("find_integrations", () => {
  it("links an app that is not connected to the owner's bot page", async () => {
    mocks.bot.mockResolvedValue({ userId });

    expect(await run("crm")).toEqual({
      apps: [
        {
          provider: "hubspot",
          name: "HubSpot",
          description: "HubSpot things",
          status: "DISCONNECTED",
          connectLink: "/personal-assistant?connect=hubspot",
        },
        {
          provider: "notion",
          name: "Notion",
          description: "Notion things",
          status: "ACTIVE",
          connectLink: null,
        },
      ],
    });
    expect(mocks.catalog).toHaveBeenCalledWith("crm", 10);
  });

  it("links a team bot's own page", async () => {
    mocks.bot.mockResolvedValue({ userId: null });

    const result = (await run("hubspot")) as {
      apps: { connectLink: string | null }[];
    };
    expect(result.apps[0]?.connectLink).toBe(
      `/soko-bots/${sokoBotId}?connect=hubspot`,
    );
  });
});
