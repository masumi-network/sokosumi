import { seoTaskDescription } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import { isNoopTaskUpdate } from "./task-update-noop";

const audit = seoTaskDescription("Full SEO audit of 1 page.", "seo_audit", {
  price: { markupPercent: 50 },
});
const base = {
  name: "Audit",
  description: "Plain text",
  status: "DRAFT",
  projectId: "prj_1",
};

describe("isNoopTaskUpdate", () => {
  it.each([
    ["an empty update", base, {}, false, true],
    ["the same name", base, { name: "Audit" }, false, true],
    ["the same description", base, { description: "Plain text" }, false, true],
    ["a new name", base, { name: "Other" }, false, false],
    ["a new description", base, { description: "Other" }, false, false],
    ["a new status", base, { status: "QUEUED" }, false, false],
    ["a new Project", base, { projectId: "prj_2" }, false, false],
    ["an archive", base, { archive: true }, false, false],
    ["an unassign", base, {}, true, false],
    [
      "a full audit read back as people see it",
      { ...base, description: audit },
      { description: "Full SEO audit of 1 page." },
      false,
      true,
    ],
    [
      "a full audit with an edited summary",
      { ...base, description: audit },
      { description: "A different summary." },
      false,
      false,
    ],
    [
      "a plain Task whose text only matches a hidden line",
      base,
      { description: "Full SEO audit of 1 page." },
      false,
      false,
    ],
  ] as const)("%s", (_name, before, input, unassign, expected) => {
    expect(isNoopTaskUpdate(before, input, unassign)).toBe(expected);
  });
});
