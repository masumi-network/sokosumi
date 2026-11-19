import { expect, it } from "vitest";
import { seoReportFileFormat } from "./seo-report-file.js";

it.each([
  ["seo-report-task.pdf", "application/pdf", "pdf"],
  ["seo-report-task.md", "text/markdown", "markdown"],
  ["seo-report-task.data.json", "application/json", "json"],
  ["seo-report-task.json", "application/json", "json"],
  ["seo-report-other.data.json", "application/json", null],
  ["seo-report-task.pdf", "application/json", null],
  ["seo-report-task.json", null, null],
  ["seo-report-task.private.json", "application/json", null],
] as const)("recognizes the Task's %s with MIME %s", (name, mime, expected) => {
  expect(seoReportFileFormat("task", name, mime)).toBe(expected);
});
