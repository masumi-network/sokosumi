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
  openCheckOptions,
  openStatisticsSetup,
  SEO_TEST_AUDIT,
  SEO_TEST_PROJECT,
  seoTestCheckedAudit,
  seoTestMetric,
  seoTestObservation,
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
    expect(screen.getByTestId("seo-summary-tests")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      "No issues found in the last check",
    );
    await user.click(screen.getByRole("tab", { name: "Traffic" }));
    await user.click(
      screen.getAllByRole("button", { name: "Set up statistics" })[0],
    );
    // No account yet: the dialog is the connect step.
    expect(
      await screen.findByRole("dialog", { name: "Set up statistics" }),
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
      // The row drops the source prefix, like the other lists of checks.
      title: "Raw HTML: The page has no description",
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
    expect(
      screen.getByRole("heading", {
        name: "Not passed: The page has no description",
      }),
    ).toBeVisible();
    // No action fixes this issue, so no link promises a fix.
    expect(
      screen.queryByRole("button", { name: /^Fix: |^See the fix$/ }),
    ).toBeNull();
    const evidence = screen.getByText(
      "Raw HTML evidence: no meta description element.",
    );
    expect(evidence).not.toBeVisible();
    // The row is the switch: it opens the evidence of its issue.
    await user.click(
      screen.getByRole("heading", {
        name: "Not passed: The page has no description",
      }),
    );
    expect(evidence).toBeVisible();
  });

  it("shows an issue with a fix once, as the card of its fix, on the tab an old Health link opens", async () => {
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
      evidence: ["The markup says 6.99, the page shows 9.99. (prices in USD)"],
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
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The fix card names the check: an issue row over it would say the same thing twice.
    expect(
      screen.queryByRole("heading", {
        name: "Not passed: Markup matches the visible page",
      }),
    ).toBeNull();
    const card = screen
      .getByRole("heading", { name: /^Make the markup price match the page/ })
      .closest("article");
    // An open card holds its labels twice, and the style sheet shows one: in the head on a wide screen,
    // under the page link on a phone (the order of a closed row: title, page, labels). No style sheet here.
    const [headLabel, bodyLabel] = within(card!).getAllByText("High impact");
    expect(headLabel.parentElement).toHaveClass("max-sm:hidden");
    expect(bodyLabel.parentElement).toHaveClass("sm:hidden");
    expect(within(card!).getAllByText("High impact")).toHaveLength(2);
    // What the check found is in view; the reasons and the effect of the fix stay closed.
    // The line alone can be a bare count, so the name of its check goes with it.
    expect(
      within(card!).getByText(
        "Not passed: Markup matches the visible page. Found: The markup says 6.99, the page shows 9.99.",
      ),
    ).toBeVisible();
    // The rule's footnote is on the card too; the open card shows it.
    expect(within(card!).getByText("(prices in USD)")).toBeInTheDocument();
    expect(
      within(card!).getByText("Expected effect: One price."),
    ).not.toBeVisible();
    expect(within(card!).getByText("The two prices differ.")).not.toBeVisible();
  });

  it("puts the numbers before the steps, offers the agent only with an Audit, and names a page of the site by its path", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const observationId = "962a86bb-5702-4d64-a6c4-15be5bf8ed80";
    const guide = "https://example.com/guides/a";
    workspace.findings.push({
      id: "price",
      observationId,
      pageUrl: guide,
      device: "mobile",
      rowId: "SD-08",
      title: "Markup matches the visible page",
      severity: "major",
      evidence: ["The markup says 6.99, the page shows 9.99."],
      sourceRef: "html:head",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    workspace.actions.push({
      id: "fix-price",
      observationId,
      pageUrl: guide,
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
    workspace.actions.push({
      ...workspace.actions.at(-1)!,
      id: "fix-price-2",
      title: "Show one price in the markup",
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
      device: "mobile",
      checkedResults: 18,
      observedAt: new Date("2026-01-03T12:00:00Z"),
      observationId,
      position: null,
      positionStatus: "not_in_range",
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    } as const;
    workspace.keywords.push(
      { ...read, id: "small", keyword: "charge timer", volume: 90 },
      { ...read, id: "large", keyword: "battery app", volume: 720 },
    );
    let served: ProjectSeoWorkspace = workspace;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith("/chat") ? { sharing: "personal", turns: [] } : served,
        ),
      ),
    );
    // A saved check: the result card leads, not the setup card.
    workspace.observations.push({
      id: observationId,
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 1,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    // A phone gets the same order as a wide screen.
    vi.stubGlobal("innerWidth", 375);
    renderWorkspace(workspace);
    // Without an Audit there is no agent to write to: no button offers one.
    expect(
      screen.queryByRole("button", { name: "Ask the SEO agent" }),
    ).toBeNull();
    // The numbers are a block of their own, between the result and the steps.
    const verdict = screen.getByTestId("seo-agent-verdict");
    const tiles = screen.getByTestId("seo-summary-tiles");
    expect(verdict.parentElement).not.toContainElement(tiles);
    expect(
      verdict.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      tiles.compareDocumentPosition(
        screen.getByText("Make the markup price match the page"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    cleanup();
    // With an Audit one floating button leads to the agent. The page itself has no question field.
    served = { ...workspace, auditId: SEO_TEST_AUDIT };
    renderWorkspace(served);
    expect(
      screen.getAllByRole("button", { name: "Ask the SEO agent" }),
    ).toHaveLength(1);
    expect(screen.queryByLabelText("Your question")).toBeNull();
    // The page of the fix is a page of the site: its path, with the address as the link's name.
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    const card = screen
      .getByRole("heading", { name: /^Make the markup price match the page/ })
      .closest("article");
    expect(within(card!).getByRole("link", { name: guide })).toHaveTextContent(
      /^\/guides\/a$/,
    );
    // Without its fix the issue has a row of its own under the cards.
    cleanup();
    served = { ...served, actions: [] };
    renderWorkspace(served, "?tab=actions");
    // One device says something; the page is its own part, so the open row can leave it to the link.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "SPAN" &&
          element.textContent === "Mobile · /guides/a",
      ),
    ).toBeVisible();
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
    expect(screen.getByText("2 notes")).toBeInTheDocument();
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
      /1 suggestion\s*·\s*2 notes$/,
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
    expect(
      screen.getAllByRole("button", { name: "Ask the agent for a fix" }),
    ).toHaveLength(1);
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
        name: "Ask the agent for a fix",
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
    const fixes = screen.getAllByRole("button", {
      name: "Ask the agent for a fix",
    });
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
      within(details).queryAllByRole("link", { name: /View results/ }),
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
        .getAllByRole("link", { name: /View results$/ })
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

  it("offers quick periods where dates narrow the view, not on Traffic", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const traffic = renderWorkspace(workspace, "?tab=traffic&from=2026-01-01");
    expect(screen.getByLabelText("Activity from")).toBeVisible();
    expect(screen.queryByRole("group", { name: "Quick periods" })).toBeNull();
    traffic.unmount();
    renderWorkspace(workspace, "?tab=health&from=2026-01-01");
    expect(screen.getByRole("group", { name: "Quick periods" })).toBeVisible();
  });

  it("puts the runs on a timeline, newest on the right, with the date filter beside its title", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    const run = (observedAt: string, issues: number) => ({
      observationId: crypto.randomUUID(),
      kind: "audit_full",
      observedAt: new Date(observedAt),
      issues,
      seconds: 600,
    });
    workspace.runs = [
      run("2026-11-12T13:00:00Z", 5),
      run("2026-11-10T09:00:00Z", 6),
      run("2026-10-28T08:00:00Z", 7),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const runs = screen.getByRole("group", { name: "Checks" });
    expect(
      within(runs)
        .getAllByRole("button", { pressed: undefined })
        .map((button) => button.textContent),
    ).toEqual([
      "Other dates",
      "Oct 287 issues",
      "Nov 106 issues",
      "Nov 125 issues",
    ]);
    // The timeline holds the one date filter: the header and the filter block have none.
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    const dates = within(runs).getByRole("button", { name: "Other dates" });
    await user.click(dates);
    // A calendar under the stop, on the month of the first check, with the days of a check marked in words too.
    const calendar = await screen.findByRole("dialog");
    expect(within(calendar).getByText("October 2026")).toBeVisible();
    within(calendar).getByRole("button", {
      name: /October 28th, 2026, Day with a check/,
    });
    expect(
      within(calendar).getByRole("button", { name: /October 29th, 2026$/ }),
    ).toBeEnabled();
    // Before the first check no day can show a check: it is no choice.
    expect(
      within(calendar).getByRole("button", { name: /October 27th, 2026$/ }),
    ).toBeDisabled();
    // Two presses set the range and close the calendar; the line says what is in view, with the way back.
    await user.click(
      within(calendar).getByRole("button", { name: /October 28th, 2026/ }),
    );
    await user.click(
      within(calendar).getByRole("button", { name: /October 30th, 2026/ }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/Showing Oct 28.+30\./)).toBeVisible();
    expect(dates).toHaveAttribute("data-active", "true");
    // Open again on a set range, a press starts a new range: it does not stretch the old one and close.
    await user.click(dates);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /October 31st, 2026/,
      }),
    );
    expect(await screen.findByText(/Showing Oct 31\./)).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Show the latest" }));
    await waitFor(() => expect(screen.queryByText(/Showing/)).toBeNull());
    expect(dates).toHaveAttribute("data-active", "false");
    // "Other dates" stands apart from the line of checks: on it, it read as a check still to come.
    expect(
      within(within(runs).getByRole("list")).queryByRole("button", {
        name: "Other dates",
      }),
    ).toBeNull();
    // With no range, the calendar boxes the day the page shows: a picked check, not the newest and not today.
    await user.click(within(runs).getByRole("button", { name: /^Nov 10/ }));
    await user.click(dates);
    const picked = await screen.findByRole("dialog");
    expect(
      within(picked)
        .getByRole("button", { name: /November 10th, 2026, Day with a check/ })
        .closest("td"),
    ).toHaveClass("bg-accent");
    // The focus starts on that day, so the ring and the box mark one day.
    expect(
      within(picked).getByRole("button", {
        name: /November 10th, 2026, Day with a check/,
      }),
    ).toHaveFocus();
    expect(
      within(picked)
        .getByRole("button", { name: /November 12th, 2026, Day with a check/ })
        .closest("td"),
    ).not.toHaveClass("bg-accent");
    await user.keyboard("{Escape}");
    // The stop stands on every tab, also where dates narrow nothing.
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    expect(
      within(screen.getByRole("group", { name: "Checks" })).getByRole(
        "button",
        { name: "Other dates" },
      ),
    ).toBeEnabled();
  });

  it("shows a day's issue count only where it changed from the day before", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    const run = (observedAt: string, issues: number) => ({
      observationId: crypto.randomUUID(),
      kind: "audit_full",
      observedAt: new Date(observedAt),
      issues,
      seconds: 600,
    });
    workspace.runs = [
      run("2026-11-12T13:00:00Z", 5),
      run("2026-11-10T09:00:00Z", 5),
      run("2026-10-28T08:00:00Z", 7),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const runs = screen.getByRole("group", { name: "Checks" });
    expect(
      within(within(runs).getByRole("list"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Oct 287 issues", "Nov 105 issues", "Nov 12"]);
  });

  it("boxes in the calendar the day the line of checks marks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    const run = (observedAt: string, issues: number) => ({
      observationId: crypto.randomUUID(),
      kind: "audit_full",
      observedAt: new Date(observedAt),
      issues,
      seconds: 600,
    });
    workspace.runs = [
      run("2026-11-12T13:00:00Z", 5),
      run("2026-11-10T09:00:00Z", 6),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const boxed = async (search: string) => {
      const view = renderWorkspace(workspace, search);
      await user.click(
        within(screen.getByRole("group", { name: "Checks" })).getByRole(
          "button",
          { name: "Other dates" },
        ),
      );
      const calendar = await screen.findByRole("dialog");
      const days = within(calendar)
        .getAllByRole("gridcell")
        .filter((cell) => cell.classList.contains("bg-accent"))
        .map((cell) => cell.textContent);
      view.unmount();
      return days;
    };
    // No filter: the newest check.
    expect(await boxed("?tab=traffic")).toEqual(["12"]);
    // An end on a day with no check: the line marks the check before it, and so does the calendar.
    expect(await boxed("?tab=traffic&to=2026-11-11")).toEqual(["10"]);
    // A broken date: no one day is in view. (A range shows as the calendar's own selection.)
    expect(await boxed("?tab=traffic&to=2026-13-45")).toEqual([]);
  });

  it("mutes the calendar days without a check and opens no month before the first check", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    const run = (observedAt: string) => ({
      observationId: crypto.randomUUID(),
      kind: "audit_full",
      observedAt: new Date(observedAt),
      issues: 5,
      seconds: 600,
    });
    workspace.runs = [run("2026-11-12T13:00:00Z"), run("2026-11-10T09:00:00Z")];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    await user.click(
      within(screen.getByRole("group", { name: "Checks" })).getByRole(
        "button",
        { name: "Other dates" },
      ),
    );
    const calendar = await screen.findByRole("dialog");
    const cell = (day: string) =>
      within(calendar)
        .getAllByRole("gridcell")
        .find((item) => item.textContent === day);
    // The days with a check are the bright choices; a day without one is muted and still starts a range.
    expect(cell("9")).toHaveClass("text-muted-foreground");
    expect(cell("10")).not.toHaveClass("text-muted-foreground");
    expect(cell("12")).not.toHaveClass("text-muted-foreground");
    // November holds the first check: the month before it has none.
    expect(
      within(calendar).getByRole("button", { name: /previous month/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("links the results of the tests without their day where the line of checks names it", async () => {
    const workspace = seoTestWorkspace();
    const check = {
      ...seoTestObservation(workspace),
      sourceTaskId: "task-tests",
    };
    workspace.observations = [check];
    const at = new Date(check.observedAt);
    const older = new Date(at.getTime() - 2 * 86_400_000);
    workspace.runs = [
      {
        observationId: check.id,
        kind: check.kind,
        observedAt: at,
        issues: 2,
        seconds: 600,
      },
      {
        observationId: crypto.randomUUID(),
        kind: check.kind,
        observedAt: older,
        issues: 3,
        seconds: 600,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const view = renderWorkspace(workspace, "?tab=health");
    const tests = await screen.findByTestId("seo-summary-tests");
    // The line over the tabs names the day of this check: the tile names its results alone, and opens them.
    expect(within(tests).queryByText(/^Last check/)).toBeNull();
    expect(
      within(tests).getByRole("link", { name: "View results" }),
    ).toHaveAttribute("href", `/tasks/${check.sourceTaskId}`);
    view.unmount();
    // A check without results to open: the tile names no link it cannot open.
    workspace.observations = [{ ...check, sourceTaskId: null }];
    const plain = renderWorkspace(workspace, "?tab=health");
    const untasked = await screen.findByTestId("seo-summary-tests");
    expect(within(untasked).queryByText(/View results|Last check/)).toBeNull();
    plain.unmount();
    workspace.observations = [check];
    // An older day in view: the tile still shows another check, so it dates it.
    renderWorkspace(
      workspace,
      `?tab=health&to=${older.toISOString().slice(0, 10)}`,
    );
    expect(await screen.findByTestId("seo-summary-tests")).toHaveTextContent(
      /Last check/,
    );
  });

  it.each([
    // A start alone runs to today.
    ["?tab=traffic&from=2026-11-05", /Showing Nov 5\b/],
    // An end on no day with a check is a range, not the pick of a check.
    ["?tab=traffic&to=2026-11-11", /Showing up to Nov 11\./],
    ["?tab=traffic&from=2026-11-12&to=2026-11-10", /end date on or after/],
    // A day the URL holds in another form narrows nothing either.
    ["?tab=traffic&from=soon", /end date on or after/],
    // A string compare would let this pass: "2026-11-12" is not after "soon".
    ["?tab=traffic&from=2026-11-12&to=soon", /end date on or after/],
    // The form of a day, but no day: Core refuses it as well.
    ["?tab=traffic&from=2026-02-30", /end date on or after/],
  ])(
    "says under the timeline which dates %s holds, with the way back",
    (search, note) => {
      const workspace = seoTestWorkspace();
      workspace.metrics = [seoTestMetric()];
      workspace.runs = ["2026-11-12T13:00:00Z", "2026-11-10T09:00:00Z"].map(
        (observedAt) => ({
          observationId: crypto.randomUUID(),
          kind: "audit_full",
          observedAt: new Date(observedAt),
          issues: 5,
          seconds: 600,
        }),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace, search);
      expect(screen.getByText(note)).toBeVisible();
      expect(screen.queryByText(/Earlier check/)).toBeNull();
      expect(
        screen.getByRole("button", { name: "Show the latest" }),
      ).toBeVisible();
    },
  );

  it("keeps the page in view while another day loads, without a jump back to the first read", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    workspace.auditName = "First read";
    workspace.runs = ["2026-11-12T13:00:00Z", "2026-11-10T09:00:00Z"].map(
      (observedAt) => ({
        observationId: crypto.randomUUID(),
        kind: "audit_full",
        observedAt: new Date(observedAt),
        issues: 5,
        seconds: 600,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        // The read of the older day does not answer while the test looks.
        String(url).includes("to=")
          ? new Promise(() => {})
          : Promise.resolve(
              Response.json({ ...workspace, auditName: "Fresh read" }),
            ),
      ),
    );
    renderWorkspace(workspace, "?tab=traffic");
    await screen.findByRole("heading", { name: "Fresh read" });
    await user.click(
      within(screen.getByRole("group", { name: "Checks" })).getByRole(
        "button",
        { name: /^Nov 10/ },
      ),
    );
    expect(screen.getByRole("heading", { name: "Fresh read" })).toBeVisible();
    // The page says that its numbers are not of the picked day yet.
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
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
    // One page and no saved selection: the header has no page picker.
    workspace.scopes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const view = renderWorkspace(workspace, "?tab=traffic");
    const after = (name: string) =>
      screen
        .getByRole("tablist")
        .compareDocumentPosition(screen.getByRole("button", { name })) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    expect(after("Filter by date")).toBeTruthy();
    view.unmount();
    // With a page picker the header has a line on every tab: the closed filter stands in it and adds no row.
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/blogs",
      relationship: "related",
      relatedToPageId: workspace.pages[0].id,
    });
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    renderWorkspace(workspace, "?tab=traffic");
    expect(after("Filter by date")).toBeFalsy();
    expect(
      screen.getByRole("button", { name: "Filter by date" }).parentElement,
    ).toContainElement(screen.getByRole("combobox", { name: "Pages" }));
  });

  it("opens the folded filter block when the header's date filter is pressed", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    // Google Analytics data adds the traffic choice, so a phone folds the filter block.
    workspace.metrics = [{ ...seoTestMetric(), source: "ga4" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const fold = screen.getByRole("button", { name: "Filters" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Filter by date" }));
    // The date fields stand in that block: a press that opened them in a closed block would show nothing.
    expect(fold).toHaveAttribute("aria-expanded", "true");
  });

  it("puts no badge on a page while the Audit has one primary page", () => {
    const workspace = seoTestWorkspace();
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
    renderWorkspace(workspace, "?tab=health");
    const pages = screen
      .getByRole("heading", { name: "Pages", level: 2 })
      .closest("section");
    if (!pages) throw new Error("Pages card missing");
    const rows = within(pages).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("https://example.com/")).toBeVisible();
    expect(within(rows[0]).queryByText(/page$/)).toBeNull();
    // One primary page: the names tell the two pages apart, so no badge and no "Related to" line.
    expect(
      within(rows[1]).getByRole("heading", { name: "Blog" }),
    ).toBeVisible();
    expect(within(rows[1]).queryByText("Related page")).toBeNull();
    expect(within(rows[1]).queryByText(/^Related to/)).toBeNull();
  });

  it("names the parent of a related page when it is not the primary page", () => {
    const workspace = seoTestWorkspace();
    const blog = {
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/blogs",
      label: "Blog",
      relationship: "related" as const,
      relatedToPageId: workspace.pages[0].id,
    };
    workspace.pages.push(blog, {
      ...blog,
      id: crypto.randomUUID(),
      url: "https://example.com/blogs/post",
      label: "Post",
      relatedToPageId: blog.id,
    });
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    const row = screen.getByRole("heading", { name: "Post" }).closest("li");
    if (!row) throw new Error("Page row missing");
    expect(within(row).getByText("Related to: Blog")).toBeVisible();
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
      screen.getByRole("button", { name: "Filter by date" }),
    ).toBeVisible();
    unmount();
    // A page the Audit no longer has stays visible, so the filter can be cleared.
    renderWorkspace(workspace, "?pageId=removed-page");
    expect(screen.getByRole("combobox", { name: "Pages" })).toBeVisible();
  });

  it("puts the page filter in the header line of every tab, and its first choice counts the Audit's pages", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      label: "Blog",
    });
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    workspace.metrics = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const traffic = renderWorkspace(workspace, "tab=traffic");
    // No statistics for all pages: one page can still have them, so the filter stays.
    // The count is the filter: no labelled row of its own.
    expect(screen.getByRole("combobox", { name: "Pages" })).toHaveTextContent(
      "All 2 pages",
    );
    expect(screen.queryByText("2 pages")).toBeNull();
    traffic.unmount();
    // One page in view: the first choice still counts every page of the Audit.
    workspace.scope.pageIds = [workspace.pages[0].id];
    renderWorkspace(workspace, `tab=health&pageId=${workspace.pages[0].id}`);
    await user.click(screen.getByRole("combobox", { name: "Pages" }));
    expect(
      screen.getByRole("option", { name: "All 2 pages" }),
    ).toBeInTheDocument();
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
            ? // The facts are spans of one line; the dot between them is a mark, with no space in the text.
              (_, node) =>
                node?.tagName === "P" &&
                /^2 tests·.*·1 test gave no result$/.test(
                  node.textContent ?? "",
                )
            : "Tests: 2 with a result, 1 without a result, 0 unavailable",
        ),
      ).toBeInTheDocument();
    },
  );

  it.each([
    // [case, pages, issues of each check (oldest first), tests that failed, optional parts lost, Timeline rows]
    ["one page: no page card gives the last check", 1, [1], 0, 0, 1],
    ["several pages and one check: the page cards give it", 2, [1], 0, 0, 0],
    [
      "two checks with issues: the tiles give the last one, a row the one before",
      2,
      [1, 2],
      0,
      0,
      1,
    ],
    [
      "two clean checks: one row that folds the earlier one",
      2,
      [0, 0],
      0,
      0,
      1,
    ],
    ["a check with failed tests: the row says so", 2, [0], 1, 0, 1],
    ["a check that lost an optional part: the row says so", 2, [1], 0, 1, 1],
  ] as const)(
    "shows the Health History only when it adds to the tiles and page cards, %s",
    (_case, pages, issues, failed, lost, rows) => {
      const workspace = seoTestWorkspace();
      workspace.findings = [];
      if (pages > 1)
        workspace.pages.push({
          ...workspace.pages[0],
          id: crypto.randomUUID(),
          url: "https://example.com/blog",
          label: "Blog",
        });
      const pageIds = workspace.pages.map((page) => page.id);
      workspace.scope.pageIds = pageIds;
      const checks = issues.map((count, index) => ({
        id: `check-${index}`,
        kind: "page_check" as const,
        source: "seo_coworker" as const,
        observedAt: new Date(Date.UTC(2026, 0, 3 + index, 12)),
        pageIds,
        scopeVersion: 2,
        sourceTaskId: `check-task-${index}`,
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop" as const],
        rulebookVersion: "html-v1",
        artifactHash: `hash-${index}`,
        issues: count,
        coverage: {
          checked: 2,
          skipped: 0,
          failed,
          modules: { notRequested: 0, failed: lost },
        },
      }));
      // The workspace gives its checks newest first.
      workspace.observations = checks.toReversed();
      workspace.timeline = workspace.observations.map((observation) => ({
        id: `event-${observation.id}`,
        kind: "check" as const,
        title: "SEO check results imported",
        status: "completed" as const,
        detail: "",
        at: observation.observedAt,
        pageIds,
        taskId: observation.sourceTaskId,
        observationId: observation.id,
      }));
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace, "?tab=health");
      expect(screen.getByTestId("seo-summary-tests")).toBeVisible();
      const history = screen.queryByRole("heading", { name: "History" });
      expect(history !== null).toBe(rows > 0);
      // Where the tiles give the last check, what came before it is one closed line.
      const fold = history?.closest("details");
      expect(Boolean(fold)).toBe(_case.startsWith("two checks with issues"));
      expect(fold?.open ?? false).toBe(false);
      // The date of the tests tile opens the results of the last check, with or without a Timeline.
      expect(
        within(screen.getByTestId("seo-summary-tests")).getByRole("link", {
          name: /, View results$/,
        }),
      ).toHaveAttribute("href", `/tasks/check-task-${issues.length - 1}`);
      const list = screen.queryByRole("list", {
        name: "SEO activity, newest first",
      });
      if (!list) {
        expect(rows).toBe(0);
        return;
      }
      expect(within(list).getAllByRole("listitem")).toHaveLength(rows);
      // A Timeline row links the results of its check: the first link is of the newest check of the row.
      // With several pages the tiles give the last check, so the row is the check before it.
      expect(
        within(list)
          .getAllByRole("link", { name: /View results$/, hidden: true })[0]
          .getAttribute("href"),
      ).toBe(
        `/tasks/check-task-${
          _case.startsWith("two checks with issues") ? 0 : issues.length - 1
        }`,
      );
    },
  );

  it("names a Health page row without a name of its own only when it is the home page", () => {
    const workspace = seoTestWorkspace();
    workspace.findings = [];
    // A page added without a name has its address as its label.
    workspace.pages[0].label = workspace.pages[0].url;
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/blog",
      label: "https://example.com/blog",
      relationship: "related",
    });
    // The root of another site is not the home page of this one.
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://other.example/",
      label: "https://other.example/",
      relationship: "related",
    });
    workspace.timeline = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    // The home page has the word the issue rows use, and its address under it.
    const home = screen.getByRole("heading", { level: 3, name: "Home page" });
    const homeRow = home.closest("li");
    if (!homeRow) throw new Error("Home page row missing");
    expect(
      within(homeRow).getByRole("link", { name: "https://example.com/" }),
    ).toBeVisible();
    // Another page has no made-up name: its address is its first line.
    const blogRow = screen
      .getByRole("link", { name: "https://example.com/blog" })
      .closest("li");
    if (!blogRow) throw new Error("Blog row missing");
    expect(within(blogRow).queryByRole("heading")).toBeNull();
  });

  it("dates a Health issue row only when its finding is of another day than the tests tile", () => {
    const workspace = seoTestWorkspace();
    const finding = {
      id: "price",
      observationId: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
      pageUrl: workspace.pages[0].url,
      device: "mobile" as const,
      rowId: "SD-08",
      title: "Markup matches the visible page",
      severity: "major" as const,
      evidence: ["The markup says 6.99, the page shows 9.99."],
      sourceRef: "html:head",
      // A row can carry a later time than its check (one read per device): the day of the check counts.
      observedAt: new Date("2026-01-04T12:00:00Z"),
    };
    workspace.findings.push(finding, {
      ...finding,
      id: "older",
      observationId: "older-check",
      rowId: "SD-09",
      title: "Older finding",
      observedAt: new Date("2026-01-02T12:00:00Z"),
    });
    // Newest first: the tile dates the check of Jan 3.
    workspace.observations = [
      { id: finding.observationId, day: 3 },
      { id: "older-check", day: 2 },
    ].map(({ id, day }) => ({
      id,
      kind: "page_check" as const,
      source: "seo_coworker" as const,
      observedAt: new Date(Date.UTC(2026, 0, day, 12)),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "check-task",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile" as const],
      rulebookVersion: "html-v1",
      artifactHash: `hash-${day}`,
      issues: 1,
      coverage: {
        checked: 2,
        skipped: 0,
        failed: 0,
        modules: { notRequested: 0, failed: 0 },
      },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    expect(screen.getByTestId("seo-summary-tests")).toHaveTextContent(
      "Last check Jan 3, 2026",
    );
    // The finding of the tile's day repeats no date. The older one has its date, with a word that names it.
    const dated = screen.getAllByText("Checked");
    expect(dated).toHaveLength(1);
    expect(dated[0].closest("li")).toHaveTextContent("Older finding");
    // The day alone, as in the tile: the rule compares days.
    expect(dated[0]).toHaveTextContent(
      /^Checked Jan 2, 2026(, View results)?$/,
    );
  });

  it("dates a Health page row only when its check is of another day than the tests tile", () => {
    const workspace = seoTestWorkspace();
    workspace.findings = [];
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/blog",
      label: "Blog",
    });
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/guide",
      label: "Guide",
    });
    const [home, blog, guide] = workspace.pages.map((page) => page.id);
    workspace.scope.pageIds = [home, blog, guide];
    // Newest first: the last check read the home page alone; the guide's last check is of the same day, hours
    // before; the blog's last check is of the day before. Each check has results of its own.
    workspace.observations = [
      { day: 4, hour: 15, pageIds: [home] },
      { day: 4, hour: 9, pageIds: [home, guide] },
      { day: 3, hour: 12, pageIds: [home, blog, guide] },
    ].map(({ day, hour, pageIds }) => ({
      id: `check-${day}-${hour}`,
      kind: "page_check" as const,
      source: "seo_coworker" as const,
      observedAt: new Date(Date.UTC(2026, 0, day, hour)),
      pageIds,
      scopeVersion: 2,
      sourceTaskId: `task-${day}-${hour}`,
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop" as const],
      rulebookVersion: "html-v1",
      artifactHash: `hash-${day}-${hour}`,
      issues: 0,
      coverage: {
        checked: 2,
        skipped: 0,
        failed: 0,
        modules: { notRequested: 0, failed: 0 },
      },
    }));
    workspace.timeline = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    expect(screen.getByTestId("seo-summary-tests")).toHaveTextContent(
      "Last check Jan 4, 2026",
    );
    // The date of the tile is the one link to the results of its check. The words before it are text:
    // one underlined piece, also where the line breaks before the date.
    const dated = within(screen.getByTestId("seo-summary-tests")).getAllByRole(
      "link",
    );
    expect(dated).toHaveLength(1);
    // The words before the date are no part of the link.
    expect(dated[0]).toHaveAccessibleName(/^Jan 4, 2026\b.*View results$/);
    expect(dated[0]).toHaveAttribute("href", "/tasks/task-4-15");
    // A page row of that day repeats no date.
    expect(
      screen.queryByRole("link", { name: /^Last check Jan 4, 2026/ }),
    ).toBeNull();
    // The home page's check is the one the tile dates: its row shows the result as text. An underlined count
    // reads as "show these issues", and the link under it opened the results the tile opens.
    // The guide's check is another one of the same day: its row links the result, and repeats no date.
    const results = screen.getAllByRole("link", { name: /^no issues\b/ });
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveAttribute("href", "/tasks/task-4-9");
    expect(
      screen
        .getAllByText("no issues")
        .filter((element) => element.tagName !== "A"),
    ).toHaveLength(1);
    // The blog's check is older: its row keeps the date, and the date is the link.
    expect(
      screen.getByRole("link", { name: /^Last check Jan 3, 2026/ }),
    ).toBeVisible();
  });

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
    // A home page without a name of its own has the name its own row has.
    { label: "", expected: "Related to: Home page" },
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
      // A second primary page makes the parent a fact: the badge marks the page, the line names the parent.
      workspace.pages.push({
        ...workspace.pages[0],
        id: crypto.randomUUID(),
        url: "https://example.com/shop",
        label: "Shop",
      });
      workspace.scope.pageIds = workspace.pages.map((page) => page.id);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace, "tab=health");
      const row = screen.getByRole("heading", { name: "Blog" }).closest("li");
      if (!row) throw new Error("Related page row missing");
      expect(within(row).getByText("Related page")).toBeVisible();
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
    expect(
      within(onlyPage).queryByText(messages.App.Seo.pages.notChecked),
    ).toBeNull();
    expect(within(onlyPage).queryByText(/^Last check/)).toBeNull();
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
    // Two pages in view: the header counts them, and the count is the page filter.
    expect(screen.getByRole("combobox", { name: "Pages" })).toHaveTextContent(
      "All 2 pages",
    );
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
    await user.click(screen.getByRole("button", { name: "Competitors" }));
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
    };
    workspace.searchBreakdown = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      observedAt: new Date(),
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
    const breakdown = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      observedAt,
      countries: split(1, "EG"),
      devices: split(1, "desktop"),
    };
    workspace.searchBreakdown = breakdown;
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
    breakdown.devices = split(5, "desktop");
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
      // The saved period is not offered again: every sync reads the same rolling days.
      expect(
        within(dialog).getByTestId("seo-statistics-reads"),
      ).toHaveTextContent("Reads the last 90 days of Google search data.");
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
    "keeps Audit activity dates ($from / $to) when a sync reads its own 90 days",
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
      // One property: it is chosen, and shown as a line.
      expect(await within(dialog).findByText("Example website")).toBeVisible();
      await user.click(
        within(dialog).getByRole("button", { name: "Sync statistics" }),
      );
      // A new Google Analytics sync reads organic search, and the view follows it.
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining("channel=organic"),
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
              channel: "organic",
            }),
          },
        }),
      );
      // The period is the 90 complete days up to yesterday, whatever the Audit's dates are.
      const body = mutate.mock.calls[0][0].command.body;
      const day = 86_400_000;
      expect(body.to).toBe(
        new Date(Date.now() - day).toISOString().slice(0, 10),
      );
      expect((Date.parse(body.to) - Date.parse(body.from)) / day).toBe(89);
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
    expect(
      screen.getByRole("heading", {
        name: "Not passed: Previous page finding",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Pages" }));
    await user.click(screen.getByRole("option", { name: "Other page" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", {
          name: "Not passed: Previous page finding",
        }),
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
    await user.click(screen.getByRole("button", { name: "Run full audit" }));
    const dialog = screen.getByRole("dialog");
    await openCheckOptions(user);
    // The dialog opens on the full audit; the page check is one choice away.
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    await user.click(screen.getByRole("option", { name: "Page check" }));
    expect(within(dialog).queryByLabelText("Maximum data requests")).toBeNull();
    expect(
      within(dialog).queryByRole("combobox", { name: /coworker/i }),
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.clear(within(dialog).getByLabelText("Search language"));
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
      await user.click(screen.getByRole("button", { name: "Run page check" }));
      const dialog = screen.getByRole("dialog");
      await openCheckOptions(user);
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
      await user.clear(within(dialog).getByLabelText("Search language"));
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

  it("shows a price in credits only when Audit lite includes provider-backed checks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Run full audit" }));
    const dialog = screen.getByRole("dialog");
    await openCheckOptions(user);
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    await user.click(screen.getByRole("option", { name: "Audit lite" }));
    const price = /^Up to \d+ credits?$/;
    expect(within(dialog).queryByText(price)).toBeNull();
    await user.click(within(dialog).getByLabelText("Backlink overview"));
    expect(within(dialog).getByText(price)).toBeVisible();
    await user.click(within(dialog).getByLabelText("Backlink overview"));
    expect(within(dialog).queryByText(price)).toBeNull();
    // No limit field: the check asks for the requests it makes.
    expect(within(dialog).queryByRole("spinbutton")).toBeNull();
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
    // No check can run: no card promises one, the header's button is off, and the notice says why.
    expect(screen.queryByTestId("seo-setup")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Run full audit" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(messages.App.Seo.dispatchPaused)).toBeVisible();
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
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    await user.click(screen.getAllByRole("button", { name: "Add a page" })[0]);
    const addPage = screen.getByRole("dialog", { name: "Add a page" });
    expect(addPage).toBeVisible();
    // A new page relates to the main page unless the user says it stands alone.
    expect(
      within(addPage).getByRole("combobox", { name: "Related to" }),
    ).toHaveTextContent(workspace.pages[0].label || workspace.pages[0].url);
    // With no pages the card is back: the page step has the one button, and the check waits as a title.
    cleanup();
    workspace.scope.pageIds = [];
    renderWorkspace(workspace);
    expect(
      within(screen.getByTestId("seo-setup"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Add a page"]);
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
    const steps = within(
      within(setup).getByRole("list", { name: "Setup steps" }),
    ).getAllByRole("listitem");
    // The page is saved, so the first audit is the current step.
    expect(steps.map((step) => step.getAttribute("aria-current"))).toEqual([
      null,
      "step",
    ]);
    // The schedule offer and the old verdict wait until a check exists.
    expect(screen.queryByTestId("seo-automation")).toBeNull();
    expect(screen.queryByTestId("seo-agent-verdict")).toBeNull();
    await user.click(
      within(steps[1]).getByRole("button", { name: "Run full audit" }),
    );
    // The step's button opens the dialog on the check it names.
    expect(
      within(screen.getByTestId("seo-analysis-summary")).getByText(
        "Full audit",
      ),
    ).toBeVisible();
    cleanup();
    workspace.analyses = [
      {
        id: "8a0f4a39-7a55-4f0c-9a43-6c1a4f1f2b11",
        kind: "page_check",
        status: "running",
        taskId: null,
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        createdAt: new Date(),
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
    const again = screen.getByRole("button", { name: "Run full audit" });
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
    // The Agent tab leads with its setup card before the first check; the other tabs hold the run.
    renderWorkspace(workspace, "?tab=traffic");
    // The arrow of the run schedules the follow-up, also before the first check.
    await user.click(
      screen.getByRole("button", { name: messages.App.Seo.monitor.create }),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: messages.App.Seo.monitor.create,
      }),
    );
    const dialog = screen.getByRole("dialog");
    // The schedule repeats the full audit, the check of the run button.
    expect(
      within(within(dialog).getByTestId("seo-analysis-summary")).getByText(
        "Full audit",
      ),
    ).toBeVisible();
    // The schedule opens weekly on Mondays at 09:00.
    expect(
      within(dialog).getByRole("button", { name: "Weekly" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The Sokosumi repeats are all there, but a cron that runs more than once a day says why it cannot save.
    await user.click(within(dialog).getByRole("button", { name: "Custom" }));
    await user.type(
      within(dialog).getByPlaceholderText("0 9 * * MON"),
      "*/15 * * * *",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      messages.App.Seo.monitor.onceADay,
    );
    await user.click(within(dialog).getByRole("button", { name: "Weekly" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Change options" }),
    );
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    // A schedule can repeat the full audit too.
    expect(screen.getByRole("option", { name: "Full audit" })).toBeVisible();
    await user.click(screen.getByRole("option", { name: "Keyword positions" }));
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.clear(within(dialog).getByLabelText("Search language"));
    await user.type(within(dialog).getByLabelText("Search language"), "de");
    await user.type(
      within(dialog).getByLabelText("Keywords, one per line"),
      "stablecoins",
    );
    // No weekday is no rule: the form refuses to save.
    await user.click(within(dialog).getByRole("button", { name: "Monday" }));
    const monitorForm = dialog.querySelector("form");
    if (!monitorForm) throw new Error("Missing monitor form");
    fireEvent.submit(monitorForm);
    expect(mutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Monday" }));
    fireEvent.change(
      within(dialog).getByLabelText("Ends", { selector: "input" }),
      { target: { value: "2" } },
    );
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
          rule: {
            expr: "0 9 * * MON",
            timezone: expect.any(String),
            intervalDays: null,
            anchorAt: null,
            endsMode: "AFTER",
            endsOn: null,
            targetRunCount: 2,
          },
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

  it("offers no schedule while the dates are wrong: the form could not open and would open later unasked", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic&from=2026-02-01&to=2026-01-01");
    await user.click(
      screen.getByRole("button", { name: messages.App.Seo.monitor.create }),
    );
    expect(
      await screen.findByRole("menuitem", {
        name: messages.App.Seo.monitor.create,
      }),
    ).toHaveAttribute("aria-disabled", "true");
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
      expect(
        screen.getByRole("button", { name: "Run full audit" }),
      ).toBeVisible();
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
      // No schedule exists here, so the schedule card stays away.
      expect(screen.queryByTestId("seo-automation")).toBeNull();
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
    const view = renderWorkspace(workspace, "?tab=traffic");
    await user.click(
      screen.getByRole("button", { name: messages.App.Seo.monitor.create }),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: messages.App.Seo.monitor.create,
      }),
    );
    const dialog = screen.getByRole("dialog");
    // Without paid search data the schedule form opens with a page check. Its fields are folded.
    await user.click(
      within(dialog).getByRole("button", { name: "Change options" }),
    );
    expect(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    ).toHaveTextContent(messages.App.Seo.analysis.page_check);
    expect(
      within(dialog).getByText(messages.App.Seo.analysis.htmlService),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.clear(within(dialog).getByLabelText("Search language"));
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
    // The one property is chosen for the reader.
    expect(await within(dialog).findByText("Website property")).toBeVisible();
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
    expect(await screen.findByText("Current Google account")).toBeVisible();
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
    expect(screen.getByText("Current Google account")).toBeVisible();
  });

  it("leads the chat examples with the question about Google's results when no keyword is in them", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    // One full audit read one keyword, and no page is in its results.
    workspace.observations.push({
      id: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      kind: "audit_full",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 198, skipped: 0, failed: 0 },
    });
    workspace.keywords.push({
      id: "missing",
      keyword: "charge timer",
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      device: "mobile",
      checkedResults: 100,
      observedAt: new Date("2026-01-03T12:00:00Z"),
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      position: null,
      positionStatus: "not_in_range",
      volume: 90,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, _init?: RequestInit) =>
        Response.json(url.endsWith("/chat") ? { turns: [] } : workspace),
      ),
    );
    renderWorkspace(workspace);
    expect(await screen.findByTestId("seo-summary-keywords")).toHaveTextContent(
      /^0 of /,
    );
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const panel = await screen.findByRole("dialog", {
      name: "Ask the SEO agent",
    });
    expect(
      await within(panel).findByRole("button", {
        name: "Why are my pages not in Google's top results?",
      }),
    ).toBeVisible();
    expect(
      within(panel).queryByRole("button", { name: "What should I do first?" }),
    ).toBeNull();
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
      await within(panel).findByRole("button", {
        name: "What should I do first?",
      }),
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
    const workspace = { ...seoTestCheckedAudit(), auditName: "Launch pages" };
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
      .click(await screen.findByRole("button", { name: "Ask the SEO agent" }));
    expect(
      await within(await screen.findByRole("dialog")).findByRole("button", {
        name: `Create draft task: ${opportunity.title}`,
      }),
    ).toBeVisible();
  });

  it("answers a question in the chat sheet, and keeps the thread there on other tabs", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
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
    // The Agent tab holds no thread and no field, and reads no chat before the sheet opens.
    await screen.findByTestId("seo-agent-verdict");
    expect(screen.queryByText("Earlier visit question")).toBeNull();
    expect(reads).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Ask the SEO agent",
    });
    await user.type(
      within(sheet).getByLabelText("Your question"),
      "New question",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Send question" }),
    );
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
    // One run button there: the card's. The header adds no second one.
    expect(
      within(await screen.findByTestId("seo-setup")).getByRole("button", {
        name: "Run full audit",
      }),
    ).toHaveClass("bg-primary");
    expect(
      screen.getAllByRole("button", { name: "Run full audit" }),
    ).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "Rankings" }));
    expect(
      await screen.findByRole("button", { name: "Run full audit" }),
    ).toHaveClass("bg-quaternary");
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
        difficulty: null,
        clicks: null,
        conversion: null,
        feature: null,
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
    await openCheckOptions(user);
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
    await openCheckOptions(user);
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
        createdAt: new Date(),
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

  it("keeps an answer asked in the chat sheet on another tab in reach from the Agent tab", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
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
    await within(sheet).findByText(messages.App.Seo.agent.prompts.first);
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
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    expect(
      await within(await screen.findByRole("dialog")).findByText(
        "Answer to Sheet question",
      ),
    ).toBeVisible();
  });

  it("keeps an answer in view when the question is sent before chat history loads", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
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
    await user.click(
      await screen.findByRole("button", { name: "Ask the SEO agent" }),
    );
    const sheet = await screen.findByRole("dialog");
    await user.type(
      within(sheet).getByLabelText("Your question"),
      "Early question",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Send question" }),
    );
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
    // A result that asks for a change is a line of the Agent card.
    workspace.strategy.verdict = "out of reach";
    const first = renderWorkspace(workspace);
    expect(await screen.findByTestId("seo-agent-strategy")).toHaveTextContent(
      "Keyword strategy: Most searches of these keywords are out of reach for the site",
    );
    first.unmount();
    // "Keep these keywords" asks for nothing: the card does not say it.
    workspace.strategy.verdict = "keep";
    renderWorkspace(workspace);
    // The step is one row that leads to the list: the whole row is the button.
    const step = await screen.findByRole("button", {
      name: "3 items from the keyword strategy",
    });
    expect(step.closest("li")).not.toBeNull();
    expect(screen.queryByTestId("seo-agent-strategy")).toBeNull();
    // The Audit has no page action; the strategy actions alone show the tab.
    expect(screen.getByRole("tab", { name: "Actions" })).toBeVisible();
    await user.click(step);
    expect(
      await screen.findByRole("heading", {
        name: "Actions from the keyword strategy",
      }),
    ).toBeVisible();
    // "No recommended actions" above these cards would say two things at once.
    expect(screen.queryByRole("heading", { name: "Actions" })).toBeNull();
    expect(screen.queryByText("No recommended actions")).toBeNull();
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const page = screen
      .getByRole("heading", { name: /Write a comparison page/ })
      .closest("article");
    if (!page) throw new Error("no page card");
    // The Agent row led here, so the first card is open: the list has a lead. Every other card is one row.
    expect(within(page).getByRole("button", { expanded: true })).toBeVisible();
    // The effort is plain text, and the title alone says the kind of action: no outlined label on a row.
    expect(within(page).getByText("Effort: High")).not.toHaveAttribute(
      "data-slot",
      "badge",
    );
    expect(within(page).queryByText("On another site")).toBeNull();
    expect(within(page).queryByText("Limit")).toBeNull();
    // Each page of the listing action is a place of its own, with how easy it is in place of the effort.
    expect(
      screen.getByRole("heading", { name: "Where to show the product" }),
    ).toBeVisible();
    // The task and the site lead; the page title stays under them: a list's title reads as another product.
    const card = screen
      .getByRole("heading", {
        name: /^Ask lists\.example to list the product/,
      })
      .closest("article");
    if (!card) throw new Error("no card");
    expect(within(card).getByText("Best battery apps")).toBeVisible();
    expect(within(card).getByText("Hard")).toBeVisible();
    // A closed card is one row: its body and its button are not on the page.
    expect(
      within(card).queryByRole("button", { name: "Draft a plan" }),
    ).toBeNull();
    await user.click(within(card).getByRole("button", { expanded: false }));
    expect(within(card).getByText("The page's author decides.")).toBeVisible();
    expect(
      within(card).getByText("Ask on the product's merits only."),
    ).toBeVisible();
    const list = within(card).getByRole("link", { name: "Best battery apps" });
    expect(list).toHaveAttribute("href", "https://lists.example/best");
    expect(list.closest("li")).toHaveTextContent(
      "List of products · Does not name the product",
    );
    // The reason about all the lists stays off the row of one list.
    expect(
      within(card).queryByText("2 lists of products are in the top 10."),
    ).toBeNull();
    // A type and a state without a label add no note.
    const other = screen
      .getByRole("heading", { name: /^Ask other\.example to list the product/ })
      .closest("article");
    if (!other) throw new Error("no other card");
    await user.click(within(other).getByRole("button", { expanded: false }));
    expect(
      within(other)
        .getByRole("link", { name: "https://other.example/page" })
        .closest("li"),
    ).not.toHaveTextContent("·");
    // Both buttons have one name; each card's title tells them apart.
    expect(
      within(page).getByRole("button", { name: "Draft a plan" }),
    ).toHaveAccessibleDescription(
      "Write a comparison page for “battery app alternative”",
    );
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
    // The limit goes with the question: the agent may not have this action in its evidence. The question names the
    // one place of the row. The chat field keeps the question that was not sent, and the new one follows it.
    expect(
      within(await screen.findByRole("dialog")).getByLabelText("Your question"),
    ).toHaveValue(
      "The site audit recommends: “Write a comparison page for “battery app alternative””. Draft a plan with the steps in order.\n\nThe site audit recommends: “Ask to be added to these lists of products”. Draft a plan with the steps in order. Keep to this limit: Ask on the product's merits only. The place: https://lists.example/best",
    );
    expect(asked).toEqual([]);
  });

  it("names the fixes on the Actions tab when the strategy actions follow them", async () => {
    const workspace = seoTestWorkspace();
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const first = renderWorkspace(workspace, "?tab=actions");
    // Alone on the tab, the fixes need no title.
    expect(
      await screen.findByRole("button", { name: /Create draft task/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Fixes for the issues" }),
    ).toBeNull();
    first.unmount();
    const strategy = seoTestStrategy();
    strategy.actions = Array.from({ length: 5 }, (_, index) => ({
      ...strategy.actions[1],
      title: `Strategy action ${index + 1}`,
    }));
    workspace.strategy = strategy;
    const second = renderWorkspace(workspace, "?tab=actions");
    expect(
      await screen.findByRole("heading", {
        name: "Fixes for the issues",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Actions from the keyword strategy",
      }),
    ).toBeVisible();
    // Under the fixes the strategy list starts with three rows; the button opens the rest.
    const rows = () =>
      screen
        .queryAllByText(/^Strategy action \d$/)
        .map((title) => title.textContent);
    expect(rows()).toEqual([
      "Strategy action 1",
      "Strategy action 2",
      "Strategy action 3",
    ]);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Show 2 more actions" }));
    expect(rows()).toHaveLength(5);
    second.unmount();
    // The Agent row names the count of the strategy actions: it lands on their group, with every row in view.
    // With a finished check the Agent tab shows its steps.
    workspace.observations = [seoTestObservation(workspace)];
    workspace.competitors = [
      {
        id: "saved-competitor",
        url: "https://competitor.example/",
        role: "competitor",
        confirmed: true,
        source: "saved",
        rank: null,
        backlinks: 12,
        referringDomains: null,
        observedAt: null,
        observationId: null,
        version: 1,
        canConfirm: true,
        exclusionReason: null,
      },
    ];
    const third = renderWorkspace(workspace, "?tab=agent");
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "5 items from the keyword strategy",
      }),
    );
    const group = await screen.findByRole("heading", {
      name: "Actions from the keyword strategy",
    });
    await waitFor(() => expect(rows()).toHaveLength(5));
    await waitFor(() => expect(group.closest("[role='group']")).toHaveFocus());
    // Five equal rows have no lead: the first action is open on this landing, the others are closed.
    const head = (title: string) => screen.getByText(title).closest("button");
    expect(head("Strategy action 1")).toHaveAttribute("aria-expanded", "true");
    expect(head("Strategy action 2")).toHaveAttribute("aria-expanded", "false");
    // The landing is for one press: opened by its tab again, the group starts with three rows.
    await userEvent.setup().click(screen.getByRole("tab", { name: "Agent" }));
    await userEvent.setup().click(screen.getByRole("tab", { name: "Actions" }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(head("Strategy action 1")).toHaveAttribute("aria-expanded", "false");
    // The list of sites in the results has the same way to the group.
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: "Rankings" }));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Competitors" }));
    await userEvent.setup().click(
      screen.getByRole("button", {
        name: "Next step: 5 items from the keyword strategy",
      }),
    );
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(head("Strategy action 1")).toHaveAttribute("aria-expanded", "true");
    third.unmount();
    // Alone on the tab the list is the page: it shows every row.
    workspace.actions = [];
    renderWorkspace(workspace, "?tab=actions");
    expect(await screen.findAllByText(/^Strategy action \d$/)).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /more actions/ })).toBeNull();
  });

  it("does not repeat a type that every thread of a place shares", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const strategy = seoTestStrategy();
    const [action] = strategy.actions;
    strategy.actions = [
      {
        ...action,
        kind: "promote",
        title: "Present the product in r/macapps",
        place: {
          name: "r/macapps",
          url: "https://www.reddit.com/r/macapps/",
          form: "community",
        },
        targets: action.targets.map((target) => ({
          ...target,
          type: "forum",
        })),
      },
    ];
    workspace.strategy = strategy;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/chat") ? { turns: [] } : workspace),
      ),
    );
    renderWorkspace(workspace);
    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    const list = await screen.findByRole("link", { name: "Best battery apps" });
    // The state still tells the threads apart. The type is the same on each line, and the place names it.
    expect(list.closest("li")).toHaveTextContent("Does not name the product");
    expect(list.closest("li")).not.toHaveTextContent("Forum");
  });

  it("shows a promotion action's place as a link and its text with a copy button; the question names the place", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const draft =
      "I make Battery Sensei.\n\nIt shows the charge of each device.";
    const strategy = seoTestStrategy();
    strategy.actions = [
      {
        // The targets stay: for a promotion action they are the threads that show the place.
        ...strategy.actions[0],
        kind: "promote",
        title: "Answer in r/macapps",
        place: {
          name: "r/macapps",
          url: "https://www.reddit.com/r/macapps/",
          form: "community",
        },
        draft,
      },
    ];
    workspace.strategy = strategy;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/chat") ? { turns: [] } : workspace),
      ),
    );
    renderWorkspace(workspace);
    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    expect(
      await screen.findByRole("link", { name: "r/macapps" }),
    ).toHaveAttribute("href", "https://www.reddit.com/r/macapps/");
    // The name does not say which site the link opens, so the site shows beside it.
    expect(screen.getByText("Community · reddit.com")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Best battery apps" }),
    ).toBeVisible();
    // The line breaks are part of the post.
    const text = screen.getByTestId("seo-strategy-draft");
    expect(text.textContent).toBe(draft);
    expect(text).toHaveClass("whitespace-pre-wrap");
    const write = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Copy text" }));
    expect(write).toHaveBeenCalledWith(draft);
    await user.click(screen.getByRole("button", { name: "Draft a plan" }));
    expect(
      within(await screen.findByRole("dialog")).getByLabelText("Your question"),
    ).toHaveValue(
      "The site audit recommends: “Answer in r/macapps”. Draft a plan with the steps in order. Keep to this limit: Ask on the product's merits only. The place: https://www.reddit.com/r/macapps/",
    );
  });

  it("shows the notes on promotion places on the Actions tab, also when the audit has no action", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.actions = [];
    const strategy = seoTestStrategy();
    strategy.actions = [];
    strategy.placesNotes = [
      "the place_fit agent gave no answer for r/macapps, so it shows without a ready text",
      "forums.macrumors.com is in 3 of 5 SERP reads, but its terms ban promotion (its terms page), so it is no place",
    ];
    workspace.strategy = strategy;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    const section = await screen.findByTestId("seo-strategy-place-notes");
    expect(
      within(section)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(strategy.placesNotes);
    expect(
      screen.getByRole("heading", { name: "Promotion places" }),
    ).toBeVisible();
  });

  it("keeps the Actions tab without actions: the health of the site stands on it", async () => {
    const workspace = seoTestWorkspace();
    workspace.actions = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(await screen.findByRole("tab", { name: "Agent" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Rankings" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Actions" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Health" })).toBeNull();
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
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
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
    // Paid columns can never fill, and no Analytics data exists.
    expect(screen.queryByText(/Search volume/)).toBeNull();
    expect(screen.queryByText(/Track one to see/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Traffic" })).toBeNull();
    // A competitor without numbers says why, instead of a bare URL.
    await userEvent.click(screen.getByRole("button", { name: "Competitors" }));
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
            : url.includes("/api/seo/connections/")
              ? { status: "not_connected", source: "none" }
              : workspace,
        ),
      ),
    );
    renderWorkspace(workspace);
    await openStatisticsSetup(userEvent);
    // No account yet: the dialog asks for the account. The sync fields and the sync button follow the approval.
    const dialog = await screen.findByRole("dialog", {
      name: "Set up statistics",
    });
    expect(
      within(dialog).getByText(
        // No account at all: Search Console is the first one to connect.
        "Connect Search Console first. You can then sync its statistics here.",
      ),
    ).toBeVisible();
    expect(within(dialog).queryByTestId("seo-statistics-reads")).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Sync statistics" }),
    ).toBeNull();
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

  it("keeps the fill on the run while a check can start, with the first step's reasons in its details", async () => {
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
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
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
    // A new check is the focus of every tab (owner call, 2026-11-13): the step waits outlined, and the
    // run is raised in the secondary look, not the brand fill (owner call, later the same day).
    expect(create).not.toHaveClass("bg-primary");
    const run = screen.getByRole("button", { name: "Run full audit" });
    expect(run).toHaveClass("bg-quaternary");
    expect(run).not.toHaveClass("bg-primary");
    expect(run).not.toHaveAttribute("aria-disabled");
    // The position result leads the Agent tab.
    expect(screen.getByTestId("seo-summary-keywords")).toHaveTextContent(
      /^1 of 21 on the first pageResults read per keyword: 20$/,
    );
    expect(screen.getByText("The title is missing")).not.toBeVisible();
    await user.click(screen.getByText("Reason and evidence"));
    expect(screen.getByText("The title is missing")).toBeVisible();
    expect(screen.getByText("A descriptive search result")).toBeVisible();
    // The Actions tab is the full list of the same cards: the reasons stay closed, and the run keeps the fill.
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    expect(await screen.findByText("The title is missing")).not.toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create draft task" }),
    ).not.toHaveClass("bg-primary");
  });

  it("gives the fill back to the lead fix while no check can start", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    workspace.availableActions = {
      ...workspace.availableActions,
      canRequestAnalysis: false,
    };
    workspace.observations.push({
      id: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      kind: "audit_full",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    // The run cannot start, so it is no filled button: the tab's own next step is.
    expect(
      await screen.findByRole("button", { name: "Create draft task" }),
    ).toHaveClass("bg-primary");
    expect(
      screen.getByRole("button", { name: "Run full audit" }),
    ).not.toHaveClass("bg-primary");
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    await screen.findByText("The title is missing");
    expect(
      screen.getByRole("button", { name: "Create draft task" }),
    ).toHaveClass("bg-primary");
  });

  it("leads from a position check that found no page to the fixes, and only then", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
    const [check] = workspace.observations;
    workspace.actions.push({
      id: "fix-title",
      observationId: check.id,
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
    // An idea for a new page is no fix: the row does not count it.
    workspace.actions.push({
      ...workspace.actions[0],
      id: "idea",
      title: "Write a guide",
      kind: "opportunity",
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
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
      device: "mobile",
      checkedResults: 20,
      observedAt: check.observedAt,
      observationId: check.id,
      position: null,
      positionStatus: "not_in_range",
    } as const;
    workspace.keywords.push(
      { ...read, id: "first", keyword: "battery app" },
      { ...read, id: "second", keyword: "charge timer" },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=rankings");
    // "0 of 2" alone is a dead end: "Track" on a row does not answer it. The fixes are the next step.
    await user.click(
      await screen.findByRole("button", {
        name: "Next step: 1 fix",
      }),
    );
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    cleanup();
    // One keyword in the results: the card has a result to show, and the row would be a second call to act.
    workspace.keywords[0] = {
      ...workspace.keywords[0],
      position: 4,
      positionStatus: "ranked",
    };
    renderWorkspace(workspace, "?tab=rankings");
    expect(
      await screen.findByRole("tab", { name: "Rankings" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("charge timer").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /^Next step: \d+ fix/ }),
    ).toBeNull();
    cleanup();
    // No keyword in the results and no fix to offer: a row to an empty list would be the dead end again.
    workspace.keywords[0] = {
      ...workspace.keywords[0],
      position: null,
      positionStatus: "not_in_range",
    };
    workspace.actions = workspace.actions.filter(
      (action) => action.kind !== "fix",
    );
    renderWorkspace(workspace, "?tab=rankings");
    expect(
      await screen.findByRole("tab", { name: "Rankings" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("charge timer").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /^Next step: \d+ fix/ }),
    ).toBeNull();
  });

  it("shows one fix as a card on the Agent tab and each later fix as a row that opens it on the Actions tab", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const observationId = "b5efedab-c394-4ce9-a089-0979e8a18fdb";
    workspace.observations.push({
      id: observationId,
      kind: "audit_full",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
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
    const fix: Omit<(typeof workspace.actions)[number], "id" | "title"> = {
      observationId,
      pageUrl: "https://example.com/",
      findingIds: [],
      why: "The check found it",
      effort: "low",
      expectedEffect: "A better search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    };
    workspace.actions.push(
      { ...fix, id: "title", title: "Fix the page title" },
      { ...fix, id: "description", title: "Write a description" },
      { ...fix, id: "heading", title: "Add a main heading" },
      { ...fix, id: "alt", title: "Describe the images" },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    // Only the top fix is a full card with its own button.
    expect(
      await screen.findAllByRole("button", { name: "Create draft task" }),
    ).toHaveLength(1);
    expect(screen.getAllByText("Reason and evidence")).toHaveLength(1);
    // The one proposal of the Agent tab stays open: its title is no button that could close it.
    expect(
      screen.queryByRole("button", { name: /^Fix the page title/ }),
    ).toBeNull();
    const row = screen.getByText("Write a description").closest("li");
    expect(row).not.toBeNull();
    // One page: the row needs no page.
    expect(within(row!).queryByRole("link")).toBeNull();
    // The Agent tab shows three of the four fixes, and a row counts the rest.
    expect(screen.queryByText("Describe the images")).toBeNull();
    expect(screen.getByText("1 more fix")).toBeVisible();
    // The whole row is the control: no second button repeats it.
    expect(within(row!).getAllByRole("button")).toHaveLength(1);
    await user.click(
      within(row!).getByRole("button", { name: /^Write a description/ }),
    );
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The Actions tab lists each fix as a closed row. Two cards are open: the first one that waits, and the
    // card of the opened row, which takes the focus.
    expect(
      await screen.findAllByRole("button", { name: "Create draft task" }),
    ).toHaveLength(2);
    expect(screen.getAllByRole("article")).toHaveLength(4);
    const card = screen
      .getByRole("heading", { name: /^Write a description/ })
      .closest("article");
    await waitFor(() => expect(card).toHaveFocus());
    expect(
      within(card!).getByRole("button", { name: "Create draft task" }),
    ).toBeVisible();
    // A press on the title row closes the card again: the row is the one control of a closed card.
    await user.click(
      within(card!).getByRole("button", { name: /^Write a description/ }),
    );
    expect(within(card!).getAllByRole("button")).toHaveLength(1);
    expect(within(card!).queryByRole("link")).toBeNull();
    // The row that counts the rest leads to the same list.
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    await user.click(screen.getByRole("button", { name: "1 more fix" }));
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    cleanup();
    // With several pages two fixes can have one title: the row names its page.
    const pricing = "https://example.com/pricing";
    const second = "a658c5bb-3084-4b26-81ee-b3208ee5ab61";
    // No name of its own: the row names the page by its path.
    workspace.pages.push({
      ...workspace.pages[0],
      id: second,
      url: pricing,
      label: "",
    });
    workspace.scope = {
      ...workspace.scope,
      pageIds: [...workspace.scope.pageIds, second],
    };
    workspace.actions[1] = { ...workspace.actions[1], pageUrl: pricing };
    // A suggestion is no fix: the row that counts the rest then says "actions".
    workspace.actions[3] = {
      ...workspace.actions[3],
      kind: "opportunity",
      title: "Write a guide",
    };
    renderWorkspace(workspace, "?tab=agent");
    const paged = (await screen.findByText("Write a description")).closest(
      "li",
    );
    expect(within(paged!).getByText("/pricing")).toBeVisible();
    expect(screen.getByRole("button", { name: "1 more action" })).toBeVisible();
    cleanup();
    // Every action shows: no row counts a rest. The row of a suggestion does not call it a fix.
    workspace.actions = [workspace.actions[0], workspace.actions[3]];
    renderWorkspace(workspace, "?tab=agent");
    const suggestion = (await screen.findByText("Write a guide")).closest("li");
    expect(within(suggestion!).getAllByRole("button")).toHaveLength(1);
    expect(
      within(suggestion!).getByRole("button", { name: /^Write a guide/ }),
    ).toBeVisible();
    expect(screen.queryByText(/more (fix|action)/)).toBeNull();
    cleanup();
    // Without an action the steps are one list: no label splits them.
    workspace.actions = [];
    renderWorkspace(workspace, "?tab=agent");
    expect(
      await screen.findByRole("heading", { name: "The agent proposes" }),
    ).toBeVisible();
    expect(
      screen.queryByText(
        "Nothing is waiting. The agent syncs Search Console when you open this audit and the data is older than a day.",
      ),
    ).toBeNull();
  });

  it("creates one draft action Task with its source references and guards repeated clicks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const waiting = {
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
    } as const;
    workspace.actions.push(
      // An action with a Task comes first in the list; the card opens on the one that still waits.
      {
        ...waiting,
        id: "action-with-task",
        findingIds: [],
        evidence: [],
        title: "Add a meta description",
        taskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
        status: "task_created",
      },
      { ...waiting, findingIds: ["finding"], evidence: [] },
    );
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
    expect(
      screen.getByRole("button", { name: "Create draft task" }),
    ).not.toHaveClass("bg-primary");
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

  it("opens the next waiting action once a Task exists for the one before", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const waiting: Omit<(typeof workspace.actions)[number], "id" | "title"> = {
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      findingIds: [],
      why: "The check found it",
      effort: "low",
      expectedEffect: "A better search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    };
    workspace.actions.push(
      { ...waiting, id: "title", title: "Fix the page title" },
      { ...waiting, id: "description", title: "Write a description" },
    );
    let served = workspace;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(served)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace, "?tab=actions");
    // One card is open: the first action that waits. The second is a closed row.
    expect(
      screen.getAllByRole("button", { name: "Create draft task" }),
    ).toHaveLength(1);
    // A card that a press opens has the same button: the button does the same thing on each card.
    const second = screen
      .getByRole("heading", { name: /^Write a description/ })
      .closest("article");
    await user.click(within(second!).getByRole("button", { expanded: false }));
    const creates = screen.getAllByRole("button", {
      name: "Create draft task",
    });
    expect(creates).toHaveLength(2);
    for (const create of creates)
      expect(create).toHaveClass("border-control-border");
    served = {
      ...workspace,
      actions: [
        {
          ...workspace.actions[0],
          taskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
          status: "task_created",
        },
        workspace.actions[1],
      ],
    };
    await user.click(creates[0]);
    // The Task exists: the next action leads, and its card opens to show its button.
    const next = screen
      .getByRole("heading", { name: /^Write a description/ })
      .closest("article");
    await waitFor(() =>
      expect(
        within(next!).getByRole("button", { name: "Create draft task" }),
      ).toBeVisible(),
    );
  });

  it("says what a keyword result of zero means, with the depth the check read", async () => {
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
      devices: ["mobile"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 201, skipped: 0, failed: 0 },
    });
    workspace.keywords.push({
      id: "missing",
      keyword: "charge timer",
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
      position: null,
      positionStatus: "not_in_range",
      volume: 90,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    });
    // A second read looked deeper; the sentence names the depth every read reached.
    workspace.keywords.push({
      ...workspace.keywords[workspace.keywords.length - 1],
      id: "missing-deep",
      keyword: "charge limit",
      checkedResults: 100,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    // "0 of 2" is no "not in Google": the tile names the results the check read.
    expect(await screen.findByTestId("seo-summary-keywords")).toHaveTextContent(
      /^0 of 2Results read per keyword: 20 to 100$/,
    );
    // The line that dates the check shows the day: two reads of one check differ by minutes.
    expect(screen.getAllByText("Jan 3, 2026").length).toBeGreaterThan(0);
  });

  it("names no depth where a read has none, and splits the tests without a result", async () => {
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const observedAt = new Date("2026-01-03T12:00:00Z");
    const observationId = "b5efedab-c394-4ce9-a089-0979e8a18fdb";
    workspace.availableActions = {
      canEdit: false,
      canRequestAnalysis: false,
      canCreateMonitor: false,
      canUsePaidSearchData: false,
      canSyncMetrics: false,
    };
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
      devices: ["mobile"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 198, skipped: 2, failed: 1 },
    });
    workspace.keywords.push({
      id: "missing",
      keyword: "charge timer",
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      device: "mobile",
      // This read has no depth, so the sentence names none.
      checkedResults: null,
      observedAt,
      observationId,
      position: null,
      positionStatus: "not_in_range",
      volume: 90,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(await screen.findByTestId("seo-summary-keywords")).toHaveTextContent(
      /^0 of 1$/,
    );
    // The tests tile splits the tests without a result the way the Timeline row of the check does.
    await userEvent.click(screen.getByRole("tab", { name: "Actions" }));
    const tests = screen.getByTestId("seo-summary-tests");
    expect(within(tests).getByText("2 tests gave no result")).toBeVisible();
    expect(within(tests).getByText("1 unavailable")).toBeVisible();
  });

  it("shows the keyword numbers on the Agent tab and the page-check numbers on Actions, and one Rankings list at a time", async () => {
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
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
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
    // The Agent tab says the issue count once, in its headline, and shows the keyword numbers.
    expect(await screen.findByTestId("seo-agent-verdict")).toHaveTextContent(
      "2 issues to fix: 1 high impact and 1 low impact",
    );
    expect(screen.queryByTestId("seo-summary-issues")).toBeNull();
    expect(screen.queryByTestId("seo-summary-tests")).toBeNull();
    expect(screen.getByTestId("seo-summary-keywords")).toHaveTextContent(
      "1 of 2",
    );
    const searches = screen.getByTestId("seo-summary-searches");
    expect(searches).toHaveTextContent("810 a month");
    // Every checked keyword has a number: the tile beside this one already says how many they are.
    expect(within(searches).queryByText(/checked keywords?$/)).toBeNull();
    // The Actions tab leads with the numbers of the page check, and not with the keyword numbers.
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    const issues = screen.getByTestId("seo-summary-issues");
    expect(issues).toHaveTextContent(/^2/);
    expect(within(issues).getByText("1 high impact")).toBeVisible();
    expect(within(issues).getByText("1 low impact")).toBeVisible();
    // Tests without a result are part of the total, not hidden. With one kind of them the total says it:
    // a line "30 tests gave no result" would say 231 minus 201 a second time.
    const tests = screen.getByTestId("seo-summary-tests");
    expect(tests).toHaveTextContent("201 of 231");
    expect(within(tests).queryByText(/gave no result/)).toBeNull();
    // The count behind "of 231" is the hint of those words.
    expect(within(tests).getByText("of 231")).toHaveAttribute(
      "title",
      "30 tests gave no result",
    );
    // The issues can come from older checks: the tile dates its check.
    expect(tests).toHaveTextContent("Last check Jan 3, 2026");
    expect(screen.queryByTestId("seo-summary-keywords")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    // The keyword tile is the way to the Rankings tab: one button covers the tile.
    await user.click(screen.getByRole("button", { name: "Open rankings" }));
    expect(screen.getByRole("tab", { name: "Rankings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // One keyword is found, so the Position column shows.
    expect(screen.getByText("Not found")).toBeVisible();
    // The lists have no Intent column: the word drives no action here.
    expect(screen.queryByText("Not available")).toBeNull();
    expect(screen.queryByText(/intent/i)).toBeNull();
    // One list shows at a time.
    const part = (name: string | RegExp) =>
      screen.getByRole("heading", { name }).closest("section")?.parentElement;
    expect(part(/^In Google's top results for/)).not.toHaveClass("hidden");
    expect(part(/^\d+ keyword ideas?$/)).toHaveClass("hidden");
    expect(part(/^Sites in Google's results/)).toHaveClass("hidden");
    const competitors = screen.getByRole("button", { name: "Competitors" });
    expect(competitors).toHaveAttribute("aria-pressed", "false");
    await user.click(competitors);
    expect(competitors).toHaveAttribute("aria-pressed", "true");
    expect(part(/^Sites in Google's results/)).not.toHaveClass("hidden");
    expect(part(/^In Google's top results for/)).toHaveClass("hidden");
    await user.click(screen.getByRole("button", { name: "Ideas" }));
    expect(part(/^\d+ keyword ideas?$/)).not.toHaveClass("hidden");
    expect(part(/^Sites in Google's results/)).toHaveClass("hidden");
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
    expect(part(/^In Google's top results for/)).not.toHaveClass("hidden");
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

  it("shows keywords and ideas together while a search holds text, and opens on the ideas without a checked keyword", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
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
      observedAt: new Date("2026-11-11T00:26:00Z"),
      observationId: "observation",
      volume: 50,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    } as const;
    const idea = {
      ...read,
      id: "idea",
      keyword: "battery widget",
      source: "gap",
      position: null,
      positionStatus: "unavailable",
      checkedResults: null,
    } as const;
    // Twenty keywords: enough for the search box.
    workspace.keywords = [
      ...Array.from({ length: 20 }, (_, index) => ({
        ...read,
        id: `read-${index}`,
        keyword: `read ${index}`,
        position: index + 1,
        positionStatus: "ranked" as const,
      })),
      idea,
    ];
    // The workspace reads the Audit on mount; never let it reach a real server.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const part = (name: string | RegExp) =>
      screen.getByRole("heading", { name }).closest("section")?.parentElement;
    renderWorkspace(workspace, "tab=rankings");
    expect(screen.getByRole("button", { name: "Keywords" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(part(/^\d+ keyword ideas?$/)).toHaveClass("hidden");
    // One box searches both lists: a match in the ideas does not hide behind the switch.
    const search = screen.getByPlaceholderText("Filter keywords");
    await user.type(search, "widget");
    expect(part(/^\d+ keyword ideas?$/)).not.toHaveClass("hidden");
    expect(part(/^In Google's top results for/)).not.toHaveClass("hidden");
    await user.click(screen.getByRole("button", { name: "Competitors" }));
    expect(part(/^\d+ keyword ideas?$/)).toHaveClass("hidden");
    expect(part(/^In Google's top results for/)).toHaveClass("hidden");
    await user.click(screen.getByRole("button", { name: "Keywords" }));
    await user.clear(search);
    expect(part(/^\d+ keyword ideas?$/)).toHaveClass("hidden");
    cleanup();
    // Ideas and no tracked or checked keyword: the Keywords list is empty, so the tab opens on the ideas.
    workspace.keywords = [idea];
    renderWorkspace(workspace, "tab=rankings");
    expect(screen.getByRole("button", { name: "Ideas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(part(/^\d+ keyword ideas?$/)).not.toHaveClass("hidden");
  });
});
