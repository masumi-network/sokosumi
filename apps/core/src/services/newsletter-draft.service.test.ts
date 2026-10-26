import { beforeEach, describe, expect, it, vi } from "vitest";
import { isNewsletterDraftAvailable } from "./newsletter-draft.service";

const m = vi.hoisted(() => ({ enabled: true, find: vi.fn() }));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ NEWSLETTER_ENABLED: m.enabled }),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { newsletter: { findFirst: m.find } },
}));
beforeEach(() => {
  vi.resetAllMocks();
  m.enabled = true;
  m.find.mockResolvedValue({ id: "newsletter" });
});
describe("newsletter draft tool availability", () => {
  it("does not offer the tool when the feature is disabled", async () => {
    m.enabled = false;
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
        workspace: { organization: { slug: "utxo" } },
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
        workspace: { organization: { slug: "utxo" } },
      },
      select: { id: true },
    });
  });
});
