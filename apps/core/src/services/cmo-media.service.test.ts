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

import { cmoCalendarMedia, cmoSocialPostMedia } from "./cmo-media.service";

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

describe("cmoSocialPostMedia", () => {
  const file = (name: string, kind: "image" | "video" = "image") => ({
    pathname: `drive/org/${name}`,
    fileUrl: `https://blob.example/${name}`,
    name,
    size: 1,
    mimeType: kind === "video" ? "video/mp4" : "image/png",
    kind,
  });

  it("shows each Social post's own media, a carousel with its slides", () => {
    expect(
      cmoSocialPostMedia([
        { entry: piece("post-1"), entryId: "a", media: [file("one.png")] },
        {
          entry: piece("post-2"),
          entryId: "b",
          media: [file("s1.png"), file("s2.png")],
        },
        {
          entry: piece("post-3"),
          entryId: "c",
          media: [file("v.mp4", "video")],
        },
        { entry: piece("post-4"), entryId: "d", media: [] },
      ]),
    ).toEqual([
      { entryId: "post-1", kind: "image", url: "https://blob.example/one.png" },
      {
        entryId: "post-2",
        kind: "image",
        url: "https://blob.example/s1.png",
        slides: ["https://blob.example/s1.png", "https://blob.example/s2.png"],
      },
      { entryId: "post-3", kind: "video", url: "https://blob.example/v.mp4" },
    ]);
  });
});
