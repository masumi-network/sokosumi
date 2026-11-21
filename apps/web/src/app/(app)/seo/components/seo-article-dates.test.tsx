import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import messages from "../../../../../messages/en.json";
import { SeoArticleDates } from "./seo-article-dates";
import { seoTestWorkspace } from "./seo-test-fixture";

it("shows the headline phrase, older article and private query evidence within the selected cohort", () => {
  const data = seoTestWorkspace(),
    topic = "Kamera-Reparatur";
  const article = (n: number, date: string) => ({
    url: "https://example.test/page-" + n,
    publishedOn: new Date(date + "T00:00:00Z"),
    record: String(n).repeat(64),
    section: topic,
  });
  const [one, two, old] = [
    article(1, "2026-09-01"),
    article(2, "2026-09-08"),
    article(3, "2025-03-10"),
  ];
  const model = {
    data: {
      ...data,
      pages: [one, two, old].map((p, i) => ({
        ...data.pages[0],
        id: String(i),
        url: p.url,
      })),
      scope: { ...data.scope, pageIds: ["0", "1", "2"] },
      observations: [
        {
          ...data.observations[0],
          kind: "audit_full",
          pageIds: ["0", "1"],
          observedAt: new Date("2026-09-12T22:15:00Z"),
        },
      ],
      articleDates: [
        one,
        two,
        old,
        { ...one, url: "https://example.test/account/private" },
      ],
      privateTopicQueries: [
        {
          topic,
          query: "Kamera-Reparatur Objektiv",
          pages: [one.url, two.url],
          from: new Date("2026-09-01"),
          to: new Date("2026-09-08"),
          observationId: "query-observation",
        },
      ],
      topicLaunches: [
        {
          topic,
          basis: "headline_phrase" as const,
          publishedFrom: one.publishedOn,
          publishedThrough: two.publishedOn,
          pages: [one, two],
          earlierArticle: old,
        },
      ],
    },
  };
  const view = (workspace: typeof model.data) => (
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="America/Los_Angeles"
    >
      <SeoResultMessagesProvider messages={messages.App.Seo}>
        <SeoArticleDates workspace={workspace} />
      </SeoResultMessagesProvider>
    </NextIntlClientProvider>
  );
  const { rerender } = render(view(model.data));
  expect(
    screen.getByText(/public headlines contain the same phrase/),
  ).toBeVisible();
  expect(
    screen.getByText(
      /Your private Search Console data recorded “Kamera-Reparatur Objektiv” for 2 of these pages/,
    ),
  ).toBeVisible();
  expect(
    screen.getByText(/11 days old at the Sep 12, 2026 audit/),
  ).toBeVisible();
  expect(screen.getByText(/publisher supplied these dates/)).toBeVisible();
  expect(screen.getByRole("heading", { name: topic })).toBeVisible();
  expect(
    screen.getByText(
      /2 audited articles give publication dates from Sep 1, 2026 to Sep 8, 2026/,
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      /older article used this phrase in its headline on Mar 10, 2025/,
    ),
  ).toBeVisible();
  expect(
    screen.getAllByRole("link").map((link) => link.getAttribute("href")),
  ).toEqual([old.url, one.url, two.url]);
  const next = [article(4, "2026-10-01"), article(5, "2026-10-02")];
  rerender(
    view({
      ...model.data,
      pages: [
        ...model.data.pages,
        ...next.map((p) => ({ ...data.pages[0], id: p.url, url: p.url })),
      ],
      scope: {
        ...model.data.scope,
        pageIds: ["0", "1", ...next.map((p) => p.url)],
      },
      articleDates: [...model.data.articleDates, ...next],
      topicLaunches: [
        ...model.data.topicLaunches,
        {
          ...model.data.topicLaunches[0],
          topic: topic.toUpperCase(),
          pages: next,
          publishedFrom: next[0].publishedOn,
          publishedThrough: next[1].publishedOn,
        },
      ],
    }),
  );
  expect(screen.getAllByRole("heading", { name: topic })).toHaveLength(1);
  expect(
    screen.getAllByText(/do not establish when the publisher first covered/),
  ).toHaveLength(2);
  expect(screen.queryByText(/older article used this phrase/)).toBeNull();
  expect(
    screen.getAllByRole("link").map((link) => link.getAttribute("href")),
  ).toEqual([one.url, two.url, ...next.map((p) => p.url)]);
});
