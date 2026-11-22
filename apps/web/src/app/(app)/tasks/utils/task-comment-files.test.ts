import type { TaskFile } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { commentFiles } from "@/app/tasks/utils/task-comment-files";

function file(name: string, over: Partial<TaskFile> = {}): TaskFile {
  return {
    id: `id-${name}`,
    name,
    fileUrl: `https://blob.example/tasks/t/${name}`,
    mimeType: null,
    size: 10,
    status: "READY",
    sourceUrl: null,
    ...over,
  } as TaskFile;
}

const names = (comment: string, files: TaskFile[]) =>
  commentFiles(comment, files).map((shown) => shown.name);

describe("commentFiles", () => {
  const report = [
    file("seo-report-1.md"),
    file("seo-report-1.pdf"),
    file("seo-report-1.data.json"),
  ];

  it("shows the Task file a comment names in plain text, with the file's own URL", () => {
    const shown = commentFiles(
      "The Report is in the file seo-report-1.pdf.",
      report,
    );
    expect(shown.map(({ name, fileUrl }) => [name, fileUrl])).toEqual([
      ["seo-report-1.pdf", "https://blob.example/tasks/t/seo-report-1.pdf"],
    ]);
  });

  it("reads a name at the start, in emphasis and before a comma", () => {
    expect(names("seo-report-1.md holds it", report)).toEqual([
      "seo-report-1.md",
    ]);
    expect(
      names(
        "_The Report is also in the file seo-report-1.pdf, as a PDF._",
        report,
      ),
    ).toEqual(["seo-report-1.pdf"]);
  });

  it("does not show a file whose name is only a part of a longer name or of a path", () => {
    const files = [file("report.md"), file("a.json")];
    expect(names("See my-report.md and report.md.bak", files)).toEqual([]);
    expect(names("See docs/report.md and data.a.json", files)).toEqual([]);
    expect(names("See report.mdx", files)).toEqual([]);
  });

  it("does not take a name without an extension for a file", () => {
    expect(names("The report is done.", [file("report")])).toEqual([]);
  });

  it("shows a file once when the comment links it and names it", () => {
    const shown = commentFiles(
      "[Report](https://blob.example/tasks/t/seo-report-1.pdf) is seo-report-1.pdf.",
      report,
    );
    expect(shown.map(({ name }) => name)).toEqual(["seo-report-1.pdf"]);
  });

  it("shows nothing for a missing comment", () => {
    expect(commentFiles(null, report)).toEqual([]);
  });
});
