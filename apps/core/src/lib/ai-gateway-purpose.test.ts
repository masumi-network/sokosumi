import { createGateway, gateway } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, findUniqueMock, evalWorkspaceMock } = vi.hoisted(() => ({
  envMock: vi.fn(),
  findUniqueMock: vi.fn(),
  evalWorkspaceMock: vi.fn(),
}));
vi.mock("@/lib/evals/eval-guard", () => ({
  isEvalWorkspace: evalWorkspaceMock,
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, createGateway: vi.fn(actual.createGateway) };
});
vi.mock("@/config/env", () => ({ getEnv: envMock }));
vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotTurn: { findUnique: findUniqueMock } },
}));

import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { isProjectMemoryConfigured } from "@/lib/project-memory-config";
import { sokoBotModelRequest } from "@/lib/soko-bot/model-policy";
import {
  aiGateway,
  aiGatewayApiKey,
  sokoBotTurnPurpose,
} from "./ai-gateway-purpose";
import { loadSokoBotTurnPurpose } from "./ai-gateway-turn-purpose";

const ALL_KEYS = {
  AI_GATEWAY_API_KEY: "shared",
  SOKO_BOT_AI_GATEWAY_API_KEY: "bot",
  CMO_AI_GATEWAY_API_KEY: "cmo",
  PROJECT_MEMORY_AI_GATEWAY_API_KEY: "memory",
  EVALS_AI_GATEWAY_API_KEY: "evals",
};

describe("aiGatewayApiKey", () => {
  beforeEach(() => envMock.mockReturnValue(ALL_KEYS));

  it("returns each purpose's own key", () => {
    expect(aiGatewayApiKey("soko-bot")).toBe("bot");
    expect(aiGatewayApiKey("cmo")).toBe("cmo");
    expect(aiGatewayApiKey("project-memory")).toBe("memory");
    expect(aiGatewayApiKey("evals")).toBe("evals");
    expect(aiGatewayApiKey("default")).toBe("shared");
    expect(aiGatewayApiKey()).toBe("shared");
  });

  it("falls back to the shared key for every purpose until one is set", () => {
    envMock.mockReturnValue({ AI_GATEWAY_API_KEY: "shared" });
    for (const purpose of [
      "soko-bot",
      "cmo",
      "project-memory",
      "evals",
      "default",
    ] as const)
      expect(aiGatewayApiKey(purpose)).toBe("shared");
  });

  it("is undefined when nothing is set", () => {
    envMock.mockReturnValue({});
    expect(aiGatewayApiKey("cmo")).toBeUndefined();
  });

  it("never lets a purpose key leak into the default purpose", () => {
    envMock.mockReturnValue({ CMO_AI_GATEWAY_API_KEY: "cmo" });
    expect(aiGatewayApiKey("default")).toBeUndefined();
  });
});

describe("aiGateway", () => {
  it("keeps the SDK's default gateway without a purpose key", () => {
    envMock.mockReturnValue({ AI_GATEWAY_API_KEY: "shared" });
    expect(aiGateway("cmo")).toBe(gateway);
    expect(aiGateway()).toBe(gateway);
  });

  it("builds a keyed gateway when the purpose has a key", () => {
    envMock.mockReturnValue(ALL_KEYS);
    expect(aiGateway("evals")).not.toBe(gateway);
    expect(aiGateway("default")).toBe(gateway);
  });

  it("keys a bot request by its purpose: judge on evals, agent on cmo", () => {
    envMock.mockReturnValue(ALL_KEYS);
    for (const [purpose, apiKey] of [
      ["evals", "evals"],
      ["cmo", "cmo"],
    ] as const) {
      vi.mocked(createGateway).mockClear();
      sokoBotModelRequest({
        role: "agent",
        model: "google/gemini-3.6-flash",
        purpose,
      });
      expect(createGateway).toHaveBeenCalledWith({ apiKey });
    }
  });
});

describe("sokoBotTurnPurpose", () => {
  it("sends eval turns to evals, even on a CMO version", () => {
    expect(sokoBotTurnPurpose({ clientTurnId: "lab:eval:r1" })).toBe("evals");
    expect(
      sokoBotTurnPurpose({
        clientTurnId: "lab:eval:r1",
        versionId: CMO_SOKO_BOT_VERSION_ID,
      }),
    ).toBe("evals");
  });

  it("sends CMO turns to cmo", () => {
    expect(sokoBotTurnPurpose({ clientTurnId: "cmo-daily-run:1" })).toBe("cmo");
    expect(sokoBotTurnPurpose({ clientTurnId: "cmo:onboarding:b1" })).toBe(
      "cmo",
    );
    expect(
      sokoBotTurnPurpose({
        clientTurnId: "chat:1",
        versionId: CMO_SOKO_BOT_VERSION_ID,
      }),
    ).toBe("cmo");
  });

  it("sends every lab: turn to evals", () => {
    for (const id of ["lab:event:t1", "lab:ingest:b:1", "lab:eval:r1"])
      expect(sokoBotTurnPurpose({ clientTurnId: id })).toBe("evals");
  });

  it("sends every other turn to soko-bot", () => {
    expect(sokoBotTurnPurpose({ clientTurnId: "chat:1" })).toBe("soko-bot");
    expect(sokoBotTurnPurpose(null)).toBe("soko-bot");
  });

  describe("loading the turn", () => {
    const load = (
      turn: { clientTurnId: string; versionId: string | null },
      inEvalLane: boolean,
    ) => {
      findUniqueMock.mockResolvedValue({ ...turn, workspaceId: "ws-1" });
      evalWorkspaceMock.mockResolvedValue(inEvalLane);
      return loadSokoBotTurnPurpose("t1");
    };

    it("reads the turn and its workspace", async () => {
      await load({ clientTurnId: "chat:1", versionId: null }, false);
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { id: "t1" },
        select: { clientTurnId: true, versionId: true, workspaceId: true },
      });
      expect(evalWorkspaceMock).toHaveBeenCalledWith("ws-1");
    });

    it("bills a lane's CMO turns (cmo: ids, CMO version) to evals", async () => {
      await expect(
        load(
          {
            clientTurnId: "cmo:strategy:b1:1",
            versionId: CMO_SOKO_BOT_VERSION_ID,
          },
          true,
        ),
      ).resolves.toBe("evals");
    });

    it("bills a lane's background children to evals", async () => {
      await expect(
        load({ clientTurnId: "background:t0:research", versionId: null }, true),
      ).resolves.toBe("evals");
      await expect(
        load(
          {
            clientTurnId: "background:t0:month",
            versionId: CMO_SOKO_BOT_VERSION_ID,
          },
          true,
        ),
      ).resolves.toBe("evals");
    });

    it("leaves production turns alone", async () => {
      await expect(
        load({ clientTurnId: "chat:1", versionId: null }, false),
      ).resolves.toBe("soko-bot");
      await expect(
        load(
          {
            clientTurnId: "cmo:strategy:b1:1",
            versionId: CMO_SOKO_BOT_VERSION_ID,
          },
          false,
        ),
      ).resolves.toBe("cmo");
      await expect(
        load(
          {
            clientTurnId: "background:t0:month",
            versionId: CMO_SOKO_BOT_VERSION_ID,
          },
          false,
        ),
      ).resolves.toBe("cmo");
    });
  });
});

describe("project memory routing", () => {
  it("is configured by the memory key or the shared key, with Blob", () => {
    const blob = { BLOB_READ_WRITE_TOKEN: "blob" };
    expect(
      isProjectMemoryConfigured({
        ...blob,
        PROJECT_MEMORY_AI_GATEWAY_API_KEY: "memory",
      }),
    ).toBe(true);
    expect(
      isProjectMemoryConfigured({ ...blob, AI_GATEWAY_API_KEY: "shared" }),
    ).toBe(true);
    expect(isProjectMemoryConfigured({ ...blob })).toBe(false);
    expect(
      isProjectMemoryConfigured({
        PROJECT_MEMORY_AI_GATEWAY_API_KEY: "memory",
      }),
    ).toBe(false);
  });

  it("uses the memory key for the memory gateway", () => {
    envMock.mockReturnValue(ALL_KEYS);
    expect(aiGatewayApiKey("project-memory")).toBe("memory");
    expect(aiGateway("project-memory")).not.toBe(gateway);
  });
});
