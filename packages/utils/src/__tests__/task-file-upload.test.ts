import { describe, expect, it } from "vitest";

import {
  buildTaskFilePathname,
  buildTaskFilePrefix,
  isOwnedTaskFileUrl,
  sanitizeTaskFileFilename,
  TASK_FILE_MAX_SIZE_BYTES,
} from "../task-file-upload.js";

describe("task file upload helpers", () => {
  it("exposes a 50 MB max size", () => {
    expect(TASK_FILE_MAX_SIZE_BYTES).toBe(50 * 1024 * 1024);
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
