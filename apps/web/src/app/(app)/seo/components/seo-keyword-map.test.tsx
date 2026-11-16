import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoKeywordMap } from "./seo-keyword-map";
import { seoKeywordMap } from "./seo-keyword-map-model";
import { keywordGroups } from "./seo-keyword-rows-model";
import { seoTestWorkspace } from "./seo-test-fixture";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const wizard = vi.hoisted(() => ({ openNewTaskWizard: vi.fn() }));
// The New Task wizard is another feature's dialog: the map only hands it a prompt.
vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => wizard,
}));

type Keyword = ProjectSeoWorkspace["keywords"][number];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const model = {
  data: seoTestWorkspace(),
  pending: false,
  openChat: vi.fn(),
  toggleKeyword: vi.fn(),
} as unknown as SeoWorkspaceModel;

let next = 0;
function row(patch: Partial<Keyword>): Keyword {
  next += 1;
  return {
    id: `k${next}`,
    keyword: `keyword ${next}`,
    pageUrl: "https://example.com/",
    targetPageId: null,
    saved: false,
    countryCode: "US",
    languageCode: "en",
    source: "focus",
    volume: null,
    difficulty: null,
    clicks: null,
    intent: null,
    conversion: null,
    feature: null,
    device: null,
    position: null,
    positionStatus: "unavailable",
    checkedResults: null,
    observedAt: null,
    observationId: null,
    priority: "medium",
    version: 0,
    ...patch,
  };
}

function renderMap(rows: Keyword[], viewer = model) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoKeywordMap groups={keywordGroups(rows)} model={viewer} />
    </NextIntlClientProvider>,
  );
}

describe("SEO keyword map", () => {
  it("gives a keyword's numbers from the keyboard, and the same numbers in the table", async () => {
    const user = userEvent.setup();
    renderMap([
      row({
        keyword: "battery app",
        volume: 1000,
        difficulty: 12.4,
        position: 15,
        positionStatus: "ranked",
        observationId: "o1",
        observedAt: new Date("2026-11-01T00:00:00.000Z"),
        clicks: { now: 7, top10: 8, top3: 60, top1: 194 },
      }),
      row({
        keyword: "battery health",
        source: "gap",
        volume: 5000,
        difficulty: 70,
        clicks: { now: 0, top10: 41, top3: 301, top1: 969 },
      }),
    ]);
    const map = screen.getByRole("group", { name: "Keyword opportunities" });
    expect(screen.queryByTestId("seo-keyword-card")).toBeNull();
    map.focus();
    await user.keyboard("{ArrowRight}");
    // The easiest keyword comes first.
    const card = screen.getByTestId("seo-keyword-card");
    expect(card.textContent).toContain("battery app");
    expect(card.textContent).toContain("1,000 searches a month");
    expect(card.textContent).toContain("Difficulty 12 of 100");
    expect(card.textContent).toContain("Position 15");
    expect(card.textContent).toContain("Top 10: +1 click a month");
    expect(card.textContent).toContain("Top 3: +53 clicks a month");
    expect(screen.getByRole("status").textContent).toContain("battery app");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("seo-keyword-card").textContent).toContain(
      "Top 3: +301 clicks a month",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("seo-keyword-card")).toBeNull();
    // The table gives every number without a pointer, the most extra clicks first.
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows.map((item) => item.textContent)).toEqual([
      "KeywordSearches a monthDifficultyExtra clicks at top 3",
      "battery health · Idea5,00070301",
      "battery app1,0001253",
    ]);
  });

  it("opens a keyword with a content Task, a question to the agent, and Track for an idea", async () => {
    const user = userEvent.setup();
    renderMap([
      row({
        keyword: "battery app",
        volume: 1000,
        difficulty: 12.4,
        saved: true,
        version: 1,
        // The feature comes with the estimate of the check.
        conversion: "high",
        feature: "Cycle count",
      }),
      row({
        keyword: "battery health",
        source: "gap",
        volume: 5000,
        difficulty: 70,
      }),
    ]);
    const map = screen.getByRole("group", { name: "Keyword opportunities" });
    map.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    const popover = await screen.findByTestId("seo-keyword-popover");
    expect(popover).toHaveTextContent("battery app");
    expect(popover).toHaveTextContent("Your keyword");
    expect(popover).toHaveTextContent("Easy");
    // The hover card gives way to the open keyword.
    expect(screen.queryByTestId("seo-keyword-card")).toBeNull();
    // A tracked keyword has nothing to track.
    expect(within(popover).queryByRole("button", { name: "Track" })).toBeNull();
    await user.click(
      within(popover).getByRole("button", { name: "Create content task" }),
    );
    const brief =
      'Write web content that can rank on Google for the search "battery app" on example.com. It has 1,000 searches a month in United States · English, and its difficulty is Easy (12 of 100). Lead with this product feature: Cycle count.';
    expect(wizard.openNewTaskWizard).toHaveBeenCalledWith({
      prompt: brief,
      projectId: model.data.projectId,
    });
    await user.click(
      within(popover).getByRole("button", { name: "Ask the SEO agent" }),
    );
    expect(model.openChat).toHaveBeenCalledWith(brief);
    // Closing gives the focus back to the map; the next keyword, an idea, can be tracked.
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("seo-keyword-popover")).toBeNull();
    expect(map).toHaveFocus();
    await user.keyboard("{ArrowRight}{Enter}");
    await user.click(
      within(await screen.findByTestId("seo-keyword-popover")).getByRole(
        "button",
        { name: "Track" },
      ),
    );
    expect(model.toggleKeyword).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: "battery health" }),
    );
  });

  it("opens the dot a press picks, not after a drag, and a press on another dot opens that one", async () => {
    // A frame of 400 by 300 px: a press finds its dot by the place on the frame.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 300 }),
    );
    const rows = [
      row({ keyword: "battery app", volume: 1000, difficulty: 12 }),
      row({ keyword: "battery health", volume: 5000, difficulty: 70 }),
    ];
    renderMap(rows);
    const { points } = seoKeywordMap(keywordGroups(rows))!;
    const frame = screen.getByTestId("seo-keyword-map");
    const press = (keyword: string, moved = 0) => {
      const point = points.find((item) => item.group.lead.keyword === keyword)!;
      // The frame's padding is 12 px on each side.
      const at = {
        clientX: 12 + (point.x / 100) * 376,
        clientY: 12 + (point.y / 100) * 276,
      };
      fireEvent.pointerDown(frame, { ...at, pointerType: "mouse" });
      fireEvent.click(frame, { ...at, clientX: at.clientX + moved });
    };
    const popover = () => screen.queryByTestId("seo-keyword-popover");
    // A drag pans the map: it opens nothing.
    press("battery health", 10);
    expect(popover()).toBeNull();
    press("battery app");
    await waitFor(() => expect(popover()).toHaveTextContent("battery app"));
    // The press outside the open popover closes it and opens the dot it picked.
    await new Promise((done) => setTimeout(done, 0));
    press("battery health");
    await waitFor(() => expect(popover()).toHaveTextContent("battery health"));
    // Closed, the map keeps the keyword it showed last: its card is back.
    fireEvent.keyDown(screen.getByTestId("seo-keyword-popover"), {
      key: "Escape",
    });
    await waitFor(() => expect(popover()).toBeNull());
    expect(screen.getByTestId("seo-keyword-card")).toHaveTextContent(
      "battery health",
    );
  });

  it("leaves the focus on a field the reader clicked, and does not open a keyword again that left the map", async () => {
    const user = userEvent.setup();
    const rows = [
      row({
        keyword: "battery app",
        volume: 1000,
        difficulty: 12,
        saved: true,
        version: 1,
      }),
      row({
        keyword: "battery health",
        source: "gap",
        volume: 5000,
        difficulty: 70,
      }),
    ];
    const view = (shown: Keyword[]) => (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <input aria-label="Filter keywords" />
        <SeoKeywordMap groups={keywordGroups(shown)} model={model} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(view(rows));
    const map = screen.getByRole("group", { name: "Keyword opportunities" });
    map.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    await screen.findByTestId("seo-keyword-popover");
    const field = screen.getByLabelText("Filter keywords");
    await user.click(field);
    await waitFor(() =>
      expect(screen.queryByTestId("seo-keyword-popover")).toBeNull(),
    );
    await new Promise((done) => setTimeout(done, 10));
    expect(field).toHaveFocus();
    // Open again, then the keyword leaves the map (a filter, or Track) and comes back: it stays closed.
    map.focus();
    await user.keyboard("{Enter}");
    await screen.findByTestId("seo-keyword-popover");
    rerender(
      view([
        rows[1],
        row({ keyword: "battery saver", volume: 300, difficulty: 30 }),
      ]),
    );
    expect(screen.queryByTestId("seo-keyword-popover")).toBeNull();
    rerender(view(rows));
    expect(screen.queryByTestId("seo-keyword-popover")).toBeNull();
  });

  it("has no Track for a viewer who cannot edit", async () => {
    const user = userEvent.setup();
    const viewer = {
      ...model,
      data: {
        ...model.data,
        availableActions: { ...model.data.availableActions, canEdit: false },
      },
    } as SeoWorkspaceModel;
    renderMap(
      [
        row({
          keyword: "battery app",
          volume: 1000,
          difficulty: 12,
          saved: true,
          version: 1,
        }),
        row({
          keyword: "battery health",
          source: "gap",
          volume: 5000,
          difficulty: 70,
        }),
      ],
      viewer,
    );
    screen.getByRole("group", { name: "Keyword opportunities" }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    const popover = await screen.findByTestId("seo-keyword-popover");
    expect(popover).toHaveTextContent("Idea");
    expect(within(popover).queryByRole("button", { name: "Track" })).toBeNull();
  });

  it("zooms in with the button or the + key, and the reset shows the whole map again", async () => {
    const user = userEvent.setup();
    renderMap([
      row({ keyword: "a", volume: 100, difficulty: 10 }),
      row({ keyword: "b", volume: 1000, difficulty: 20 }),
    ]);
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    // The whole map is the widest view: no way further out, and no reset.
    expect(zoomOut).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Show the whole map" }),
    ).toBeNull();
    screen.getByRole("group", { name: "Keyword opportunities" }).focus();
    await user.keyboard("+");
    expect(zoomOut).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "Show the whole map" }),
    );
    expect(zoomOut).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoomOut).toBeEnabled();
  });

  it("is not there without difficulty, as for a check from before it", () => {
    const { container } = renderMap([
      row({ volume: 1000 }),
      row({ volume: 2000 }),
    ]);
    expect(container.textContent).toBe("");
  });
});
