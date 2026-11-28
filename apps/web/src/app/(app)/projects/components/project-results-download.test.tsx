import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TestQueryProvider } from "@/test/query-provider";
import en from "../../../../../messages/en.json";

const { loadProjectResults, exportAs, exportedWith } = vi.hoisted(() => ({
  loadProjectResults: vi.fn(),
  exportAs: vi.fn(async () => {}),
  exportedWith: {
    markdown: null as null | (() => Promise<string>),
    fileName: "",
  },
}));

vi.mock("@/lib/actions/project/results-action", () => ({
  loadProjectResults,
}));

// The PDF and Word routes are covered with that hook; here only what it is handed counts.
vi.mock("@/components/jobs/job-details/download-button", () => ({
  useExportMarkdownFile: (
    markdown: () => Promise<string>,
    fileName: string,
  ) => {
    exportedWith.markdown = markdown;
    exportedWith.fileName = fileName;
    return exportAs;
  },
}));

import { ProjectResultsDownload } from "./project-results-download";

const PROJECT_ID = "01960001-0001-7001-8001-000000000001";

function renderDownload() {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TestQueryProvider>
        <ProjectResultsDownload projectId={PROJECT_ID} projectName="Launch" />
      </TestQueryProvider>
    </NextIntlClientProvider>,
  );
  return userEvent.click(
    screen.getByRole("button", { name: "Download results" }),
  );
}

describe("ProjectResultsDownload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("puts the ticked results into one PDF named after the Project", async () => {
    loadProjectResults.mockResolvedValue({
      ok: true,
      value: [
        {
          id: "task-a",
          name: "Write the press release",
          identifier: "LAU-1",
          finishedAt: "2026-11-03T09:00:00.000Z",
          result: "The release text.",
        },
        {
          id: "task-b",
          name: "Pick a date",
          identifier: null,
          finishedAt: "2026-11-04T09:00:00.000Z",
          result: "Tuesday.",
        },
      ],
    });

    await renderDownload();

    expect(loadProjectResults).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    const date = await screen.findByRole("checkbox", { name: /Pick a date/ });
    expect(date).toBeChecked();
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();

    await userEvent.click(date);
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));

    expect(exportAs).toHaveBeenCalledWith("pdf");
    expect(exportedWith.fileName).toBe("Launch results");
    const markdown = await exportedWith.markdown?.();
    expect(markdown).toContain("# Launch: results");
    expect(markdown).toContain("## LAU\\-1 Write the press release");
    expect(markdown).toContain("Finished Nov 3, 2026");
    expect(markdown).toContain(
      `[Open in Sokosumi](${window.location.origin}/tasks/task-a)`,
    );
    expect(markdown).toContain("The release text.");
    expect(markdown).not.toContain("Tuesday.");
  });

  it("offers no download when nothing is ticked", async () => {
    loadProjectResults.mockResolvedValue({
      ok: true,
      value: [
        {
          id: "task-a",
          name: "Write the press release",
          identifier: null,
          finishedAt: "2026-11-03T09:00:00.000Z",
          result: "The release text.",
        },
      ],
    });

    await renderDownload();
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Select all" }),
    );

    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Download Word" }),
    ).toBeDisabled();
  });

  it("says when the Project has no results yet", async () => {
    loadProjectResults.mockResolvedValue({ ok: true, value: [] });

    await renderDownload();

    expect(await screen.findByText(/No results yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  });

  it("offers another try when the results did not load", async () => {
    loadProjectResults
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR" },
      })
      .mockResolvedValueOnce({ ok: true, value: [] });

    await renderDownload();
    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );

    await waitFor(() =>
      expect(screen.getByText(/No results yet/)).toBeInTheDocument(),
    );
    expect(loadProjectResults).toHaveBeenCalledTimes(2);
  });
});
