import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { cmoOverview } from "../test-fixtures/cmo";
import { PhoneFeeds } from "./phone-feeds";

const piece = (id: string, patch: object = {}) => ({
  id,
  date: "2026-11-06",
  channel: "linkedin",
  format: "image",
  title: "Inside the test stand",
  status: "scheduled" as const,
  ...patch,
});

function feeds(
  calendar: ReturnType<typeof piece>[],
  patch: Parameters<typeof cmoOverview>[0] = {},
) {
  const overview = cmoOverview(patch);
  const strategy = overview.strategy;
  if (!strategy) throw new Error("The fixture has a strategy");
  return renderToStaticMarkup(
    <PhoneFeeds overview={overview} strategy={{ ...strategy, calendar }} />,
  );
}

it("shows a made post's own words and picture, and a placeholder only for one still to come", () => {
  const html = feeds(
    [
      piece("made", { draft: "Every engine runs on the test stand first." }),
      piece("coming", { status: "idea" as const }),
    ],
    {
      media: [
        { entryId: "made", kind: "image", url: "https://blob.example/a.jpg" },
      ],
    },
  );
  expect(html).toContain("Every engine runs on the test stand first.");
  expect(html).toContain('src="https://blob.example/a.jpg"');
  // The piece without words keeps its grey bars.
  expect(html).toContain("mw-line");
});

it("says a planned ad needs its account, once, instead of calling it optional", () => {
  const ad = piece("ad", {
    channel: "google_ads",
    format: "search_ad",
    status: "draft" as const,
  });
  const missing = feeds([ad], { adProviders: [] });
  expect(missing).toContain("Planned. Connect Google Ads in Channels");
  expect(missing).not.toContain("if you add");
  expect(missing).not.toContain("Optional");
  expect(feeds([ad], { adProviders: ["google_ads"] })).not.toContain(
    "Connect Google Ads",
  );
});
