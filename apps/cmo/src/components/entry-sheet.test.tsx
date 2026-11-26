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

  it("names the other networks one talking video goes out on", () => {
    const html = renderToStaticMarkup(
      <EntrySheet
        entry={{
          ...entry,
          channel: "instagram",
          format: "talking_video",
          alsoOn: ["youtube", "facebook"],
        }}
        onClose={() => {}}
      />,
    );
    expect(html).toContain(
      "Instagram · Talking Reel · video by Cuso · also on YouTube, Facebook",
    );
  });

  it("names a video's other shapes by network and shape", () => {
    const html = renderToStaticMarkup(
      <EntrySheet
        entry={{
          ...entry,
          channel: "instagram",
          format: "talking_video",
          alsoOn: ["youtube", "instagram_feed", "x"],
        }}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("also on YouTube, Instagram 4:5, X 16:9");
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

  it("opens a piece kept in the owner's Files instead of promising it", () => {
    const html = renderToStaticMarkup(
      <EntrySheet
        entry={{
          ...entry,
          channel: "seo",
          format: "article",
          draft: undefined,
          fileId: "file-1",
        }}
        onClose={() => {}}
        loadText={async () => "Three checks before you add analytics."}
      />,
    );
    expect(html).toContain("Opening it from your Files");
    expect(html).not.toContain("once you subscribe");
  });

  it("lays a carousel's slides out in order to swipe", () => {
    const html = renderToStaticMarkup(
      <EntrySheet
        entry={{ ...entry, channel: "instagram", format: "carousel" }}
        media={{
          entryId: "cal-1",
          kind: "image",
          url: "https://blob/1.jpg",
          slides: ["https://blob/1.jpg", "https://blob/2.jpg"],
        }}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("2 images by Cuso");
    expect(html).toContain('<ol class="sheet-slides"');
    expect(html).toContain('src="https://blob/1.jpg" alt="Slide 1 of 2"');
    expect(html).toContain('src="https://blob/2.jpg" alt="Slide 2 of 2"');
    expect(html).not.toContain('class="sheet-media"');
  });
});
