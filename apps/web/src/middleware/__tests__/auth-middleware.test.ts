import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

import { UnAuthenticatedError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/server-auth";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

vi.mock("@/lib/auth/server-auth", () => ({
  getSession: vi.fn(),
}));

interface TestParams extends AuthenticatedRequest {
  value: string;
}

describe("withSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores a client-supplied session and uses the server-loaded one", async () => {
    const serverSession = {
      user: { id: "user_server" },
      session: { activeOrganizationId: null },
    };
    vi.mocked(getSession).mockResolvedValue(serverSession as never);

    const wrapped = withSession<TestParams, string>(async (params) => {
      return `${params.value}:${params.session.user.id}`;
    });

    // A forged session on the params must never be trusted.
    const forgedSession = {
      user: { id: "attacker", role: "admin" },
      session: { activeOrganizationId: null },
    };

    const result = await wrapped({
      value: "input",
      session: forgedSession as never,
    });

    expect(result).toBe("input:user_server");
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("derives session when not provided", async () => {
    const session = {
      user: { id: "user_2" },
      session: { activeOrganizationId: "org_2" },
    };
    vi.mocked(getSession).mockResolvedValue(session as never);

    const wrapped = withSession<TestParams, string>(async (params) => {
      return `${params.value}:${params.session.session.activeOrganizationId}`;
    });

    const result = await wrapped({ value: "input" });

    expect(result).toBe("input:org_2");
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("throws UnAuthenticatedError when session is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const wrapped = withSession<TestParams, string>(async () => {
      return "unreachable";
    });

    await expect(wrapped({ value: "input" })).rejects.toBeInstanceOf(
      UnAuthenticatedError,
    );
    expect(getSession).toHaveBeenCalledTimes(1);
  });
});
