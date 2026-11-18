import type { SeoAuditBrief } from "@sokosumi/core-client";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoActions } from "./seo-actions";
import { SeoAnalysisDialog } from "./seo-analysis-dialog";
import { SeoBriefDialog } from "./seo-brief-dialog";
import { selectedBriefPages } from "./seo-brief-model";
import { SeoBriefSummary } from "./seo-brief-summary";
import { seoTestWorkspace } from "./seo-test-fixture";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

afterEach(cleanup);
const data = seoTestWorkspace();
const page = data.pages[0];
const fixture: SeoAuditBrief = {
  revision: 3,
  updatedAt: null,
  objective: "sales",
  outcome: "More demo requests",
  audience: "Technical buyers",
  constraints: "Do not change checkout",
  pages: [
    {
      pageId: page.id,
      role: "guide",
      action: "read",
      job: "Private page requirements",
      indexIntent: "exclude",
    },
  ],
  followUps: [],
  priorities: [],
};
const model = (
  brief: SeoAuditBrief,
  save = vi.fn().mockResolvedValue("saved"),
) =>
  ({
    data,
    filters: { pageId: page.id },
    setDialog: vi.fn(),
    brief: { data: brief, save, reload: vi.fn() },
  }) as unknown as SeoWorkspaceModel;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider messages={messages} timeZone="UTC" locale="en">
    {children}
  </NextIntlClientProvider>
);

it("shares only selected page IDs and their saved revision after the reader sees the role and action", async () => {
  const user = userEvent.setup();
  const saved = model(fixture);
  const { container, rerender } = render(
    <form>
      <SeoBriefSummary model={saved} edit={() => {}} />
    </form>,
    { wrapper },
  );
  const form = container.querySelector("form")!;
  expect(screen.queryByText(fixture.audience!)).toBeNull();
  expect(screen.queryByText(fixture.constraints!)).toBeNull();
  expect(
    screen.getByText(
      /public SEO task will show its URL, role and desired action/,
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: /Guide · Read/ }),
  ).not.toBeChecked();
  expect(
    selectedBriefPages(new FormData(form), fixture, [page.id]),
  ).toBeUndefined();
  await user.click(screen.getByRole("checkbox"));
  expect(selectedBriefPages(new FormData(form), fixture, [page.id])).toEqual({
    revision: 3,
    pageIds: [page.id],
  });
  expect(() => selectedBriefPages(new FormData(form), fixture, [])).toThrow();
  const changed = { ...fixture, revision: 4 };
  rerender(
    <form>
      <SeoBriefSummary model={model(changed)} edit={() => {}} />
    </form>,
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

it("keeps other pages, the private visibility decision and the original revision when the reader edits the site goal", async () => {
  const user = userEvent.setup();
  const save = vi.fn().mockResolvedValue("saved");
  const other = {
    ...fixture.pages[0],
    pageId: "b8eaba6a-50dd-4ef7-a822-a777088d49ae",
    job: "Keep the support answer",
  };
  const initial = { ...fixture, pages: [...fixture.pages, other] };
  render(<SeoBriefDialog model={model(initial, save)} />, { wrapper });
  const dialog = within(screen.getByRole("dialog"));
  await user.clear(dialog.getByLabelText("What result matters to you?"));
  await user.type(
    dialog.getByLabelText("What result matters to you?"),
    "Qualified demos",
  );
  await user.type(
    dialog.getByLabelText("What should visitors accomplish here?"),
    " first",
  );
  await user.click(dialog.getByRole("button", { name: "Save brief" }));
  expect(save).toHaveBeenCalledWith({
    expectedRevision: 3,
    audience: initial.audience,
    objective: "sales",
    outcome: "Qualified demos",
    constraints: initial.constraints,
    pages: [
      { ...initial.pages[0], job: initial.pages[0].job + " first" },
      other,
    ],
  });
});

it("keeps an unsaved draft open after a revision conflict", async () => {
  const user = userEvent.setup();
  const m = model(fixture, vi.fn().mockResolvedValue("conflict"));
  render(<SeoBriefDialog model={m} />, { wrapper });
  await user.type(
    screen.getByLabelText("What result matters to you?"),
    " in Oslo",
  );
  await user.click(screen.getByRole("button", { name: "Save brief" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "changed while you were editing",
  );
  expect(screen.getByLabelText("What result matters to you?")).toHaveValue(
    "More demo requests in Oslo",
  );
  expect(m.setDialog).not.toHaveBeenCalled();
});

it("sends only the selected goal reference when the reader starts a full audit", async () => {
  const user = userEvent.setup();
  const execute = vi.fn().mockResolvedValue(true);
  const confirmed = {
    ...model(fixture),
    execute,
    analysisKind: "audit_full" as const,
    operationKey: () => "1cbd4274-d331-4ad1-a45c-d4dc20b34f05",
  };
  render(<SeoAnalysisDialog model={confirmed} />, { wrapper });
  await user.click(screen.getByRole("checkbox", { name: /Guide · Read/ }));
  await user.click(screen.getByRole("button", { name: "Start check" }));
  expect(execute).toHaveBeenCalledOnce();
  const command = execute.mock.calls[0][0];
  expect(command.kind).toBe("request_analysis");
  expect(command.body.sharedBrief).toEqual({
    revision: fixture.revision,
    pageIds: [page.id],
  });
  const sent = JSON.stringify(command);
  for (const privateValue of [
    fixture.outcome,
    fixture.audience,
    fixture.constraints,
    fixture.pages[0].job,
    fixture.pages[0].indexIntent,
  ]) {
    expect(sent).not.toContain(privateValue);
  }
});

it("shows the ranked sales or support page on Actions and its advice in the matching action", async () => {
  const user = userEvent.setup();
  const price = {
    ...page,
    url: "https://example.com/pricing",
    label: "Pricing",
  };
  const support = {
    ...page,
    id: "b8eaba6a-50dd-4ef7-a822-a777088d49ae",
    url: "https://example.com/help",
    label: "Help",
  };
  const action = {
    id: "change",
    observationId: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
    pageUrl: support.url,
    findingIds: [],
    title: "Update the help page",
    why: "An obsolete answer is still visible.",
    effort: "low",
    expectedEffect: "A current answer",
    edit: null,
    taskId: null,
    status: "recommended",
    kind: "fix",
    evidence: [],
  } as const;
  const workspace = {
    ...data,
    pages: [price, support],
    scope: { ...data.scope, pageIds: [price.id, support.id] },
    actions: [{ ...action, findingIds: [], evidence: [] }],
  };
  const sales = {
    pageId: price.id,
    nextStep: "Review the demo request form.",
    why: ["The pricing page supports the sales goal."],
  };
  const help = {
    pageId: support.id,
    nextStep: "Check that the answer resolves the support question.",
    why: ["The help page supports the customer support goal."],
  };
  function withGoal(
    objective: "sales" | "support",
    priorities: typeof fixture.priorities,
  ) {
    return {
      ...model({ ...fixture, objective, priorities }),
      data: workspace,
      filters: { ...model(fixture).filters, pageId: null },
    };
  }
  const { rerender } = render(
    <SeoActions model={withGoal("sales", [sales, help])} />,
    { wrapper },
  );
  const recommendation = () =>
    within(screen.getByRole("region", { name: "Priority from your brief" }));
  expect(
    recommendation().getByRole("link", { name: "Pricing" }),
  ).toHaveAttribute("href", price.url);
  expect(recommendation().getByText(sales.nextStep)).toBeVisible();
  rerender(<SeoActions model={withGoal("support", [help, sales])} />);
  expect(recommendation().getByRole("link", { name: "Help" })).toHaveAttribute(
    "href",
    support.url,
  );
  expect(recommendation().getByText(help.why[0])).toBeVisible();
  expect(recommendation().queryByText(fixture.audience!)).toBeNull();
  await user.click(screen.getByRole("button", { name: action.title }));
  const detail = within(
    await screen.findByRole("dialog", { name: action.title }),
  );
  expect(
    detail.getByRole("region", { name: "Priority from your brief" }),
  ).toHaveTextContent(help.nextStep);
  const priority = within(
    detail.getByRole("region", { name: "Priority from your brief" }),
  );
  expect(priority.getByText(fixture.audience!)).toBeVisible();
  expect(priority.getByText(fixture.constraints!)).toBeVisible();
  expect(detail.getByRole("link", { name: "Help" })).toHaveAttribute(
    "href",
    support.url,
  );
});
