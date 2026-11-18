import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChatWork } from "../../lib/chat-work";
import { buildThread } from "../../lib/thread";
import { cmoOverview, cmoStrategyVersion } from "../../test-fixtures/cmo";
import { MadeInChat } from "./chat-work";

function work(overrides: Partial<ChatWork> = {}): ChatWork {
  return {
    id: "w1",
    kind: "image",
    state: "making",
    at: new Date("2026-11-18T12:00:30Z"),
    title: "A square picture of NMKR Pay",
    url: null,
    ...overrides,
  };
}

const card = (item: ChatWork) =>
  renderToStaticMarkup(<MadeInChat work={item} retry={() => {}} />);

describe("MadeInChat", () => {
  it("says a picture is being made, and where it will show", () => {
    const html = card(work());
    expect(html).toContain('role="status"');
    expect(html).toContain("Making your picture");
    expect(html).toContain("It shows up here when it is ready.");
    expect(html).not.toContain("<img");
  });

  it("shows the finished picture with words for a screen reader", () => {
    const html = card(work({ state: "ready", url: "https://blob/p.jpg" }));
    expect(html).toContain('<img class="made-media" src="https://blob/p.jpg"');
    expect(html).toContain(
      'alt="Picture by Cuso: A square picture of NMKR Pay"',
    );
    expect(html).toContain("Download");
    expect(html).not.toContain("Making your");
  });

  it("plays a video and a voice-over in the chat", () => {
    expect(
      card(work({ kind: "video", state: "ready", url: "https://blob/v.mp4" })),
    ).toContain('<video class="made-media" src="https://blob/v.mp4" controls');
    expect(
      card(work({ kind: "audio", state: "ready", url: "https://blob/a.mp3" })),
    ).toContain('<audio class="made-audio" src="https://blob/a.mp3" controls');
  });

  it("offers another try when it did not work out", () => {
    const html = card(work({ kind: "video", state: "failed" }));
    expect(html).toContain("This video didn&#x27;t work out.");
    expect(html).toContain("Ask Cuso to try again");
  });

  it("never links into Sokosumi", () => {
    for (const state of ["making", "ready", "failed"] as const) {
      const html = card(work({ state, url: "https://blob/p.jpg" }));
      expect(html.toLowerCase()).not.toContain("sokosumi");
      expect(html).not.toContain("/studio");
    }
  });
});

describe("thread", () => {
  const hired = cmoOverview({
    ...cmoStrategyVersion(new Date("2026-11-01T09:00:00Z")),
    hiredAt: new Date("2026-11-01T09:00:00Z"),
  });

  it("puts what Cuso makes where he started it, once", () => {
    const messages = [
      {
        id: "m1",
        fromCuso: false,
        author: "Ada",
        content: "Make a picture",
        createdAt: "2026-11-18T12:00:00.000Z",
      },
      {
        id: "m2",
        fromCuso: true,
        author: "Cuso",
        content: "Started image.",
        createdAt: "2026-11-18T12:00:01.000Z",
      },
      {
        id: "m3",
        fromCuso: false,
        author: "Ada",
        content: "Thanks",
        createdAt: "2026-11-18T12:05:00.000Z",
      },
    ];
    const thread = buildThread(hired, messages, [work()]);
    expect(
      thread.map((item) =>
        item.kind === "message" ? item.message.id : item.kind,
      ),
    ).toEqual(["welcome", "connect", "m1", "m2", "work", "m3"]);
  });

  it("leaves out what was made while hiring", () => {
    const thread = buildThread(
      hired,
      [],
      [work({ at: new Date("2026-10-30T09:00:00Z") })],
    );
    expect(thread.map((item) => item.kind)).not.toContain("work");
  });
});
