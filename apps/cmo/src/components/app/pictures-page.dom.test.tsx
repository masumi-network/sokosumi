// @vitest-environment happy-dom

import type { CmoPictureGroup } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PicturesPage, picturePreviewUrl } from "./pictures-page";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const alt = (
  jobId: string,
  patch: Partial<CmoPictureGroup["alternatives"][number]> = {},
) => ({
  jobId,
  model: "Muse Image",
  verdict: "passed" as const,
  why: null,
  chosen: false,
  hasImage: true,
  createdAt: "2026-11-21T10:00:00Z",
  ...patch,
});

const groups: CmoPictureGroup[] = [
  {
    postId: "post-1",
    network: "instagram",
    scheduledAt: "2026-12-02T09:00:00Z",
    headline: "Mint now",
    title: "Tokens for everyone",
    pictureKind: "bold graphic",
    slot: 0,
    postedUrl: "https://blob/posted.jpg",
    reason: "Clearest headline at a glance",
    alternatives: [
      alt("a1", { verdict: "rejected", why: "Extra words on the sign" }),
      alt("a2", { chosen: true }),
      alt("a3", { model: "MAI-Image 2.7", verdict: "failed", hasImage: false }),
    ],
  },
  {
    postId: "post-2",
    network: "x",
    scheduledAt: "2026-11-28T09:00:00Z",
    headline: "Show the fee",
    title: null,
    pictureKind: null,
    slot: 0,
    postedUrl: null,
    reason: null,
    alternatives: [alt("b1", { verdict: "rejected", why: "Logo misdrawn" })],
  },
];

describe("PicturesPage", () => {
  it("shows the picture on each post with why it won, and the ones left out with their verdict", async () => {
    const openPost = vi.fn();
    await act(async () =>
      root.render(
        <PicturesPage
          projectId="project-1"
          actions={{
            loadPictures: async () => ({
              groups,
              networks: ["instagram", "x"],
              months: ["2026-11", "2026-12"],
            }),
          }}
          openPost={openPost}
        />,
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("1 picture on your posts.");
    expect(text).toContain("I made 4 pictures to choose them");
    expect(text).toContain("On the post");
    expect(text).toContain("Clearest headline at a glance");
    expect(text).toContain("Turned down");
    expect(text).toContain("Extra words on the sign");
    expect(text).toContain("Failed to make");
    expect(text).toContain("Not chosen yet");
    expect(text).not.toMatch(/Sokosumi|Content Studio/);
    const images = [...container.querySelectorAll("img")].map((img) =>
      img.getAttribute("src"),
    );
    expect(images[0]).toBe("https://blob/posted.jpg");
    expect(images).toContain(picturePreviewUrl("project-1", "a1"));
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Open post")
        ?.click();
    });
    expect(openPost).toHaveBeenCalledWith("post-1");
  });

  it("filters by network and by pictures on posts", async () => {
    const loadPictures = vi.fn(async () => ({
      groups,
      networks: ["instagram", "x"],
      months: ["2026-11", "2026-12"],
    }));
    await act(async () =>
      root.render(
        <PicturesPage
          projectId="project-1"
          actions={{ loadPictures }}
          openPost={() => {}}
        />,
      ),
    );
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Instagram")
        ?.click();
    });
    expect(loadPictures).toHaveBeenLastCalledWith({ network: "instagram" });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Only pictures on posts")
        ?.click();
    });
    expect(loadPictures).toHaveBeenLastCalledWith({
      network: "instagram",
      chosen: true,
    });
  });
});
