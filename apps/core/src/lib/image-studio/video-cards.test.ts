import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site-capture", () => ({ withBrowser: vi.fn() }));
vi.mock("@/config/env", () => ({ getEnv: () => ({}) }));

import { cardColours, videoCardHtml } from "./video-cards";
import { VIDEO_LAYOUTS } from "./video-layout";

const BRAND = { colors: ["#6400FF", "#FFFFFF"], font: "Inter" };

describe("video cards", () => {
  it("draws a card in the frame of its shape, inside the part no overlay covers", () => {
    for (const shape of ["9:16", "4:5", "1:1", "16:9"] as const) {
      const { frame, safe } = VIDEO_LAYOUTS[shape];
      const html = videoCardHtml({ kind: "title", text: "Hi" }, BRAND, shape);
      expect(html).toContain(`width:${frame.width}px;height:${frame.height}px`);
      expect(html).toContain(`left:${safe.left}px;top:${safe.top}px`);
    }
  });

  it("uses the brand's colour, with ink that reads on it", () => {
    expect(cardColours(BRAND)).toEqual({ fill: "#6400FF", ink: "#FFFFFF" });
    expect(cardColours({ colors: ["#FFE600"], font: null })).toEqual({
      fill: "#FFE600",
      ink: "#101010",
    });
    // A brand without a usable colour gets a near-black card.
    expect(cardColours({ colors: ["purple"], font: null }).fill).toBe(
      "#101010",
    );
  });

  it("loads the brand's font by name, and only a plain family name", () => {
    expect(
      videoCardHtml({ kind: "title", text: "Hi" }, BRAND, "9:16"),
    ).toContain("fonts.googleapis.com/css2?family=Inter:");
    const odd = videoCardHtml(
      { kind: "title", text: "Hi" },
      { colors: [], font: 'Inter"><script>' },
      "9:16",
    );
    expect(odd).not.toContain("googleapis");
    expect(odd).not.toContain("<script>");
  });

  it("shows each kind's own parts and escapes the words", () => {
    const point = videoCardHtml(
      { kind: "point", number: 2, text: "Ships in <24h> & free" },
      BRAND,
      "4:5",
    );
    expect(point).toContain('<p class="number">2</p>');
    expect(point).toContain("Ships in &lt;24h&gt; &amp; free");
    expect(
      videoCardHtml({ kind: "label", label: "Myth", text: "x" }, BRAND, "1:1"),
    ).toContain('<p class="label">Myth</p>');
    expect(
      videoCardHtml(
        { kind: "offer", text: "20% off", detail: "until Friday" },
        BRAND,
        "16:9",
      ),
    ).toMatch(/class="big">20% off<\/p><p class="text">until Friday/);
    expect(
      videoCardHtml(
        { kind: "date", date: "3 December", text: "Doors open" },
        BRAND,
        "9:16",
      ),
    ).toContain('<p class="big">3 December</p>');
  });

  it("carries only the words it is given: no name or link of ours", () => {
    const html = videoCardHtml(
      { kind: "title", text: "Fresh beans" },
      BRAND,
      "9:16",
    );
    expect(html.toLowerCase()).not.toMatch(/sokosumi|soko bot|cuso/);
  });
});
