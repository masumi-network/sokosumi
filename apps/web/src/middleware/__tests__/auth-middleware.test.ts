import { beforeEach, describe, expect, it, vi } from "vitest";
export {};

import { UnAuthenticatedError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/utils";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

vi.mock("@/lib/auth/utils", () => ({
  getSession: vi.fn(),
}));

interface TestParams extends AuthenticatedRequest {
  value: string;
}

describe("withSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses provided session without reading session fallback", async () => {
    const wrapped = withSession<TestParams, string>(async (params) => {
      return `${params.value}:${params.session.user.id}`;
    });
    const session = {
      user: { id: "user_1" },
      session: { activeOrganizationId: null },
    };

    const result = await wrapped({
      value: "input",
      session: session as never,
    });

    expect(result).toBe("input:user_1");
    expect(getSession).not.toHaveBeenCalled();
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
