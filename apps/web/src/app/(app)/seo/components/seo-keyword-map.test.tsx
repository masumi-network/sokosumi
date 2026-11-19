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
import { SeoKeywordIdeas } from "./seo-keyword-ideas";
import { SeoKeywordMap } from "./seo-keyword-map";
import { seoKeywordMap } from "./seo-keyword-map-model";
import { keywordGroups } from "./seo-keyword-rows-model";
import { seoTestWorkspace } from "./seo-test-fixture";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));

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
    expect(card).toHaveTextContent("1,000 searches/mo · Difficulty 12/100");
    expect(card).not.toHaveTextContent(/Top 10|Top 3|Position/);
    expect(screen.getByRole("status")).toHaveTextContent("Position 15");
    await user.keyboard("{Enter}");
    const panel = await screen.findByTestId("seo-keyword-popover");
    expect(panel).toHaveTextContent("Top 10 +1");
    expect(panel).toHaveTextContent("Top 3 +53");
    expect(panel).toHaveTextContent("Position 15");
    await user.keyboard("{Escape}{ArrowRight}");
    expect(screen.getByTestId("seo-keyword-card")).toHaveTextContent(
      "battery health",
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
    // The popover takes the focus itself, not its first button.
    expect(popover).toHaveFocus();
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
      'Write web content for example.com that can rank on Google for the search "battery app". The keyword has 1,000 searches a month (market: United States · English), and its difficulty is easy (12 of 100). Lead with this product feature: Cycle count.';
    expect(wizard.openNewTaskWizard).toHaveBeenCalledWith({
      prompt: brief,
      projectId: model.data.projectId,
    });
    // The wizard is a dialog of its own: the popover closes first and the map keeps the focus to get back.
    expect(screen.queryByTestId("seo-keyword-popover")).toBeNull();
    expect(map).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(
      within(await screen.findByTestId("seo-keyword-popover")).getByRole(
        "button",
        { name: "Ask the SEO agent" },
      ),
    );
    // The agent gets a question, not the order to write.
    expect(model.openChat).toHaveBeenCalledWith(
      'How can example.com rank on Google for the search "battery app"? The keyword has 1,000 searches a month (market: United States · English), and its difficulty is easy (12 of 100). The product feature it fits: Cycle count.',
    );
    expect(map).toHaveFocus();
    // Escape gives the focus back to the map too; the next keyword, an idea, can be tracked.
    await user.keyboard("{Enter}");
    await screen.findByTestId("seo-keyword-popover");
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

  it("points at a dot under the pointer, and grabs the map elsewhere", () => {
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
    // The frame's padding is 12 px on each side.
    const at = ({ x, y }: { x: number; y: number }) => ({
      clientX: 12 + (x / 100) * 376,
      clientY: 12 + (y / 100) * 276,
      pointerType: "mouse",
    });
    expect(frame).toHaveClass("cursor-grab");
    fireEvent.pointerMove(frame, at(points[0]));
    expect(frame).toHaveClass("cursor-pointer");
    expect(frame).not.toHaveClass("cursor-grab");
    // The corner farthest from every dot: a drag there pans the map.
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    const away = (corner: { x: number; y: number }) =>
      Math.min(
        ...points.map((point) =>
          Math.hypot(point.x - corner.x, point.y - corner.y),
        ),
      );
    const empty = corners.reduce((best, corner) =>
      away(corner) > away(best) ? corner : best,
    );
    fireEvent.pointerMove(frame, at(empty));
    expect(frame).toHaveClass("cursor-grab");
    expect(frame).not.toHaveClass("cursor-pointer");
    // A press opens the dot and the popover takes the focus: the pointer still rests on the dot.
    const dot = { ...at(points[0]), view: window };
    fireEvent.pointerMove(frame, dot);
    fireEvent.pointerDown(frame, dot);
    fireEvent.mouseDown(frame, dot);
    screen.getByRole("group", { name: "Keyword opportunities" }).focus();
    fireEvent.mouseUp(window, dot);
    fireEvent.click(frame, dot);
    expect(screen.getByTestId("seo-keyword-popover")).toBeVisible();
    expect(frame).toHaveClass("cursor-pointer");
    // The keyboard picks a dot while the mouse is away: no dot is under the pointer.
    fireEvent.keyDown(screen.getByTestId("seo-keyword-popover"), {
      key: "Escape",
    });
    fireEvent.pointerLeave(frame, { pointerType: "mouse" });
    fireEvent.keyDown(
      screen.getByRole("group", { name: "Keyword opportunities" }),
      { key: "ArrowRight" },
    );
    expect(frame).toHaveClass("cursor-grab");
  });

  it("opens the dot a press picks, not after a drag, and a press on another dot or on no dot closes it", async () => {
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
      const end = { ...at, clientX: at.clientX + moved, view: window };
      fireEvent.pointerDown(frame, { ...at, pointerType: "mouse" });
      // The zoom takes the mousedown and stops it, as in a browser: the popover never sees the press outside.
      fireEvent.mouseDown(frame, { ...at, view: window });
      // A mousedown focuses the map, as a browser does: happy-dom moves no focus for it.
      screen.getByRole("group", { name: "Keyword opportunities" }).focus();
      if (moved) fireEvent.mouseMove(window, end);
      fireEvent.mouseUp(window, end);
      fireEvent.click(frame, end);
    };
    const popover = () => screen.queryByTestId("seo-keyword-popover");
    // A drag pans the map: it opens nothing. A hand that shakes by 2 px still presses.
    press("battery health", 10);
    expect(popover()).toBeNull();
    // The zoom drops its block on clicks one tick after a drag, as in a browser.
    await new Promise((done) => setTimeout(done, 0));
    press("battery app", 2);
    await waitFor(() => expect(popover()).toHaveTextContent("battery app"));
    // A press on another dot opens that one, and its popover takes the focus.
    await new Promise((done) => setTimeout(done, 0));
    press("battery health");
    await waitFor(() => expect(popover()).toHaveTextContent("battery health"));
    await waitFor(() => expect(popover()).toHaveFocus());
    await new Promise((done) => setTimeout(done, 10));
    expect(popover()).toHaveFocus();
    // The second click of a double-click zooms: it leaves the popover open.
    const second = points.find(
      (item) => item.group.lead.keyword === "battery health",
    )!;
    const there = {
      clientX: 12 + (second.x / 100) * 376,
      clientY: 12 + (second.y / 100) * 276,
    };
    fireEvent.pointerDown(frame, there);
    fireEvent.mouseDown(frame, { ...there, view: window });
    fireEvent.mouseUp(window, { ...there, view: window });
    fireEvent.click(frame, { ...there, detail: 2 });
    expect(popover()).toHaveTextContent("battery health");
    // Closed, the map keeps the keyword it showed last: its card is back.
    fireEvent.keyDown(screen.getByTestId("seo-keyword-popover"), {
      key: "Escape",
    });
    await waitFor(() => expect(popover()).toBeNull());
    expect(screen.getByTestId("seo-keyword-card")).toHaveTextContent(
      "battery health",
    );
    // A press on the open dot closes it, and a press on no dot too.
    press("battery app");
    await waitFor(() => expect(popover()).toHaveTextContent("battery app"));
    press("battery app");
    await waitFor(() => expect(popover()).toBeNull());
    press("battery app");
    await waitFor(() => expect(popover()).toHaveTextContent("battery app"));
    fireEvent.pointerDown(frame, { clientX: 399, clientY: 1 });
    fireEvent.mouseDown(frame, { clientX: 399, clientY: 1, view: window });
    fireEvent.mouseUp(window, { view: window });
    fireEvent.click(frame, { clientX: 399, clientY: 1 });
    await waitFor(() => expect(popover()).toBeNull());
  });

  it("closes the popover on a drag, and a press that pans the zoomed map does not open the dot again", async () => {
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
    const map = screen.getByRole("group", { name: "Keyword opportunities" });
    const point = points.find(
      (item) => item.group.lead.keyword === "battery app",
    )!;
    // The dot's place on screen under the zoom's own transform.
    const at = () => {
      const { k, x, y } = (
        frame as unknown as { __zoom: { k: number; x: number; y: number } }
      ).__zoom ?? { k: 1, x: 0, y: 0 };
      return {
        clientX: (12 + (point.x / 100) * 376) * k + x,
        clientY: (12 + (point.y / 100) * 276) * k + y,
        view: window,
      };
    };
    const press = (moved: number) => {
      const start = at();
      const end = { ...start, clientX: start.clientX + moved };
      fireEvent.pointerDown(frame, start);
      fireEvent.mouseDown(frame, start);
      map.focus();
      if (moved) fireEvent.mouseMove(window, end);
      fireEvent.mouseUp(window, end);
      fireEvent.pointerUp(frame, end);
      fireEvent.click(frame, end);
    };
    const popover = () => screen.queryByTestId("seo-keyword-popover");
    press(0);
    await waitFor(() => expect(popover()).toHaveTextContent("battery app"));
    await new Promise((done) => setTimeout(done, 0));
    // A drag at the edge of the map: the zoom moves nothing and keeps the click, so only the press ends there.
    // It closes the popover all the same.
    const start = at();
    fireEvent.pointerDown(frame, start);
    fireEvent.mouseDown(frame, start);
    map.focus();
    // Another finger lifts first: the press goes on. Then it is let go outside the frame.
    fireEvent.pointerUp(document.body, {
      ...start,
      clientX: start.clientX + 10,
      pointerId: 2,
    });
    expect(popover()).not.toBeNull();
    fireEvent.pointerUp(document.body, {
      ...start,
      clientX: start.clientX + 10,
    });
    fireEvent.mouseUp(window, start);
    await waitFor(() => expect(popover()).toBeNull());
    await new Promise((done) => setTimeout(done, 0));
    // Zoomed in, a shaking press on the open dot pans the map a little: the popover closes and stays closed.
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    press(0);
    await waitFor(() => expect(popover()).toHaveTextContent("battery app"));
    await new Promise((done) => setTimeout(done, 0));
    press(2);
    expect(popover()).toBeNull();
    await new Promise((done) => setTimeout(done, 10));
    expect(popover()).toBeNull();
  });

  it("keeps the popover the keyboard opens while another one is still open", async () => {
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
    const map = screen.getByRole("group", { name: "Keyword opportunities" });
    const point = points.find(
      (item) => item.group.lead.keyword === "battery app",
    )!;
    const at = {
      clientX: 12 + (point.x / 100) * 376,
      clientY: 12 + (point.y / 100) * 276,
      view: window,
    };
    fireEvent.pointerDown(frame, at);
    fireEvent.mouseDown(frame, at);
    map.focus();
    fireEvent.mouseUp(window, at);
    fireEvent.click(frame, at);
    await screen.findByTestId("seo-keyword-popover");
    await new Promise((done) => setTimeout(done, 0));
    // A press on the map let go outside it gets no click: the open popover stays, and the map has the focus.
    fireEvent.pointerDown(frame, at);
    fireEvent.mouseDown(frame, at);
    map.focus();
    fireEvent.mouseUp(window, at);
    expect(screen.getByTestId("seo-keyword-popover")).toBeInTheDocument();
    const next = points.findIndex(
      (item) => item.group.lead.keyword === "battery health",
    );
    const keys = next > points.indexOf(point) ? "ArrowRight" : "ArrowLeft";
    fireEvent.keyDown(map, { key: keys });
    fireEvent.keyDown(map, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByTestId("seo-keyword-popover")).toHaveTextContent(
        "battery health",
      ),
    );
    // The close of the first popover comes later and must not take the focus from the new one.
    await new Promise((done) => setTimeout(done, 10));
    expect(screen.getByTestId("seo-keyword-popover")).toHaveFocus();
  });

  it("goes back to the map on a Tab from Track while Track saves", async () => {
    const user = userEvent.setup();
    const rows = [
      row({ keyword: "battery app", volume: 1000, difficulty: 12 }),
      row({
        keyword: "battery health",
        source: "gap",
        volume: 5000,
        difficulty: 70,
      }),
    ];
    const { rerender } = renderMap(rows);
    const map = screen.getByRole("group", { name: "Keyword opportunities" });
    map.focus();
    const { points } = seoKeywordMap(keywordGroups(rows))!;
    const idea = points.findIndex((item) => !item.checked);
    await user.keyboard(`${"{ArrowRight}".repeat(idea + 1)}{Enter}`);
    const popover = await screen.findByTestId("seo-keyword-popover");
    within(popover).getByRole("button", { name: "Track" }).focus();
    // The save runs: Track is busy and keeps the focus.
    rerender(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SeoKeywordMap
          groups={keywordGroups(rows)}
          model={{ ...model, pending: true } as SeoWorkspaceModel}
        />
      </NextIntlClientProvider>,
    );
    await user.tab();
    expect(screen.queryByTestId("seo-keyword-popover")).toBeNull();
    expect(map).toHaveFocus();
  });

  it("goes back to the map on a Tab out of either end of the popover", async () => {
    const user = userEvent.setup();
    renderMap([
      row({ keyword: "battery app", volume: 1000, difficulty: 12 }),
      row({ keyword: "battery health", volume: 5000, difficulty: 70 }),
    ]);
    const map = screen.getByRole("group", { name: "Keyword opportunities" });
    map.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    await screen.findByTestId("seo-keyword-popover");
    await user.tab({ shift: true });
    expect(screen.queryByTestId("seo-keyword-popover")).toBeNull();
    expect(map).toHaveFocus();
    await user.keyboard("{Enter}");
    const popover = await screen.findByTestId("seo-keyword-popover");
    // Between its own buttons the Tab stays in the popover.
    await user.tab();
    expect(
      within(popover).getByRole("button", { name: /content task/i }),
    ).toHaveFocus();
    await user.tab();
    expect(
      within(popover).getByRole("button", { name: "Ask the SEO agent" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.queryByTestId("seo-keyword-popover")).toBeNull();
    expect(map).toHaveFocus();
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
    // The closed keyword does not come back as a card over the map, nor in the screen reader's status.
    expect(screen.queryByTestId("seo-keyword-card")).toBeNull();
    expect(within(map).getByRole("status")).toBeEmptyDOMElement();
    // Open again, then the keyword leaves the map (a filter, or Track) and comes back: it stays closed.
    map.focus();
    await user.keyboard("{ArrowRight}{Enter}");
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
    // The same when too few keywords are left for a map at all.
    screen.getByRole("group", { name: "Keyword opportunities" }).focus();
    await user.keyboard("{ArrowRight}{Enter}");
    await screen.findByTestId("seo-keyword-popover");
    rerender(view([rows[0]]));
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

it("marks recommended ideas in the graph and explains the same marker from the keyboard", async () => {
  const user = userEvent.setup();
  renderMap([
    row({
      keyword: "low competition",
      volume: 50,
      difficulty: 12,
      conversion: "medium",
      source: "opportunity",
    }),
    row({ keyword: "unrated", volume: 100, difficulty: 65, source: "gap" }),
  ]);
  expect(
    screen
      .getAllByTestId("seo-keyword-dot")
      .filter((dot) => dot.dataset.recommended),
  ).toHaveLength(1);
  const graph = screen.getByRole("group", { name: "Keyword opportunities" });
  graph.focus();
  await user.keyboard("{ArrowRight}{Enter}");
  const details = within(await screen.findByTestId("seo-keyword-popover"));
  expect(details.getByText("Recommended for lower competition")).toBeVisible();
  expect(
    details.getByRole("button", { name: /Draft in Content Studio/ }),
  ).toBeDisabled();
});

it("expands the whole idea row, keeps tracking independent, and gives the details a full row", async () => {
  const user = userEvent.setup();
  const idea = row({
    keyword: "ostsee rügen",
    volume: 14800,
    difficulty: 13,
    source: "opportunity",
    conversion: "medium",
    clicks: { now: 0, top10: 120, top3: 891, top1: 1500 },
  });
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoKeywordIdeas ideas={keywordGroups([idea]).ideas} model={model} />
    </NextIntlClientProvider>,
  );
  const toggle = screen.getByRole("button", { name: idea.keyword });
  expect(screen.queryByText("Recommended for lower competition")).toBeNull();
  const summary = toggle.closest("tr")!;
  await user.click(within(summary).getByRole("button", { name: "Track" }));
  expect(model.toggleKeyword).toHaveBeenCalledWith(idea);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await user.click(within(summary).getByText("14,800"));
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panel = screen
    .getByText("Recommended for lower competition")
    .closest("td")!;
  expect(panel.colSpan).toBe(summary.cells.length);
  expect(panel).toHaveTextContent("Top 10 +120");
  expect(panel).toHaveTextContent("Top 3 +891");
  toggle.focus();
  await user.keyboard(" ");
  expect(screen.queryByText("Recommended for lower competition")).toBeNull();
});
