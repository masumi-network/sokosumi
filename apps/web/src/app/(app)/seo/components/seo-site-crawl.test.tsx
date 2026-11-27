import type {
  ProjectSeoSiteCrawl,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoSiteCrawl } from "./seo-site-crawl";
import { type SeoCrawlT, seoCrawlInstructions } from "./seo-site-crawl-copy";
import { seoSiteCrawlView } from "./seo-site-crawl-model";
import { SeoCrawlNextButton } from "./seo-site-crawl-next";
import { SEO_TEST_PAGE, seoTestWorkspace } from "./seo-test-fixture";

type Crawled = Extract<ProjectSeoSiteCrawl, { state: "crawled" }>;
const SITE = "https://example.com";
const none = { urls: [], total: 0 };
const copy = messages.App.Seo.siteCrawl;

afterEach(cleanup);

/** A whole crawl with one broken link, linked from the Audit's home page and from a page the Audit does not hold. */
const crawl = (): Crawled => ({
  state: "crawled",
  fetched: 40,
  read: 38,
  stop: "complete",
  links: {
    broken: [
      {
        target: `${SITE}/old`,
        status: 404,
        linkedFrom: 2,
        // The bot may write a URL that Core stores in another form: both name the home page.
        sources: ["https://EXAMPLE.com:443/", `${SITE}/blog`],
      },
    ],
    brokenTotal: 3,
    chains: [],
    chainsTotal: 0,
    notJudged: 4,
  },
  javascript: { unseen: 0, groups: [] },
  orphans: { state: "found", urls: [], total: 0, candidates: false },
  pageChecks: {
    pages: 38,
    checked: 38,
    missingTitle: none,
    missingH1: none,
    duplicateTitles: { groups: [], total: 0, notDetermined: 0 },
    noindexInSitemap: { ...none, sitemapUrls: 20, checked: 20 },
    badCanonicals: { pages: [], total: 0, notDetermined: 0 },
  },
  gaps: [],
});

function show(siteCrawl: Crawled, openPage = vi.fn()) {
  const workspace: ProjectSeoWorkspace = {
    ...seoTestWorkspace(),
    observations: [
      {
        kind: "audit_full",
        observedAt: new Date("2026-11-20T12:00:00Z"),
        siteCrawl,
      } as unknown as ProjectSeoWorkspace["observations"][number],
    ],
  };
  render(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      formats={createFormats()}
      messages={messages}
    >
      <SeoSiteCrawl workspace={workspace} openPage={openPage} />
    </NextIntlClientProvider>,
  );
  return openPage;
}

/** Leaves `count` more checks without a result: with the links the crawl did not judge, each reads as not determined. */
function undecided(siteCrawl: Crawled, count: number) {
  const pc = siteCrawl.pageChecks!;
  const drop: (() => void)[] = [
    () => {
      siteCrawl.orphans = { state: "not determined", reason: "no sitemap" };
    },
    () => {
      siteCrawl.javascript = null;
    },
    () => {
      pc.noindexInSitemap = { ...none, sitemapUrls: 20, checked: 12 };
    },
  ];
  for (const step of drop.slice(0, count)) step();
  return siteCrawl;
}

describe("site crawl view", () => {
  it("keeps three undecided checks open and folds a fourth behind one line", async () => {
    show(undecided(crawl(), 2));
    expect(
      screen.getAllByText(`${copy.notDetermined}.`, { exact: false }),
    ).toHaveLength(3);
    cleanup();

    show(undecided(crawl(), 3));
    const fold = screen.getByText("Not determined: 4 checks");
    // Shut, the fold hides its rows; the line says what they are.
    expect(fold.closest("details")).not.toHaveAttribute("open");
    await userEvent.click(fold);
    const rows = within(fold.closest("details")!).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
      copy.checks.noindexInSitemap,
      copy.checks.redirectChains,
      copy.checks.orphans,
      copy.checks.javascript,
    ]);
    // The fold's line says the state: the rows inside do not say it again.
    expect(
      within(fold.closest("details")!).queryAllByText(
        `${copy.notDetermined}.`,
        { exact: false },
      ),
    ).toEqual([]);
  });

  it("opens the Audit's checks of a listed page, and leaves a page the Audit does not hold as text", async () => {
    const openPage = show(crawl());
    await userEvent.click(screen.getByText(copy.checks.brokenLinks));
    expect(
      screen.getByText(copy.checks.brokenLinks).closest("details"),
    ).toHaveAttribute("open");
    // The home page is the Audit's; /blog and the broken target /old are not, so only "/" opens anything.
    const pages = screen.getAllByRole("button", {
      name: (name) => name.endsWith(copy.openPage),
    });
    expect(pages.map((page) => page.firstChild?.textContent)).toEqual(["/"]);
    await userEvent.click(pages[0]!);
    expect(openPage).toHaveBeenCalledWith(SEO_TEST_PAGE);
  });
});

describe("crawl of the next pages", () => {
  const AUDIT = "a".repeat(64),
    NEXT = "b".repeat(64);
  const next = copy.next;

  it("lists the continuation with its deep audit, and starts the next one from the tip Core offers", async () => {
    const continuation: Crawled = {
      ...crawl(),
      stop: "page cap",
      snapshotId: NEXT,
      continues: AUDIT,
      startUrl: `${SITE}/`,
      deepAudit: {
        pages: [
          {
            url: `${SITE}/shop`,
            pickedFor: ["broken links"],
            findings: [
              { title: "No meta description", severity: "major" },
              { title: "Check the image sizes", severity: "test" },
            ],
            findingsTotal: 2,
          },
        ],
        skipped: [{ url: `${SITE}/cart`, reason: "the page answered 500" }],
      },
    };
    const base = seoTestWorkspace();
    const workspace = {
      ...base,
      availableActions: { ...base.availableActions, continueCrawlFrom: NEXT },
      observations: [
        {
          kind: "crawl_next",
          observedAt: new Date("2026-11-21T12:00:00Z"),
          siteCrawl: continuation,
        },
        {
          kind: "audit_full",
          observedAt: new Date("2026-11-20T12:00:00Z"),
          siteCrawl: { ...crawl(), stop: "page cap", snapshotId: AUDIT },
        },
      ],
    } as unknown as ProjectSeoWorkspace;
    const execute = vi.fn();
    const model = { data: workspace, pending: false, execute };
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoSiteCrawl
          workspace={workspace}
          openPage={vi.fn()}
          action={
            <SeoCrawlNextButton
              model={
                model as unknown as Parameters<
                  typeof SeoCrawlNextButton
                >[0]["model"]
              }
            />
          }
        />
      </NextIntlClientProvider>,
    );
    const fold = screen.getByText(next.heading).closest("details")!;
    await userEvent.click(screen.getByText(next.heading));
    expect(fold).toHaveAttribute("open");
    within(fold).getByText(`${SITE}/shop`);
    within(fold).getByText("Picked for: broken links · 2 issues");
    within(fold).getByText("The page answered 500.");
    // A test has no level: only the ranked finding shows one.
    expect(within(fold).getAllByText("High impact")).toHaveLength(1);
    expect(within(fold).queryByText("Low impact")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: next.button }));
    await userEvent.click(screen.getByRole("button", { name: next.confirm }));
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      {
        kind: "continue_crawl",
        continues: NEXT,
        idempotencyKey: expect.any(String),
      },
      next.started,
    );
  });
});

describe("agent instructions for a crawl check", () => {
  const t = createTranslator({
    locale: "en",
    messages,
    namespace: "App.Seo.siteCrawl",
  }) as unknown as SeoCrawlT;

  it("names full URLs, and says what the crawl did not list or judge", () => {
    const view = seoSiteCrawlView(crawl());
    if (view?.state !== "crawled") throw new Error("expected a crawl");
    const row = view.rows.find((r) => r.check === "brokenLinks");
    if (row?.state !== "found") throw new Error("expected broken links");
    expect(seoCrawlInstructions(row, "complete", t)).toBe(
      [
        copy.copy.lead,
        `${copy.checks.brokenLinks}: 3`,
        copy.copy.fix.brokenLinks,
        `- ${SITE}/old (Status 404, Linking pages: 2)\n  ${copy.from}: https://EXAMPLE.com:443/, ${SITE}/blog`,
        "The crawl lists 1 of 3.",
        "Links not judged: 4",
      ].join("\n\n"),
    );
  });

  it("says where a stopped crawl stopped, which the view's header says and a pasted finding does not", () => {
    const view = seoSiteCrawlView({ ...crawl(), stop: "page cap" });
    if (view?.state !== "crawled") throw new Error("expected a crawl");
    const row = view.rows.find((r) => r.check === "brokenLinks");
    if (row?.state !== "found") throw new Error("expected broken links");
    expect(seoCrawlInstructions(row, "page cap", t).split("\n\n").at(-1)).toBe(
      "Stopped at the page limit. Pages that the crawl did not read can have this problem too.",
    );
  });

  it("writes a redirect chain as its hops and a duplicate title in quotes", () => {
    const c = crawl();
    c.links!.chains = [
      {
        start: `${SITE}/a`,
        kind: "loop",
        linkedFrom: 1,
        hops: [
          { url: `${SITE}/a`, status: 301 },
          { url: `${SITE}/b`, status: 301 },
        ],
        final: `${SITE}/a`,
      },
    ] as NonNullable<Crawled["links"]>["chains"];
    c.links!.chainsTotal = 1;
    c.pageChecks!.duplicateTitles = {
      groups: [{ text: "Home", size: 2, urls: [`${SITE}/`, `${SITE}/x`] }],
      total: 1,
      notDetermined: 0,
    };
    const view = seoSiteCrawlView(c);
    if (view?.state !== "crawled") throw new Error("expected a crawl");
    const text = (check: string) => {
      const row = view.rows.find((r) => r.check === check);
      if (row?.state !== "found") throw new Error(`expected ${check}`);
      return seoCrawlInstructions(row, "complete", t).split("\n\n")[3];
    };
    expect(text("redirectChains")).toBe(
      `- ${SITE}/a → ${SITE}/b → ${SITE}/a (Loop, Linking pages: 1)`,
    );
    expect(text("duplicateTitles")).toBe(
      `- "Home" (Pages: 2)\n  ${SITE}/, ${SITE}/x`,
    );
  });
});
