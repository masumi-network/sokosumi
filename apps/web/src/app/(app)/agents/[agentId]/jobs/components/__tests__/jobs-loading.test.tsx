import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobsListHeader } from "@/app/agents/[agentId]/jobs/components/jobs-list-header";
import {
  JobDetailSkeleton,
  JobsListHeaderSkeleton,
  JobsPanesSkeleton,
} from "@/app/agents/[agentId]/jobs/components/jobs-loading";
import { AgentLoadingStatusRegion } from "@/app/agents/[agentId]/jobs/components/jobs-loading-status";
import { createMockCoreAgent } from "@/lib/helpers/__tests__/fixtures/core-agent";

vi.mock("@/components/agents/agent-icon", () => ({
  AgentIcon: () => null,
}));

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

  it("holds the header's back-link row at the widths that show it", () => {
    const { container: loaded } = render(
      <JobsListHeader agent={createMockCoreAgent({ id: "agent-1" })} />,
    );
    const { container: bones } = render(<JobsListHeaderSkeleton />);

    const backRow = loaded.querySelector("a")?.parentElement;
    const boneRows = bones.firstElementChild?.children;
    expect(backRow).toBeTruthy();
    expect(boneRows?.[0]?.className).toBe(backRow?.className);
    expect(bones.firstElementChild?.className).toBe(
      loaded.firstElementChild?.className,
    );
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
