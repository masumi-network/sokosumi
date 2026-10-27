import { beforeEach, describe, expect, it, vi } from "vitest";
import { isNewsletterDraftAvailable } from "./newsletter-draft.service";

const m = vi.hoisted(() => ({
  find: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    newsletter: { findFirst: m.find },
    workspace: { findUnique: m.workspace },
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  m.find.mockResolvedValue({ id: "newsletter" });
  m.workspace.mockResolvedValue({ organization: { slug: "utxo" } });
});
describe("newsletter draft tool availability", () => {
  it("does not offer the tool outside the beta workspace", async () => {
    m.workspace.mockResolvedValue({ organization: { slug: "other" } });
    expect(
      await isNewsletterDraftAvailable({
        workspaceId: "workspace",
        projectId: "project",
      }),
    ).toBe(false);
    expect(m.find).not.toHaveBeenCalled();
  });
  it("requires a newsletter inside the current bot's project and workspace", async () => {
    const scope = { workspaceId: "workspace", projectId: "project" };
    expect(await isNewsletterDraftAvailable(scope)).toBe(true);
    expect(m.find).toHaveBeenCalledWith({
      where: {
        ...scope,
        project: { workspaceId: "workspace" },
      },
      select: { id: true },
    });
    m.find.mockResolvedValue(null);
    expect(await isNewsletterDraftAvailable(scope)).toBe(false);
  });
  it("only offers workspace bots configured newsletters in their own workspace", async () => {
    expect(
      await isNewsletterDraftAvailable({
        workspaceId: "workspace",
        projectId: null,
      }),
    ).toBe(true);
    expect(m.find).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace",
        project: { workspaceId: "workspace" },
      },
      select: { id: true },
    });
  });
});
