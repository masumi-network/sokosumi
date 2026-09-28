import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  HistoryListItem,
  type HistoryListItemLabels,
} from "@/app/history/components/history-list-item";
import type { TransactionHistoryItem } from "@/lib/services/history.service";

const iconMocks = vi.hoisted(() => ({
  agentIcon: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTimeZone: () => "UTC",
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    number: (value: number) => value.toLocaleString("en-US"),
  }),
}));

vi.mock("@/components/agents/agent-icon", () => ({
  AgentIcon: (props: {
    agent: { name: string; icon: string | null };
    className?: string;
  }) => {
    iconMocks.agentIcon(props);
    return <span data-testid="agent-icon" />;
  },
}));

const labels: HistoryListItemLabels = {
  credit: "credit",
  credits: "credits",
  noDescription: "No description",
  consumed: "Consumed",
  kind: {
    job: "Agent job",
    image: "Image",
    task: "Task",
    coworker: "Coworker",
    sokoBot: "Soko Bot",
    topUp: "Top up",
    unattributed: "Other",
  },
};

const base = {
  consumedAt: new Date("2025-08-19T10:00:00.000Z"),
  credits: 2,
  description: null,
  owner: null,
  projectId: null,
} as const;

function renderItem(item: TransactionHistoryItem) {
  return render(
    <HistoryListItem item={item} labels={labels} activeOrganizationId={null} />,
  );
}

describe("HistoryListItem", () => {
  it("shows the consumption date with its year, not a relative label", () => {
    renderItem({
      ...base,
      kind: "task",
      id: "tx-1",
      title: "Summarise the report",
      taskId: "task-1",
      taskEventId: "event-1",
    });

    // The bug this surface was rebuilt for: a year-old entry that reads
    // "Yesterday", or a bare "Aug 19" that does not say which August.
    const time = screen.getByText("Aug 19, 2025");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "2025-08-19T10:00:00.000Z");
  });

  it("renders when consumedAt is an ISO string from the server boundary", () => {
    renderItem({
      ...base,
      kind: "task",
      id: "tx-1",
      title: "Summarise the report",
      consumedAt: "2025-08-19T10:00:00.000Z" as unknown as Date,
      taskId: "task-1",
      taskEventId: "event-1",
    });

    expect(screen.getByText("Aug 19, 2025")).toBeInTheDocument();
  });

  it("shows the credits taken, always as a positive amount", () => {
    renderItem({
      ...base,
      kind: "job",
      id: "tx-2",
      title: "Research competitors",
      credits: 5,
      jobId: "job-1",
      agentId: "agent-1",
      agentName: "Research Agent",
      agentIcon: null,
    });

    expect(screen.getByText("5 credits")).toBeInTheDocument();
  });

  it("uses the singular unit for exactly one credit", () => {
    renderItem({
      ...base,
      kind: "job",
      id: "tx-3",
      title: "Research competitors",
      credits: 1,
      jobId: "job-1",
      agentId: "agent-1",
      agentName: "Research Agent",
      agentIcon: null,
    });

    expect(screen.getByText("1 credit")).toBeInTheDocument();
  });

  it("links a consumption that has a page behind it", () => {
    const { container } = renderItem({
      ...base,
      kind: "job",
      id: "tx-4",
      title: "Research competitors",
      jobId: "job-1",
      agentId: "agent-1",
      agentName: "Research Agent",
      agentIcon: null,
    });

    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "/agents/agent-1/jobs/job-1",
    );
  });

  it("renders a consumption with no destination as plain text", () => {
    const { container } = renderItem({
      ...base,
      kind: "unattributed",
      id: "tx-5",
      title: "Credit consumption",
      bucketSource: null,
    });

    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("Credit consumption")).toBeInTheDocument();
  });

  it("reports an unattributed row's credit bucket instead of inventing a source", () => {
    renderItem({
      ...base,
      kind: "unattributed",
      id: "tx-6",
      title: "Credit consumption",
      bucketSource: "STRIPE_SUBSCRIPTION_PERIOD",
    });

    expect(screen.getByText("Stripe subscription period")).toBeInTheDocument();
  });

  it("falls back to the no-description label when nothing is known", () => {
    renderItem({
      ...base,
      kind: "unattributed",
      id: "tx-7",
      title: "Credit consumption",
      bucketSource: null,
    });

    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("labels each source kind", () => {
    renderItem({
      ...base,
      kind: "coworker",
      id: "tx-8",
      title: "Ledger Coworker",
      coworkerId: "cow-1",
    });

    expect(screen.getByText("Coworker")).toBeInTheDocument();
  });

  it("shows a top up with its source and a signed amount", () => {
    renderItem({
      ...base,
      kind: "topUp",
      id: "tx-topup",
      credits: 1000,
      title: "Credit top up",
      bucketSource: "STRIPE_TOPUP",
    });

    expect(screen.getByText("Credit top up")).toBeInTheDocument();
    // The sign is what stops a top up reading as a spend. Spends stay unsigned,
    // exactly as they render on main.
    expect(screen.getByText("+1,000 credits")).toBeInTheDocument();
  });

  it("leaves a spend amount unsigned", () => {
    renderItem({
      ...base,
      kind: "sokoBot",
      id: "tx-sb",
      credits: 6,
      title: "Soko Bot usage",
      sokoBotId: "bot-1",
    });

    expect(screen.getByText("6 credits")).toBeInTheDocument();
  });
});
