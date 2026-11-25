import type { TaskFile } from "@sokosumi/core-client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import messages from "../../../../../messages/en.json";
import { SeoReportFiles } from "./seo-report-files";
import { seoReportVersions } from "./seo-report-files-model";
import {
  SEO_TEST_PROJECT,
  seoTestMetric,
  seoTestObservation,
  seoTestStrategy,
  seoTestWorkspace,
} from "./seo-test-fixture";
import { SeoWorkspaceMenu } from "./seo-workspace-menu";

const { getTaskById, execute, viewer } = vi.hoisted(() => ({
  getTaskById: vi.fn(),
  execute: vi.fn(),
  viewer: { id: "owner" as string | null },
}));
vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getTaskById },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: viewer.id
      ? { user: { id: viewer.id }, session: { activeOrganizationId: "org" } }
      : null,
    isPending: false,
  }),
}));
afterEach(() => {
  viewer.id = "owner";
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function reportFile(
  taskId: string,
  ext: string,
  mimeType: string,
  extra: Partial<TaskFile> = {},
): TaskFile {
  const coworker = { id: "seo", name: "SEO", slug: "seo" };
  const name = `seo-report-${taskId}.${ext}`;
  return {
    id: `${taskId}-${ext}`,
    taskId,
    name,
    mimeType,
    fileUrl: `https://store.public.blob.vercel-storage.com/tasks/${taskId}/${name}`,
    size: 100,
    status: "READY",
    origin: "USER_UPLOAD",
    sourceUrl: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    uploader: { type: "coworker", id: coworker.id, coworker },
    ...extra,
  };
}

function openRuns(
  sameMinute = false,
  withEvidence = false,
  eligible: string[] = [],
  marketFile?: string,
  expired = false,
) {
  const data = seoTestWorkspace();
  data.observations = [
    {
      ...seoTestObservation(data),
      sourceTaskId: "newer",
      observedAt: new Date("2026-11-01T16:35Z"),
    },
  ];
  data.analyses = [
    {
      id: "imported",
      taskId: "newer",
      kind: "page_check",
      status: "completed",
      pageIds: data.scope.pageIds,
      scopeVersion: 2,
      createdAt: new Date("2026-11-01T15:00Z"),
    },
    {
      id: "waiting",
      taskId: "older",
      kind: sameMinute ? "page_check" : "audit_full",
      status: "running",
      pageIds: data.scope.pageIds,
      scopeVersion: 2,
      createdAt: new Date(
        sameMinute ? "2026-11-01T16:35:02Z" : "2026-11-01T10:15Z",
      ),
    },
  ];
  if (marketFile) {
    data.observations[0].kind = "audit_full";
    data.strategy = {
      ...seoTestStrategy(),
      observationId: data.observations[0].id,
      marketRecoveryFileId: marketFile,
    };
  }
  if (withEvidence) {
    data.siteEvidence = {
      taskId: "older",
      auditPageUrl: "https://example.com/shop",
      observedAt: new Date("2026-11-01T10:30Z"),
      complete: true,
      sampledPages: ["https://example.com/shop"],
      targets: [],
    };
    data.auditSiteEvidence = [
      {
        ...data.siteEvidence,
        taskId: "newer",
        sampledPages: ["https://example.com/newer-report"],
      },
      data.siteEvidence,
    ];
    data.siteEvidence = data.auditSiteEvidence[0];
    data.metrics = [{ ...seoTestMetric(), value: 876543 }];
    data.auditSearchConsole = [
      {
        taskId: "newer",
        ...(expired && { propertyDataExpired: true }),
        propertyId: "sc-domain:example.com",
        from: new Date("2026-10-01"),
        to: new Date("2026-10-28"),
        pageUrls: ["https://example.com/shop", "https://example.com/blog"],
        measuredPages: [
          {
            pageUrl: "https://example.com/shop",
            measuredUrl: "https://www.example.com/shop",
            basis: "google_canonical",
          },
          {
            pageUrl: "https://example.com/blog",
            measuredUrl: "https://example.com/blog",
            basis: "unverified",
          },
        ],
        opportunities: [
          {
            id: "snippet",
            title: "Review the shop snippet",
            why: "This query received 0 clicks for the measured page.",
            pageUrl: "https://www.example.com/shop",
            expectedEffect: "Compare the next period.",
            evidence: ["5 impressions for this query in Search Console."],
          },
        ],
        coverage: "partial",
        clicks: 0,
        impressions: null,
        ctr: null,
        averagePosition: null,
        history: {
          reason: "recent_click_decline",
          from: new Date("2025-10-02"),
          to: new Date("2025-10-29"),
          coverage: "partial",
          clicks: null,
          decision: "insufficient_history",
        },
        previous: {
          from: new Date("2026-09-03"),
          to: new Date("2026-09-30"),
          clicks: 1,
          impressions: 5,
          ctr: 0.2,
          averagePosition: 3,
        },
        queries: {
          rows: [
            {
              query: "shop",
              pageUrl: "https://www.example.com/shop",
              clicks: 0,
              impressions: 1,
              ctr: 0,
              averagePosition: 2.2,
            },
          ],
          truncated: true,
        },
      },
    ];
  }
  data.auditSearchConsoleRetryTaskIds = eligible;
  function ReportFilesView() {
    const { data: workspace } = useQuery({
      queryKey: [
        "seo-workspace",
        "org",
        viewer.id,
        "project",
        data.projectId,
        "",
      ],
      initialData: data,
      queryFn: async () => data,
      enabled: false,
    });
    const versions = seoReportVersions(workspace, { from: null, to: null });
    const model = {
      data: workspace,
      pending: false,
      execute,
      setDialog: vi.fn(),
    };
    return (
      <>
        <SeoReportFiles versions={versions} model={model} />
        <SeoWorkspaceMenu
          versions={versions}
          model={model}
          unavailable={false}
        />
      </>
    );
  }
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { gcTime: Number.POSITIVE_INFINITY },
            mutations: { gcTime: Number.POSITIVE_INFINITY },
          },
        })
      }
    >
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={messages}
        formats={createFormats()}
      >
        <ReportFilesView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

function task(id: string, files: TaskFile[]) {
  return {
    data: {
      id,
      files,
      assigneeId: "seo",
      ownerId: "owner",
      projectId: null,
      visibility: "PUBLIC",
      status: "COMPLETED",
      archivedAt: null,
    },
  };
}

async function openConsole(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Manage SEO" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Search Console results" }),
  );
  return within(
    await screen.findByRole("dialog", { name: "Search Console results" }),
  );
}

describe("SEO report file versions", () => {
  it("keeps Search Console evidence with its run, including a measured zero and missing impressions", async () => {
    getTaskById.mockImplementation(async (id: string) => task(id, []));
    const user = openRuns(false, true);
    await openConsole(user);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByText("Crawl details")).toBeNull();
    expect(getTaskById).not.toHaveBeenCalled();
    const evidence = within(
      dialog.getByRole("region", { name: "Search Console" }),
    );
    expect(
      evidence.getByRole("table", {
        name: "Web search performance for audited pages",
      }),
    ).toBeVisible();
    expect(evidence.getByText("sc-domain:example.com")).toBeVisible();
    expect(
      evidence.getByRole("columnheader", {
        name: /This period.*Oct 1.*28, 2026/,
      }),
    ).toBeVisible();
    await user.click(evidence.getByText("Audited URLs"));
    expect(evidence.getByText("https://example.com/shop")).toBeVisible();
    expect(evidence.getByText("https://example.com/blog")).toBeVisible();
    expect(
      evidence.getByText(
        "Measured Google canonical URL: https://www.example.com/shop",
      ),
    ).toBeVisible();
    expect(
      evidence.getByText(
        "The audit measured the submitted URL. Its canonical URL is unverified.",
      ),
    ).toBeVisible();
    expect(evidence.getByText("Partial data")).toBeVisible();
    expect(evidence.getByText("2025-10-02 to 2025-10-29")).toBeVisible();
    expect(
      evidence.getByText(
        "There is too little comparable history to confirm the recent change.",
      ),
    ).toBeVisible();
    expect(evidence.queryByText(/^Clicks during that period:/)).toBeNull();
    expect(
      evidence.getByRole("row", { name: "Search clicks 0 1" }),
    ).toBeVisible();
    expect(
      evidence.getByRole("row", { name: "Search impressions Unavailable 5" }),
    ).toBeVisible();
    expect(
      evidence.getByRole("columnheader", {
        name: /Previous period.*Sep 3.*30, 2026/,
      }),
    ).toBeVisible();
    expect(
      evidence.getByRole("row", { name: "Click-through rate Unavailable 20%" }),
    ).toBeVisible();
    const recommendations = within(
      evidence.getByRole("region", { name: "Recommendations from this check" }),
    );
    await user.click(recommendations.getByText("Evidence"));
    expect(
      recommendations.getByText(
        "5 impressions for this query in Search Console.",
      ),
    ).toBeVisible();
    expect(recommendations.getByText("Review the shop snippet")).toBeVisible();
    expect(
      recommendations.getByText(
        "This query received 0 clicks for the measured page.",
      ),
    ).toBeVisible();
    await user.click(evidence.getByText("Search Console queries"));
    expect(evidence.getByText("shop")).toBeVisible();
    expect(evidence.getAllByText("https://www.example.com/shop")).toHaveLength(
      2,
    );
    expect(
      evidence.getByText("Only the first 1 rows by clicks are kept"),
    ).toBeVisible();
    await user.click(dialog.getByRole("combobox", { name: "Check" }));
    await user.click(await screen.findByRole("option", { name: /Full audit/ }));
    expect(dialog.queryByText("sc-domain:example.com")).toBeNull();
    expect(dialog.queryByText("Review the shop snippet")).toBeNull();
    expect(
      dialog.getByText(
        "No Search Console results are available for this check.",
      ),
    ).toBeVisible();
    expect(dialog.queryByText("876,543")).toBeNull();
  });

  it("opens scoped crawl evidence from files without repeating saved Search Console results", async () => {
    getTaskById.mockImplementation(async (id: string) => task(id, []));
    const user = openRuns(false, true);
    await user.click(screen.getByRole("button", { name: "Report files" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByText("sc-domain:example.com")).toBeNull();
    await user.click(dialog.getByText("Crawl details"));
    await user.click(dialog.getByText("Sampled public pages"));
    expect(
      dialog.getByRole("link", { name: "https://example.com/newer-report" }),
    ).toBeVisible();
    await user.click(dialog.getByRole("combobox", { name: "Check" }));
    await user.click(await screen.findByRole("option", { name: /Full audit/ }));
    expect(dialog.getByText("Internal links and indexing")).not.toBeVisible();
    await user.click(dialog.getByText("Crawl details"));
    expect(dialog.getByText("Internal links and indexing")).toBeVisible();
    await user.click(dialog.getByText("Sampled public pages"));
    expect(
      dialog.queryByRole("link", { name: "https://example.com/newer-report" }),
    ).toBeNull();
    expect(
      dialog.getByRole("link", { name: "https://example.com/shop" }),
    ).toBeVisible();
  });

  it("keeps saved results readable when property recovery has expired", async () => {
    getTaskById.mockImplementation(async (id: string) => task(id, []));
    const user = openRuns(false, true, [], undefined, true);
    await openConsole(user);
    const dialog = within(await screen.findByRole("dialog"));
    expect(
      dialog.getByText(/outside Search Console’s data retention/),
    ).toBeVisible();
    expect(
      dialog.queryByRole("button", {
        name: "Load property totals and page insights",
      }),
    ).toBeNull();
    expect(
      dialog.getByRole("row", { name: "Search clicks 0 1" }),
    ).toBeVisible();
  });

  it.each([false, true])(
    "keeps recovered property and page counts when query recovery is incomplete: %s",
    async (missingQuery) => {
      getTaskById.mockImplementation(async (id: string) => task(id, []));
      const user = openRuns(false, true);
      const fetch = vi.fn().mockResolvedValue(
        Response.json({
          auditSearchConsole: [
            {
              taskId: "newer",
              pageDiscovery: {
                topClickedPages: [
                  {
                    pageUrl: "https://www.example.com/",
                    clicks: 3,
                    impressions: 83,
                  },
                ],
                recent: { from: "2026-10-01", to: "2026-10-28" },
                previous: { from: "2026-09-03", to: "2026-09-30" },
                pages: [
                  {
                    pageUrl: "https://www.example.com/guides/planning",
                    reason: "lowCtr",
                    totals: { clicks: 0, impressions: 150 },
                    recent: { clicks: 0, impressions: 60 },
                    previous: { clicks: 0, impressions: 55 },
                    query: null,
                    ...(missingQuery && { queryUnavailable: true }),
                    suggestion: null,
                  },
                ],
                limited: false,
              },
              propertyTotals: {
                clicks: 9,
                impressions: 675,
                ctr: 9 / 675,
                averagePosition: 6.7,
              },
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetch);
      await openConsole(user);
      const dialog = within(await screen.findByRole("dialog"));
      expect(fetch).not.toHaveBeenCalled();
      await user.click(
        dialog.getByRole("button", {
          name: "Load property totals and page insights",
        }),
      );
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
        auditTaskId: "newer",
        includePropertyTotals: true,
        includePageDiscovery: true,
      });
      expect(await dialog.findByText("675")).toBeVisible();
      const landingPages = within(
        dialog.getByRole("table", { name: "Top pages by search clicks" }),
      );
      const home = landingPages.getByRole("row", {
        name: "https://www.example.com/ 3 83",
      });
      expect(within(home).getByRole("link")).toHaveAttribute(
        "href",
        "https://www.example.com/",
      );
      await user.click(
        dialog.getByText("Frequent appearances with few clicks"),
      );
      expect(dialog.getByText("0 clicks · 150 impressions")).toBeVisible();
      if (missingQuery) {
        expect(await dialog.findByRole("alert")).toHaveTextContent(
          "Some property performance data could not be loaded.",
        );
        expect(
          dialog.getByRole("button", {
            name: "Load property totals and page insights",
          }),
        ).toBeVisible();
      } else {
        expect(dialog.getByText(/Monitor this page/)).toBeVisible();
        expect(dialog.queryByRole("alert")).toBeNull();
      }
      expect(dialog.getByText("1.3%")).toBeVisible();
      expect(dialog.getByText("6.7")).toBeVisible();
      expect(
        dialog.getByRole("row", { name: "Search clicks 0 1" }),
      ).toBeVisible();
    },
  );

  it("recovers only the eligible selected check after an explicit click, and allows a retry on failure", async () => {
    const response = Promise.withResolvers<Response>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(response.promise)
      .mockResolvedValueOnce(
        Response.json({
          ...seoTestWorkspace(),
          auditSearchConsole: [
            {
              taskId: "older",
              propertyId: "sc-domain:recovered.example",
              from: "2026-09-01",
              to: "2026-09-28",
              pageUrls: ["https://recovered.example/"],
              measuredPages: [
                {
                  pageUrl: "https://recovered.example/",
                  measuredUrl: "https://recovered.example/",
                  basis: "unverified",
                },
              ],
              coverage: "complete",
              clicks: 3,
              impressions: 30,
              ctr: 0.1,
              averagePosition: 2,
              previous: null,
              queries: { rows: [], truncated: false },
              opportunities: [],
            },
          ],
          auditSearchConsoleRetryTaskIds: [],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    getTaskById.mockImplementation(async (id: string) => task(id, []));
    const user = openRuns(false, true, ["older"]);
    await openConsole(user);
    expect(
      screen.queryByRole("button", { name: "Recover Search Console results" }),
    ).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Check" }));
    await user.click(await screen.findByRole("option", { name: /Full audit/ }));
    expect(fetch).not.toHaveBeenCalled();
    const retry = screen.getByRole("button", {
      name: "Recover Search Console results",
    });
    await user.click(retry);
    expect(retry).toHaveAttribute("aria-disabled", "true");
    await user.click(retry);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`/api/projects/${SEO_TEST_PROJECT}/seo/statistics`);
    expect(JSON.parse(init.body)).toEqual({ auditTaskId: "older" });
    expect(init.headers["x-seo-viewer"]).toBe("owner");
    response.resolve(new Response(null, { status: 503 }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not recover Search Console results.",
    );
    await user.click(retry);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText("sc-domain:recovered.example"),
    ).toBeVisible();
    const pageTable = screen.getByRole("table", {
      name: "Web search performance for audited pages",
      hidden: true,
    });
    expect(pageTable).not.toBeVisible();
    expect(screen.getAllByText("2026-09-01 to 2026-09-28")[0]).toBeVisible();
    await user.click(screen.getByText("Page performance is unverified."));
    expect(pageTable).toBeVisible();
    expect(screen.queryByText("Search Console queries")).toBeNull();
    expect(
      screen.getByText("Search Console returned no query rows"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Recover Search Console results" }),
    ).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Check" }));
    await user.click(await screen.findByRole("option", { name: /Page check/ }));
    expect(screen.getByText("sc-domain:example.com")).toBeVisible();
  });

  it("opens each same-day run's delivered formats on demand, and can recover a missing observation", async () => {
    const pdf = reportFile("newer", "pdf", "application/pdf");
    const json = reportFile("newer", "data.json", "application/json");
    const old = reportFile("older", "json", "application/json");
    const md = reportFile("older", "md", "text/markdown");
    getTaskById.mockImplementation(async (id: string) =>
      id === "newer" ? task(id, [json, pdf]) : task(id, [old, md]),
    );
    const user = openRuns();
    expect(getTaskById).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Report files" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(
      await dialog.findByRole("link", { name: "Open PDF" }),
    ).toHaveAttribute("href", pdf.fileUrl);
    expect(
      dialog.getByRole("link", { name: "Report data (JSON)" }),
    ).toHaveAttribute("href", json.fileUrl);
    expect(
      dialog.queryByRole("button", { name: "Import report into SEO" }),
    ).toBeNull();
    await user.click(dialog.getByRole("combobox", { name: "Check" }));
    await user.click(await screen.findByRole("option", { name: /Full audit/ }));
    expect(
      await dialog.findByRole("link", { name: "Open Markdown" }),
    ).toHaveAttribute("href", md.fileUrl);
    expect(
      dialog.getByRole("link", { name: "Report data (JSON)" }),
    ).toHaveAttribute("href", old.fileUrl);
    expect(dialog.queryByRole("link", { name: "Open PDF" })).toBeNull();
    await user.click(
      dialog.getByRole("button", { name: "Import report into SEO" }),
    );
    expect(execute).toHaveBeenCalledWith(
      { kind: "import_audit", body: { taskId: "older", fileId: old.id } },
      "Report imported",
    );
    expect(getTaskById.mock.calls.map(([id]) => id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("restores market data from the exact original JSON for a completed audit", async () => {
    const source = reportFile("newer", "data.json", "application/json");
    const later = reportFile("newer", "json", "application/json", {
      createdAt: new Date(10),
    });
    getTaskById.mockResolvedValue(task("newer", [later, source]));
    const user = openRuns(false, false, [], source.id);
    await user.click(screen.getByRole("button", { name: "Report files" }));
    await user.click(
      await screen.findByRole("button", { name: "Recover market comparison" }),
    );
    expect(execute).toHaveBeenCalledWith(
      {
        kind: "import_audit",
        body: { taskId: "newer", fileId: source.id, recoverMarkets: true },
      },
      "Market comparison checked",
    );
  });

  it("uses the archived Task read and omits unfinished, unrelated and untrusted attachments", async () => {
    const pdf = reportFile("newer", "pdf", "application/pdf");
    getTaskById
      .mockRejectedValueOnce(
        new CoreApiRequestError("Not found", { status: 404 }),
      )
      .mockResolvedValueOnce({
        data: {
          ...task("newer", [
            pdf,
            reportFile("newer", "md", "text/markdown", { status: "PENDING" }),
            reportFile("newer", "data.json", "application/json", {
              uploader: null,
            }),
            reportFile("newer", "json", "application/json", {
              fileUrl: "https://files.example/tasks/newer/report.json",
            }),
            reportFile("newer", "md", "text/markdown", {
              fileUrl:
                "https://store.public.blob.vercel-storage.com/tasks/other/report.md",
            }),
            reportFile("newer", "json", "application/json", {
              name: "search-console-private.json",
            }),
          ]).data,
          archivedAt: new Date(),
        },
      });
    const user = openRuns();
    await user.click(screen.getByRole("button", { name: "Report files" }));
    expect(
      await screen.findByRole("link", { name: "Open PDF" }),
    ).toHaveAttribute("href", pdf.fileUrl);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(getTaskById).toHaveBeenLastCalledWith("newer", { archived: "true" });
  });

  it("names both Tasks when the check and time labels match, and keeps English on the portaled options", async () => {
    getTaskById.mockResolvedValue(task("newer", []));
    const user = openRuns(true);
    await user.click(screen.getByRole("button", { name: "Report files" }));
    const select = screen.getByRole("combobox", { name: "Check" });
    expect(select).toHaveAttribute("lang", "en");
    await user.click(select);
    const list = await screen.findByRole("listbox");
    expect(list.closest("[lang]")).toHaveAttribute("lang", "en");
    const options = within(list).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Task older"),
      expect.stringContaining("Task newer"),
    ]);
  });

  it.each([true, false])(
    "ends loading without a usable identity or Task grant (signed in %s)",
    async (signedIn) => {
      viewer.id = signedIn ? "reader" : null;
      getTaskById.mockRejectedValue(
        new CoreApiRequestError("Forbidden", { status: 403 }),
      );
      const user = openRuns();
      await user.click(screen.getByRole("button", { name: "Report files" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "You do not have access",
      );
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(getTaskById).toHaveBeenCalledTimes(signedIn ? 1 : 0);
    },
  );
  it("shows a failed authorized read and lets the reader try again", async () => {
    getTaskById
      .mockRejectedValueOnce(
        new CoreApiRequestError("Unavailable", { status: 502 }),
      )
      .mockResolvedValueOnce(task("newer", []));
    const user = openRuns();
    await user.click(screen.getByRole("button", { name: "Report files" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("This run has no report files available."),
    ).toBeVisible();
    expect(screen.queryAllByRole("link")).toEqual([]);
    const pdf = reportFile("newer", "pdf", "application/pdf");
    getTaskById.mockResolvedValueOnce(task("newer", [pdf]));
    await user.click(screen.getByRole("button", { name: "Refresh files" }));
    expect(
      await screen.findByRole("link", { name: "Open PDF" }),
    ).toHaveAttribute("href", pdf.fileUrl);
  });
});
