import { beforeEach, describe, expect, it, vi } from "vitest";

import { isNewsletterWorkspaceEnabled } from "./feature";

const workspace = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({ default: { workspace } }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("newsletter workspace beta gate", () => {
  it.each([null, { slug: "other" }, { slug: "utxo" }])(
    "requires the project's workspace organization to be utxo: %s",
    async (organization) => {
      workspace.findUnique.mockResolvedValue({ organization });
      expect(await isNewsletterWorkspaceEnabled("workspace_1")).toBe(
        organization?.slug === "utxo",
      );
      expect(workspace.findUnique).toHaveBeenCalledWith({
        where: { id: "workspace_1" },
        select: { organization: { select: { slug: true } } },
      });
    },
  );

  it("rejects missing and unknown workspaces", async () => {
    expect(await isNewsletterWorkspaceEnabled(null)).toBe(false);
    expect(workspace.findUnique).not.toHaveBeenCalled();
    workspace.findUnique.mockResolvedValue(null);
    expect(await isNewsletterWorkspaceEnabled("unknown")).toBe(false);
  });

  it("propagates workspace lookup failures", async () => {
    workspace.findUnique.mockRejectedValue(new Error("Database unavailable"));
    await expect(isNewsletterWorkspaceEnabled("workspace_1")).rejects.toThrow(
      "Database unavailable",
    );
  });
});
