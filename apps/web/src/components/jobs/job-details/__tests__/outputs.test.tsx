import { AgentJobStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { JobEvent } from "@/components/jobs/job-details/job-details-events.utils";
import JobDetailsOutputs from "@/components/jobs/job-details/outputs";
import type { Job } from "@/lib/clients/generated/core";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/default-error-boundary", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/expandable-markdown", () => ({
  ExpandableMarkdown: ({ content }: { content: string }) => (
    <div data-testid="expandable-markdown">{content}</div>
  ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <div data-testid="separator" />,
}));

vi.mock("@/components/jobs/job-details/copy-markdown", () => ({
  default: () => <button type="button">copy</button>,
}));

vi.mock("@/components/jobs/job-details/download-button", () => ({
  default: () => <button type="button">download</button>,
}));

vi.mock("@/components/jobs/job-details/maximize-markdown", () => ({
  default: () => <button type="button">maximize</button>,
}));

vi.mock("@/components/jobs/job-details/hash-group-row", () => ({
  HashGroupRow: () => <div data-testid="hash-group-row" />,
}));

vi.mock("@/components/jobs/job-details/refund-request", () => ({
  canRenderRefundRequest: () => false,
  default: () => <button type="button">refund</button>,
}));

function createJob(): Job {
  return {
    id: "job-1",
    createdAt: new Date("2026-03-26T10:00:00.000Z"),
    updatedAt: new Date("2026-03-26T10:05:00.000Z"),
    completedAt: new Date("2026-03-26T10:06:00.000Z"),
    agentId: "agent-1",
    userId: "user-1",
    organizationId: null,
    organization: null,
    projectId: null,
    taskId: null,
    name: "Shared Job",
    jobType: "FREE",
    status: SokosumiJobStatus.COMPLETED,
    credits: 0,
    onChainStatus: null,
    onChainTransactionHash: null,
    result: "final result",
    resultHash: null,
    input: null,
    inputHash: null,
    inputSchema: null,
    agentJobId: "agent-job-1",
    identifierFromPurchaser: "purchase-id",
    share: null,
    events: [],
    user: {
      id: "user-1",
      name: "Ada Lovelace",
      image: null,
    },
    workspace: {
      id: "workspace-1",
      organizationId: null,
      organization: null,
    },
    agent: {
      id: "agent-1",
      name: "Research Agent",
      overrideName: null,
      icon: null,
      image: null,
      overrideImage: null,
      legalPrivacyPolicy: null,
      overrideLegalPrivacyPolicy: null,
      legalTerms: null,
      overrideLegalTerms: null,
      legalDpa: null,
      overrideLegalDpa: null,
      legalOther: null,
      overrideLegalOther: null,
    },
  };
}

function createEvent(): JobEvent {
  return {
    id: "event-1",
    createdAt: new Date("2026-03-26T10:06:00.000Z"),
    updatedAt: new Date("2026-03-26T10:06:00.000Z"),
    status: AgentJobStatus.COMPLETED,
    inputSchema: null,
    input: null,
    result: "final result",
    blobs: [],
    links: [],
  };
}

describe("JobDetailsOutputs", () => {
  it("does not render a second share control in the outputs toolbar", () => {
    render(
      <JobDetailsOutputs
        job={createJob()}
        event={createEvent()}
        readOnly={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "download" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "copy" })).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Components.Jobs.JobDetails.JobShare.share"),
    ).not.toBeInTheDocument();
  });
});
