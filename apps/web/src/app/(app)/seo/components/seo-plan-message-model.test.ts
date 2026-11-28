import type {
  ProjectSeoAction,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { expect, it } from "vitest";
import { seoPlanExcerpt, seoPlanMessage } from "./seo-plan-message-model";
import { seoTestObservation, seoTestWorkspace } from "./seo-test-fixture";

type Plan = NonNullable<
  ProjectSeoWorkspace["observations"][number]["auditPlan"]
>;
const data = seoTestWorkspace();
const step = (over: Partial<Plan["steps"][number]> = {}) => ({
  action: "Give the page one price",
  why: "The markup and the page show two prices.",
  nextCheck: "The next audit reads one price.",
  actionIds: [],
  ...over,
});
const report = (plan: Partial<Plan> = {}) => ({
  ...seoTestObservation(data),
  kind: "audit_full",
  auditPlan: {
    summary: "The audit found two prices on the page.",
    steps: [step()],
    ...plan,
  },
});
const action = (
  id: string,
  over: Partial<ProjectSeoAction> = {},
): ProjectSeoAction => ({
  id,
  observationId: seoTestObservation(data).id,
  pageUrl: data.pages[0].url,
  findingIds: [],
  title: `Action ${id}`,
  why: "",
  effort: "low",
  expectedEffect: "",
  edit: null,
  taskId: null,
  status: "recommended",
  kind: "fix",
  evidence: [],
  ...over,
});
const none = () => null;

it("keeps both prices together in a short lead and preserves an unsplittable explanation in the fold", () => {
  const prices = "The markup says $9.99. The page shows $6.49.";
  const explanation =
    "Compare the offer, locale, stock status and billing period on each page before changing "
      .repeat(3)
      .trimEnd() + ".";
  expect(seoPlanExcerpt(prices + " " + explanation)).toEqual({
    lead: prices,
    rest: explanation,
  });
  expect(seoPlanExcerpt(explanation)).toEqual({ lead: "", rest: explanation });
});

it("uses the fallback when a saved plan has a summary but no steps", () => {
  expect(
    seoPlanMessage({ actions: [] }, report({ steps: [] }), none),
  ).toBeNull();
});

it("shows no written plan for a report without one, or without its summary", () => {
  expect(seoPlanMessage({ actions: [] }, undefined, none)).toBeNull();
  expect(
    seoPlanMessage({ actions: [] }, seoTestObservation(data), none),
  ).toBeNull();
  expect(
    seoPlanMessage({ actions: [] }, report({ summary: undefined }), none),
  ).toBeNull();
});

it("gives a step the actions of its own report only, and keeps a step whose action is gone", () => {
  const own = action("1");
  const other = action("1", { observationId: "another-report" });
  const message = seoPlanMessage(
    { actions: [other, own] },
    report({
      steps: [
        step({ actionIds: ["1"] }),
        step({ action: "Gone", actionIds: ["9"] }),
      ],
    }),
    none,
  );
  expect(message?.steps[0].actions).toEqual([own]);
  expect(message?.steps[1]).toMatchObject({ action: "Gone", actions: [] });
});

it("rates a step by the worst issue its actions fix", () => {
  const actions = [action("1"), action("2"), action("3")];
  const message = seoPlanMessage(
    { actions },
    report({
      steps: [step({ actionIds: ["1", "2"] }), step({ actionIds: ["3"] })],
    }),
    (row) => (row.id === "1" ? "minor" : row.id === "2" ? "critical" : null),
  );
  expect(message?.steps.map((row) => row.severity)).toEqual(["critical", null]);
});

it("marks a step done only when each of its actions is on the page, and started once one has a Task", () => {
  const state = (...statuses: ProjectSeoAction["status"][]) =>
    seoPlanMessage(
      { actions: statuses.map((status, i) => action(String(i), { status })) },
      report({
        steps: [step({ actionIds: statuses.map((_, i) => String(i)) })],
      }),
      none,
    )?.steps[0].state;
  expect(state("implemented", "verified")).toBe("done");
  expect(state("implemented", "recommended")).toBe("open");
  expect(state("implemented", "task_created")).toBe("started");
  // A step that names no action is never done.
  expect(state()).toBe("open");
});

it("counts the waiting actions that no step names", () => {
  const actions = [
    action("1"),
    action("2"),
    action("3", { status: "needs_review" }),
    action("4", { status: "implemented" }),
    action("5", { status: "task_created" }),
  ];
  expect(
    seoPlanMessage(
      { actions },
      report({ steps: [step({ actionIds: ["1"] })] }),
      none,
    )?.rest,
  ).toBe(2);
});
