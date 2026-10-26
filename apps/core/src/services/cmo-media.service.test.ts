import type { CmoStrategy } from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";

const { liveResources, head } = vi.hoisted(() => ({
  liveResources: vi.fn(),
  head: vi.fn(),
}));
vi.mock("@/services/file-search.service", () => ({
  loadLiveResources: liveResources,
}));
vi.mock("@vercel/blob", () => ({ head }));

import { cmoCalendarMedia } from "./cmo-media.service";

const piece = (id: string, imageFileId?: string) => ({
  id,
  date: "2026-10-27",
  channel: "youtube",
  format: "short",
  title: "A piece",
  status: "draft" as const,
  ...(imageFileId ? { imageFileId } : {}),
});

const scope = {
  workspaceId: "ws-1",
  organizationId: "org-1",
  userId: "user-1",
};

describe("cmoCalendarMedia", () => {
  it("returns each piece's image or video the owner may open", async () => {
    liveResources.mockResolvedValue([
      { id: "f-video", mimeType: "video/mp4", sourceId: "drive/v.mp4" },
      { id: "f-image", mimeType: "image/png", sourceId: "drive/i.png" },
      { id: "f-pdf", mimeType: "application/pdf", sourceId: "drive/a.pdf" },
    ]);
    head.mockImplementation(async (pathname: string) => ({
      url: `https://blob/${pathname}`,
    }));
    const strategy = {
      calendar: [
        piece("a", "f-video"),
        piece("b", "f-image"),
        piece("c", "f-pdf"),
        piece("d", "f-gone"),
        piece("e"),
      ],
    } as unknown as CmoStrategy;

    await expect(cmoCalendarMedia({ strategy, ...scope })).resolves.toEqual([
      { entryId: "a", kind: "video", url: "https://blob/drive/v.mp4" },
      { entryId: "b", kind: "image", url: "https://blob/drive/i.png" },
    ]);
    expect(liveResources).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        actor: expect.objectContaining({ userId: "user-1", kind: "oauth" }),
      }),
    );
  });

  it("asks for nothing when no piece has media yet", async () => {
    liveResources.mockClear();
    const strategy = { calendar: [piece("a")] } as unknown as CmoStrategy;
    await expect(cmoCalendarMedia({ strategy, ...scope })).resolves.toEqual([]);
    expect(liveResources).not.toHaveBeenCalled();
  });
});
