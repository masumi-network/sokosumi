import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import {
  hasSocialBetaAccess,
  requireSocialBetaAccess,
} from "./social-beta-access.js";

describe("Social beta access", () => {
  it("allows members of the utxo AG workspace", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "member-1" });

    await expect(
      hasSocialBetaAccess("user-1", {
        member: { findFirst },
      } as never),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        organization: { slug: "utxo" },
      },
      select: { id: true },
    });
  });

  it("forbids users outside the utxo AG workspace", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);

    await expect(
      requireSocialBetaAccess("user-2", {
        member: { findFirst },
      } as never),
    ).rejects.toMatchObject({
      status: 403,
      message: "Social is only available to utxo AG workspace members",
    } satisfies Partial<HTTPException>);
  });
});
