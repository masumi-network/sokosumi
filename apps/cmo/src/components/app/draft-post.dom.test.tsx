// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cmoOverview } from "../../test-fixtures/cmo";
import { CalendarPage } from "./calendar-page";
import { UpdateCard } from "./cards";
import { type Draft, type DraftActions, DraftPost } from "./draft-post";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function draft(patch: Partial<Draft> = {}): Draft {
  return {
    id: "post-1",
    provider: "x",
    text: "Studio gives creators a no-code way to sell.",
    status: "NEEDS_APPROVAL",
    revision: 3,
    scheduledAt: null,
    publishedUrl: null,
    media: [
      {
        kind: "video",
        url: "https://blob.test/studio-intro.mp4",
        name: "studio-intro.mp4",
      },
    ],
    ...patch,
  };
}

function actions(patch: Partial<DraftActions> = {}): DraftActions {
  return {
    approve: vi.fn(async () => null),
    decline: vi.fn(async () => null),
    edit: vi.fn(async () => null),
    tikTokCreator: async () => ({ creator: null, error: null }),
    ...patch,
  };
}

const cardActions = (drafts: DraftActions) => ({
  approve: async () => {},
  revert: async () => {},
  retryLearning: async () => null,
  compose: () => {},
  open: () => {},
  topUp: null,
  drafts,
});

async function press(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`No "${label}" button`);
  await act(async () => button.click());
}

describe("DraftPost", () => {
  it("plays the video and approves the draft as it was shown", async () => {
    const drafts = actions();
    await act(async () =>
      root.render(<DraftPost draft={draft()} actions={drafts} />),
    );

    const video = host.querySelector("video");
    expect(video?.getAttribute("src")).toBe(
      "https://blob.test/studio-intro.mp4",
    );
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(host.textContent).toContain("Waiting for you");
    expect(host.textContent).toContain(
      "It goes out on X two minutes after you approve.",
    );

    await press("Approve");

    expect(drafts.approve).toHaveBeenCalledWith("post-1", 3);
    // The yes gets its moment: Cuso's check mark and when it goes out.
    const done = host.querySelector('[role="status"].draft-done');
    expect(done?.textContent).toBe(
      "Approved. It goes out on X in about two minutes.",
    );
    expect(done?.querySelector("img")?.getAttribute("src")).toBe(
      "/cuso/correct.svg",
    );
    expect(host.textContent).not.toContain("Decline");
  });

  it("posts a TikTok video only after the owner confirms it, with nothing ticked for them", async () => {
    const drafts = actions({
      tikTokCreator: async () => ({
        creator: {
          creator_nickname: "acme",
          privacy_level_options: ["PUBLIC_TO_EVERYONE"],
          comment_disabled: false,
          duet_disabled: true,
          stitch_disabled: false,
          max_video_post_duration_sec: 600,
        },
        error: null,
      }),
    });
    await act(async () =>
      root.render(
        <DraftPost draft={draft({ provider: "tiktok" })} actions={drafts} />,
      ),
    );

    expect(host.textContent).toContain("Posts as acme");
    expect(host.textContent).toContain("Everyone on TikTok can see it");
    expect(host.textContent).toContain("made with AI");
    expect(host.textContent).toContain("Music Usage Confirmation");
    // No plain Approve, and no promise of a time.
    expect(host.textContent).not.toContain("two minutes after you approve");
    const boxes = [...host.querySelectorAll<HTMLInputElement>("input")];
    expect(boxes.map((box) => box.checked)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    // Duet is off in the creator's own TikTok settings.
    expect(boxes[1]?.disabled).toBe(true);
    const post = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Post to TikTok",
    );
    expect(post?.disabled).toBe(true);

    await act(async () => boxes[0]?.click());
    await act(async () => boxes[3]?.click());
    expect(post?.disabled).toBe(false);
    await press("Post to TikTok");

    expect(drafts.approve).toHaveBeenCalledWith("post-1", 3, {
      privacyLevel: "PUBLIC_TO_EVERYONE",
      allowComment: true,
      allowDuet: false,
      allowStitch: false,
      promotesOwnBrand: true,
      acceptedMusicUsage: true,
      previewConsent: true,
    });
  });

  it("offers no TikTok post when TikTok cannot be read or takes no more videos", async () => {
    await act(async () =>
      root.render(
        <DraftPost
          draft={draft({ provider: "tiktok" })}
          actions={actions({
            tikTokCreator: async () => ({
              creator: null,
              error: "Connect TikTok again to post this video.",
            }),
          })}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Connect TikTok again to post this video.",
    );
    expect(host.textContent).not.toContain("Post to TikTok");
  });

  it("says why an approval was refused and keeps the draft", async () => {
    await act(async () =>
      root.render(
        <DraftPost
          draft={draft()}
          actions={actions({ approve: async () => "X is not connected." })}
        />,
      ),
    );

    await press("Approve");

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "X is not connected.",
    );
    expect(host.querySelector(".draft-done")).toBeNull();
    expect(host.textContent).toContain("Waiting for you");
  });

  it("saves the owner's own words", async () => {
    const drafts = actions();
    await act(async () =>
      root.render(<DraftPost draft={draft()} actions={drafts} />),
    );

    await press("Edit");
    const box = host.querySelector("textarea");
    if (!box) throw new Error("No text box");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setValue?.call(box, "Sell without code.");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Save");

    expect(drafts.edit).toHaveBeenCalledWith("post-1", 3, "Sell without code.");
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("declines the draft", async () => {
    const drafts = actions();
    await act(async () =>
      root.render(<DraftPost draft={draft()} actions={drafts} />),
    );

    await press("Decline");

    expect(drafts.decline).toHaveBeenCalledWith("post-1", 3);
  });

  it("lets an approved post be stopped until it goes out, and offers nothing after", async () => {
    const drafts = actions();
    await act(async () =>
      root.render(
        <DraftPost
          draft={draft({
            status: "SCHEDULED",
            scheduledAt: new Date("2026-11-20T09:00:00Z"),
          })}
          actions={drafts}
        />,
      ),
    );
    expect(host.textContent).toContain("Goes out");
    await press("Don't post it");
    expect(drafts.decline).toHaveBeenCalledWith("post-1", 3);

    await act(async () =>
      root.render(
        <DraftPost draft={draft({ status: "CANCELED" })} actions={drafts} />,
      ),
    );
    expect(host.textContent).toContain("Declined. It won't go out.");
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("a report that made a video", () => {
  const update = {
    id: "u1",
    at: new Date("2026-11-18T17:50:00Z"),
    kind: "request" as const,
    headline: "Studio video and X draft ready",
    done: ["Made the video", "Wrote the post for X"],
    upNext: [],
    changes: [],
    revertible: false,
    revertedAt: null,
    posts: [draft()],
    media: [],
  };

  it("shows the draft with its video in the message that delivers it", async () => {
    await act(async () =>
      root.render(
        <UpdateCard
          update={update}
          actions={cardActions(actions())}
          approved
        />,
      ),
    );
    expect(host.textContent).toContain("Studio video and X draft ready");
    expect(host.querySelectorAll("video")).toHaveLength(1);
    expect(host.textContent).toContain("Approve");
  });

  it("shows a video made without a post on its own", async () => {
    await act(async () =>
      root.render(
        <UpdateCard
          update={{ ...update, posts: [], media: draft().media }}
          actions={cardActions(actions())}
          approved
        />,
      ),
    );
    expect(host.querySelectorAll("video")).toHaveLength(1);
    expect(host.textContent).not.toContain("Approve");
  });
});

describe("Calendar", () => {
  it("leads with the posts that wait for the owner", async () => {
    await act(async () =>
      root.render(
        <CalendarPage
          overview={cmoOverview({ drafts: [draft()] })}
          drafts={actions()}
          onAsk={async () => {}}
        />,
      ),
    );
    expect(host.querySelector("h2")?.textContent).toContain("Waiting for you");
    expect(host.textContent).toContain("1 post");
    expect(host.querySelectorAll("video")).toHaveLength(1);
  });

  it("has no waiting section when nothing waits", async () => {
    await act(async () =>
      root.render(
        <CalendarPage
          overview={cmoOverview()}
          drafts={actions()}
          onAsk={async () => {}}
        />,
      ),
    );
    expect(host.textContent).not.toContain("Waiting for you");
  });
});
