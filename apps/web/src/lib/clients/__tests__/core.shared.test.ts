import { describe, expect, it, vi } from "vitest";
import { createCoreClient } from "@/lib/clients/core.shared";
import { deleteAdminInvoice as coreDeleteAdminInvoice } from "@/lib/clients/generated/core";
import type { Client } from "@/lib/clients/generated/core/client";

vi.mock("@/lib/clients/generated/core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/clients/generated/core")>();
  return {
    ...actual,
    deleteAdminInvoice: vi.fn(),
  };
});

describe("createCoreClient no-content responses", () => {
  it("treats 204 responses with undefined data as success", async () => {
    vi.mocked(coreDeleteAdminInvoice).mockResolvedValue({
      data: undefined,
      response: { ok: true, status: 204 } as Response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    await expect(core.deleteAdminInvoice("in_1")).resolves.toBeUndefined();
  });
});
