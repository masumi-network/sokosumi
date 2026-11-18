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
    askCusoForArticles: vi.fn(async () => null),
    connectSearchConsole: vi.fn(async () => ({ url: null, error: null })),
    ...patch,
  } satisfies SeoActions;
}

async function render(page: SeoActions) {
  await act(async () => root.render(<SeoPage actions={page} />));
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
