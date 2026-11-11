import type {
  ProjectSeoWorkspace,
  SeoAuditChatHistory,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoAutomation } from "./seo-monitors";
import {
  openStatisticsSetup,
  SEO_TEST_AUDIT,
  SEO_TEST_PROJECT,
  seoTestMetric,
  seoTestStrategy,
  seoTestWorkspace,
} from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";
import { useSeoWorkspace } from "./use-seo-workspace";

const { mutate, viewer, ensureRoom, push } = vi.hoisted(() => ({
  mutate: vi.fn(),
  viewer: { userId: "owner" as string | null },
  ensureRoom: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: ensureRoom,
}));
vi.mock("next/navigation", async () => ({
  ...(await vi.importActual<typeof import("next/navigation")>(
    "next/navigation",
  )),
  useRouter: () => ({ push }),
}));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    // A null viewer is a session the client has not read yet.
    data: viewer.userId
      ? {
          session: { activeOrganizationId: "org" },
          user: { id: viewer.userId },
        }
      : null,
  }),
}));

const clients: QueryClient[] = [];
function nativeChatNetwork(
  workspace: ProjectSeoWorkspace,
  options: { uncertainFirst?: boolean; failedFirst?: boolean } = {},
) {
  const requests: Array<{
    question: string;
    idempotencyKey: string;
    scope: Record<string, unknown>;
  }> = [];
  const turns: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith("/chat")) return Response.json(workspace);
      if (init?.method !== "POST") return Response.json({ turns });
      if (typeof init.body !== "string")
        throw new Error("Missing JSON question");
      const body = JSON.parse(init.body);
      requests.push(body);
      if (options.uncertainFirst && requests.length === 1)
        throw new Error("Uncertain response");
      const turn = {
        id: crypto.randomUUID(),
        question: body.question,
        status:
          options.failedFirst && requests.length === 1 ? "failed" : "completed",
        response: "The selected page needs a clearer title.",
        actions: [],
        scope: { pageIds: workspace.scope.pageIds },
        createdAt: new Date().toISOString(),
      };
      turns.push(turn);
      return Response.json(turn);
    }),
  );
  return requests;
}

function SeoMonitorPanel({ workspace }: { workspace: ProjectSeoWorkspace }) {
  return <SeoAutomation model={useSeoWorkspace(workspace)} />;
}
function renderWorkspace(
  workspace: ProjectSeoWorkspace,
  searchParams = "",
  monitorsOnly = false,
  staleTime = 0,
) {
  const View = monitorsOnly ? SeoMonitorPanel : SeoWorkspace;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime } },
  });
  clients.push(client);
  const content = (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter searchParams={searchParams} hasMemory>
          <View workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  const view = render(content);
  return {
    ...view,
    client,
    refreshViewer: () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <NextIntlClientProvider
            locale="en"
            timeZone="UTC"
            formats={createFormats()}
            messages={messages}
          >
            <NuqsTestingAdapter searchParams={searchParams} hasMemory>
              <View workspace={workspace} />
            </NuqsTestingAdapter>
          </NextIntlClientProvider>
        </QueryClientProvider>,
      ),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  viewer.userId = "owner";
});
afterEach(() => {
  sessionStorage.clear();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SEO workspace integration", () => {
  it.each([
    [
      "a newer check that measured nothing",
      "page_check",
      "These checks are incomplete",
    ],
    ["a newer rankings read", "rankings", "No issues found in the last check"],
  ] as const)(
    "judges the verdict by the newest rule check after %s",
    (_, kind, verdict) => {
      const workspace = seoTestWorkspace();
      const base = {
        source: "seo_coworker",
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        sourceTaskId: null,
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop" as const],
        rulebookVersion: "html-v1",
      };
      workspace.observations = [
        {
          ...base,
          id: "8b0f8f0e-31d5-4d1e-9a52-5d7c1c3a1f10",
          kind,
          observedAt: new Date("2026-01-03T12:00:00Z"),
          artifactHash: "newer",
          issues: 0,
          coverage: {
            checked: 0,
            skipped: kind === "page_check" ? 30 : 0,
            failed: 0,
          },
        },
        {
          ...base,
          id: "1d0e0b6a-0c43-4c55-9d2f-6a6f2f1b7b11",
          kind: "page_check",
          observedAt: new Date("2026-01-01T12:00:00Z"),
          artifactHash: "older",
          issues: 0,
          coverage: { checked: 20, skipped: 0, failed: 0 },
        },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace);
      expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
        verdict,
      );
    },
  );

  it("keeps passing measurements behind closed check details and offers statistics after limited checks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.observations.push({
      id: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 2, skipped: 0, failed: 0 },
    });
    workspace.findings.push({
      id: "measured-title",
      observationId: workspace.observations[0].id,
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "title-length",
      title: "Title length measured",
      severity: "measure",
      evidence: [
        "The title has 42 characters. Technical reference: HTML title element.",
      ],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.includes("/statistics/properties")
            ? { status: "not_connected", properties: [] }
            : workspace,
        ),
      ),
    );
    renderWorkspace(workspace, "?tab=health");
    const measurement = screen.getByText("Title length measured:");
    expect(measurement).not.toBeVisible();
    expect(measurement.closest("details")).not.toHaveAttribute("open");
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      "No issues found in the last check",
    );
    expect(screen.getByTestId("seo-summary-tests")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Traffic" }));
    await user.click(
      screen.getAllByRole("button", { name: "Set up statistics" })[0],
    );
    expect(
      screen.getByRole("dialog", { name: "Sync statistics" }),
    ).toBeVisible();
  });

  it("keeps raw issue evidence out of the default findings cards", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.findings.push({
      id: "missing-description",
      observationId: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "meta-description",
      title: "The page has no description",
      severity: "major",
      evidence: ["Raw HTML evidence: no meta description element."],
      sourceRef: "html:head",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    expect(screen.getByText("The page has no description")).toBeVisible();
    // No action fixes this issue, so no link promises a fix.
    expect(screen.queryByRole("button", { name: "See the fix" })).toBeNull();
    const evidence = screen.getByText(
      "Raw HTML evidence: no meta description element.",
    );
    expect(evidence).not.toBeVisible();
    // The row is the switch: it opens the evidence of its issue.
    await user.click(screen.getByText("The page has no description"));
    expect(evidence).toBeVisible();
  });

  it("names an issue after its fix on Site health and leads to the fix", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const observationId = "962a86bb-5702-4d64-a6c4-15be5bf8ed80";
    workspace.findings.push({
      id: "price",
      observationId,
      pageUrl: workspace.pages[0].url,
      device: "mobile",
      rowId: "SD-08",
      // A test name reads like a pass.
      title: "Markup matches the visible page",
      severity: "major",
      evidence: ["The markup says 6.99, the page shows 9.99."],
      sourceRef: "html:head",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    workspace.actions.push({
      id: "fix-price",
      observationId,
      pageUrl: workspace.pages[0].url,
      findingIds: ["price"],
      title: "Make the markup price match the page",
      why: "The two prices differ.",
      effort: "low",
      expectedEffect: "One price.",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    expect(
      screen.getByRole("heading", {
        name: "Make the markup price match the page",
      }),
    ).toBeVisible();
    // The test's own name stays in the details.
    const check = screen.getByText(
      "Check not passed: Markup matches the visible page",
    );
    expect(check).not.toBeVisible();
    await user.click(
      screen.getByRole("heading", {
        name: "Make the markup price match the page",
      }),
    );
    expect(check).toBeVisible();
    await user.click(screen.getByRole("button", { name: "See the fix" }));
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The same title on the card of the fix, with the severity of its issue. The card takes the focus,
    // so the reader does not look for the fix again in the list.
    const card = screen
      .getByRole("heading", { name: "Make the markup price match the page" })
      .closest("article");
    await waitFor(() => expect(card).toHaveFocus());
    expect(within(card!).getByText("Major")).toBeVisible();
    // What the fix brings is in view; the reasons stay closed.
    expect(within(card!).getByText("One price.")).toBeVisible();
    expect(within(card!).getByText("The two prices differ.")).not.toBeVisible();
  });

  it("splits page details into measurements and notes and folds their references", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    // An Audit has the agent chat, so notes can ask it.
    workspace.auditId = crypto.randomUUID();
    workspace.findings.push({
      id: "measured-title",
      observationId: "check-title",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "title-length",
      title: "Raw HTML: Title length",
      severity: "measure",
      evidence: [
        "title 56 characters",
        "vendor tools: Ahrefs under 70 (N1-246)",
        "Source: raw HTML; the rendered DOM was not requested.",
      ],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    workspace.findings.push({
      id: "meta-keywords",
      observationId: "check-keywords",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "meta-keywords",
      title: "Raw HTML: No meta keywords",
      severity: "note",
      evidence: [
        `meta keywords in head: "${Array.from({ length: 30 }, (_, i) => `battery ${i}`).join(", ")}"`,
        "Source: raw HTML; the rendered DOM was not requested.",
      ],
      sourceRef: "html:head",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    // The same rule on a second page: its guidance shows once.
    workspace.findings.push({
      id: "measured-title-old",
      observationId: "check-title-old",
      pageUrl: "https://example.com/old",
      device: "desktop",
      rowId: "title-length",
      title: "Raw HTML: Title length",
      severity: "measure",
      evidence: [
        "title 80 characters",
        "vendor tools: Ahrefs under 70 (N1-246)",
        "Source: raw HTML; the rendered DOM was not requested.",
      ],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    // A test-level row is a flagged rule too, though its name reads as a claim.
    workspace.findings.push({
      id: "ai-bots",
      observationId: "check-bots",
      pageUrl: "https://example.com/old",
      device: "desktop",
      rowId: "AC-22",
      title: "Raw HTML: AI search bots may fetch the page",
      severity: "test",
      evidence: [
        "robots.txt blocks GPTBot",
        "Source: raw HTML; the rendered DOM was not requested.",
      ],
      sourceRef: "robots",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    // An older check measured a title outside the range; the newest check is in range,
    // so that row is no suggestion and offers no fix.
    workspace.findings.push({
      id: "measured-title-older",
      observationId: "check-title-older",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "title-length",
      title: "Raw HTML: Title length",
      severity: "measure",
      evidence: [
        "title 75 characters",
        "vendor tools: Ahrefs under 70 (N1-246)",
        "Source: raw HTML; the rendered DOM was not requested.",
      ],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-01T12:00:00Z"),
    });
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST") return Response.json({ turns: [] });
        const question = JSON.parse(String(init.body)).question;
        asked.push(question);
        return Response.json({
          id: crypto.randomUUID(),
          question,
          response: "Draft",
          status: "completed",
          actions: [],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        });
      }),
    );
    // happy-dom has no layout: the long note's clamp cuts its text here.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);
    renderWorkspace(workspace, "?tab=health");
    // The folded section says whether opening it pays off.
    expect(screen.getByText(/· 2 notes$/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("heading", {
        name: "Title, description and other page details",
      }),
    );
    // A measurement is one line; its value drops the words its name says.
    expect(screen.getAllByText("Title length:")[0]).toBeVisible();
    expect(screen.getByText("56 characters")).toBeVisible();
    // Notes sit under their own heading, so a rule name does not read as a claim about the page.
    expect(
      screen.getByRole("heading", {
        name: "Notes (2) · not counted as issues",
      }),
    ).toBeVisible();
    // A note leads with what the check found; the rule name follows, so it does not read as a claim.
    expect(
      screen.getByRole("heading", { name: "Found: meta keywords in head" }),
    ).toBeVisible();
    expect(screen.getByText("Rule: “No meta keywords”")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Measurements" })).toBeVisible();
    // A 1-page Audit does not repeat its URL on every row.
    const details = screen.getAllByText("Title length:")[0].closest("details");
    if (!details) throw new Error("Page details missing");
    expect(
      within(details)
        .queryAllByRole("link")
        .filter((link) => link.getAttribute("href") === workspace.pages[0].url),
    ).toHaveLength(0);
    // A row for a page removed since keeps its URL, so it is not read as this page's.
    expect(
      within(details)
        .getAllByRole("link")
        .some(
          (link) => link.getAttribute("href") === "https://example.com/old",
        ),
    ).toBe(true);
    // The fold counts suggestions apart from notes, as the Agent tab does.
    expect(details.querySelector("summary")).toHaveTextContent(
      /· 1 suggestion · 2 notes$/,
    );
    // Rows from different checks keep their own date.
    expect(within(details).queryByText(/From the check on/)).toBeNull();
    expect(details.querySelectorAll("time")).toHaveLength(5);
    expect(
      screen.getByRole("heading", {
        name: "Found: robots.txt blocks GPTBot",
      }),
    ).toBeVisible();
    // A measurement shows the check's guidance under its value, once per rule.
    // Rule IDs leave the shown line and fold with the sources.
    expect(
      screen.getByText("Ranges SEO tools use: Ahrefs under 70"),
    ).toBeVisible();
    // Each page's value says where it sits against the tools' ranges.
    expect(screen.getByText(/within the tool range/)).toBeVisible();
    // Only the newest check's value outside a range is a suggestion; the older one is history.
    expect(
      screen.getAllByText(/outside the tool range \(Ahrefs\)/),
    ).toHaveLength(2);
    expect(
      screen.getByText(/Suggestion: outside the tool range \(Ahrefs\)/),
    ).toBeVisible();
    // A long note value starts folded and opens in place.
    const showAll = screen.getByRole("button", { name: "Show all" });
    expect(showAll).toHaveAttribute("aria-expanded", "false");
    const value = document.getElementById(
      showAll.getAttribute("aria-controls") ?? "",
    );
    expect(value).toHaveClass("line-clamp-3");
    await user.click(showAll);
    expect(value).not.toHaveClass("line-clamp-3");
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Each note offers a question to the agent; a measurement offers a fix only when a tool range leaves it out.
    expect(
      screen.getAllByRole("button", { name: "Ask the agent" }),
    ).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Draft a fix" })).toHaveLength(
      1,
    );
    // Provenance folds once: a line every row shares is listed once, without row names.
    const reference = screen.getByText(
      "Source: raw HTML; the rendered DOM was not requested.",
    );
    expect(reference).not.toBeVisible();
    expect(screen.queryByText("Check details")).toBeNull();
    await user.click(screen.getByText("Sources and rule IDs"));
    expect(reference).toBeVisible();
    expect(screen.getByText("Rule IDs: N1-246")).toBeVisible();
    // A note on a page removed since names that page in the question; nothing is sent.
    await user.click(
      screen.getByRole("button", {
        name: "Ask the agent",
        description: "Found: robots.txt blocks GPTBot https://example.com/old",
      }),
    );
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("Your question")).toHaveValue(
      "A check flagged “AI search bots may fetch the page” on https://example.com/old. What does it mean, and should I change anything?",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // A fix request is the Agent tab's, as a draft; the unsent note question stays above it.
    await user.click(
      screen.getByRole("button", {
        name: "Draft a fix",
        description: "Title length: https://example.com/old",
      }),
    );
    const question = within(await screen.findByRole("dialog")).getByLabelText(
      "Your question",
    ) as HTMLTextAreaElement;
    expect(question.value).toBe(
      "A check flagged “AI search bots may fetch the page” on https://example.com/old. What does it mean, and should I change anything?\n\nThe check measured “Title length” on https://example.com/old as 80 characters, outside the range of Ahrefs. Draft a change and suggest it as an action I can approve.",
    );
    // Nothing is sent until the owner sends it.
    expect(asked).toEqual([]);
  });

  it("offers one fix per suggestion and drafts it in the chat", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const measured = (device: "desktop" | "mobile", characters: number) => ({
      id: `description-${device}`,
      observationId: "check-description",
      pageUrl: workspace.pages[0].url,
      device,
      rowId: "description-length",
      title: "Raw HTML: Meta description length",
      severity: "measure" as const,
      evidence: [
        `meta description ${characters} characters`,
        "vendor tools: Ahrefs under 160 (N1-247)",
      ],
      sourceRef: "html:description",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    workspace.findings.push(measured("desktop", 163), measured("mobile", 170));
    const prompt = `The check measured “Meta description length” on ${workspace.pages[0].url} as 163 characters, outside the range of Ahrefs. Draft a change and suggest it as an action I can approve.`;
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST") return Response.json({ turns: [] });
        const question = JSON.parse(String(init.body)).question;
        asked.push(question);
        return Response.json({
          id: crypto.randomUUID(),
          question,
          response: "Draft",
          status: "completed",
          actions: [],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        });
      }),
    );
    renderWorkspace(workspace, "?tab=health");
    // Both device rows are the one suggestion; only its first row offers the fix.
    expect(await screen.findAllByText(/Suggestion: outside/)).toHaveLength(2);
    const fixes = screen.getAllByRole("button", { name: "Draft a fix" });
    expect(fixes).toHaveLength(1);
    await user.click(fixes[0]);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("Your question")).toHaveValue(prompt);
    expect(asked).toEqual([]);
  });

  it("names each page-detail row's page on a multi-page Audit", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/blog",
      label: "Blog",
    });
    const observation = {
      id: "one-check",
      kind: "page_check" as const,
      source: "seo_coworker" as const,
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.pages.map((page) => page.id),
      scopeVersion: 2,
      sourceTaskId: "one-check-task",
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop" as const, "mobile" as const],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 4, skipped: 0, failed: 0 },
    };
    workspace.observations.push(observation);
    workspace.timeline.push({
      id: "one-check-event",
      kind: "check",
      title: "SEO check results imported",
      status: "completed",
      detail: "",
      at: observation.observedAt,
      pageIds: observation.pageIds,
      taskId: observation.sourceTaskId,
      observationId: observation.id,
    });
    workspace.findings.push(
      {
        id: "measured-title",
        observationId: observation.id,
        pageUrl: workspace.pages[0].url,
        device: "desktop",
        rowId: "title-length",
        title: "Raw HTML: Title length",
        severity: "measure",
        evidence: ["title 56 characters"],
        sourceRef: "html:title",
        observedAt: new Date("2026-01-03T12:05:00Z"),
      },
      {
        id: "measured-description",
        observationId: observation.id,
        pageUrl: workspace.pages[1].url,
        device: "mobile",
        rowId: "description-length",
        title: "Raw HTML: Meta description length",
        severity: "measure",
        evidence: ["meta description 120 characters"],
        sourceRef: "html:description",
        observedAt: new Date("2026-01-03T12:05:00Z"),
      },
      {
        id: "long-note",
        observationId: observation.id,
        pageUrl: workspace.pages[1].url,
        device: "mobile",
        rowId: "meta-keywords",
        title: "Raw HTML: No meta keywords",
        severity: "note",
        evidence: [`meta keywords in head: "${"battery, ".repeat(20)}"`],
        sourceRef: "html:head",
        observedAt: new Date("2026-01-03T12:05:00Z"),
      },
      {
        id: "long-unlabelled-note",
        observationId: observation.id,
        pageUrl: workspace.pages[1].url,
        device: "mobile",
        rowId: "link-text",
        title: "Raw HTML: Descriptive link text",
        severity: "note",
        evidence: [
          `the page links with generic text ${"read more, ".repeat(12)}and no other words`,
        ],
        sourceRef: "html:links",
        observedAt: new Date("2026-01-03T12:05:00Z"),
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    await user.click(
      screen.getByRole("heading", {
        name: "Title, description and other page details",
      }),
    );
    const details = screen.getByText("Title length:").closest("details");
    if (!details) throw new Error("Page details missing");
    expect(
      within(details)
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === workspace.pages[0].url),
    ).toBe(true);
    // One check behind every row: its time and record show once, above the rows.
    expect(within(details).getByText(/From the check on/)).toBeInTheDocument();
    const times = details.querySelectorAll("time");
    expect(times).toHaveLength(1);
    expect(times[0].getAttribute("datetime")).toBe("2026-01-03T12:00:00.000Z");
    // The Timeline row links the check's results; the rows do not repeat the link.
    expect(
      within(details).queryAllByRole("link", { name: "View results" }),
    ).toHaveLength(0);
    // A long line without a label is the value under its rule, not a heading.
    expect(
      within(details).getByRole("heading", {
        name: "Rule not met: “Descriptive link text”",
      }),
    ).toBeVisible();
    // A long note the clamp does not cut needs no toggle.
    expect(within(details).getByText(/^"battery, battery/)).toBeVisible();
    expect(
      within(details).queryByRole("button", { name: "Show all" }),
    ).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "SEO activity, newest first" }))
        .getAllByRole("link", { name: "View results" })
        .map((link) => link.getAttribute("href")),
    ).toContain("/tasks/one-check-task");
  });

  it("leaves the date filter off the Agent tab unless dates are set", () => {
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(workspace);
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    unmount();
    // A set date filter still shows, so it can be cleared.
    const set = renderWorkspace(workspace, "?from=2026-01-01");
    expect(screen.getByLabelText("Activity from")).toBeVisible();
    set.unmount();
    // An empty tab has nothing a date can narrow.
    const empty = renderWorkspace(workspace, "?tab=rankings");
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    empty.unmount();
    // Statistics syncs alone give Site health nothing a date can narrow.
    workspace.timeline = [
      {
        id: "sync",
        kind: "metrics",
        title: "Search Console statistics synced",
        status: "complete",
        detail: "",
        at: new Date("2026-01-02T00:00:00Z"),
        pageIds: workspace.scope.pageIds,
        taskId: null,
        observationId: null,
      },
    ];
    const health = renderWorkspace(workspace, "?tab=health");
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    health.unmount();
    // One other event has one date: a filter could only show it or hide it.
    workspace.timeline.push({
      ...workspace.timeline[0],
      id: "pages",
      kind: "scope",
      title: "Page selection changed",
    });
    const one = renderWorkspace(workspace, "?tab=health");
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    one.unmount();
    // Two events are history a date can narrow.
    workspace.timeline.push({
      ...workspace.timeline[1],
      id: "pages-again",
      at: new Date("2026-01-05T00:00:00Z"),
    });
    const history = renderWorkspace(workspace, "?tab=health");
    expect(
      screen.getByRole("button", { name: "Filter by date" }),
    ).toBeVisible();
    history.unmount();
    workspace.timeline = [];
    // Rankings change over time, so their tab offers the dates once two checks have rows.
    const check = {
      id: "first-check",
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: null,
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop" as const],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 2, skipped: 0, failed: 0 },
    };
    workspace.observations = [check];
    workspace.competitors.push({
      id: "rival",
      url: "https://rival.example/",
      role: "competitor",
      confirmed: true,
      source: "saved",
      rank: null,
      backlinks: null,
      referringDomains: null,
      observedAt: null,
      observationId: null,
      version: 1,
      canConfirm: true,
      exclusionReason: null,
    });
    // One check has one date.
    const single = renderWorkspace(workspace, "?tab=rankings");
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    single.unmount();
    workspace.observations = [{ ...check, id: "second-check" }, check];
    renderWorkspace(workspace, "?tab=rankings");
    expect(
      screen.getByRole("button", { name: "Filter by date" }),
    ).toBeVisible();
  });

  it("folds empty date fields opened on another tab when the Agent tab opens", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    await user.click(screen.getByRole("button", { name: "Filter by date" }));
    expect(screen.getByLabelText("Activity from")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    expect(screen.queryByLabelText("Activity from")).toBeNull();
  });

  it("keeps an Agent tab date field while its date is cleared mid-edit", async () => {
    const workspace = seoTestWorkspace();
    // No other filter: the date fields alone keep the filter block.
    workspace.availableActions.canEdit = false;
    workspace.scopes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?from=2026-01-01");
    const from = screen.getByLabelText("Activity from");
    // A date input reports an empty value as soon as one part is cleared.
    fireEvent.change(from, { target: { value: "" } });
    await waitFor(() => expect(from).toHaveValue(""));
    expect(screen.getByLabelText("Activity from")).toBe(from);
  });

  it("puts the filters under the tabs so the tab row stays put", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const tabs = screen.getByRole("tablist");
    const dates = screen.getByRole("button", { name: "Filter by date" });
    expect(
      tabs.compareDocumentPosition(dates) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leaves the Primary page badge off a lone page", () => {
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    const pages = screen
      .getByRole("heading", { name: "Pages" })
      .closest("section");
    if (!pages) throw new Error("Pages card missing");
    expect(within(pages).getByText("https://example.com/")).toBeVisible();
    expect(screen.queryByText("Primary page")).toBeNull();
  });

  it("shows the saved selections card only once a selection exists", () => {
    const workspace = seoTestWorkspace();
    workspace.pages.push(
      {
        ...workspace.pages[0],
        id: "a658c5bb-3084-4b26-81ee-b3208ee5ab61",
        url: "https://example.com/pricing",
      },
      // With two pages a selection is one page or both; the offer starts at three.
      {
        ...workspace.pages[0],
        id: "b758c5bb-3084-4b26-81ee-b3208ee5ab62",
        url: "https://example.com/about",
      },
    );
    const saved = workspace.scopes;
    workspace.scopes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(workspace, "?tab=health");
    expect(
      screen.queryByRole("heading", { name: "Saved page selections" }),
    ).toBeNull();
    // The way to save the first selection sits in the Pages card.
    const pages = screen
      .getByRole("heading", { name: "Pages" })
      .closest("section");
    if (!pages) throw new Error("Pages card missing");
    expect(
      within(pages).getByRole("button", { name: "Save page selection" }),
    ).toBeVisible();
    unmount();
    workspace.scopes = saved;
    renderWorkspace(workspace, "?tab=health");
    const card = screen
      .getByRole("heading", { name: "Saved page selections" })
      .closest("section");
    if (!card) throw new Error("Selections card missing");
    expect(
      within(card).getByRole("button", { name: "Save page selection" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Save page selection" }),
    ).toHaveLength(1);
  });

  it("hides the page picker when the only page is the one selected", () => {
    const workspace = seoTestWorkspace();
    workspace.scopes = [];
    workspace.metrics = [seoTestMetric()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(
      workspace,
      `?tab=traffic&pageId=${workspace.pages[0].id}`,
    );
    // One page is all pages; the picker would only repeat it.
    expect(screen.queryByRole("combobox", { name: "Pages" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Pages and filters/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Filter by date" }),
    ).toBeVisible();
    unmount();
    // A page the Audit no longer has stays visible, so the filter can be cleared.
    renderWorkspace(workspace, "?pageId=removed-page");
    expect(screen.getByRole("combobox", { name: "Pages" })).toBeVisible();
  });

  it.each([true, false])(
    "lists a check under Check details only when it has no Timeline row: %s",
    (onTimeline) => {
      const workspace = seoTestWorkspace();
      workspace.findings = [];
      workspace.observations = [
        {
          id: "lone-check",
          kind: "page_check",
          source: "seo_coworker",
          observedAt: new Date("2026-01-03T12:00:00Z"),
          pageIds: workspace.scope.pageIds,
          scopeVersion: 2,
          sourceTaskId: null,
          countryCode: "US",
          languageCode: "en",
          devices: ["desktop"],
          rulebookVersion: "html-v1",
          artifactHash: "lone",
          issues: 0,
          coverage: { checked: 2, skipped: 1, failed: 0 },
        },
      ];
      workspace.timeline = onTimeline
        ? [
            {
              id: "lone-event",
              kind: "check",
              title: "SEO check results imported",
              status: "completed",
              detail: "",
              at: new Date("2026-01-03T12:00:00Z"),
              pageIds: workspace.scope.pageIds,
              taskId: null,
              observationId: "lone-check",
            },
          ]
        : [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace, "?tab=health");
      // The Timeline row carries the coverage; a second list would repeat it.
      expect(
        screen.queryByRole("heading", {
          name: "Title, description and other page details",
        }) !== null,
      ).toBe(!onTimeline);
      expect(
        screen.getByText(
          onTimeline
            ? /^2 tests · .* · 1 not checked$/
            : "Rule checks: 2 checked, 1 not checked, 0 unavailable",
        ),
      ).toBeInTheDocument();
    },
  );

  it.each([false, true])(
    "distinguishes an empty Actions tab when checked evidence exists: %s",
    async (checked) => {
      const workspace = seoTestWorkspace();
      if (checked)
        workspace.observations.push({
          id: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
          kind: "page_check",
          source: "seo_coworker",
          observedAt: new Date("2026-01-03T12:00:00Z"),
          pageIds: workspace.scope.pageIds,
          scopeVersion: 2,
          sourceTaskId: null,
          countryCode: "US",
          languageCode: "en",
          devices: ["desktop"],
          rulebookVersion: "html-v1",
          artifactHash: "checked-html",
          issues: 0,
          coverage: { checked: 2, skipped: 2, failed: 0 },
        });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace, "tab=actions");
      expect(
        screen.getByText(
          checked
            ? "No fixes recommended from these checks"
            : "No recommended actions",
        ),
      ).toBeVisible();
      expect(screen.queryByText("These checks are incomplete")).toBeNull();
    },
  );

  it.each([
    { label: "", expected: "Related to: https://example.com/" },
    { label: "Home", expected: "Related to: Home" },
  ])(
    "shows the related page's parent when its label is '$label'",
    async ({ label, expected }) => {
      const workspace = seoTestWorkspace();
      workspace.pages[0].label = label;
      workspace.pages.push({
        ...workspace.pages[0],
        id: crypto.randomUUID(),
        url: "https://example.com/blogs",
        label: "Blog",
        relationship: "related",
        relatedToPageId: workspace.pages[0].id,
      });
      workspace.scope.pageIds = workspace.pages.map((page) => page.id);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace, "tab=health");
      const row = screen.getByRole("heading", { name: "Blog" }).closest("li");
      if (!row) throw new Error("Related page row missing");
      expect(within(row).getByText(expected)).toBeVisible();
    },
  );

  it("shows search totals on a page only while the saved statistics cover that page alone", () => {
    const workspace = seoTestWorkspace();
    // A second page; the saved statistics still cover only the first.
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      label: "Blog",
    });
    const clicks = {
      id: "sync:clicks",
      key: "clicks",
      label: "Clicks",
      unit: "count" as const,
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic" as const,
      value: 7,
      from: "2026-01-01",
      to: "2026-01-28",
      timeZone: "UTC",
      observedAt: new Date(),
      coverage: "complete" as const,
      points: [],
      notes: [],
    };
    workspace.metrics = [
      clicks,
      { ...clicks, id: "sync:ctr", key: "ctr", unit: "ratio", value: 0.057 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(workspace, "tab=health");
    const row = screen.getByRole("heading", { name: "Home" }).closest("li");
    if (!row) throw new Error("Page row missing");
    expect(within(row).getByText("Search clicks")).toBeVisible();
    expect(within(row).getByText("7")).toBeVisible();
    // The same rate the Performance tiles show, as a percent.
    expect(within(row).getByText("5.7%")).toBeVisible();
    expect(within(row).getByText("Not checked yet")).toBeVisible();
    unmount();

    // A 1-page Audit shows these totals on Overview; the Pages tab does not repeat them.
    const one = seoTestWorkspace();
    one.metrics = [clicks];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(one)),
    );
    const single = renderWorkspace(one, "tab=health");
    // With one page the Timeline lists its checks; the page card does not repeat the last one.
    const onlyPage = screen
      .getByRole("heading", { name: "Pages" })
      .closest("section");
    if (!onlyPage) throw new Error("Pages card missing");
    expect(within(onlyPage).queryByText("Last check")).toBeNull();
    expect(screen.queryByText("Search clicks")).toBeNull();
    single.unmount();

    // A lone page without its own name is the header's URL; the Pages card would only repeat it.
    const bare = seoTestWorkspace();
    bare.pages[0].label = bare.pages[0].url;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(bare)),
    );
    const plain = renderWorkspace(bare, "tab=health");
    const header = screen.getByRole("link", {
      name: "All audits",
    }).parentElement;
    if (!header) throw new Error("Header missing");
    expect(
      within(header).getByRole("link", { name: bare.pages[0].url }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Pages" })).toBeNull();
    expect(screen.queryByText("1 page")).toBeNull();
    plain.unmount();
    // Without that page in view the header cannot name it, so the card stays.
    const empty = { ...bare, scope: { ...bare.scope, pageIds: [] } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(empty)),
    );
    const unscoped = renderWorkspace(empty, "tab=health");
    expect(screen.getByRole("heading", { name: "Pages" })).toBeVisible();
    unscoped.unmount();

    // A date filter keeps the page's own line: the Timeline does not say "in these dates".
    const filtered = seoTestWorkspace();
    filtered.pages[0].label = filtered.pages[0].url;
    filtered.scope.from = "2026-01-01";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(filtered)),
    );
    const dated = renderWorkspace(filtered, "tab=health&from=2026-01-01");
    const datedPage = screen
      .getByRole("heading", { name: "Pages" })
      .closest("section");
    if (!datedPage) throw new Error("Pages card missing");
    expect(
      within(datedPage).getByText("No check in these dates"),
    ).toBeVisible();
    dated.unmount();

    const two = seoTestWorkspace();
    two.metrics = [clicks];
    two.pages.push({ ...two.pages[0], id: crypto.randomUUID(), label: "Blog" });
    two.scope.pageIds = two.pages.map((page) => page.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(two)),
    );
    const both = renderWorkspace(two, "tab=health");
    // Two pages in view: the header counts them.
    expect(screen.getByText("2 pages")).toBeVisible();
    // Totals for two pages belong to neither page.
    expect(screen.queryByText("Search clicks")).toBeNull();
    both.unmount();
    // One page of two in view: the header names that page by its URL, not its name.
    const narrowed = {
      ...two,
      scope: { ...two.scope, pageIds: [two.pages[1].id] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(narrowed)),
    );
    renderWorkspace(narrowed, `tab=health&pageId=${two.pages[1].id}`);
    const narrowHeader = screen.getByRole("link", {
      name: "All audits",
    }).parentElement;
    if (!narrowHeader) throw new Error("Header missing");
    expect(
      within(narrowHeader).getByRole("link", { name: two.pages[1].url }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "Pages" })[0]).toBeVisible();
  });

  it("opens the chat with a comparison question for a competitor and sends nothing", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      competitors: [
        {
          id: "rival",
          url: "https://rival.example/",
          role: "competitor" as const,
          confirmed: true,
          source: "saved",
          rank: null,
          backlinks: null,
          referringDomains: null,
          observedAt: null,
          observationId: null,
          version: 1,
          canConfirm: true,
          exclusionReason: null,
        },
      ],
    };
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      Response.json(
        url.endsWith("/chat") ? { sharing: "personal", turns: [] } : workspace,
      ),
    );
    vi.stubGlobal("fetch", fetch);
    renderWorkspace(workspace, "tab=rankings");
    await user.click(
      screen.getByRole("button", {
        name: "Actions for https://rival.example/",
      }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Compare with my page" }),
    );
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("Your question")).toHaveValue(
      "Compare my page with https://rival.example/. What does it do better for the same searches, and what should I change first?",
    );
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
      false,
    );
  });

  it("labels a saved page group's navigation as a selection", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.scopes[0].name = "Website and blog";
    // Saved selections show only once there is more than one page to choose from.
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: `${workspace.pages[0].url}blog`,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "tab=health");
    const row = screen
      .getByRole("heading", { name: "Website and blog" })
      .closest("li");
    if (!row) throw new Error("Saved page selection missing");
    expect(within(row).queryByRole("button", { name: "View page" })).toBeNull();
    await user.click(
      within(row).getByRole("button", { name: "View selection" }),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(`scopeId=${workspace.scopes[0].id}`),
        expect.any(Object),
      ),
    );
  });

  it("points the position arrow up when the position improves", () => {
    const workspace = seoTestWorkspace();
    const days = Array.from({ length: 14 }, (_, day) =>
      new Date(Date.UTC(2026, 9, day + 1)).toISOString().slice(0, 10),
    );
    const base = {
      label: "",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic" as const,
      from: days[0],
      to: days[13],
      timeZone: "UTC",
      observedAt: new Date(),
      coverage: "complete" as const,
      notes: [],
    };
    workspace.metrics = [
      {
        ...base,
        id: "sync:impressions",
        key: "impressions",
        unit: "count",
        value: 280,
        // 140 impressions a week: enough to judge a position change.
        points: days.map((date) => ({ date, value: 20 })),
      },
      {
        ...base,
        id: "sync:position",
        key: "position",
        unit: "position",
        value: 4.5,
        // Position falls from 5 to 4: that is better.
        points: days.map((date, day) => ({ date, value: day < 7 ? 5 : 4 })),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    // An arrow up beside a falling number reads as worse; the words carry it.
    const change = screen.getByText(/: 4\.0 · week before: 5\.0, better$/);
    expect(change.querySelector("svg")).toBeNull();
    // The line names the newest 7 days, so "week before" has a clear anchor.
    expect(change).toHaveTextContent(/^Oct 8\W+14:/);
    expect(screen.getByText(/: 140 · week before: 140$/)).toBeVisible();
  });

  it("marks a recorded page change on the traffic chart and names it", () => {
    const workspace = seoTestWorkspace();
    const days = Array.from({ length: 14 }, (_, day) =>
      new Date(Date.UTC(2026, 9, day + 1)).toISOString().slice(0, 10),
    );
    workspace.metrics = [
      {
        id: "sync:clicks",
        key: "clicks",
        label: "",
        unit: "count",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        value: 14,
        from: days[0],
        to: days[13],
        timeZone: "UTC",
        observedAt: new Date(),
        coverage: "complete",
        notes: [],
        points: days.map((date) => ({ date, value: 1 })),
      },
    ];
    workspace.timeline = [
      {
        id: "page-change:1",
        kind: "page_change",
        title: "New title",
        at: new Date("2026-10-05T09:00:00Z"),
        pageIds: [],
        observationId: null,
        taskId: null,
        status: "recorded",
        detail: "",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    expect(screen.getAllByTestId("seo-trend-change")).toHaveLength(1);
    expect(
      screen.getByText("Recorded change on Oct 5: New title"),
    ).toBeVisible();
  });

  it("says whether Google indexes the page in view and names another canonical", () => {
    const workspace = seoTestWorkspace();
    const url = workspace.pages[0].url;
    // A second page in view that no sync could inspect.
    workspace.pages.push({
      ...workspace.pages[0],
      id: "7b0c4f5e-1d2a-4c3b-9e8f-000000000002",
      url: `${url}blog`,
      relationship: "related",
    });
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    const checkedAt = new Date("2026-11-01T10:00:00Z");
    workspace.indexStatus = {
      pages: [
        {
          pageUrl: url,
          verdict: "NEUTRAL",
          coverageState: "Alternate page with proper canonical tag",
          robotsTxtState: "ALLOWED",
          lastCrawlTime: new Date("2026-10-30T08:15:00Z"),
          googleCanonical: "https://example.com/other",
          userCanonical: null,
          checkedAt,
        },
        // A page outside the scope stays out of view.
        {
          pageUrl: "https://elsewhere.example/",
          verdict: "PASS",
          coverageState: "Submitted and indexed",
          robotsTxtState: null,
          lastCrawlTime: null,
          googleCanonical: null,
          userCanonical: null,
          checkedAt,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    const section = screen
      .getByRole("heading", { name: "Google index" })
      .closest("section");
    if (!section) throw new Error("Index section missing");
    expect(within(section).getByText("Not indexed")).toBeVisible();
    expect(within(section).queryByText("Indexed")).toBeNull();
    expect(
      within(section).getByText(
        "Google says: “Alternate page with proper canonical tag”",
      ),
    ).toBeVisible();
    expect(
      within(section).getByRole("link", { name: "https://example.com/other" }),
    ).toBeVisible();
    expect(
      within(section).getByText(/No index status yet for 1 page in view\./),
    ).toBeVisible();
  });

  it("lists search totals by country and device, folding countries past ten", () => {
    const workspace = seoTestWorkspace();
    const row = (key: string, clicks: number) => ({
      key,
      clicks,
      impressions: clicks * 10,
      ctr: 0.1,
      averagePosition: 5.25,
    });
    const codes = [
      "DE",
      "AT",
      "CH",
      "US",
      "GB",
      "FR",
      "IT",
      "ES",
      "NL",
      "BE",
      "ZZZ",
    ];
    workspace.searchQueries = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      timeZone: "UTC",
      observedAt: new Date(),
      rowLimit: 250,
      truncated: false,
      rows: [],
      countries: {
        rowLimit: 250,
        truncated: false,
        rows: codes.map((code, index) => row(code, 20 - index)),
      },
      devices: { rowLimit: 250, truncated: false, rows: [row("mobile", 7)] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const section = screen
      .getByRole("heading", { name: "Countries and devices" })
      .closest("section");
    if (!section) throw new Error("Breakdown section missing");
    const country = within(section).getAllByRole("table")[0];
    expect(within(country).getByText("Germany")).toBeVisible();
    expect(within(country).getAllByRole("row")).toHaveLength(11);
    // The 11th country, Google's unknown region, folds into the count.
    expect(within(country).queryByText("Unknown country")).toBeNull();
    expect(
      within(section).getByText("1 more country with fewer clicks."),
    ).toBeVisible();
    const device = within(section).getAllByRole("table")[1];
    expect(within(device).getByText("Mobile")).toBeVisible();
    expect(within(device).getByText("5.3")).toBeVisible();
  });

  it("says once that both splits cover the same impressions", () => {
    const workspace = seoTestWorkspace();
    const observedAt = new Date("2026-10-29T00:00:00Z");
    const row = (key: string, impressions: number) => ({
      key,
      clicks: 0,
      impressions,
      ctr: 0,
      averagePosition: 3,
    });
    workspace.metrics = [
      {
        ...seoTestMetric(),
        id: "sync:impressions",
        key: "impressions",
        from: "2026-10-01",
        to: "2026-10-28",
        observedAt,
        value: 34,
      },
    ];
    const split = (impressions: number, key: string) => ({
      rowLimit: 250,
      truncated: false,
      rows: [row(key, impressions)],
    });
    workspace.searchQueries = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      timeZone: "UTC",
      observedAt,
      rowLimit: 250,
      truncated: false,
      rows: [],
      countries: split(1, "EG"),
      devices: split(1, "desktop"),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const same = renderWorkspace(workspace, "?tab=traffic");
    expect(
      screen.getByText(
        "Google gives a country and a device for only 1 of your 34 impressions.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Google gives a country for only/)).toBeNull();
    expect(screen.queryByText(/Google gives a device for only/)).toBeNull();
    same.unmount();
    // Different counts: each table says its own.
    workspace.searchQueries.devices = split(5, "desktop");
    renderWorkspace(workspace, "?tab=traffic");
    expect(
      screen.getByText(
        "Google gives a country for only 1 of your 34 impressions.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Google gives a device for only 5 of your 34 impressions.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/a country and a device/)).toBeNull();
  });

  it("names each total's change against the equal window before the period", () => {
    const workspace = seoTestWorkspace();
    const base = {
      label: "",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic" as const,
      from: "2026-10-01",
      to: "2026-10-14",
      timeZone: "UTC",
      observedAt: new Date(),
      coverage: "complete" as const,
      notes: [],
      points: [],
    };
    const before = (value: number) => ({
      from: "2026-09-17",
      to: "2026-09-30",
      value,
    });
    workspace.metrics = [
      {
        ...base,
        id: "s:clicks",
        key: "clicks",
        unit: "count",
        value: 30,
        previous: before(12),
      },
      {
        ...base,
        id: "s:impressions",
        key: "impressions",
        unit: "count",
        value: 900,
        previous: before(900),
      },
      {
        ...base,
        id: "s:position",
        key: "position",
        unit: "position",
        value: 4.2,
        previous: before(6.1),
      },
      {
        ...base,
        id: "s:ctr",
        key: "ctr",
        unit: "ratio",
        value: 0.025,
        previous: before(0.021),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    expect(screen.getByText("Previous 14 days: 12 (+18)")).toBeVisible();
    expect(screen.getByText("Previous 14 days: 900, no change")).toBeVisible();
    // A lower position is better, so the words say it, not a sign.
    expect(screen.getByText("Previous 14 days: 6.1, better now")).toBeVisible();
    // A rate change carries its sign.
    expect(screen.getByText("Previous 14 days: 2.1% (+0.4 pp)")).toBeVisible();
  });

  it("puts the Google search totals under the agent verdict only when both counts exist", () => {
    const workspace = seoTestWorkspace();
    const base = {
      label: "",
      unit: "count" as const,
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic" as const,
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "UTC",
      observedAt: new Date(),
      coverage: "complete" as const,
      notes: [],
    };
    const impressions = {
      ...base,
      id: "sync:impressions",
      key: "impressions",
      value: 35,
      // Jan 1 was quiet: Google leaves the day out, but the read still covers it.
      points: [{ date: "2026-01-02", value: 35 }],
    };
    workspace.metrics = [
      impressions,
      {
        ...base,
        id: "sync:clicks",
        key: "clicks",
        value: 2,
        points: [{ date: "2026-01-02", value: 2 }],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    // A measured check with no issues.
    workspace.observations.push({
      id: crypto.randomUUID(),
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: null,
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 2, skipped: 0, failed: 0 },
    });
    const { unmount } = renderWorkspace(workspace);
    // Fewer impressions than one week needs for a comparison: the verdict says Google rarely shows the page.
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      "Your page passes the last check, but Google rarely shows it yet",
    );
    expect(screen.getByTestId("seo-agent-traffic")).toHaveTextContent(
      // The link is its own item after the period, with no separator of its own.
      /^Google search on this page: 2 clicks, 35 impressions · Jan 1\W+2, 2026\s*Open traffic$/,
    );
    unmount();
    // Without clicks the line would read as zero clicks; it stays away.
    workspace.metrics = [impressions];
    const second = renderWorkspace(workspace);
    expect(screen.queryByTestId("seo-agent-traffic")).toBeNull();
    second.unmount();
    // Enough impressions for a week's comparison: the plain verdict.
    workspace.metrics = [
      { ...impressions, value: 100 },
      { ...impressions, id: "sync:clicks", key: "clicks", value: 2 },
    ];
    renderWorkspace(workspace);
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      "No issues found in the last check",
    );
  });

  it("does not judge a position change on a handful of impressions", async () => {
    const workspace = seoTestWorkspace();
    const days = Array.from(
      { length: 14 },
      (_, day) => `2026-01-${String(day + 1).padStart(2, "0")}`,
    );
    const base = {
      label: "",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic" as const,
      from: days[0],
      to: days[13],
      timeZone: "UTC",
      observedAt: new Date(),
      coverage: "complete" as const,
      notes: [],
    };
    workspace.metrics = [
      {
        ...base,
        id: "sync:impressions",
        key: "impressions",
        unit: "count",
        value: 21,
        // 7 impressions, then 14: a doubling on numbers this small is noise.
        points: days.map((date, day) => ({ date, value: day < 7 ? 1 : 2 })),
      },
      {
        ...base,
        id: "sync:position",
        key: "position",
        unit: "position",
        value: 4.5,
        points: days.map((date, day) => ({ date, value: day < 7 ? 5 : 4 })),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    // One note under the tiles, not one per tile.
    expect(screen.queryByText("Not enough days to compare")).toBeNull();
    // Search Console is Google search only; the subtitle does not repeat it.
    expect(screen.queryByText(/Organic search/)).toBeNull();
    expect(screen.getAllByText(/Too few to compare weeks\.$/)).toHaveLength(1);
    // Both weeks are small: no tile compares, and the one note keeps both counts.
    expect(
      screen.getByText(
        /^Jan 8\W+14: 14 impressions\. Week before: 7\. Too few to compare weeks\.$/,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/better|worse/)).toBeNull();
    expect(screen.queryByText(/· week before: /)).toBeNull();
    // The position hint describes its tile; in the name, "5" and "1" would read as one number.
    const positionTile = screen.getByRole("button", {
      description: "1 is the top result",
    });
    expect(positionTile).not.toHaveAccessibleName(/top result/);
  });

  it("keeps the arrow on a search count that collapses from a busy week", () => {
    const workspace = seoTestWorkspace();
    const days = Array.from(
      { length: 14 },
      (_, day) => `2026-01-${String(day + 1).padStart(2, "0")}`,
    );
    // One sync has one time: metrics of two times are two syncs, and only the newest shows.
    const observedAt = new Date();
    workspace.metrics = [
      {
        id: "sync:impressions",
        key: "impressions",
        label: "",
        unit: "count",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        from: days[0],
        to: days[13],
        timeZone: "UTC",
        observedAt,
        coverage: "complete",
        notes: [],
        value: 4935,
        // 4,900 impressions, then 35: a page that dropped out of the results.
        points: days.map((date, day) => ({ date, value: day < 7 ? 700 : 5 })),
      },
      {
        id: "sync:position",
        key: "position",
        label: "",
        unit: "position",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        from: days[0],
        to: days[13],
        timeZone: "UTC",
        observedAt,
        coverage: "complete",
        notes: [],
        value: 4.5,
        points: days.map((date, day) => ({ date, value: day < 7 ? 5 : 4 })),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const count = screen.getByText(/: 35 · week before: 4,900$/);
    expect(count.querySelector("svg")).not.toBeNull();
    // 35 impressions cannot carry a position change; only the position note shows.
    expect(
      screen.getByText(
        "Too few impressions to compare weeks for average position.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/better|worse/)).toBeNull();
  });

  it("renders source measurements without replacing missing values with zero", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metricsStatus = "partial";
    const metric = {
      id: "views",
      key: "page_views",
      label: "Page views",
      unit: "count" as const,
      source: "ga4",
      propertyId: "properties/123",
      channel: "all" as const,
      value: 0,
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "Europe/Berlin",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      coverage: "complete" as const,
      points: [],
      notes: [],
    };
    workspace.metrics.push(metric, {
      ...metric,
      id: "users",
      key: "active_users",
      label: "Active users",
      value: null,
      coverage: "unavailable",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    expect(screen.getByText("Page views")).toBeVisible();
    expect(screen.getByText("0")).toBeVisible();
    expect(screen.getByText("Active users")).toBeVisible();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    // One fold on Traffic; without search queries it does not explain them.
    await user.click(screen.getByText("About this data"));
    expect(screen.getByText(/Europe\/Berlin/)).toBeVisible();
    expect(screen.queryByText(/not search volume/)).toBeNull();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("keeps percentage totals and daily trend values in the same units", () => {
    const workspace = seoTestWorkspace();
    workspace.metricsStatus = "available";
    workspace.metrics.push({
      id: "engagement",
      key: "engagement_rate",
      label: "Engagement rate",
      unit: "ratio",
      source: "ga4",
      propertyId: "properties/123",
      channel: "all",
      value: 0.25,
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "UTC",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      coverage: "complete",
      points: [{ date: "2026-01-01", value: 0.25 }],
      notes: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    expect(screen.getByTestId("seo-metric-engagement_rate")).toHaveTextContent(
      "25%",
    );
    expect(screen.getByRole("row", { name: "Jan 1 25%" })).toBeInTheDocument();
    const trend = screen.getByRole("group", { name: "Engagement rate" });
    act(() => trend.focus());
    expect(within(trend).getByRole("status")).toHaveTextContent("Jan 1 · 25%");
  });

  it("reopens statistics with the saved source and property instead of restarting setup", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metricsStatus = "available";
    workspace.metrics.push({
      id: "saved-clicks",
      key: "clicks",
      label: "Search clicks",
      unit: "count",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic",
      value: 41,
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "UTC",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      coverage: "complete",
      points: [],
      notes: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("statistics/properties"))
          return Response.json({
            provider: "search_console",
            status: "available",
            reason: null,
            properties: [
              { id: "sc-domain:other.example", name: "Other website" },
              { id: "sc-domain:example.com", name: "Example website" },
            ],
          });
        return Response.json(workspace);
      }),
    );
    renderWorkspace(workspace);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await openStatisticsSetup(user);
      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("combobox", { name: "Source" }),
      ).toHaveTextContent("Search Console");
      await waitFor(() =>
        expect(
          within(dialog).getByRole("combobox", { name: "Property" }),
        ).toHaveTextContent("Example website"),
      );
      expect(within(dialog).getByLabelText("Start date")).toHaveValue(
        "2026-01-01",
      );
      expect(within(dialog).getByLabelText("End date")).toHaveValue(
        "2026-01-02",
      );
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    }
  });

  it.each([
    { query: "", from: "", to: "" },
    {
      query: "from=2026-11-01&to=2026-11-05",
      from: "2026-11-01",
      to: "2026-11-05",
    },
  ])(
    "keeps Audit activity dates ($from / $to) when syncing a different Google reporting period",
    async ({ query, from, to }) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (String(url).includes("statistics/properties"))
            return Response.json({
              provider: "ga4",
              status: "available",
              reason: null,
              properties: [{ id: "properties/123", name: "Example website" }],
            });
          return Response.json(workspace);
        }),
      );
      mutate.mockResolvedValue({ ok: true, value: null });
      renderWorkspace(workspace, `tab=traffic&${query}`);
      await openStatisticsSetup(user);
      const dialog = screen.getByRole("dialog");
      await waitFor(() =>
        expect(
          within(dialog).getByRole("combobox", { name: "Property" }),
        ).toHaveTextContent("Example website"),
      );
      fireEvent.change(within(dialog).getByLabelText("Start date"), {
        target: { value: "2026-10-01" },
      });
      fireEvent.change(within(dialog).getByLabelText("End date"), {
        target: { value: "2026-10-31" },
      });
      await user.click(
        within(dialog).getByRole("button", { name: "Sync statistics" }),
      );
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining("channel=all"),
          expect.anything(),
        ),
      );
      if (from) {
        expect(screen.getByLabelText(messages.App.Seo.dateFrom)).toHaveValue(
          from,
        );
        expect(screen.getByLabelText(messages.App.Seo.dateTo)).toHaveValue(to);
      } else {
        // Unset activity dates stay folded and unset.
        expect(screen.queryByLabelText(messages.App.Seo.dateFrom)).toBeNull();
      }
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          command: {
            kind: "sync_statistics",
            body: expect.objectContaining({
              provider: "ga4",
              propertyId: "properties/123",
              from: "2026-10-01",
              to: "2026-10-31",
            }),
          },
        }),
      );
    },
  );

  it("hides the previous page's evidence while a newly selected page loads", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const secondPage = {
      ...workspace.pages[0],
      id: "a658c5bb-3084-4b26-81ee-b3208ee5ab61",
      url: "https://example.com/other",
      label: "Other page",
    };
    workspace.pages.push(secondPage);
    workspace.findings.push({
      id: "finding",
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      device: "mobile",
      rowId: "row",
      title: "Previous page finding",
      severity: "major",
      evidence: ["Observed title"],
      sourceRef: "task",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes(`pageId=${secondPage.id}`)
          ? new Promise(() => {})
          : Promise.resolve(Response.json(workspace)),
      ),
    );
    renderWorkspace(workspace, "?tab=health");
    expect(screen.getByText("Previous page finding")).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Pages" }));
    await user.click(screen.getByRole("option", { name: "Other page" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Previous page finding"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Loading SEO results")).toBeVisible();
  });

  it("does not seed the next viewer's cache with the previous viewer's private metrics", async () => {
    const workspace = seoTestWorkspace();
    workspace.metricsStatus = "available";
    workspace.metrics.push({
      id: "private",
      key: "page_views",
      label: "Page views",
      unit: "count",
      source: "ga4",
      propertyId: "properties/123",
      channel: "all",
      value: 47,
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "UTC",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      coverage: "complete",
      points: [],
      notes: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const view = renderWorkspace(workspace, "?tab=traffic");
    expect(screen.getByText("47")).toBeVisible();
    viewer.userId = "another-owner";
    view.refreshViewer();
    expect(screen.queryByText("47")).not.toBeInTheDocument();
    expect(screen.getByText("Loading SEO results")).toBeVisible();
  });

  it("keeps the edited group version frozen when a background read finds another editor's changes", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", status: 409 },
    });
    const view = renderWorkspace(workspace, `?scopeId=${workspace.scope.id}`);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await user.click(
      screen.getByRole("button", { name: "Edit page selection" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Selection name"));
    await user.type(
      within(dialog).getByLabelText("Selection name"),
      "My group edit",
    );
    const updated = {
      ...workspace,
      scope: { ...workspace.scope, version: 3 },
      scopes: workspace.scopes.map((scope) => ({ ...scope, version: 3 })),
    };
    await act(async () => {
      view.client.setQueryData(
        [
          "seo-workspace",
          "org",
          "owner",
          "project",
          workspace.projectId,
          `scopeId=${workspace.scope.id}`,
        ],
        updated,
      );
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "update_scope",
        scopeId: workspace.scope.id,
        body: {
          name: "My group edit",
          pageIds: workspace.scope.pageIds,
          expectedVersion: 2,
        },
      },
    });
  });

  it("starts a native HTML check without a prior import or caller-selected executor", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Run a check" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Maximum data requests")).toBeNull();
    expect(
      within(dialog).queryByRole("combobox", { name: /coworker/i }),
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.type(within(dialog).getByLabelText("Search language"), "de");
    await user.click(
      within(dialog).getByRole("button", { name: "Start check" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0].command).toMatchObject({
      kind: "request_analysis",
      body: {
        kind: "page_check",
        maxProviderCalls: 0,
        scopeId: workspace.scope.id,
        expectedScopeVersion: 2,
      },
    });
    expect(mutate.mock.calls[0][0].command.body).not.toHaveProperty(
      "coworkerId",
    );
  });

  it.each([false, undefined])(
    "keeps unapproved paid operations out of native checks (%s)",
    async (permission) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      workspace.availableActions.canUsePaidSearchData = permission;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      mutate.mockResolvedValue({ ok: true, value: null });
      renderWorkspace(workspace);
      await user.click(screen.getByRole("button", { name: "Run a check" }));
      const dialog = screen.getByRole("dialog");
      await user.click(
        within(dialog).getByRole("combobox", { name: "Check type" }),
      );
      expect(
        screen.queryByRole("option", { name: "Keyword positions" }),
      ).toBeNull();
      expect(
        screen.queryByRole("option", { name: "Backlink overview" }),
      ).toBeNull();
      expect(screen.queryByRole("option", { name: "Full audit" })).toBeNull();
      await user.click(screen.getByRole("option", { name: "Audit lite" }));
      expect(within(dialog).queryByLabelText("Keyword positions")).toBeNull();
      expect(
        within(dialog).queryByLabelText("Maximum data requests"),
      ).toBeNull();
      await user.click(
        within(dialog).getByRole("combobox", { name: "Search country" }),
      );
      await user.click(screen.getByRole("option", { name: "DE" }));
      await user.type(within(dialog).getByLabelText("Search language"), "de");
      await user.click(
        within(dialog).getByRole("button", { name: "Start check" }),
      );
      await waitFor(() => expect(mutate).toHaveBeenCalled());
      expect(mutate.mock.calls[0][0].command.body).toMatchObject({
        kind: "audit_lite",
        analyses: ["page.inspect"],
        maxProviderCalls: 0,
      });
      expect(mutate.mock.calls[0][0].command.body).not.toHaveProperty(
        "coworkerId",
      );
    },
  );

  it("shows a paid-data budget only when Audit lite includes provider-backed checks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Run a check" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    await user.click(screen.getByRole("option", { name: "Audit lite" }));
    expect(within(dialog).queryByLabelText("Maximum data requests")).toBeNull();
    await user.click(within(dialog).getByLabelText("Keyword positions"));
    expect(within(dialog).getByLabelText("Maximum data requests")).toHaveValue(
      20,
    );
    await user.clear(within(dialog).getByLabelText("Maximum data requests"));
    await user.type(
      within(dialog).getByLabelText("Maximum data requests"),
      "5",
    );
    await user.click(within(dialog).getByLabelText("Keyword positions"));
    expect(within(dialog).queryByLabelText("Maximum data requests")).toBeNull();
    await user.click(within(dialog).getByLabelText("Backlink overview"));
    expect(within(dialog).getByLabelText("Maximum data requests")).toHaveValue(
      5,
    );
  });

  it("keeps unavailable first-use recovery inside SEO without promising a hidden check", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(screen.queryByRole("button", { name: "Run a check" })).toBeNull();
    // The check step says it once; the page banner does not repeat it.
    expect(
      screen.getByText(messages.App.Seo.setup.checkUnavailable),
    ).toBeVisible();
    expect(screen.queryByText(messages.App.Seo.dispatchPaused)).toBeNull();
    // "All audits" goes back to the Audit's Project scope.
    expect(screen.getByRole("link", { name: "All audits" })).toHaveAttribute(
      "href",
      `/seo?projectId=${SEO_TEST_PROJECT}`,
    );
    expect(
      screen.queryByRole("link", { name: /bot|coworker|assistant/i }),
    ).toBeNull();
    // Report import is gone: adding a page is the first step without checks.
    expect(screen.queryByRole("button", { name: /import/i })).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Add a page" })[0]);
    const addPage = screen.getByRole("dialog", { name: "Add a page" });
    expect(addPage).toBeVisible();
    // A new page relates to the main page unless the user says it stands alone.
    expect(
      within(addPage).getByRole("combobox", { name: "Related to" }),
    ).toHaveTextContent(workspace.pages[0].label || workspace.pages[0].url);
    // With no pages, the later steps wait as titles, and none is called unavailable.
    cleanup();
    workspace.scope.pageIds = [];
    // Core reports no sync right for an empty scope either: the later steps wait.
    workspace.availableActions.canSyncMetrics = false;
    renderWorkspace(workspace);
    expect(
      within(screen.getByTestId("seo-setup"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Add a page"]);
    expect(
      screen.queryByText(messages.App.Seo.setup.syncUnavailable),
    ).toBeNull();
    expect(
      screen.queryByText(messages.App.Seo.setup.checkUnavailable),
    ).toBeNull();
    expect(
      screen.queryByText(messages.App.Seo.setup.connectUnavailable),
    ).toBeNull();
  });

  it("leads a new audit with its setup steps and shows a check in flight", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    const setup = screen.getByRole("region", { name: "Set up this audit" });
    expect(within(setup).getByText("1 of 4 done")).toBeVisible();
    const steps = within(
      within(setup).getByRole("list", { name: "Setup steps" }),
    ).getAllByRole("listitem");
    // The page is saved, so connecting Google is the current step once its state is read.
    await waitFor(() =>
      expect(steps.map((step) => step.getAttribute("aria-current"))).toEqual([
        null,
        "step",
        null,
        null,
      ]),
    );
    // The schedule offer and the old verdict wait until a check exists.
    expect(screen.queryByTestId("seo-automation")).toBeNull();
    expect(screen.queryByTestId("seo-agent-verdict")).toBeNull();
    await user.click(
      within(steps[3]).getByRole("button", { name: "Run a check" }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    cleanup();
    workspace.analyses = [
      {
        id: "8a0f4a39-7a55-4f0c-9a43-6c1a4f1f2b11",
        kind: "page_check",
        status: "running",
        taskId: null,
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        createdAt: new Date("2026-01-02T12:00:00Z"),
      },
    ];
    renderWorkspace(workspace);
    // The badge is the picture; the status line is what a screen reader hears.
    expect(
      within(screen.getByTestId("seo-setup")).getByText("Check running"),
    ).toBeVisible();
    expect(
      screen
        .getAllByRole("status")
        .some((status) => status.textContent === "Check running"),
    ).toBe(true);
    // The button stays for keyboard focus, but starts no second check.
    const again = screen.getByRole("button", { name: "Run a check" });
    expect(again).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(again);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("schedules finite native monitoring with its market and per-run budget", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    // Before the first check the schedule is in the Manage menu, not on the agent home.
    await user.click(screen.getByRole("button", { name: "Manage SEO" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: messages.App.Seo.monitor.create,
      }),
    );
    const dialog = screen.getByRole("dialog");
    // The schedule opens on the weekly slot, named by its day and time.
    expect(
      within(dialog).getByRole("combobox", { name: "Frequency" }),
    ).toHaveTextContent("Mondays at 09:00");
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    expect(
      screen.queryByRole("option", { name: "Full audit" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Keyword positions" }));
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.type(within(dialog).getByLabelText("Search language"), "de");
    await user.type(
      within(dialog).getByLabelText("Keywords, one per line"),
      "stablecoins",
    );
    await user.clear(within(dialog).getByLabelText("Maximum data requests"));
    await user.type(
      within(dialog).getByLabelText("Maximum data requests"),
      "2",
    );
    await user.clear(within(dialog).getByLabelText("Number of runs"));
    const monitorForm = dialog.querySelector("form");
    if (!monitorForm) throw new Error("Missing monitor form");
    fireEvent.submit(monitorForm);
    expect(mutate).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText("Number of runs"), "2");
    await user.click(
      within(dialog).getByRole("button", { name: "Schedule checks" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "create_monitor",
        body: {
          operationId: expect.any(String),
          cadence: "weekly",
          timeZone: expect.any(String),
          targetRunCount: 2,
          analysis: expect.objectContaining({
            kind: "rankings",
            scopeId: workspace.scope.id,
            expectedScopeVersion: 2,
            countryCode: "DE",
            languageCode: "de",
            keywords: ["stablecoins"],
            maxProviderCalls: 2,
          }),
        },
      },
    });
    expect(mutate.mock.calls[0][0].command.body.analysis).not.toHaveProperty(
      "coworkerId",
    );
  });

  it.each([false, undefined])(
    "keeps one-off checks available without an approved scheduler (%s)",
    async (permission) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      workspace.availableActions.canCreateMonitor = permission;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      const view = renderWorkspace(workspace);
      expect(screen.getByRole("button", { name: "Run a check" })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Schedule checks" }),
      ).toBeNull();
      expect(screen.queryByText("Monitoring")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Manage SEO" }));
      expect(
        screen.queryByRole("menuitem", { name: "Schedule checks" }),
      ).toBeNull();
      view.unmount();
      renderWorkspace(workspace, "", true);
      // A schedule the workspace cannot make shows nothing: no notice and no button.
      expect(screen.queryByTestId("seo-automation")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Let the agent check weekly" }),
      ).toBeNull();
    },
  );

  it("blocks an open monitor form when scheduler readiness is withdrawn", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.availableActions.canUsePaidSearchData = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const view = renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Manage SEO" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: messages.App.Seo.monitor.create,
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(messages.App.Seo.analysis.htmlService),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.type(within(dialog).getByLabelText("Search language"), "de");
    await act(async () => {
      view.client.setQueryData(
        ["seo-workspace", "org", "owner", "project", workspace.projectId, ""],
        {
          ...workspace,
          availableActions: {
            ...workspace.availableActions,
            canRequestAnalysis: false,
            canCreateMonitor: false,
          },
        },
      );
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Schedule checks" }),
      ).toBeDisabled(),
    );
    expect(
      within(dialog).queryByText(messages.App.Seo.analysis.htmlService),
    ).toBeNull();
    const form = dialog.querySelector("form");
    if (!form) throw new Error("Missing monitor form");
    fireEvent.submit(form);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("clears activity dates instead of claiming filtered reports are first-use results", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.scope.from = "2026-11-01";
    workspace.scope.to = "2026-11-02";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "from=2026-11-01&to=2026-11-02");
    expect(screen.queryByText(messages.App.Seo.setup.title)).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Clear activity dates" }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText(messages.App.Seo.dateFrom)).toHaveValue("");
      expect(screen.getByLabelText(messages.App.Seo.dateTo)).toHaveValue("");
    });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/seo\?$/),
        expect.any(Object),
      ),
    );
  });

  it("records an explicit page-change note without editing the source page", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Manage SEO" }));
    await user.click(screen.getByRole("menuitem", { name: "Record a change" }));
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("What changed?"),
      "Title update",
    );
    fireEvent.change(
      within(dialog).getByLabelText("When (device local time)"),
      { target: { value: "2026-01-01T13:00" } },
    );
    await user.type(
      within(dialog).getByLabelText("Details (optional)"),
      "Published in CMS",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record a change" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "record_page_change",
        body: {
          pageIds: workspace.scope.pageIds,
          occurredAt: new Date("2026-01-01T13:00"),
          title: "Title update",
          note: "Published in CMS",
          idempotencyKey: expect.any(String),
        },
      },
    });
  });

  it("shows newly synced Search Console metrics under the organic filter", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const measured = {
      ...workspace,
      metricsStatus: "available" as const,
      metrics: [
        {
          id: "clicks",
          key: "clicks",
          label: "Search clicks",
          unit: "count" as const,
          source: "search_console",
          propertyId: "sc-domain:example.com",
          channel: "organic" as const,
          value: 41,
          from: "2026-01-01",
          to: "2026-01-02",
          timeZone: "UTC",
          observedAt: new Date("2026-01-03T12:00:00Z"),
          coverage: "complete" as const,
          points: [],
          notes: [],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "https://web.test");
        if (url.pathname.endsWith("statistics/properties")) {
          const provider = url.searchParams.get("provider");
          return Response.json({
            provider,
            status: "available",
            reason: null,
            properties: [
              {
                id:
                  provider === "search_console"
                    ? "sc-domain:example.com"
                    : "properties/123",
                name: "Website property",
              },
            ],
          });
        }
        return Response.json(
          url.searchParams.get("channel") === "organic" ? measured : workspace,
        );
      }),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace, "?tab=traffic");
    await openStatisticsSetup(user);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Source" }));
    await user.click(screen.getByRole("option", { name: "Search Console" }));
    await user.click(
      await within(dialog).findByRole("combobox", { name: "Property" }),
    );
    await user.click(screen.getByRole("option", { name: "Website property" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Sync statistics" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "sync_statistics",
        body: expect.objectContaining({
          provider: "search_console",
          propertyId: "sc-domain:example.com",
          channel: "organic",
          scopeId: workspace.scope.id,
          expectedScopeVersion: 2,
        }),
      },
    });
    expect(await screen.findByText("41")).toBeVisible();
  });

  it("keeps connection management available when Google properties already exist", async () => {
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.includes("/api/seo/connections/")
            ? {
                provider: "ga4",
                name: "Google Analytics",
                status: "connected",
                source: "native",
              }
            : url.includes("/statistics/properties")
              ? {
                  provider: "ga4",
                  status: "available",
                  reason: null,
                  properties: [
                    { id: "properties/123", name: "Current Google account" },
                  ],
                }
              : workspace,
        ),
      ),
    );
    renderWorkspace(workspace);
    await openStatisticsSetup(userEvent);
    expect(
      await screen.findByRole("combobox", { name: "Property" }),
    ).toBeVisible();
    // The account is one line; its two actions are in the line's menu.
    await userEvent.click(
      await screen.findByRole("button", { name: "Google Analytics connected" }),
    );
    // The question opens above the statistics dialog; Escape closes the question only.
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Disconnect" }),
    );
    expect(await screen.findByRole("alertdialog")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("combobox", { name: "Property" })).toBeVisible();
  });

  it("opens embedded SEO chat without assistant setup, navigation, or a paid send", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      Response.json(url.endsWith("/chat") ? { turns: [] } : workspace),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace(workspace, `?pageId=${workspace.pages[0].id}&tab=rankings`);
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const panel = await screen.findByRole("dialog", {
      name: "Ask the SEO agent",
    });
    expect(within(panel).getByLabelText("Your question")).toBeVisible();
    expect(
      await within(panel).findByText("What would you like to improve?"),
    ).toBeVisible();
    expect(ensureRoom).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === `/api/seo/audits/${SEO_TEST_AUDIT}/chat`,
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
    expect(
      within(panel).queryByText(
        /inbox|calendar|personal project manager|Soko Bot/i,
      ),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Soko Bot|personal assistant/i }),
    ).toBeNull();
  });

  it("keeps a chat-proposed opportunity Task after a later Search Console sync", async () => {
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const opportunity = {
      id: "gsc:query:0123456789abcdef",
      observationId: crypto.randomUUID(),
      pageUrl: workspace.pages[0].url,
      findingIds: [],
      title: 'Review the search snippet for "battery health"',
      why: "This is a review suggestion, not a confirmed problem.",
      effort: "low" as const,
      expectedEffect: "No traffic change is promised.",
      edit: null,
      taskId: null,
      status: "recommended" as const,
      kind: "opportunity" as const,
      evidence: ["Heuristic: snippet review"],
    };
    workspace.actions = [opportunity];
    const history = {
      sharing: "personal",
      turns: [
        {
          id: crypto.randomUUID(),
          author: { id: "owner", name: "Sandro" },
          question: "What should I do first?",
          response: "Review the snippet.",
          status: "completed",
          // Proposed from the previous sync's observation.
          actions: [
            {
              kind: "task",
              observationId: crypto.randomUUID(),
              actionId: opportunity.id,
            },
          ],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/chat") ? history : workspace),
      ),
    );
    renderWorkspace(workspace);
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Open conversation" }));
    expect(
      await within(await screen.findByRole("dialog")).findByRole("button", {
        name: `Create draft task: ${opportunity.title}`,
      }),
    ).toBeVisible();
  });

  it("answers a question from the Agent tab in the chat sheet, and keeps the thread there on other tabs", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const turn = (question: string) => ({
      id: crypto.randomUUID(),
      question,
      response: `Answer to ${question}`,
      status: "completed",
      actions: [],
      scope: { pageIds: workspace.scope.pageIds },
      createdAt: new Date().toISOString(),
    });
    const turns = [turn("Earlier visit question")];
    const reads = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST") {
          reads();
          return Response.json({ sharing: "personal", turns });
        }
        const next = turn(JSON.parse(String(init.body)).question);
        turns.push(next);
        return Response.json(next);
      }),
    );
    renderWorkspace(workspace);
    // The Agent tab holds one field and no thread: nothing reads the chat yet.
    const bar = await screen.findByLabelText("Your question");
    expect(screen.queryByText("Earlier visit question")).toBeNull();
    expect(reads).not.toHaveBeenCalled();
    await user.type(bar, "New question");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Ask the SEO agent",
    });
    expect(
      await within(sheet).findByText("Answer to New question"),
    ).toBeVisible();
    expect(within(sheet).getByText("Earlier visit question")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Answer to New question")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Rankings" }));
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    expect(
      await within(await screen.findByRole("dialog")).findByText(
        "Answer to New question",
      ),
    ).toBeVisible();
  });

  it("offers a fix for a measured value outside a tool range as the primary step", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    // The check passed: the measured value is a suggestion, not an issue.
    workspace.observations.push({
      id: "check-description",
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    workspace.findings.push({
      id: "measured-description",
      observationId: "check-description",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "description-length",
      title: "Raw HTML: Meta description length",
      severity: "measure",
      evidence: [
        "meta description 163 characters",
        "vendor tools: Ahrefs under 160 (N1-247); Moz 55 to 300 (N1-279)",
      ],
      sourceRef: "html:description",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    const questions: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST")
          return Response.json({ sharing: "personal", turns: [] });
        questions.push(JSON.parse(String(init.body)).question);
        return Response.json({
          id: crypto.randomUUID(),
          question: questions.at(-1),
          response: "Draft",
          status: "completed",
          actions: [],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        });
      }),
    );
    renderWorkspace(workspace);
    expect(
      await screen.findByText(
        "Suggestion: Meta description length is 163 characters, outside the range of Ahrefs. The agent can draft a change for you to approve.",
      ),
    ).toBeVisible();
    // The verdict counts it as a suggestion, so a passed check does not read as broken.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          /^Last check .+ · 1 page$/.test(element.textContent ?? ""),
      ),
    ).toBeVisible();
    // Where a check can run, the header's run button is the one filled button.
    const draft = screen.getByRole("button", {
      name: "Draft a fix",
      description: /^Suggestion: Meta description length is 163 characters/,
    });
    expect(draft).not.toHaveClass("bg-primary");
    expect(screen.getByRole("button", { name: "Run full audit" })).toHaveClass(
      "bg-primary",
    );
    await user.click(draft);
    // The step asks in the chat sheet, where the answer shows.
    expect(
      await screen.findByRole("dialog", { name: "Ask the SEO agent" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(questions).toEqual([
        `The check measured “Meta description length” on ${workspace.pages[0].url} as 163 characters, outside the range of Ahrefs. Draft a change and suggest it as an action I can approve.`,
      ]),
    );
    cleanup();
    // With checks off, the agent's first step with a button is the filled one.
    // Without the agent chat the fix step has no button, so the next step has it.
    workspace.availableActions.canRequestAnalysis = false;
    workspace.availableActions.canUsePaidSearchData = false;
    renderWorkspace({ ...workspace, auditId: null });
    expect(
      await screen.findByText(/^Suggestion: Meta description length is 163/),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Draft a fix" })).toBeNull();
    const pagesStep = screen
      .getByText(/^This audit covers 1 page/)
      .closest("li");
    if (!pagesStep) throw new Error("Pages step missing");
    expect(
      within(pagesStep).getByRole("button", { name: "Add a page" }),
    ).toHaveClass("bg-primary");
    expect(
      screen.getByRole("button", { name: "Run page check" }),
    ).not.toHaveClass("bg-primary");
  });

  it("runs the widest check the workspace allows from the header", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/chat")
          ? Response.json({ sharing: "personal", turns: [] })
          : Response.json(workspace),
      ),
    );
    const checkType = () =>
      within(screen.getByRole("dialog")).getByRole("combobox", {
        name: "Check type",
      });
    // The setup card is on the Agent tab only: there its check step leads, on the other tabs the header does.
    renderWorkspace(workspace);
    expect(await screen.findByTestId("seo-setup")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run full audit" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Rankings" }));
    expect(
      await screen.findByRole("button", { name: "Run full audit" }),
    ).toHaveClass("bg-primary");
    cleanup();
    workspace.observations.push({
      id: "first-check",
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    for (const keyword of ["stablecoins", "stablecoin wallet"])
      workspace.keywords.push({
        id: keyword,
        keyword,
        countryCode: "DE",
        languageCode: "de",
        pageUrl: workspace.pages[0].url,
        targetPageId: workspace.pages[0].id,
        saved: true,
        priority: "medium",
        version: 1,
        source: "saved",
        volume: null,
        intent: null,
        device: null,
        position: null,
        positionStatus: "unavailable",
        checkedResults: null,
        observedAt: null,
        observationId: null,
      });
    renderWorkspace(workspace, "?tab=health");
    await user.click(
      await screen.findByRole("button", { name: "Run full audit" }),
    );
    expect(checkType()).toHaveTextContent("Full audit");
    // A full audit takes one keyword, so the form does not open on a list it would refuse.
    const keywords = () => screen.getByLabelText("Keywords, one per line");
    expect(keywords()).toHaveValue("stablecoins");
    // Another check type takes the whole saved list again.
    await user.click(checkType());
    await user.click(screen.getByRole("option", { name: "Keyword positions" }));
    expect(keywords()).toHaveValue("stablecoins\nstablecoin wallet");
    await user.click(checkType());
    await user.click(screen.getByRole("option", { name: "Full audit" }));
    expect(keywords()).toHaveValue("stablecoins");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    cleanup();
    // Without paid search data a full audit cannot run: the button names the page check.
    workspace.availableActions.canUsePaidSearchData = false;
    renderWorkspace(workspace, "?tab=traffic");
    await user.click(
      await screen.findByRole("button", { name: "Run page check" }),
    );
    expect(checkType()).toHaveTextContent("Page check");
    cleanup();
    // While a check runs the button says so, keeps its place and opens nothing.
    workspace.analyses = [
      {
        id: "8a0f4a39-7a55-4f0c-9a43-6c1a4f1f2b11",
        kind: "page_check",
        status: "running",
        taskId: null,
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        createdAt: new Date("2026-01-04T12:00:00Z"),
      },
    ];
    // Site health has one run control: the header's.
    renderWorkspace(workspace, "?tab=health");
    expect(
      await screen.findByRole("button", { name: "Check running" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run a check" })).toBeNull();
    cleanup();
    renderWorkspace(workspace, "?tab=rankings");
    const waiting = await screen.findByRole("button", {
      name: "Check running",
    });
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    expect(waiting).not.toHaveClass("bg-primary");
    expect(screen.queryByRole("button", { name: "Run page check" })).toBeNull();
    await user.click(waiting);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    // With checks off the button points to the notice that says why.
    workspace.analyses = [];
    workspace.availableActions.canRequestAnalysis = false;
    renderWorkspace(workspace, "?tab=rankings");
    const off = await screen.findByRole("button", { name: "Run page check" });
    expect(off).toHaveAccessibleDescription(messages.App.Seo.dispatchPaused);
    await user.click(off);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    // A reader who cannot edit has no run button, and no notice for it to point to.
    workspace.availableActions.canEdit = false;
    renderWorkspace(workspace, "?tab=rankings");
    expect(await screen.findByRole("tab", { name: "Rankings" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run page check" })).toBeNull();
  });

  it("sends a question asked before the session loads once the session is there", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const turns: Array<Record<string, unknown>> = [];
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST")
          return Response.json({ sharing: "personal", turns });
        const question = JSON.parse(String(init.body)).question;
        posts.push(question);
        turns.push({
          id: crypto.randomUUID(),
          question,
          response: "Late answer",
          status: "completed",
          actions: [],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        });
        return Response.json(turns[0]);
      }),
    );
    viewer.userId = null;
    const view = renderWorkspace(workspace, "", false, 60_000);
    await user.type(
      screen.getByLabelText("Your question"),
      "Early question{Enter}",
    );
    await screen.findByRole("dialog", { name: "Ask the SEO agent" });
    expect(posts).toEqual([]);
    // The chat starts again for the viewer who signed in: the question is still there to send.
    viewer.userId = "owner";
    view.refreshViewer();
    expect(
      await within(await screen.findByRole("dialog")).findByText("Late answer"),
    ).toBeVisible();
    expect(posts).toEqual(["Early question"]);
  });

  it("keeps an answer asked in the chat sheet on another tab in reach from the Agent tab", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const turns: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST")
          return Response.json({ sharing: "personal", turns });
        const question = JSON.parse(String(init.body)).question;
        const next = {
          id: crypto.randomUUID(),
          question,
          response: `Answer to ${question}`,
          status: "completed",
          actions: [],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        };
        turns.push(next);
        return Response.json(next);
      }),
    );
    renderWorkspace(workspace, "tab=actions");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByText(messages.App.Seo.chat.empty);
    await user.type(
      within(sheet).getByLabelText("Your question"),
      "Sheet question",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Send question" }),
    );
    expect(
      await within(sheet).findByText("Answer to Sheet question"),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    await user.click(
      await screen.findByRole("button", { name: "Open conversation" }),
    );
    expect(
      await within(await screen.findByRole("dialog")).findByText(
        "Answer to Sheet question",
      ),
    ).toBeVisible();
  });

  it("keeps an answer in view when the question is sent before chat history loads", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const turn = {
      id: crypto.randomUUID(),
      question: "Early question",
      response: "Answer before history loaded",
      status: "completed",
      actions: [],
      scope: { pageIds: workspace.scope.pageIds },
      createdAt: new Date().toISOString(),
    };
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method === "POST") return Response.json(turn);
        // The first history read never answers; the read after the send returns the new turn.
        reads += 1;
        if (reads === 1) return new Promise<Response>(() => {});
        return Response.json({ sharing: "personal", turns: [turn] });
      }),
    );
    renderWorkspace(workspace);
    await user.type(
      await screen.findByLabelText("Your question"),
      "Early question",
    );
    await user.click(screen.getByRole("button", { name: "Send question" }));
    expect(
      await screen.findByText("Answer before history loaded"),
    ).toBeVisible();
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    expect(screen.getByText("Answer before history loaded")).toBeVisible();
  });

  it("identifies a shared organization conversation and its member author", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
      sharing: "organization" as const,
    };
    const history = {
      sharing: "organization",
      turns: [
        {
          id: crypto.randomUUID(),
          author: { id: "another-member", name: "Alex" },
          question: "Which pages need attention?",
          response: "The saved audit has no measured results yet.",
          status: "completed",
          actions: [],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        },
      ],
    };
    history.turns.push({
      ...history.turns[0],
      id: crypto.randomUUID(),
      author: { id: "owner", name: "Sandro" },
      question: "Which source should I connect?",
      response: "Connect Search Console to read search measurements.",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/chat") ? history : workspace),
      ),
    );
    renderWorkspace(workspace, "tab=rankings");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const panel = await screen.findByRole("dialog", {
      name: "Ask the SEO agent",
    });
    await within(panel).findByText(history.turns[0].response);
    expect(within(panel).getByText("Alex")).toBeVisible();
    expect(within(panel).getByText("You")).toBeVisible();
    expect(
      within(panel).getByText("Shared in your organization"),
    ).toBeVisible();
    expect(
      within(panel).getByRole("textbox", { name: "Your question" }),
    ).toHaveAccessibleDescription(
      "This conversation and saved statistics are shared within this audit in your organization.",
    );
    expect(within(panel).queryByText(/visible only to you/)).toBeNull();
  });

  it("opens a saved link to an old tab on the tab that now holds its content", async () => {
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=keywords");
    expect(
      await screen.findByRole("tab", { name: "Rankings", selected: true }),
    ).toBeVisible();
  });

  it("shows the site audit's keyword result on the Agent tab and its strategy actions as a step", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    workspace.actions = [];
    workspace.observations = [
      {
        id: seoTestStrategy().observationId,
        kind: "audit_full",
        source: "seo_coworker",
        observedAt: new Date("2026-11-11T00:26:00Z"),
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
        countryCode: "US",
        languageCode: "en",
        devices: ["mobile", "desktop"],
        rulebookVersion: "html-v1",
        artifactHash: "checked-html",
        issues: 0,
        coverage: { checked: 12, skipped: 0, failed: 0 },
      },
    ];
    workspace.strategy = seoTestStrategy();
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method === "POST") asked.push(String(init.body));
        return Response.json({ turns: [] });
      }),
    );
    renderWorkspace(workspace);
    expect(await screen.findByTestId("seo-agent-strategy")).toHaveTextContent(
      "Keyword strategy: Keep these keywords: the site can reach at least half of their searches",
    );
    expect(
      screen.getByText(
        "The site audit recommends 2 actions from the keyword strategy. The first: Ask to be added to these lists of products.",
      ),
    ).toBeVisible();
    // The step opens a list and has no end, so it never takes the filled style.
    expect(
      screen.getByRole("button", { name: "View these actions" }),
    ).not.toHaveClass("bg-primary");
    // The Audit has no page action; the strategy actions alone show the tab.
    expect(screen.getByRole("tab", { name: "Actions" })).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "View these actions" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Actions from the keyword strategy",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "The site audit recommends these from the search results for your keywords. Each one needs a plan, so the button puts a question to the SEO agent in the chat.",
      ),
    ).toBeVisible();
    // "No recommended actions" above these cards would say two things at once.
    expect(screen.queryByRole("heading", { name: "Actions" })).toBeNull();
    expect(screen.queryByText("No recommended actions")).toBeNull();
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const card = screen
      .getByRole("heading", {
        name: "Ask to be added to these lists of products",
      })
      .closest("article");
    if (!card) throw new Error("no card");
    expect(within(card).getByText("Effort: Medium")).toBeVisible();
    expect(within(card).getByText("On another site")).toBeVisible();
    // An action on the site's own pages says so.
    const page = screen
      .getByRole("heading", { name: /Write a comparison page/ })
      .closest("article");
    if (!page) throw new Error("no page card");
    expect(within(page).getByText("New page")).toBeVisible();
    expect(within(page).queryByText("Limit")).toBeNull();
    // Both buttons have one name; each card's title tells them apart.
    expect(
      within(page).getByRole("button", { name: "Draft a plan" }),
    ).toHaveAccessibleDescription(
      "Write a comparison page for “battery app alternative”",
    );
    expect(
      within(card).getByText("Ask on the product's merits only."),
    ).toBeVisible();
    const list = within(card).getByRole("link", { name: "Best battery apps" });
    expect(list).toHaveAttribute("href", "https://lists.example/best");
    expect(list.closest("li")).toHaveTextContent(
      "List of products · Does not name the product",
    );
    // A type and a state without a label add no note.
    expect(
      within(card)
        .getByRole("link", { name: "https://other.example/page" })
        .closest("li"),
    ).not.toHaveTextContent("·");
    // An action without a limit and without places asks for neither.
    await user.click(
      within(page).getByRole("button", { name: "Draft a plan" }),
    );
    expect(
      within(await screen.findByRole("dialog")).getByLabelText("Your question"),
    ).toHaveValue(
      "The site audit recommends: “Write a comparison page for “battery app alternative””. Draft a plan with the steps in order.",
    );
    await user.keyboard("{Escape}");
    await user.click(
      within(card).getByRole("button", { name: "Draft a plan" }),
    );
    // The limit goes with the question: the agent may not have this action in its evidence.
    // The chat field keeps the question that was not sent, and the new one follows it.
    expect(
      within(await screen.findByRole("dialog")).getByLabelText("Your question"),
    ).toHaveValue(
      "The site audit recommends: “Write a comparison page for “battery app alternative””. Draft a plan with the steps in order.\n\nThe site audit recommends: “Ask to be added to these lists of products”. Draft a plan with the steps in order. Keep to this limit: Ask on the product's merits only. The places: https://lists.example/best and https://other.example/page",
    );
    expect(asked).toEqual([]);
  });

  it("leaves the filled button to the next step with work when the strategy step comes first", async () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    workspace.strategy = seoTestStrategy();
    workspace.observations = [
      {
        id: seoTestStrategy().observationId,
        kind: "audit_full",
        source: "seo_coworker",
        observedAt: new Date("2026-11-11T00:26:00Z"),
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        sourceTaskId: null,
        countryCode: "US",
        languageCode: "en",
        devices: ["mobile"],
        rulebookVersion: "html-v1",
        artifactHash: "checked-html",
        issues: 0,
        coverage: { checked: 12, skipped: 0, failed: 0 },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(
      await screen.findByRole("button", { name: "View these actions" }),
    ).not.toHaveClass("bg-primary");
    const pagesStep = screen
      .getByText(/^This audit covers 1 page/)
      .closest("li");
    if (!pagesStep) throw new Error("Pages step missing");
    expect(
      within(pagesStep).getByRole("button", { name: "Add a page" }),
    ).toHaveClass("bg-primary");
  });

  it("shows the Actions tab only once the Audit has actions", async () => {
    const workspace = seoTestWorkspace();
    workspace.actions = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(await screen.findByRole("tab", { name: "Agent" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Rankings" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Actions" })).toBeNull();
  });

  it("hides labels, notes and filters that cannot change anything without paid data", async () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canUsePaidSearchData = false;
    workspace.keywords.push({
      id: "saved-keyword",
      keyword: "Stablecoins",
      countryCode: "DE",
      languageCode: "de",
      pageUrl: workspace.pages[0].url,
      targetPageId: workspace.pages[0].id,
      saved: true,
      priority: "medium",
      version: 1,
      source: "saved",
      volume: null,
      intent: null,
      device: null,
      position: null,
      positionStatus: "unavailable",
      checkedResults: null,
      observedAt: null,
      observationId: null,
    });
    workspace.competitors.push({
      id: "rival",
      url: "https://rival.example/",
      role: "competitor",
      confirmed: true,
      source: "saved",
      rank: null,
      backlinks: null,
      referringDomains: null,
      observedAt: null,
      observationId: null,
      version: 1,
      canConfirm: true,
      exclusionReason: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=rankings");
    expect(await screen.findByText("Stablecoins")).toBeVisible();
    // Every row is tracked, paid columns can never fill, and no Analytics data exists.
    expect(screen.queryByText("Tracked")).toBeNull();
    expect(screen.queryByText(/Search volume/)).toBeNull();
    expect(screen.queryByText(/Tracking a keyword is free/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Traffic" })).toBeNull();
    // A competitor without numbers says why, instead of a bare URL.
    expect(
      screen.getByText(
        "Rank and backlink numbers need paid search data, which is off in this workspace.",
      ),
    ).toBeVisible();
  });

  it("explains organization statistics sharing before a sync", async () => {
    const workspace = {
      ...seoTestWorkspace(),
      sharing: "organization" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.includes("/statistics/properties")
            ? {
                provider: "ga4",
                status: "not_connected",
                reason: null,
                properties: [],
              }
            : workspace,
        ),
      ),
    );
    renderWorkspace(workspace);
    await openStatisticsSetup(userEvent);
    const dialog = await screen.findByRole("dialog", {
      name: "Sync statistics",
    });
    expect(
      within(dialog).getByText(
        "Saved statistics are shared within this audit in your organization. Your Google account stays under your control.",
      ),
    ).toBeVisible();
  });

  it("keeps personal workspace chat privacy explicit", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      sharing: "personal" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith("/chat")
            ? { sharing: "personal", turns: [] }
            : workspace,
        ),
      ),
    );
    renderWorkspace(workspace, "?tab=rankings");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    expect(
      await screen.findByText("Only you can read this chat"),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Your question" }),
    ).toHaveAccessibleDescription(
      "This conversation and your connected statistics are visible only to you.",
    );
    expect(screen.queryByText(/shared within this audit/)).toBeNull();
  });

  it("does not retain another viewer's private unsent SEO question", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/chat") ? { turns: [] } : workspace),
      ),
    );
    const view = renderWorkspace(workspace, "?tab=rankings");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    await user.type(
      screen.getByLabelText("Your question"),
      "Private launch budget",
    );
    viewer.userId = "another-owner";
    view.refreshViewer();
    await waitFor(() =>
      expect(screen.getByLabelText("Your question")).not.toHaveValue(
        "Private launch budget",
      ),
    );
  });

  it.each(["resolves", "rejects"] as const)(
    "does not fetch the next viewer's private history into an old viewer's cache when a pending send %s",
    async (settlement) => {
      const user = userEvent.setup();
      const workspace = {
        ...seoTestWorkspace(),
        auditId: SEO_TEST_AUDIT,
        auditName: "Launch pages",
      };
      const turn = (question: string) => ({
        id: crypto.randomUUID(),
        question,
        status: "completed" as const,
        response: `${question} reply`,
        actions: [],
        scope: { pageIds: workspace.scope.pageIds },
        createdAt: new Date().toISOString(),
      });
      const oldHistory = { turns: [turn("Owner private history")] };
      const nextHistory = { turns: [turn("Next viewer private history")] };
      const chatReads: string[] = [];
      let resolvePost: (response: Response) => void = () => {};
      let rejectPost: (error: Error) => void = () => {};
      const pendingPost = new Promise<Response>((resolve, reject) => {
        resolvePost = resolve;
        rejectPost = reject;
      });
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method === "POST") return pendingPost;
        chatReads.push(viewer.userId ?? "");
        return Response.json(
          viewer.userId === "owner" ? oldHistory : nextHistory,
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const view = renderWorkspace(workspace, "?tab=rankings");
      await user.click(
        screen.getByRole("button", { name: "Ask the SEO agent" }),
      );
      await screen.findByText("Owner private history reply");
      await user.type(
        screen.getByLabelText("Your question"),
        "Pending question",
      );
      await user.click(screen.getByRole("button", { name: "Send question" }));
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(1);

      viewer.userId = "another-owner";
      view.refreshViewer();
      await screen.findByText("Next viewer private history reply");
      const oldKey = ["seo-chat", "org", "owner", SEO_TEST_AUDIT];
      expect(view.client.getQueryData(oldKey)).toEqual(oldHistory);
      const oldCacheQuestions: string[] = [];
      const unsubscribe = view.client.getQueryCache().subscribe(() => {
        oldCacheQuestions.push(
          ...(
            view.client.getQueryData<SeoAuditChatHistory>(oldKey)?.turns ?? []
          ).map((item) => item.question),
        );
      });
      const readsBeforeSettlement = [...chatReads];
      await act(async () => {
        if (settlement === "resolves")
          resolvePost(Response.json(turn("Pending question")));
        else rejectPost(new Error("Request failed after viewer switch"));
        await pendingPost.catch(() => null);
      });
      unsubscribe();

      expect(oldCacheQuestions).not.toContain("Next viewer private history");
      expect(view.client.getQueryData(oldKey)).toEqual(oldHistory);
      expect(chatReads).toEqual(readsBeforeSettlement);
      expect(
        screen.getByText("Next viewer private history reply"),
      ).toBeVisible();
    },
  );

  it("starts a fresh turn when the same scoped question is asked after a completed reply", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const requests = nativeChatNetwork(workspace);
    renderWorkspace(workspace, `?pageId=${workspace.pages[0].id}&tab=rankings`);
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const question = screen.getByLabelText("Your question");
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(question).toHaveValue(""));
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
    expect(requests[1].scope).toEqual({ pageId: workspace.pages[0].id });
  });

  it("keeps the attempt key when retrying an uncertain network response", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const requests = nativeChatNetwork(workspace, { uncertainFirst: true });
    renderWorkspace(workspace, "?tab=rankings");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const question = screen.getByLabelText("Your question");
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await screen.findAllByRole("alert");
    expect(question).toHaveValue("What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].idempotencyKey).toBe(requests[0].idempotencyKey);
  });

  it("keeps a failed acknowledged question and gives its explicit retry a fresh attempt key", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const requests = nativeChatNetwork(workspace, { failedFirst: true });
    renderWorkspace(workspace, "?tab=rankings");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const question = screen.getByLabelText("Your question");
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await screen.findAllByRole("alert");
    expect(question).toHaveValue("What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
  });

  it("gives the filled button to the first step once a result waits, with the step's reasons in its details", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const observedAt = new Date("2026-01-03T12:00:00Z");
    workspace.observations.push({
      id: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      kind: "audit_full",
      source: "seo_coworker",
      observedAt,
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile", "desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    workspace.actions.push({
      id: "action-row",
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      findingIds: [],
      title: "Fix the page title",
      why: "The title is missing",
      effort: "low",
      expectedEffect: "A descriptive search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    });
    const read = {
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      volume: null,
      intent: null,
      device: "mobile",
      checkedResults: 20,
      observedAt,
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    } as const;
    workspace.keywords.push(
      {
        ...read,
        id: "found",
        keyword: "battery app",
        position: 4,
        positionStatus: "ranked",
      },
      {
        ...read,
        id: "missing",
        keyword: "charge timer",
        position: null,
        positionStatus: "not_in_range",
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    const create = await screen.findByRole("button", {
      name: "Create draft task",
    });
    expect(create).toHaveClass("bg-primary");
    // The run button stays usable; it only gives up the filled style.
    const run = screen.getByRole("button", { name: "Run full audit" });
    expect(run).not.toHaveClass("bg-primary");
    expect(run).not.toHaveAttribute("aria-disabled");
    // The position result sits next to the health result.
    expect(screen.getByTestId("seo-summary-keywords")).toHaveTextContent(
      "1 of 21 on the first pageOpen rankings",
    );
    expect(screen.getByText("The title is missing")).not.toBeVisible();
    await user.click(screen.getByText("Why, and the evidence"));
    expect(screen.getByText("The title is missing")).toBeVisible();
    expect(screen.getByText("A descriptive search result")).toBeVisible();
    // The Actions tab is the full list of the same cards: the reasons stay closed, and no card takes the filled style.
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    expect(await screen.findByText("The title is missing")).not.toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create draft task" }),
    ).not.toHaveClass("bg-primary");
  });

  it("creates one draft action Task with its source references and guards repeated clicks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.actions.push({
      id: "action-row",
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      findingIds: ["finding"],
      title: "Fix the page title",
      why: "The title is missing",
      effort: "low",
      expectedEffect: "A descriptive search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    let resolve: (value: unknown) => void = () => {};
    mutate.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderWorkspace(workspace, "?tab=actions");
    await user.dblClick(
      screen.getByRole("button", { name: "Create draft task" }),
    );
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "create_action_task",
        body: {
          observationId: workspace.actions[0].observationId,
          actionId: "action-row",
          idempotencyKey: expect.any(String),
        },
      },
    });
    await act(async () => {
      resolve({ ok: true, value: null });
    });
  });

  it("shows the last check as numbers on the Agent and Health tabs, and one Rankings list at a time on a phone", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const observedAt = new Date("2026-01-03T12:00:00Z");
    const observationId = "b5efedab-c394-4ce9-a089-0979e8a18fdb";
    workspace.observations.push({
      id: observationId,
      kind: "audit_full",
      source: "seo_coworker",
      observedAt,
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile", "desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 2,
      coverage: { checked: 201, skipped: 30, failed: 0 },
    });
    const failed = {
      observationId,
      pageUrl: workspace.pages[0].url,
      evidence: [],
      sourceRef: "html:head",
      observedAt,
    };
    workspace.findings.push(
      // One rule on both devices is one major issue.
      {
        ...failed,
        id: "markup-mobile",
        device: "mobile",
        rowId: "SD-06",
        title: "Markup matches the visible page",
        severity: "major",
      },
      {
        ...failed,
        id: "markup-desktop",
        device: "desktop",
        rowId: "SD-06",
        title: "Markup matches the visible page",
        severity: "major",
      },
      {
        ...failed,
        id: "alt",
        device: "desktop",
        rowId: "P-06",
        title: "Images have alt text",
        severity: "minor",
      },
    );
    const read = {
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      device: "mobile",
      checkedResults: 20,
      observedAt,
      observationId,
    } as const;
    workspace.keywords.push(
      {
        ...read,
        id: "found",
        keyword: "battery app",
        position: 4,
        positionStatus: "ranked",
        volume: 720,
        intent: "commercial",
      },
      {
        ...read,
        id: "missing",
        keyword: "charge timer",
        position: null,
        positionStatus: "not_in_range",
        volume: 90,
        intent: null,
      },
      {
        ...read,
        id: "idea",
        keyword: "battery widget",
        source: "gap",
        position: null,
        positionStatus: "unavailable",
        checkedResults: null,
        volume: 50,
        intent: null,
      },
    );
    workspace.competitors.push({
      id: "rival",
      url: "https://rival.example/",
      role: "competitor",
      confirmed: false,
      source: "search",
      rank: 1,
      backlinks: null,
      referringDomains: 10,
      observedAt,
      observationId,
      version: 0,
      canConfirm: true,
      exclusionReason: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    const issues = await screen.findByTestId("seo-summary-issues");
    expect(issues).toHaveTextContent(/^2/);
    expect(within(issues).getByText("1 major")).toBeVisible();
    expect(within(issues).getByText("1 minor")).toBeVisible();
    // Tests without a result are part of the total, not hidden.
    const tests = screen.getByTestId("seo-summary-tests");
    expect(tests).toHaveTextContent("201 of 231");
    expect(within(tests).getByText("30 tests gave no result")).toBeVisible();
    expect(screen.getByTestId("seo-summary-keywords")).toHaveTextContent(
      "1 of 2",
    );
    const searches = screen.getByTestId("seo-summary-searches");
    expect(searches).toHaveTextContent("810");
    expect(
      within(searches).getByText("For the 2 checked keywords"),
    ).toBeVisible();
    // The line above the tiles dates the check here.
    expect(tests).not.toHaveTextContent("Last check");
    // The same numbers lead the Health tab.
    await user.click(screen.getByRole("tab", { name: "Health" }));
    expect(screen.getByTestId("seo-summary-tests")).toHaveTextContent(
      "201 of 231",
    );
    // Health has no such line, and its issues can come from older checks: the tile dates its check.
    expect(screen.getByTestId("seo-summary-tests")).toHaveTextContent(
      "Last check Jan 3, 2026",
    );
    await user.click(
      within(screen.getByTestId("seo-summary-keywords")).getByRole("button", {
        name: "Open rankings",
      }),
    );
    expect(screen.getByRole("tab", { name: "Rankings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // One keyword is found, so the Position column shows.
    expect(screen.getByText("Not found")).toBeVisible();
    // A keyword without an intent has an empty cell, counted once under the table.
    // The one idea has no intent either, so its table has no Intent column and no such line.
    expect(screen.queryByText("Not available")).toBeNull();
    expect(
      screen.getByText("The keyword data gives no intent for 1 keyword."),
    ).toBeVisible();
    // On a phone one list shows at a time; a wide screen shows all three.
    const part = (name: string | RegExp) =>
      screen.getByRole("heading", { name }).closest("section")?.parentElement;
    expect(part("Keywords")).not.toHaveClass("max-sm:hidden");
    expect(part(/^Keyword ideas/)).toHaveClass("max-sm:hidden");
    expect(part("Competitors")).toHaveClass("max-sm:hidden");
    const competitors = screen.getByRole("button", { name: "Competitors" });
    expect(competitors).toHaveAttribute("aria-pressed", "false");
    await user.click(competitors);
    expect(competitors).toHaveAttribute("aria-pressed", "true");
    expect(part("Competitors")).not.toHaveClass("max-sm:hidden");
    expect(part("Keywords")).toHaveClass("max-sm:hidden");
    await user.click(screen.getByRole("button", { name: "Ideas" }));
    expect(part(/^Keyword ideas/)).not.toHaveClass("max-sm:hidden");
    expect(part("Competitors")).toHaveClass("max-sm:hidden");
    // The last idea leaves the list (the reader tracked it): the keywords show, not an empty tab.
    const client = clients.at(-1);
    const queries =
      client
        ?.getQueryCache()
        .getAll()
        .filter(({ queryKey }) => queryKey[0] === "seo-workspace") ?? [];
    if (!client || !queries.length) throw new Error("Workspace query missing");
    await act(async () => {
      for (const { queryKey } of queries)
        client.setQueryData(queryKey, {
          ...workspace,
          keywords: workspace.keywords.filter((row) => row.id !== "idea"),
        });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ideas" })).toBeNull(),
    );
    expect(part("Keywords")).not.toHaveClass("max-sm:hidden");
    expect(screen.getByRole("button", { name: "Keywords" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers a saved page selection from three pages on", () => {
    const workspace = seoTestWorkspace();
    workspace.scopes = [];
    workspace.pages.push({
      ...workspace.pages[0],
      id: "a658c5bb-3084-4b26-81ee-b3208ee5ab61",
      url: "https://example.com/pricing",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    // With two pages a selection is one page or both, and the page picker offers each.
    const pages = screen
      .getByRole("heading", { name: "Pages" })
      .closest("section");
    if (!pages) throw new Error("Pages card missing");
    expect(
      within(pages).queryByRole("button", { name: "Save page selection" }),
    ).toBeNull();
    expect(
      within(pages).getByRole("button", { name: "Add a page" }),
    ).toBeVisible();
  });
});
