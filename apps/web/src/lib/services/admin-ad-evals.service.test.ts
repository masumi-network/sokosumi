import { createClient } from "@sokosumi/core-client/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.request";

const mocks = vi.hoisted(() => ({
  getAccess: vi.fn(),
  getDashboard: vi.fn(),
  getExport: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@sokosumi/core-client", () => ({
  getAdminAdEvalsAccess: mocks.getAccess,
  getAdminAdEvals: mocks.getDashboard,
  getAdminAdEvalsExport: mocks.getExport,
}));
vi.mock("@/lib/clients/core.client", () => ({
  createCoreGeneratedClient: () => createClient(),
}));

import { adminAdEvalsService } from "./admin-ad-evals.service";

describe("adminAdEvalsService", () => {
  beforeEach(() => vi.resetAllMocks());

  it("checks access through the cheap Core endpoint without caching", async () => {
    mocks.getAccess.mockResolvedValue({ data: { data: { hasAccess: true } } });

    await expect(adminAdEvalsService.hasAccess()).resolves.toBe(true);

    expect(mocks.getAccess).toHaveBeenCalledWith({
      client: expect.any(Object),
      cache: "no-store",
    });
    expect(mocks.getDashboard).not.toHaveBeenCalled();
  });

  it("denies access when Core returns 403", async () => {
    mocks.getAccess.mockResolvedValue({
      error: { error: "Forbidden" },
      response: new Response(null, { status: 403 }),
    });

    await expect(adminAdEvalsService.hasAccess()).resolves.toBe(false);
  });

  it("preserves unexpected Core failures", async () => {
    mocks.getAccess.mockResolvedValue({
      error: { error: "Core unavailable" },
      response: new Response(null, { status: 503 }),
    });

    await expect(adminAdEvalsService.hasAccess()).rejects.toMatchObject({
      status: 503,
      message: "Core unavailable",
    });
  });

  it("preserves network failures", async () => {
    mocks.getAccess.mockRejectedValue(new Error("Network unavailable"));

    await expect(adminAdEvalsService.hasAccess()).rejects.toThrow(
      CoreApiRequestError,
    );
  });

  it("loads the Core dashboard without caching", async () => {
    const dashboard = { counts: { ratings: 0 } };
    mocks.getDashboard.mockResolvedValue({ data: { data: dashboard } });

    await expect(adminAdEvalsService.getDashboard()).resolves.toEqual(
      dashboard,
    );
    expect(mocks.getDashboard).toHaveBeenCalledWith({
      client: expect.any(Object),
      cache: "no-store",
    });
  });

  it("exports JSONL as text without caching", async () => {
    mocks.getExport.mockResolvedValue({ data: '{"type":"rating"}\n' });

    await expect(adminAdEvalsService.exportJsonl()).resolves.toBe(
      '{"type":"rating"}\n',
    );
    expect(mocks.getExport).toHaveBeenCalledWith({
      client: expect.any(Object),
      cache: "no-store",
      parseAs: "text",
    });
  });
});
