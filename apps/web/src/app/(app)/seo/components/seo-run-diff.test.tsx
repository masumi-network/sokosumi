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

it("shows the counts and the first new issues open on the Agent tab, and says which rules a rulebook change compares", () => {
  const value = diff({
    new: ["A", "B", "C", "D"].map((rowId) => issue(rowId)),
    newCount: 4,
    fixedCount: 2,
    rulebookChange: { compared: 40, other: 3 },
    numbers: { issues: { from: 1, to: 4 }, moves: [], moveCount: 0 },
  });
  show(value, <SeoRunDiffCard diff={value} />);
  const card = screen.getByTestId("seo-agent-run-diff-card");
  expect(
    within(card).getByRole("heading", {
      level: 4,
      name: "Since the check on Nov 1, 2026",
    }),
  ).toBeInTheDocument();
  expect(within(card).getByText("Fixed").nextSibling).toHaveTextContent("2");
  expect(
    within(within(card).getByRole("list", { name: "New (4)" }))
      .getAllByRole("listitem")
      .map((item) => item.firstChild?.textContent),
  ).toEqual(["Title of A", "Title of B", "Title of C"]);
  expect(card).toHaveTextContent(
    "The tests changed between the two checks. 40 tests both checks ran are compared, 3 left out.",
  );
});

it("keeps a comparison without issue counts in its fold on the Agent tab", () => {
  const value = diff({ comparable: false, reason: "market" });
  show(value, <SeoRunDiffCard diff={value} />);
  expect(screen.queryByTestId("seo-agent-run-diff-card")).toBeNull();
  expect(
    screen.getByText("What changed since the check before"),
  ).toBeInTheDocument();
});
