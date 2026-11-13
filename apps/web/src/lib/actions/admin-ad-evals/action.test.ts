import type { Session } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ export: vi.fn(), assertAdmin: vi.fn() }));
vi.mock("@/lib/services/admin-ad-evals.service", () => ({
  adminAdEvalsService: { exportJsonl: mocks.export },
}));
vi.mock("@/lib/auth/admin-access", () => ({
  assertAdminSession: mocks.assertAdmin,
}));
vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: () => ({ code: "UNAUTHORIZED" }),
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: (handler: (params: object) => unknown) => handler,
}));

import { exportAdminAdEvals } from "./action";

const SESSION = {
  user: { id: "admin-1", role: "admin" },
  session: { id: "session-1" },
} as Session;
beforeEach(() => vi.resetAllMocks());

describe("exportAdminAdEvals", () => {
  it("checks platform admin access before exporting", async () => {
    mocks.export.mockResolvedValue('{"type":"rating"}\n');
    expect(await exportAdminAdEvals({ session: SESSION })).toEqual({
      ok: true,
      value: '{"type":"rating"}\n',
    });
    expect(mocks.assertAdmin).toHaveBeenCalledWith(SESSION);
  });

  it("does not request an export when the admin check fails", async () => {
    mocks.assertAdmin.mockImplementation(() => {
      throw new Error("Admin access required");
    });
    expect((await exportAdminAdEvals({ session: SESSION })).ok).toBe(false);
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it("returns an error when Core refuses the export", async () => {
    mocks.export.mockRejectedValue(new Error("Forbidden"));
    expect((await exportAdminAdEvals({ session: SESSION })).ok).toBe(false);
  });
});
