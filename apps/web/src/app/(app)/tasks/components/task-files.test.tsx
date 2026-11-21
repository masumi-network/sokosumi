import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { Activity, StrictMode } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFilesArchive,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_FILES,
} from "@/lib/files-archive";
import en from "../../../../../messages/en.json";
import { type TaskFileListItem, TaskFiles } from "./task-files";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/files-archive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files-archive")>()),
  createFilesArchive: vi.fn(),
}));

vi.mock("@/components/jobs/job-details/file-chip-with-metadata", () => ({
  FileChipWithMetadata: ({
    url,
    fileName,
    mediaType,
    size,
  }: {
    url: string;
    fileName: string;
    mediaType: string;
    size: number;
  }) => (
    <a href={url} data-media-type={mediaType} data-size={size}>
      {fileName}
    </a>
  ),
}));

function makeFiles(count: number): TaskFileListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `file-${index}`,
    name: `Report ${index}.pdf`,
    fileUrl: `https://example.test/report-${index}.pdf`,
    mimeType: "application/pdf",
    size: 1024,
    status: "READY",
  }));
}

function filesView(
  files: TaskFileListItem[],
  taskId = "task-1",
  downloadAllName?: string,
) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{
        Components: {
          Tasks: {
            TaskFileStatusBadge: { pending: "Pending", failed: "Failed" },
          },
          FilesArchive: en.Components.FilesArchive,
        },
        App: {
          Tasks: {
            Detail: { downloadAll: en.App.Tasks.Detail.downloadAll },
          },
        },
      }}
    >
      <TaskFiles
        taskId={taskId}
        title="Files"
        files={files}
        expandLabel="Expand"
        collapseLabel="Show less"
        downloadAllName={downloadAllName}
      />
      <button type="button">After files</button>
    </NextIntlClientProvider>
  );
}

describe("TaskFiles", () => {
  it("hides the empty section and its toggle", () => {
    render(filesView([]));
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand" }),
    ).not.toBeInTheDocument();
  });

  it.each([1, 3])("shows all %i short-list files without a toggle", (count) => {
    render(filesView(makeFiles(count)));
    expect(screen.getByRole("heading", { name: "Files" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(count);
    expect(
      screen.queryByRole("button", { name: "Expand" }),
    ).not.toBeInTheDocument();
  });

  it("previews whole cards, expands every file in order, and collapses by keyboard", async () => {
    const user = userEvent.setup();
    const files = makeFiles(105);
    render(filesView(files));
    const toggle = screen.getByRole("button", { name: "Expand" });
    const content = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    expect(content).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      files.slice(0, 3).map((file) => file.name),
    );
    expect(content?.querySelectorAll("a")).toHaveLength(3);
    expect(screen.queryByText(files[3].name)).not.toBeInTheDocument();

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAccessibleName("Show less");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      files.map((file) => file.name),
    );
    expect(toggle).toHaveFocus();

    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(toggle).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "After files" })).toHaveFocus();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(screen.getByRole("link", { name: files[2].name })).toHaveFocus();
  });

  it("retains expansion, existing card nodes, and focus on same-task data refresh", async () => {
    const user = userEvent.setup();
    const files = makeFiles(5);
    const { rerender } = render(filesView(files));
    await user.click(screen.getByRole("button", { name: "Expand" }));
    const lastFile = screen.getByRole("link", { name: files[4].name });
    lastFile.focus();

    rerender(filesView(makeFiles(6)));
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getAllByRole("link")).toHaveLength(6);
    expect(screen.getByRole("link", { name: files[4].name })).toBe(lastFile);
    expect(lastFile).toHaveFocus();

    rerender(filesView(makeFiles(3)));
    expect(
      screen.queryByRole("button", { name: "Show less" }),
    ).not.toBeInTheDocument();
    rerender(filesView(makeFiles(5)));
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("starts collapsed when task identity changes, including when revisiting a task", async () => {
    const user = userEvent.setup();
    const { rerender } = render(filesView(makeFiles(5)));
    await user.click(screen.getByRole("button", { name: "Expand" }));
    rerender(filesView(makeFiles(5), "task-2"));
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getAllByRole("link")).toHaveLength(3);
    rerender(filesView(makeFiles(5)));
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("resets a cached route on reactivation but preserves refresh and an edit overlay", async () => {
    const user = userEvent.setup();
    function CachedTask({
      mode = "visible",
      editing = false,
      files = makeFiles(5),
    }: {
      mode?: "hidden" | "visible";
      editing?: boolean;
      files?: TaskFileListItem[];
    }) {
      return (
        <StrictMode>
          <Activity mode={mode}>{filesView(files)}</Activity>
          {editing ? <dialog open aria-label="Edit task" /> : null}
        </StrictMode>
      );
    }

    const { rerender } = render(<CachedTask />);
    await user.click(screen.getByRole("button", { name: "Expand" }));
    const toggle = screen.getByRole("button", { name: "Show less" });
    rerender(<CachedTask files={makeFiles(6)} />);
    expect(screen.getByRole("button", { name: "Show less" })).toBe(toggle);
    expect(screen.getAllByRole("link")).toHaveLength(6);

    // Intercepted edit overlays are siblings; the detail page stays active.
    rerender(<CachedTask editing />);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    rerender(<CachedTask />);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Next hides the retained page when another route becomes active.
    rerender(<CachedTask mode="hidden" />);
    expect(
      screen.queryByRole("heading", { name: "Files" }),
    ).not.toBeInTheDocument();
    rerender(<CachedTask />);
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("preserves readiness and file metadata across expansion and processing updates", async () => {
    const user = userEvent.setup();
    const files = makeFiles(5);
    files[1] = { ...files[1], status: "PENDING" };
    files[2] = { ...files[2], status: "FAILED" };
    files[3] = { ...files[3], status: "READY", fileUrl: null };
    const { rerender } = render(filesView(files));
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByText(files[3].name)).toBeInTheDocument();
    const lastFile = screen.getByRole("link", { name: files[4].name });
    expect(lastFile).toHaveAttribute("href", files[4].fileUrl);
    expect(lastFile).toHaveAttribute("data-media-type", "application/pdf");
    expect(lastFile).toHaveAttribute("data-size", "1024");

    rerender(filesView(makeFiles(5)));
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("expands public files without requiring private status fields", async () => {
    const user = userEvent.setup();
    const files = makeFiles(5).map(({ id, name, fileUrl, mimeType, size }) => ({
      id,
      name,
      fileUrl: fileUrl ?? "",
      mimeType,
      size,
      createdAt: new Date("2026-01-01"),
    }));
    render(filesView(files));
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });
});

describe("TaskFiles download all", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("offers it only on the Task page and only for two or more ready files", () => {
    const { rerender } = render(filesView(makeFiles(2)));
    expect(
      screen.queryByRole("button", { name: "Download all" }),
    ).not.toBeInTheDocument();

    const [ready, pending] = makeFiles(2);
    rerender(
      filesView(
        [ready, { ...pending, status: "PENDING" }],
        "task-1",
        "Launch plan",
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Download all" }),
    ).not.toBeInTheDocument();

    rerender(filesView(makeFiles(2), "task-1", "Launch plan"));
    expect(
      screen.getByRole("button", { name: "Download all" }),
    ).toBeInTheDocument();
  });

  it("saves one zip of the ready files and names the ones left out", async () => {
    const user = userEvent.setup();
    vi.mocked(createFilesArchive).mockResolvedValue({
      data: new ArrayBuffer(1),
      included: ["Report 0.pdf"],
      missing: ["Report 1.pdf"],
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:zip");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("Launch- plan.zip");
        expect(this.href).toBe("blob:zip");
      });
    const [a, b, c] = makeFiles(3);
    render(
      filesView([a, b, { ...c, status: "FAILED" }], "task-1", "Launch/ plan"),
    );

    await user.click(screen.getByRole("button", { name: "Download all" }));

    expect(createFilesArchive).toHaveBeenCalledWith(
      [
        { name: a.name, fileUrl: a.fileUrl },
        { name: b.name, fileUrl: b.fileUrl },
      ],
      expect.any(AbortSignal),
      MAX_ARCHIVE_BYTES,
      MAX_ARCHIVE_FILES,
    );
    expect(click).toHaveBeenCalledOnce();
    expect(toast.warning).toHaveBeenCalledWith(
      "Downloaded 1 of 2 files. Not included: Report 1.pdf. Open them one by one.",
      { duration: 15_000 },
    );
  });

  it("zips a public share's files, which carry no status, by their links", async () => {
    const user = userEvent.setup();
    vi.mocked(createFilesArchive).mockResolvedValue({
      data: new ArrayBuffer(1),
      included: ["Report 0.pdf", "Report 1.pdf"],
      missing: [],
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:zip");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const files = makeFiles(2).map(({ id, name, fileUrl, mimeType, size }) => ({
      id,
      name,
      fileUrl: fileUrl ?? "",
      mimeType,
      size,
      createdAt: new Date("2026-01-01"),
    }));
    render(filesView(files, "task-1", "Shared plan"));

    await user.click(screen.getByRole("button", { name: "Download all" }));

    expect(createFilesArchive).toHaveBeenCalledWith(
      files.map(({ name, fileUrl }) => ({ name, fileUrl })),
      expect.any(AbortSignal),
      MAX_ARCHIVE_BYTES,
      MAX_ARCHIVE_FILES,
    );
    expect(click).toHaveBeenCalledOnce();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("says so when no file could be downloaded", async () => {
    const user = userEvent.setup();
    vi.mocked(createFilesArchive).mockResolvedValue({
      data: null,
      included: [],
      missing: ["Report 0.pdf", "Report 1.pdf"],
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    render(filesView(makeFiles(2), "task-1", "Launch plan"));

    await user.click(screen.getByRole("button", { name: "Download all" }));

    expect(click).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't download the files. Try again, or open them one by one.",
    );
  });

  function RetainedTask({ mode }: { mode: "hidden" | "visible" }) {
    return (
      <Activity mode={mode}>
        {filesView(makeFiles(2), "task-1", "Launch plan")}
      </Activity>
    );
  }

  /** Each call waits until the test settles it, or its signal is aborted. */
  function pendingArchives() {
    const calls: Array<{
      signal: AbortSignal;
      settle: (archive: Awaited<ReturnType<typeof createFilesArchive>>) => void;
    }> = [];
    vi.mocked(createFilesArchive).mockImplementation(
      (_files, signal) =>
        new Promise((resolve, reject) => {
          if (!signal) throw new Error("expected a signal");
          calls.push({ signal, settle: resolve });
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    return calls;
  }

  it("cancels a running download when the page is left and lets it start again on return", async () => {
    const user = userEvent.setup();
    const calls = pendingArchives();
    const { rerender } = render(<RetainedTask mode="visible" />);
    await user.click(screen.getByRole("button", { name: "Download all" }));
    expect(
      screen.getByRole("button", { name: "Download all" }),
    ).toHaveAttribute("aria-busy", "true");

    rerender(<RetainedTask mode="hidden" />);
    expect(calls[0].signal.aborted).toBe(true);
    rerender(<RetainedTask mode="visible" />);
    const button = screen.getByRole("button", { name: "Download all" });
    expect(button).not.toHaveAttribute("aria-busy");

    await user.click(button);
    expect(calls).toHaveLength(2);
    expect(calls[1].signal.aborted).toBe(false);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("saves nothing and says nothing when the zip finishes after the page was left", async () => {
    const user = userEvent.setup();
    const calls = pendingArchives();
    vi.mocked(createFilesArchive).mockImplementationOnce(
      (_files, signal) =>
        new Promise((resolve) => {
          if (!signal) throw new Error("expected a signal");
          // Like JSZip: generation ignores the signal and still resolves.
          calls.push({ signal, settle: resolve });
        }),
    );
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const { rerender } = render(<RetainedTask mode="visible" />);
    await user.click(screen.getByRole("button", { name: "Download all" }));

    rerender(<RetainedTask mode="hidden" />);
    calls[0].settle({
      data: new ArrayBuffer(1),
      included: ["Report 0.pdf"],
      missing: ["Report 1.pdf"],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
