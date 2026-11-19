import type { TaskFile } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import messages from "../../../../../messages/en.json";
import { SeoReportFiles } from "./seo-report-files";
import { seoReportVersions } from "./seo-report-files-model";
import { seoTestObservation, seoTestWorkspace } from "./seo-test-fixture";

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

function openRuns(sameMinute = false) {
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
  const versions = seoReportVersions(data, { from: null, to: null });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={messages}
        formats={createFormats()}
      >
        <SeoReportFiles
          versions={versions}
          model={{ data, pending: false, execute }}
        />
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

describe("SEO report file versions", () => {
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
