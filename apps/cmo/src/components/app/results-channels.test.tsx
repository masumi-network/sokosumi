import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { cmoOverview, cmoStrategyVersion } from "../../test-fixtures/cmo";
import { ChannelsPage, ResultsPage } from "./pages";

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const linkedin = {
  id: "c1",
  provider: "linkedin",
  handle: "acme",
  displayName: "Acme",
  status: "ACTIVE",
  personalProfile: false,
};

function results(patch: Parameters<typeof cmoOverview>[0]) {
  const overview = cmoOverview({
    ...cmoStrategyVersion(new Date("2026-11-02T09:00:00Z")),
    updates: [],
    ...patch,
  });
  return text(
    renderToStaticMarkup(
      <ResultsPage
        overview={overview}
        compose={() => {}}
        openUpdate={() => {}}
        openView={() => {}}
        connectMeasurement={async () => ({ url: null, error: null })}
        ads={{
          loadAdCampaigns: async () => [],
          setAdCampaignStatus: async () => ({ overview: null, error: null }),
        }}
        onChange={() => {}}
      />,
    ),
  );
}

function withCalendar(
  entries: { channel: string; status: "draft" | "scheduled"; date: string }[],
) {
  const base = cmoOverview().strategy;
  if (!base) throw new Error("The fixture has a strategy");
  const strategy = {
    ...base,
    calendar: entries.map((entry, index) => ({
      id: `p${index}`,
      // An approved month's social piece is a Social post.
      socialPostId: `p${index}`,
      title: `Post ${index + 1}`,
      format: "post",
      time: "09:00",
      draft: "Words.",
      ...entry,
    })),
  };
  return { strategy, approvedStrategy: strategy };
}

it("shows what goes out this week and when the first numbers arrive, before any number exists", () => {
  const html = results({
    channels: [linkedin],
    ...withCalendar([
      { channel: "linkedin", status: "scheduled", date: inDays(1) },
      { channel: "linkedin", status: "scheduled", date: inDays(3) },
      { channel: "linkedin", status: "scheduled", date: inDays(20) },
    ]),
    routines: [
      {
        key: "cmo-weekly-review",
        name: "Weekly review",
        when: "Mondays at 09:00",
        description: "",
        nextRunAt: new Date("2026-11-23T08:00:00Z"),
        timezone: "Europe/Berlin",
      },
    ],
  });
  expect(html).toContain("Going out in the next seven days: 2 posts");
  expect(html).toContain("Post 1");
  expect(html).not.toContain("Post 3");
  expect(html).toContain(
    "The first ones arrive with the weekly report on Monday 23 November at 09:00",
  );
  expect(html).not.toContain("nothing to chart");
});

it("counts posts written for a network that is not connected as waiting, not as drafts", () => {
  const html = results({
    channels: [],
    posts: { draft: 2, scheduled: 0, published: 0, failed: 0 },
    ...withCalendar([
      { channel: "linkedin", status: "draft", date: inDays(1) },
      { channel: "linkedin", status: "draft", date: inDays(2) },
    ]),
  });
  expect(html).toContain("Waiting 2 for LinkedIn");
  expect(html).toContain("2 posts are written and wait for LinkedIn.");
  expect(html).not.toContain("Drafts");
});

it("lists sending the newsletter as soon, and TikTok once, only where it can be connected", () => {
  const html = renderToStaticMarkup(
    <ChannelsPage
      overview={cmoOverview()}
      compose={() => {}}
      connect={async () => ({ url: null, error: null })}
      connectAds={async () => ({ url: null, error: null })}
      addMailingList={async () => ({ overview: null, error: null })}
      onChange={() => {}}
      openSeo={() => {}}
      connectSearchConsole={async () => ({ url: null, error: null })}
    />,
  );
  expect(html).not.toContain("<b>TikTok</b>");
  expect(text(html)).toContain("Send from here");
  // Where Core lets TikTok connect, the row is the real one, once.
  const enabled = renderToStaticMarkup(
    <ChannelsPage
      overview={cmoOverview({ tiktokEnabled: true })}
      compose={() => {}}
      connect={async () => ({ url: null, error: null })}
      connectAds={async () => ({ url: null, error: null })}
      addMailingList={async () => ({ overview: null, error: null })}
      onChange={() => {}}
      openSeo={() => {}}
      connectSearchConsole={async () => ({ url: null, error: null })}
    />,
  );
  expect(enabled.match(/<b>TikTok<\/b>/g)).toHaveLength(1);
  expect(text(enabled)).toContain("You confirm each video before it goes out.");
  expect(text(html)).not.toMatch(/coming soon/i);
});

it("draws the month by network: what is out of each network's posts", () => {
  const base = cmoOverview().strategy;
  if (!base) throw new Error("The fixture has a strategy");
  const entry = (
    id: string,
    channel: string,
    status: "published" | "scheduled",
  ) => ({ id, date: "2026-11-02", channel, title: id, format: "post", status });
  const html = renderToStaticMarkup(
    <ResultsPage
      overview={cmoOverview({
        ...cmoStrategyVersion(new Date("2026-11-02T09:00:00Z")),
        updates: [],
        strategy: {
          ...base,
          calendar: [
            entry("a", "linkedin", "published"),
            entry("b", "linkedin", "scheduled"),
            entry("c", "linkedin", "scheduled"),
            entry("d", "x", "published"),
          ],
        },
      })}
      compose={() => {}}
      openUpdate={() => {}}
      openView={() => {}}
      connectMeasurement={async () => ({ url: null, error: null })}
      ads={{
        loadAdCampaigns: async () => [],
        setAdCampaignStatus: async () => ({ overview: null, error: null }),
      }}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('aria-label="LinkedIn: 1 of 3 out"');
  expect(html).toContain('aria-label="X: 1 of 1 out"');
  expect(html).toContain(
    'aria-label="Out 2, Scheduled 2, Written 0, To make 0"',
  );
  // The longest bar is the network with the most posts.
  expect(html.indexOf("LinkedIn: 1 of 3")).toBeLessThan(
    html.indexOf("X: 1 of 1"),
  );
});
