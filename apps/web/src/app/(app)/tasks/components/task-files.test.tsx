import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { Activity, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { type TaskFileListItem, TaskFiles } from "./task-files";

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

function filesView(files: TaskFileListItem[], taskId = "task-1") {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{
        Components: {
          Tasks: {
            TaskFileStatusBadge: { pending: "Pending", failed: "Failed" },
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
