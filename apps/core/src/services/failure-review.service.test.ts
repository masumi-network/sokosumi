import { describe, expect, it } from "vitest";
import {
  causeText,
  FAILURE_REVIEW_EXAMPLES,
  FAILURE_REVIEW_GROUPS,
  type FailureRow,
  groupFailures,
  turnKind,
} from "./failure-review.service";

describe("causeText", () => {
  it("drops quoted post text so the same check groups as one cause", () => {
    const a = causeText(
      'Rewrite the post: it says nearly what the post "Before a Cardano NFT mint, settle three things" says. Give it its own point.',
    );
    const b = causeText(
      "Rewrite the post: it says nearly what the post “Token infrastructure is a workflow choice.” says. Give it its own point.",
    );
    expect(a).toBe(
      'Rewrite the post: it says nearly what the post "…" says. Give it its own point.',
    );
    expect(b).toBe(a);
  });

  it("redacts emails, URLs, ids and numbers", () => {
    expect(
      causeText(
        "Mail to ada@example.com failed for 01a1e0cc-f29a-72b3-9a8d-0ea89beaaabd: spend $500.00, see https://vercel.com/d?to=x",
      ),
    ).toBe("Mail to [email] failed for [id]: spend $N, see [url]");
  });

  it("keeps the line a Prisma error's first line introduces", () => {
    expect(
      causeText(
        "\nInvalid `prisma.project.findUnique()` invocation:\n\n\nTransaction API error: A query cannot be executed on an expired transaction.",
      ),
    ).toBe(
      "Invalid `prisma.project.findUnique()` invocation: Transaction API error: A query cannot be executed on an expired transaction.",
    );
  });

  it("caps the length and handles nothing", () => {
    expect(causeText("x".repeat(500))).toHaveLength(140);
    expect(causeText(null)).toBe("");
  });
});

describe("turnKind", () => {
  it("keeps the CMO kind and the first part otherwise", () => {
    expect(turnKind("cmo:production:bot:1700000000:12")).toBe("cmo:production");
    expect(turnKind("cmo:strategy:bot:1")).toBe("cmo:strategy");
    expect(turnKind("schedule:abc:2026-11-24")).toBe("schedule");
    expect(turnKind("chat")).toBe("chat");
  });
});

const row = (
  key: string,
  index: number,
  previous = false,
  refs?: FailureRow["refs"],
): FailureRow => ({
  key,
  id: `${key}-${index}`,
  at: new Date(Date.UTC(2026, 10, 20, 0, index)),
  previous,
  refs,
});

describe("groupFailures", () => {
  it("counts both windows, newest examples first, and drops empty refs", () => {
    const groups = groupFailures([
      row("a", 1, false, { turnId: "t1", sokoBotId: null }),
      row("a", 2),
      row("a", 3),
      row("a", 4),
      row("a", 5, true),
      row("b", 1),
    ]);
    expect(
      groups.map((group) => [group.key, group.count, group.previousCount]),
    ).toEqual([
      ["a", 4, 1],
      ["b", 1, 0],
    ]);
    expect(groups[0]?.examples.map((example) => example.id)).toEqual([
      "a-4",
      "a-3",
      "a-2",
    ]);
    expect(groups[0]?.examples).toHaveLength(FAILURE_REVIEW_EXAMPLES);
    expect(
      groupFailures([row("a", 1, false, { turnId: "t1", sokoBotId: null })])[0]
        ?.examples[0]?.refs,
    ).toEqual({ turnId: "t1" });
  });

  it("leaves out causes only the previous window had", () => {
    expect(groupFailures([row("gone", 1, true)])).toEqual([]);
  });

  it("caps the groups, biggest first, new growth breaking ties", () => {
    const rows = Array.from({ length: FAILURE_REVIEW_GROUPS + 5 }, (_, index) =>
      row(`cause-${String(index).padStart(2, "0")}`, index),
    );
    rows.push(
      row("cause-19", 99),
      row("cause-05", 98),
      row("cause-05", 97, true),
    );
    const groups = groupFailures(rows);
    expect(groups).toHaveLength(FAILURE_REVIEW_GROUPS);
    expect(groups.slice(0, 2).map((group) => group.key)).toEqual([
      "cause-19",
      "cause-05",
    ]);
  });
});
