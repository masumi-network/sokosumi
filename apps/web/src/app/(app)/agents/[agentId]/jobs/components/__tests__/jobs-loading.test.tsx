import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JobDetailSkeleton, JobsPanesSkeleton } from "../jobs-loading";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const JOBS_DIR = join(process.cwd(), "src/app/(app)/agents/[agentId]/jobs");
const DYNAMIC_SHELL_API_RE =
  /\b(?:cookies|headers|connection|getTranslations|getLocale|getMessages|getSession)\s*\(/;

describe("jobs loading shells", () => {
  it("announces the jobs loading and keeps the header slot", () => {
    render(<JobsPanesSkeleton header={<h1>Agent</h1>} />);

    expect(screen.getByRole("status")).toHaveTextContent("jobs");
    expect(screen.getByRole("heading", { name: "Agent" })).toBeInTheDocument();
  });

  it("announces one job loading", () => {
    render(<JobDetailSkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("job");
  });

  it.each([
    "components/jobs-loading.tsx",
    "@right/loading.tsx",
    "@right/[jobId]/loading.tsx",
    "@modal/[jobId]/loading.tsx",
  ])("%s stays sync for Instant Nav", (file) => {
    const code = readFileSync(join(JOBS_DIR, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(DYNAMIC_SHELL_API_RE);
  });
});
