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
    by: null,
    text: null,
    readable: false,
    files: [],
    table: null,
    people: [],
    total: null,
    steps: [],
    turnId: null,
    ...overrides,
  };
}

const card = (item: ChatWork) =>
  renderToStaticMarkup(
    <MadeInChat
      work={item}
      compose={() => {}}
      loadText={async () => null}
      loadTable={async () => null}
    />,
  );

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

  it("says who has handed work, and that Cuso reports back here", () => {
    const html = card(
      work({ kind: "task", title: "Research three trends", by: "Hannah" }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Hannah is working on this");
    expect(html).toContain("Research three trends");
    expect(html).toContain("I tell you here when it is done.");
    expect(html).not.toContain("Read it");
  });

  it("shows a check asked of the SEO specialist: running, then its result, or another try", () => {
    const check = {
      kind: "seo" as const,
      title: 'Where you rank on Google for "calendly alternative"',
      by: "The SEO specialist",
    };
    const running = card(work(check));
    expect(running).toContain('role="status"');
    expect(running).toContain("The SEO specialist is working on this");
    expect(running).toContain("Where you rank on Google for");
    expect(running).toContain("I tell you here when it is done.");

    const done = card(
      work({
        ...check,
        state: "ready",
        text: "position 7, 1,300 searches a month",
        readable: true,
      }),
    );
    expect(done).toContain("The SEO specialist is done");
    expect(done).toContain("position 7, 1,300 searches a month");
    expect(done).toContain("Read it");

    const failed = card(
      work({ ...check, state: "failed", text: "The check failed." }),
    );
    expect(failed).toContain("The SEO specialist could not finish this");
    expect(failed).toContain("The check failed.");
    expect(failed).toContain("Ask Cuso to try again");
    expect(`${running}${done}${failed}`).not.toMatch(/Sokosumi|Task|Coworker/);
  });

  it("shows the weekly audit like handed work, without a retry it cannot grant", () => {
    const audit = {
      kind: "audit" as const,
      title: "Weekly audit of your site",
      by: "The SEO specialist",
    };
    const running = card(work(audit));
    expect(running).toContain("The SEO specialist is working on this");
    expect(running).toContain("What it finds shows in your SEO tab.");
    expect(
      card(
        work({
          ...audit,
          state: "ready",
          text: "86 of 110 checks passed. 5 things to fix are in your SEO tab.",
        }),
      ),
    ).toContain("5 things to fix are in your SEO tab.");
    const failed = card(
      work({ ...audit, state: "failed", text: "No charge." }),
    );
    expect(failed).toContain("The SEO specialist could not finish this");
    expect(failed).not.toContain("try again");
  });

  it("shows what handed work asks, with a way to answer", () => {
    const html = card(
      work({
        kind: "task",
        state: "waiting",
        title: "Write the press note",
        by: "Alex",
        text: "Which date goes in the headline?",
      }),
    );
    expect(html).toContain("Alex needs an answer from you");
    expect(html).toContain("Which date goes in the headline?");
    expect(html).toContain(">Answer<");
  });

  it("shows a result's start, its files, and opens the rest in place", () => {
    const html = card(
      work({
        kind: "agent",
        state: "ready",
        title: "Market scan",
        by: "Market Scout",
        text: "Three trends stand out.",
        readable: true,
        files: [{ name: "scan.pdf", url: "https://blob/scan.pdf" }],
      }),
    );
    expect(html).toContain("Market Scout is done");
    expect(html).toContain("Three trends stand out.");
    expect(html).toContain('<a href="https://blob/scan.pdf"');
    expect(html).toContain("Read it");
  });

  it("offers a file Cuso wrote to read here or download", () => {
    const html = card(
      work({
        kind: "file",
        state: "ready",
        title: "Launch brief.md",
        url: "https://blob/brief.md",
        readable: true,
      }),
    );
    expect(html).toContain("Launch brief.md");
    expect(html).toContain("Read it");
    expect(html).toContain('href="https://blob/brief.md"');
  });

  it("says when handed work could not be finished", () => {
    const html = card(
      work({ kind: "task", state: "failed", title: "Research", by: "Hannah" }),
    );
    expect(html).toContain("Hannah could not finish this");
    expect(html).toContain("Ask Cuso to try again");
  });

  it("shows a table Cuso made as a table, with a way to see all of it", () => {
    const html = card(
      work({
        kind: "table",
        state: "ready",
        title: "Content tracker",
        readable: true,
        table: {
          columns: ["Post", "Status"],
          rows: [["Launch post 1", "Made"], ["Launch post 2"]],
          total: 12,
        },
      }),
    );
    expect(html).toContain("Content tracker");
    expect(html).toContain('<th scope="col">Status</th>');
    expect(html).toContain("<td>Launch post 1</td><td>Made</td>");
    // A short row still fills its columns.
    expect(html).toContain("<td>Launch post 2</td><td></td>");
    expect(html).toContain("2 of 12 rows");
    expect(html).toContain("Show all");
  });

  it("says how many rows a whole table has, without Show all", () => {
    const html = card(
      work({
        kind: "table",
        state: "ready",
        title: "Results log",
        table: { columns: ["Week"], rows: [["45"]], total: 1 },
      }),
    );
    expect(html).toContain("1 row");
    expect(html).not.toContain("Show all");
  });

  it("lists the people on a contact list, and how many more", () => {
    const html = card(
      work({
        kind: "contacts",
        state: "ready",
        title: "Press",
        people: [
          { name: "Mira Lindqvist", detail: "Editor, Product Weekly" },
          { name: "Jonas Feld", detail: null },
        ],
        total: 5,
      }),
    );
    expect(html).toContain("Press");
    expect(html).toContain("Mira Lindqvist");
    expect(html).toContain("Editor, Product Weekly");
    expect(html).toContain("and 3 more");
  });

  it("shows a background run's plan while it runs, with a way to stop it", () => {
    const html = card(
      work({
        kind: "run",
        title: "Results log",
        steps: [
          { label: "Read the posts", state: "done" },
          { label: "Fill the table", state: "now" },
          { label: "Write it up", state: "next" },
        ],
        turnId: "run-1",
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Working on this in the background");
    expect(html).toContain('<div class="step ok">');
    expect(html).toContain('<div class="step run">');
    expect(html).toContain("Stop it");
  });

  it("shows a finished run's result, and a stopped one as stopped", () => {
    const done = card(
      work({
        kind: "run",
        state: "ready",
        title: "Results log",
        text: "Four weeks are in the table.",
        readable: true,
        turnId: "run-1",
      }),
    );
    expect(done).toContain("Done");
    expect(done).toContain("Four weeks are in the table.");
    expect(done).toContain("Read it");
    expect(done).not.toContain("Stop it");
    expect(
      card(work({ kind: "run", state: "stopped", title: "Results log" })),
    ).toContain("Stopped");
  });

  it("signs a Coworker's answer with the Coworker's name", () => {
    expect(
      card(
        work({
          kind: "question",
          title: "How long would it take?",
          by: "Hannah",
        }),
      ),
    ).toContain("Asked Hannah");
    const html = card(
      work({
        kind: "question",
        state: "ready",
        title: "How long would it take?",
        by: "Hannah",
        text: "About two hours.",
      }),
    );
    expect(html).toContain("Hannah answered");
    expect(html).toContain("About two hours.");
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

  it("shows a file once: in its own card, not again under the report", () => {
    const report = {
      id: "u1",
      kind: "request" as const,
      headline: "Picture ready",
      at: new Date("2026-11-18T12:02:00Z"),
      revertible: false,
      revertedAt: null,
      posts: [],
      media: [
        { kind: "image" as const, url: "https://blob/p.jpg", name: "p.jpg" },
        { kind: "image" as const, url: "https://blob/other.jpg", name: "o" },
      ],
    };
    const thread = buildThread(
      { ...hired, updates: [report] },
      [],
      [work({ state: "ready", url: "https://blob/p.jpg" })],
    );
    const update = thread.find((item) => item.kind === "update");
    expect(update?.kind === "update" ? update.update.media : null).toEqual([
      { kind: "image", url: "https://blob/other.jpg", name: "o" },
    ]);
  });

  it("shows a finished run once: its card, not its report message too", () => {
    const report = {
      id: "m9",
      fromCuso: true,
      author: "Cuso",
      content: "Four weeks are in the table.",
      createdAt: "2026-11-18T13:00:00.000Z",
      turnId: "run-1",
    };
    const run = work({ kind: "run", title: "Results log", turnId: "run-1" });
    const kinds = (made: ChatWork) =>
      buildThread(hired, [report], [made]).map((item) =>
        item.kind === "message" ? item.message.id : item.kind,
      );

    // While it runs, anything the run says still shows.
    expect(kinds(run)).toContain("m9");
    expect(kinds({ ...run, state: "ready" })).not.toContain("m9");
    expect(kinds({ ...run, state: "stopped" })).not.toContain("m9");
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
