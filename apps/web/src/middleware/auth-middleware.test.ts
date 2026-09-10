import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

import { getSessionResult } from "@/lib/auth/auth.server";
import {
  CoreAuthUnavailableError,
  UnAuthenticatedError,
} from "@/lib/auth/errors";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: vi.fn(),
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
    vi.mocked(getSessionResult).mockResolvedValue(ok(serverSession) as never);

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
    expect(getSessionResult).toHaveBeenCalledTimes(1);
  });

  it("derives session when not provided", async () => {
    const session = {
      user: { id: "user_2" },
      session: { activeOrganizationId: "org_2" },
    };
    vi.mocked(getSessionResult).mockResolvedValue(ok(session) as never);

    const wrapped = withSession<TestParams, string>(async (params) => {
      return `${params.value}:${params.session.session.activeOrganizationId}`;
    });

    const result = await wrapped({ value: "input" });

    expect(result).toBe("input:org_2");
    expect(getSessionResult).toHaveBeenCalledTimes(1);
  });

  it("throws UnAuthenticatedError when session is missing", async () => {
    vi.mocked(getSessionResult).mockResolvedValue(ok(null) as never);

    const wrapped = withSession<TestParams, string>(async () => {
      return "unreachable";
    });

    await expect(wrapped({ value: "input" })).rejects.toBeInstanceOf(
      UnAuthenticatedError,
    );
    expect(getSessionResult).toHaveBeenCalledTimes(1);
  });

  /**
   * UnAuthenticatedError sends the error boundary to /signin. Throwing it for
   * a Core stall signs out a user whose session is fine and throws away the
   * action they were running.
   */
  it("throws a distinct error when the session could not be read", async () => {
    vi.mocked(getSessionResult).mockResolvedValue(
      err({ path: "/auth/get-session", reason: "timeout" }) as never,
    );

    const handler = vi.fn(async () => "unreachable");
    const wrapped = withSession<TestParams, string>(handler);

    const rejection = wrapped({ value: "input" });
    await expect(rejection).rejects.toBeInstanceOf(CoreAuthUnavailableError);
    // The reason is what tells a stall from a parse fault in the logs.
    await expect(rejection).rejects.toMatchObject({
      name: "CoreAuthUnavailableError",
      reason: "timeout",
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
