import type { ProjectSeoRunDiff } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import german from "../../../../../messages/de.json";
import english from "../../../../../messages/en.json";
import { SeoRunDiff } from "./seo-run-diff";
import { SeoRunDiffCard } from "./seo-run-diff-card";

const issue = (rowId: string, device: "mobile" | null = null) => ({
  rowId,
  title: `Title of ${rowId}`,
  pageUrl: "https://example.com/pricing",
  device,
  severity: "major" as const,
});
const diff = (patch: Partial<ProjectSeoRunDiff>): ProjectSeoRunDiff => ({
  from: new Date("2026-11-01T09:00:00Z"),
  to: new Date("2026-11-08T09:00:00Z"),
  comparable: true,
  new: [],
  newCount: 0,
  fixed: [],
  fixedCount: 0,
  stillOpen: [],
  stillOpenCount: 0,
  notCheckedAgain: 0,
  notCheckedBefore: 0,
  numbers: { issues: { from: null, to: null }, moves: [], moveCount: 0 },
  ...patch,
});
const show = (
  value: ProjectSeoRunDiff,
  node = <SeoRunDiff diff={value} titled />,
) =>
  render(
    <NextIntlClientProvider
      locale="de"
      messages={german}
      timeZone="UTC"
      formats={createFormats("h23")}
    >
      <SeoResultMessagesProvider messages={english.App.Seo} hourCycle="h23">
        {node}
      </SeoResultMessagesProvider>
    </NextIntlClientProvider>,
  );

it("lists new, fixed and still open issues under headings that carry the full counts", () => {
  show(
    diff({
      new: [issue("A", "mobile"), issue("B")],
      newCount: 9,
      stillOpen: [issue("C")],
      stillOpenCount: 1,
      notCheckedAgain: 2,
      notCheckedBefore: 1,
      numbers: { issues: { from: 3, to: 10 }, moves: [], moveCount: 0 },
    }),
  );
  expect(
    screen.getByRole("heading", {
      level: 3,
      name: "Since the check on Nov 1, 2026",
    }),
  ).toBeInTheDocument();
  expect(
    screen
      .getAllByRole("heading", { level: 4 })
      .map((node) => node.textContent),
  ).toEqual(["New (9)", "Fixed (0)", "Still open (1)"]);
  const [added, open] = screen.getAllByRole("list");
  expect(within(added).getAllByRole("listitem")).toHaveLength(2);
  expect(within(added).getByText("/pricing (mobile)")).toBeInTheDocument();
  expect(within(open).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("and 7 more")).toBeInTheDocument();
  expect(screen.getByText("None")).toBeInTheDocument();
  expect(
    screen.getByText("Open page issues: 3 before, 10 now"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/^2 earlier issues have no clear result in this check/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/^1 open issue has no clear result in the earlier check/),
  ).toBeInTheDocument();
});

it.each(["market", "rulebook", "pages"] as const)(
  "shows why two checks are not compared instead of lists: %s",
  (reason) => {
    show(diff({ comparable: false, reason }));
    expect(
      screen.getByText(english.App.Seo.runDiff.notComparable[reason]),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 4 })).not.toBeInTheDocument();
  },
);

it("names the day of the earlier check when the date arrives as JSON text", () => {
  show(diff({ from: "2026-11-21T18:46:23.491Z" as unknown as Date }));
  expect(
    screen.getByRole("heading", { name: "Since the check on Nov 21, 2026" }),
  ).toBeTruthy();
});

it("names the page and the device of a ranking move, and counts the moves it does not list", () => {
  const move = (device: "mobile" | null, from: number, to: number) => ({
    keyword: "pricing",
    pageUrl: "https://example.com/pricing",
    device,
    from,
    to,
  });
  show(
    diff({
      numbers: {
        issues: { from: 0, to: 0 },
        moves: [move("mobile", 2, 10), move(null, 10, 2)],
        moveCount: 5,
      },
    }),
  );
  expect(
    screen.getByRole("heading", { level: 4, name: "Ranking moves (5)" }),
  ).toBeInTheDocument();
  const moves = within(screen.getAllByRole("list").at(-1)!)
    .getAllByRole("listitem")
    .map((node) => node.textContent);
  expect(moves).toEqual([
    "pricing: position 2 → 10 /pricing (mobile)",
    "pricing: position 10 → 2 /pricing",
  ]);
  expect(screen.getByText("and 3 more")).toBeInTheDocument();
});

it("shows no issue lists and no ranking moves between two checks that read only rankings and moved none", () => {
  show(diff({}));
  expect(screen.getByText("No ranking moves to show.")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { level: 4 })).not.toBeInTheDocument();
});

it("shows the counts and the first new issues open on the Agent tab, and says which rules a rulebook change compares", () => {
  const value = diff({
    new: ["A", "B", "C", "D"].map((rowId) => issue(rowId)),
    newCount: 4,
    fixedCount: 2,
    rulebookChange: { compared: 40, other: 3 },
    notCheckedBefore: 1,
    numbers: { issues: { from: 2, to: 5 }, moves: [], moveCount: 0 },
  });
  show(value, <SeoRunDiffCard diff={value} outside={2} />);
  const card = screen.getByTestId("seo-agent-run-diff-card");
  expect(
    within(card).getByRole("heading", {
      level: 4,
      name: "Since the check on Nov 1, 2026",
    }),
  ).toBeInTheDocument();
  expect(within(card).getByText("Fixed").nextSibling).toHaveTextContent("2");
  // The issue count above the card is the "now" total: the counts add up to it.
  expect(
    within(card).getAllByText("Open page issues: 2 before, 5 now"),
  ).toHaveLength(2);
  // The check's issue total is higher: with tests only one check ran, the card names no single cause.
  expect(
    within(card).getByText(
      "2 more open issues are outside this comparison: Search Console indexing issues, or issues of tests only one check ran.",
    ),
  ).toBeInTheDocument();
  expect(
    within(within(card).getByRole("list", { name: "First new issues" }))
      .getAllByRole("listitem")
      .map((item) => item.firstChild?.textContent),
  ).toEqual(["Title of A", "Title of B", "Title of C"]);
  // Beside the counts, and again in the full comparison in the fold.
  expect(
    within(card).getAllByText(
      "The tests changed between the two checks. 40 tests both checks ran are compared, 3 left out.",
    ),
  ).toHaveLength(2);
  expect(
    within(card).getAllByText(
      "1 open issue has no clear result in the earlier check. It does not count as new.",
    ),
  ).toHaveLength(2);
});

it.each([
  ["with the same tests", undefined],
  [
    "across a rulebook change where both checks ran every test",
    { compared: 40, other: 0 },
  ],
])(
  "names Search Console indexing as the issues outside a comparison %s",
  (_, rulebookChange) => {
    const value = diff({
      fixedCount: 2,
      rulebookChange,
      numbers: { issues: { from: 2, to: 0 }, moves: [], moveCount: 0 },
    });
    show(value, <SeoRunDiffCard diff={value} outside={1} />);
    expect(
      screen.getByText(
        "1 more open issue comes from Search Console indexing. It is outside this comparison.",
      ),
    ).toBeInTheDocument();
  },
);

it("opens the card with the issues now when the earlier check counted no page issues", () => {
  const value = diff({
    notCheckedBefore: 1,
    numbers: { issues: { from: null, to: 1 }, moves: [], moveCount: 0 },
  });
  show(value, <SeoRunDiffCard diff={value} outside={1} />);
  const card = screen.getByTestId("seo-agent-run-diff-card");
  expect(within(card).getAllByText("Open page issues now: 1")).toHaveLength(2);
  // New, fixed and still open are 0: this note beside them says where the open issue went.
  expect(
    within(card).getAllByText(
      "1 open issue has no clear result in the earlier check. It does not count as new.",
    ),
  ).toHaveLength(2);
  expect(
    within(card).getByText(
      "1 more open issue comes from Search Console indexing. It is outside this comparison.",
    ),
  ).toBeInTheDocument();
});

it.each([
  ["not comparable", diff({ comparable: false, reason: "market" })],
  // Two ranking checks with no move: no issue total, so no three zeros.
  ["without issue totals", diff({})],
])("keeps a comparison %s in its fold on the Agent tab", (_, value) => {
  show(value, <SeoRunDiffCard diff={value} />);
  expect(screen.queryByTestId("seo-agent-run-diff-card")).toBeNull();
  expect(
    screen.getByText("What changed since the check before"),
  ).toBeInTheDocument();
});
