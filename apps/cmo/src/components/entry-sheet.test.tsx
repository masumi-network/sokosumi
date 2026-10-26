import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EntrySheet } from "./entry-sheet";

const entry = {
  id: "cal-1",
  date: "2026-10-27",
  time: "12:00",
  channel: "youtube",
  format: "short",
  title: "Trace a request through a workflow",
  status: "draft" as const,
  draft: "One request, start to finish.",
};

describe("EntrySheet", () => {
  it("plays the video Cuso made for the piece", () => {
    const html = renderToStaticMarkup(
      <EntrySheet
        entry={entry}
        media={{ entryId: "cal-1", kind: "video", url: "https://blob/v.mp4" }}
        onClose={() => {}}
      />,
    );
    expect(html).toContain(
      '<video class="sheet-media" src="https://blob/v.mp4"',
    );
    expect(html).toContain("One request, start to finish.");
  });

  it("shows an image with the piece's title as its text", () => {
    const html = renderToStaticMarkup(
      <EntrySheet
        entry={entry}
        media={{ entryId: "cal-1", kind: "image", url: "https://blob/i.png" }}
        onClose={() => {}}
      />,
    );
    expect(html).toContain(
      '<img class="sheet-media" src="https://blob/i.png" alt="Trace a request through a workflow"',
    );
  });
});
