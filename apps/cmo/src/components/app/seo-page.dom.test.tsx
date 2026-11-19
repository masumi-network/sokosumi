// @vitest-environment happy-dom

import type { CmoSeo } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { seo } from "../../app/design-system/app/fixtures";
import { type SeoActions, SeoPage } from "./seo-page";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const text = () => container.textContent ?? "";
const button = (label: string) => {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};

function actions(data: CmoSeo | null, patch: Partial<SeoActions> = {}) {
  return {
    loadSeo: vi.fn(async () => data),
    searchKeywords: vi.fn(async () => ({ search: null, error: null })),
    setSeoSuggestionStatus: vi.fn(async () => null),
    markLandingPageLive: vi.fn(async () => ({ note: null, error: null })),
    askCusoForArticles: vi.fn(async () => null),
    connectSearchConsole: vi.fn(async () => ({ url: null, error: null })),
    ...patch,
  } satisfies SeoActions;
}

async function render(page: SeoActions) {
  await act(async () =>
    root.render(<SeoPage actions={page} timeZone="Europe/Berlin" />),
  );
}

it("shows the weekly audit with its cost, the numbers behind each suggestion and their source", async () => {
  await render(actions(seo));
  expect(text()).toContain("750 credits");
  expect(text()).toContain("86 of 110");
  expect(text()).toContain("Structured data");
  expect(text()).toContain(
    "Team Booking Software for Sales and Support | Acme",
  );
  expect(text()).toContain("880 searches a month");
  expect(text()).toContain("(Keyword research, 17 Nov 2026)");
  expect(text()).toContain("(Search Console, 17 Nov 2026)");
  expect(text()).not.toMatch(/Sokosumi|coming soon/i);
});

it("says the audit's findings in plain words, without its check ids", async () => {
  await render(actions(seo));
  expect(text()).toContain("Checks that did not pass");
  expect(text()).toContain(
    "1 of the 17 script and style files this page needs did not load.",
  );
  expect(text()).not.toContain("rendering asks for");
  expect(text()).not.toMatch(/Finding|RN-01/);
  expect(text()).toContain(
    'did not pass the check "Script and style files for rendering load and are not blocked"',
  );
  const detail = [...container.querySelectorAll("details:not([open])")].find(
    (fold) => fold.querySelector("summary")?.textContent === "More detail",
  );
  expect(detail?.textContent).toContain(
    "update it to the current embed code from the HubSpot account",
  );
});

it("explains every check that did not pass, so the numbers add up", async () => {
  await render(actions(seo));
  const latest = seo.audit.latest;
  if (!latest) throw new Error("The fixture has an audit");
  expect(latest.passed + latest.failedChecks + latest.readingChecks).toBe(
    latest.checked,
  );
  expect(text()).toContain("6 checks found what is listed to fix");
  expect(text()).toContain("18 checks only took a reading");
  expect(text()).toContain("A reading is not a problem.");
  const readings = [...container.querySelectorAll("details")].find(
    (fold) => fold.querySelector("summary")?.textContent === "See the readings",
  );
  expect(readings?.textContent).toContain("Title length");
  expect(readings?.textContent).toContain("title 45 characters");
  expect(text()).not.toContain("No issues found");
});

it("says when the next audit runs with its time, so it never reads as the weekly review's day", async () => {
  await render(actions(seo));
  expect(text()).toMatch(/Next audit: \w+ \d+ November at \d\d:\d\d\./);
});

it("shows the original observation date on a related editorial pick", async () => {
  const search = seo.keywordSearches[0];
  await render(
    actions({
      ...seo,
      keywordSearches: [
        {
          ...search,
          ideas: [
            {
              ...search.ideas[0],
              editorial: true,
              measuredAt: new Date("2026-11-14T09:00:00Z"),
            },
            {
              ...search.ideas[1],
              measuredAt: new Date("2026-11-13T09:00:00Z"),
            },
            ...search.ideas.slice(2),
          ],
        },
      ],
    }),
  );
  const cells = [...container.querySelectorAll(".seo-table tbody tr")].map(
    (row) => row.querySelector("td")?.textContent,
  );
  expect(cells[0]).toContain("Editorial pick · Measured 14 Nov 2026");
  expect(cells[1]).toContain("Measured 13 Nov 2026");
  expect(cells[1]).not.toContain("Editorial pick");
});

it("says Not known for a keyword number that is missing", async () => {
  await render(actions(seo));
  const cells = [...container.querySelectorAll(".seo-table tbody tr")].map(
    (row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent),
  );
  expect(cells[2]).toEqual([
    "team booking app free",
    "10",
    "Not known",
    "commercial",
    "Not yet",
  ]);
  expect(cells[3].slice(1, 4)).toEqual(["Not known", "Not known", "Not known"]);
  expect(text()).not.toContain("None");
});

it("marks a page change done and asks Cuso for more ideas and a full article", async () => {
  const page = actions(seo);
  await render(page);
  await act(async () => button("Done").click());
  expect(page.setSeoSuggestionStatus).toHaveBeenCalledWith(
    seo.pageChanges[0].id,
    "done",
  );
  await act(async () => button("More article ideas").click());
  expect(page.askCusoForArticles).toHaveBeenCalledWith(undefined);
  await act(async () => button("Write it").click());
  expect(page.askCusoForArticles).toHaveBeenCalledWith(seo.articles[0].id);
  expect(text()).toMatch(/is writing it/);
});

it("says plainly when a week was skipped for credits and offers Search Console when it is not connected", async () => {
  await render(
    actions({
      ...seo,
      audit: { ...seo.audit, skipped: [new Date("2026-11-23T12:00:00Z")] },
      searchConsole: {
        ...seo.searchConsole,
        status: "not_connected",
        totals: null,
        nearFirstPage: [],
        lowClickRate: [],
      },
    }),
  );
  expect(text()).toContain(
    "Skipped on 23 Nov 2026: your credits could not cover the 750 an audit costs.",
  );
  expect(button("Connect")).toBeTruthy();
});

it("shows a landing page with its sources and says where it is live", async () => {
  const markLandingPageLive = vi.fn(async () => ({
    note: "1 search ad for this search now sends people to the page.",
    error: null,
  }));
  const page = actions(seo, { markLandingPageLive });
  await render(page);
  expect(text()).toContain("Landing pages");
  expect(text()).toContain(
    "Calendly alternative for teams that want their own booking page",
  );
  expect(text()).toContain(
    '"Standard $12 /seat/mo billed yearly" (calendly.com)',
  );
  const source = container.querySelector<HTMLAnchorElement>(
    'a[href="https://calendly.com/pricing"]',
  );
  expect(source?.rel).toBe("noreferrer");

  const input = container.querySelector<HTMLInputElement>('input[name="url"]');
  if (!input) throw new Error("No address field");
  await act(async () => {
    input.value = "https://acme.io/calendly-alternative";
    button("It's live").click();
  });
  expect(markLandingPageLive).toHaveBeenCalledWith(
    seo.landingPages[0].id,
    "https://acme.io/calendly-alternative",
  );
  expect(text()).toContain(
    "1 search ad for this search now sends people to the page.",
  );
});

it("shows a landing page that is live with its address, and no address field", async () => {
  const [landing] = seo.landingPages;
  await render(
    actions({
      ...seo,
      landingPages: [
        {
          ...landing,
          status: "done",
          pageUrl: "https://acme.io/calendly-alternative",
        },
      ],
    }),
  );
  expect(text()).toContain("Live");
  expect(text()).toContain("/calendly-alternative");
  expect(container.querySelector('input[name="url"]')).toBeNull();
});

it("leaves the landing pages out while there are none", async () => {
  await render(actions({ ...seo, landingPages: [] }));
  expect(text()).not.toContain("Landing pages");
});
