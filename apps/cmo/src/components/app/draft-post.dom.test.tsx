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
    expect(host.querySelector("h3")?.textContent).toContain("Waiting for you");
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
