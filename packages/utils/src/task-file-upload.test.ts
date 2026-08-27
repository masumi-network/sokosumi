import { describe, expect, it } from "vitest";

import {
  buildTaskFilePathname,
  buildTaskFilePrefix,
  clampTaskFileName,
  isOwnedTaskFileUrl,
  resolveTaskFileContentType,
  sanitizeTaskFileFilename,
  TASK_FILE_MAX_NAME_LENGTH,
  TASK_FILE_MAX_SIZE_BYTES,
} from "./task-file-upload.js";

describe("task file upload helpers", () => {
  it("exposes a 50 MB max size", () => {
    expect(TASK_FILE_MAX_SIZE_BYTES).toBe(100 * 1024 * 1024);
  });

  it("resolves allowed MIME types and rejects SVG", () => {
    expect(resolveTaskFileContentType("report.pdf", "application/pdf")).toBe(
      "application/pdf",
    );
    expect(resolveTaskFileContentType("notes.txt", "text/plain")).toBe(
      "text/plain",
    );
    expect(resolveTaskFileContentType("icon.svg", "image/svg+xml")).toBeNull();
    expect(resolveTaskFileContentType("icon.svg", "")).toBeNull();
    // Declared allowlisted MIME must not bypass the .svg extension block
    expect(resolveTaskFileContentType("icon.svg", "image/png")).toBeNull();
    expect(resolveTaskFileContentType("ICON.SVG", "image/jpeg")).toBeNull();
    expect(
      resolveTaskFileContentType("malware.exe", "application/x-msdownload"),
    ).toBeNull();
  });

  it("clamps display names to the max length", () => {
    expect(clampTaskFileName("  report.pdf  ")).toBe("report.pdf");
    expect(clampTaskFileName("   ")).toBe("file");
    expect(clampTaskFileName("a".repeat(TASK_FILE_MAX_NAME_LENGTH + 10))).toBe(
      "a".repeat(TASK_FILE_MAX_NAME_LENGTH),
    );
  });

  it("preserves the file extension when clamping long names", () => {
    const longPdf = `${"a".repeat(300)}.pdf`;
    expect(clampTaskFileName(longPdf)).toBe(
      `${"a".repeat(TASK_FILE_MAX_NAME_LENGTH - ".pdf".length)}.pdf`,
    );
    expect(clampTaskFileName(longPdf)).toHaveLength(TASK_FILE_MAX_NAME_LENGTH);

    const longDocx = `${"b".repeat(300)}.docx`;
    expect(clampTaskFileName(longDocx).endsWith(".docx")).toBe(true);
    expect(clampTaskFileName(longDocx)).toHaveLength(TASK_FILE_MAX_NAME_LENGTH);

    // No usable extension → hard slice
    expect(clampTaskFileName("a".repeat(300))).toBe(
      "a".repeat(TASK_FILE_MAX_NAME_LENGTH),
    );
  });

  it("builds the task file prefix", () => {
    expect(buildTaskFilePrefix("tsk_123")).toBe("tasks/tsk_123/");
  });

  it("sanitizes uploaded file names", () => {
    expect(sanitizeTaskFileFilename(" ../my file(1).pdf ")).toBe(
      "my_file1.pdf",
    );
  });

  it("builds the full upload pathname", () => {
    expect(buildTaskFilePathname("tsk_123", "hello world.txt")).toBe(
      "tasks/tsk_123/hello_world.txt",
    );
  });

  it("detects owned task file URLs", () => {
    expect(
      isOwnedTaskFileUrl(
        "https://blob.example.com/tasks/tsk_123/hello_world-abc.txt",
        "tsk_123",
      ),
    ).toBe(true);
    expect(
      isOwnedTaskFileUrl(
        "https://blob.example.com/tasks/other/hello.txt",
        "tsk_123",
      ),
    ).toBe(false);
    expect(isOwnedTaskFileUrl("not-a-url", "tsk_123")).toBe(false);
  });
});
