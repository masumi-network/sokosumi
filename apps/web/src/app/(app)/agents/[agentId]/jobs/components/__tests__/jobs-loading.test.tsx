import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  JobDetailSkeleton,
  JobsPanesSkeleton,
} from "@/app/agents/[agentId]/jobs/components/jobs-loading";
import { AgentLoadingStatusRegion } from "@/app/agents/[agentId]/jobs/components/jobs-loading-status";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const JOBS_DIR = join(process.cwd(), "src/app/(app)/agents/[agentId]/jobs");
const DYNAMIC_SHELL_API_RE =
  /\b(?:cookies|headers|connection|getTranslations|getLocale|getMessages|getSession)\s*\(/;

describe("jobs loading shells", () => {
  it("keeps the status region empty while nothing loads", () => {
    render(<AgentLoadingStatusRegion />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("announces the jobs loading in the standing region", () => {
    const { rerender } = render(<AgentLoadingStatusRegion />);
    const status = screen.getByRole("status");
    rerender(
      <>
        <AgentLoadingStatusRegion />
        <JobsPanesSkeleton header={<h1>Agent</h1>} />
      </>,
    );

    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("jobs");
    expect(screen.getByRole("heading", { name: "Agent" })).toBeInTheDocument();
  });

  it("announces one job loading and clears when it lands", () => {
    const { rerender } = render(
      <>
        <AgentLoadingStatusRegion />
        <JobDetailSkeleton />
      </>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("job");

    rerender(<AgentLoadingStatusRegion />);
    expect(status).toBeEmptyDOMElement();
  });

  it("draws the skeletons on the server; only the status is a client module", () => {
    const read = (file: string) =>
      readFileSync(join(JOBS_DIR, "components", file), "utf8");
    expect(read("jobs-loading.tsx")).not.toMatch(/^\s*["']use client["']/);
    expect(read("jobs-loading-status.tsx")).toMatch(/^\s*["']use client["']/);
  });

  it.each([
    "components/jobs-loading.tsx",
    "components/jobs-loading-status.tsx",
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
