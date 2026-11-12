import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/prisma", () => ({
  default: { coworkerApiKey: { findUnique } },
}));

import { COWORKER_API_KEY_PREFIX } from "@/lib/coworker-api-key";
import { resolveAgentApiKeyAuthContext } from "./agent-api-key-auth";

const TOKEN = `${COWORKER_API_KEY_PREFIX}test`;

function keyFor(coworker: Record<string, unknown>) {
  return {
    coworkerId: "coworker",
    sokoBotId: null,
    revokedAt: null,
    expiresAt: null,
    coworker: { archivedAt: null, vendorId: "vendor", ...coworker },
    sokoBot: null,
  };
}

describe("resolveAgentApiKeyAuthContext for a personal agent via Buzz", () => {
  beforeEach(() => findUnique.mockReset());

  it("acts for an active owner", async () => {
    findUnique.mockResolvedValue(
      keyFor({
        baseURL: "buzz://relay.example",
        buzzIdentity: {
          ownerIdentity: { user: { banned: false, banExpires: null } },
        },
      }),
    );
    await expect(resolveAgentApiKeyAuthContext(TOKEN)).resolves.toEqual({
      actor: "coworker",
      coworkerId: "coworker",
      vendorId: "vendor",
    });
  });

  it("stops once its owner is banned or their account is gone", async () => {
    findUnique.mockResolvedValueOnce(
      keyFor({
        baseURL: "buzz://relay.example",
        buzzIdentity: {
          ownerIdentity: { user: { banned: true, banExpires: null } },
        },
      }),
    );
    await expect(resolveAgentApiKeyAuthContext(TOKEN)).resolves.toBeNull();
    // A deleted account takes the agent's Buzz identity with it.
    findUnique.mockResolvedValueOnce(
      keyFor({ baseURL: "buzz://relay.example", buzzIdentity: null }),
    );
    await expect(resolveAgentApiKeyAuthContext(TOKEN)).resolves.toBeNull();
  });

  it("leaves other Coworkers as they were", async () => {
    findUnique.mockResolvedValue(
      keyFor({ baseURL: "https://agent.example", buzzIdentity: null }),
    );
    await expect(resolveAgentApiKeyAuthContext(TOKEN)).resolves.toMatchObject({
      actor: "coworker",
    });
  });
});
