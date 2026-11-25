import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAuthenticationContext } from "@/middleware/auth";

const { increment } = vi.hoisted(() => ({ increment: vi.fn() }));
vi.mock("@/lib/redis-rate-limit", () => ({
  incrementRedisRateLimit: increment,
}));

import {
  AGENT_WRITING_PER_HOUR,
  limitAgentWriting,
} from "./agent-writing-limit";

const person = (
  authenticationMethod: UserAuthenticationContext["authenticationMethod"],
): UserAuthenticationContext => ({
  actor: "user",
  userId: "user-a",
  organizationId: null,
  role: "user",
  authenticationMethod,
});

describe("limitAgentWriting", () => {
  beforeEach(() => vi.resetAllMocks());

  it("never counts a browser session", async () => {
    await limitAgentWriting(person("session"), "workspace-a");

    expect(increment).not.toHaveBeenCalled();
  });

  it.each(["api_key", "oauth"] as const)(
    "counts a %s caller per workspace per hour",
    async (method) => {
      increment.mockResolvedValue(AGENT_WRITING_PER_HOUR);

      await limitAgentWriting(person(method), "workspace-a");

      expect(increment).toHaveBeenCalledWith(
        "studio:agent-writing:workspace-a",
        3600,
      );
    },
  );

  it("answers 429 past the hourly cap", async () => {
    increment.mockResolvedValue(AGENT_WRITING_PER_HOUR + 1);

    await expect(
      limitAgentWriting(person("api_key"), "workspace-a"),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("lets the call through when Redis is unavailable", async () => {
    increment.mockResolvedValue(undefined);

    await expect(
      limitAgentWriting(person("oauth"), "workspace-a"),
    ).resolves.toBeUndefined();
  });
});
