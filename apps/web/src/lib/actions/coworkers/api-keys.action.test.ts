import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { CoreApiRequestError } from "@/lib/clients/core.client";

const createApiKeyMock = vi.fn();
const revokeApiKeyMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/services/developer-coworker.service", () => ({
  developerCoworkerService: {
    createApiKey: (...args: unknown[]) => createApiKeyMock(...args),
    revokeApiKey: (...args: unknown[]) => revokeApiKeyMock(...args),
  },
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TArgs, TResult>(
      handler: (args: TArgs & { session: unknown }) => Promise<TResult>,
    ) =>
    async (args: TArgs) =>
      handler({ ...args, session: { user: { id: "user_1" } } }),
}));

import { expectConsole } from "@sokosumi/utils/test-console";
import { redirect } from "next/navigation";
import {
  createDeveloperCoworkerApiKeyAction,
  revokeDeveloperCoworkerApiKeyAction,
} from "@/lib/actions/coworkers/api-keys.action";

const COWORKER_ID = "11111111-1111-4111-8111-111111111111";
const KEY_ID = "33333333-3333-4333-8333-333333333333";

describe("createDeveloperCoworkerApiKeyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the one-time token and refreshes the coworker page", async () => {
    createApiKeyMock.mockResolvedValue({
      id: KEY_ID,
      token: "coworker_secret",
      name: "Production",
      expiresAt: null,
    });

    const result = await createDeveloperCoworkerApiKeyAction({
      coworkerId: COWORKER_ID,
      name: "  Production  ",
    });

    expect(result).toEqual({ ok: true, value: { key: "coworker_secret" } });
    expect(createApiKeyMock).toHaveBeenCalledWith(COWORKER_ID, "Production");
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/developer/coworkers/${COWORKER_ID}`,
    );
  });

  it("rejects an empty name without calling Core", async () => {
    const result = await createDeveloperCoworkerApiKeyAction({
      coworkerId: COWORKER_ID,
      name: "   ",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: CommonErrorCode.BAD_INPUT },
    });
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  it("maps a Core failure to an action error", async () => {
    const errorCalls = expectConsole(
      "error",
      "Failed to create developer coworker API key",
    );
    const error = new CoreApiRequestError("Forbidden", { status: 403 });
    createApiKeyMock.mockRejectedValue(error);

    const result = await createDeveloperCoworkerApiKeyAction({
      coworkerId: COWORKER_ID,
      name: "Production",
    });

    expect(errorCalls[0]?.[1]).toBe(error);
    expect(result.ok).toBe(false);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("sign-in redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets Core's 401 redirect through on create and revoke", async () => {
    createApiKeyMock.mockImplementation(() => redirect("/signin"));
    revokeApiKeyMock.mockImplementation(() => redirect("/signin"));

    await expect(
      createDeveloperCoworkerApiKeyAction({
        coworkerId: COWORKER_ID,
        name: "Production",
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    await expect(
      revokeDeveloperCoworkerApiKeyAction({
        coworkerId: COWORKER_ID,
        keyId: KEY_ID,
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});

describe("revokeDeveloperCoworkerApiKeyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes the key and refreshes the coworker page", async () => {
    revokeApiKeyMock.mockResolvedValue({ id: KEY_ID });

    const result = await revokeDeveloperCoworkerApiKeyAction({
      coworkerId: COWORKER_ID,
      keyId: KEY_ID,
    });

    expect(result).toEqual({ ok: true, value: { keyId: KEY_ID } });
    expect(revokeApiKeyMock).toHaveBeenCalledWith(COWORKER_ID, KEY_ID);
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/developer/coworkers/${COWORKER_ID}`,
    );
  });

  it("rejects an empty key id without calling Core", async () => {
    const result = await revokeDeveloperCoworkerApiKeyAction({
      coworkerId: COWORKER_ID,
      keyId: "   ",
    });

    expect(result.ok).toBe(false);
    expect(revokeApiKeyMock).not.toHaveBeenCalled();
  });

  it("accepts legacy CUID ids from before the UUID switch", async () => {
    revokeApiKeyMock.mockResolvedValue({ id: "cm8x0legacykey0000000001" });

    const result = await revokeDeveloperCoworkerApiKeyAction({
      coworkerId: "cm8x0legacycoworker00001",
      keyId: "cm8x0legacykey0000000001",
    });

    expect(result.ok).toBe(true);
    expect(revokeApiKeyMock).toHaveBeenCalledWith(
      "cm8x0legacycoworker00001",
      "cm8x0legacykey0000000001",
    );
  });
});
