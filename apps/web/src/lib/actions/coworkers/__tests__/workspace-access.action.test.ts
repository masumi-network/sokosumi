import { beforeEach, describe, expect, it, vi } from "vitest";

const createForCoworkerMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/services/coworker-access.service", () => ({
  coworkerAccessService: {
    createForCoworker: (...args: unknown[]) => createForCoworkerMock(...args),
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

import { grantDeveloperCoworkerEarlyAccessAction } from "../workspace-access.action";

describe("grantDeveloperCoworkerEarlyAccessAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates access and revalidates developer routes", async () => {
    createForCoworkerMock.mockResolvedValue({
      id: "access-1",
      status: "GRANTED",
    });

    const result = await grantDeveloperCoworkerEarlyAccessAction({
      coworkerId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        accessId: "access-1",
        status: "GRANTED",
      });
    }
    expect(createForCoworkerMock).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      { workspaceId: "22222222-2222-4222-8222-222222222222" },
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/developer/coworkers/11111111-1111-4111-8111-111111111111",
    );
  });

  it("rejects invalid UUIDs", async () => {
    const result = await grantDeveloperCoworkerEarlyAccessAction({
      coworkerId: "not-a-uuid",
      workspaceId: "also-bad",
    });

    expect(result.ok).toBe(false);
    expect(createForCoworkerMock).not.toHaveBeenCalled();
  });
});
