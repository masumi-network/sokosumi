import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import {
  hasCalendarBetaAccess,
  requireCalendarBetaAccess,
} from "./calendar-beta-access.js";

describe("Calendar beta access", () => {
  it("allows members of the utxo AG workspace", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "member-1" });

    await expect(
      hasCalendarBetaAccess("user-1", {
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
      requireCalendarBetaAccess("user-2", {
        member: { findFirst },
      } as never),
    ).rejects.toMatchObject({
      status: 403,
      message: "Calendar is only available to utxo AG workspace members",
    } satisfies Partial<HTTPException>);
  });
});
