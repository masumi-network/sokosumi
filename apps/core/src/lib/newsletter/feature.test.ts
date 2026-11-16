import { beforeEach, describe, expect, it, vi } from "vitest";

import { isNewsletterWorkspaceEnabled, newsletterPilotScope } from "./feature";

const pilotIds = vi.hoisted(() => vi.fn((): string[] => []));
const workspace = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ NEWSLETTER_PILOT_WORKSPACE_IDS: pilotIds() }),
}));
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

  it("enables a pilot workspace without enabling its organization or other workspaces", async () => {
    pilotIds.mockReturnValue(["workspace_pilot"]);
    workspace.findUnique.mockResolvedValue({ organization: { slug: "cmo" } });

    expect(await isNewsletterWorkspaceEnabled("workspace_pilot")).toBe(true);
    expect(await isNewsletterWorkspaceEnabled("workspace_other")).toBe(false);
    expect(newsletterPilotScope()).toEqual({
      project: {
        workspace: {
          OR: [
            { organization: { slug: "utxo" } },
            { id: { in: ["workspace_pilot"] } },
          ],
        },
      },
    });
  });

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
