import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString(),
  }),
}));

const listTransactionHistoryMock = vi.fn();

vi.mock("@/lib/services/transaction-history.service", () => ({
  transactionHistoryService: {
    listTransactionHistory: (...args: unknown[]) =>
      listTransactionHistoryMock(...args),
  },
}));

const { TransactionHistorySection } = await import(
  "@/components/billing/transaction-history-section"
);

describe("TransactionHistorySection", () => {
  it("shows the empty state when there are no transactions", async () => {
    listTransactionHistoryMock.mockResolvedValue({
      transactions: [],
      pagination: null,
    });

    render(
      await TransactionHistorySection({ returnPath: "/billing?tab=history" }),
    );

    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("links a job-purchase row to the job when jobId and agentId are present", async () => {
    listTransactionHistoryMock.mockResolvedValue({
      transactions: [
        {
          id: "txn_1",
          createdAt: new Date("2026-01-15T10:30:00.000Z"),
          credits: -5,
          source: "job_purchase",
          jobId: "job_1",
          agentId: "agent_1",
        },
      ],
      pagination: null,
    });

    render(
      await TransactionHistorySection({ returnPath: "/billing?tab=history" }),
    );

    const link = screen.getByRole("link", { name: "sources.jobPurchase" });
    expect(link).toHaveAttribute("href", "/agents/agent_1/jobs/job_1");
  });

  it("renders a plain label (no link) for a row with no job", async () => {
    listTransactionHistoryMock.mockResolvedValue({
      transactions: [
        {
          id: "txn_1",
          createdAt: new Date("2026-01-15T10:30:00.000Z"),
          credits: 1000,
          source: "credit_grant",
          jobId: null,
          agentId: null,
        },
      ],
      pagination: null,
    });

    render(
      await TransactionHistorySection({ returnPath: "/billing?tab=history" }),
    );

    expect(screen.getByText("sources.creditGrant")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders a load-more link built from returnPath when a next cursor exists", async () => {
    listTransactionHistoryMock.mockResolvedValue({
      transactions: [],
      pagination: {
        cursor: null,
        limit: 20,
        total: 40,
        nextCursor: "txn_20",
      },
    });

    render(
      await TransactionHistorySection({ returnPath: "/billing?tab=history" }),
    );

    const loadMore = screen.getByRole("link", { name: "loadMore" });
    expect(loadMore).toHaveAttribute(
      "href",
      "/billing?tab=history&historyCursor=txn_20",
    );
  });

  it("passes the cursor through to the history service", async () => {
    listTransactionHistoryMock.mockResolvedValue({
      transactions: [],
      pagination: null,
    });

    await TransactionHistorySection({
      cursor: "txn_10",
      returnPath: "/billing?tab=history",
    });

    expect(listTransactionHistoryMock).toHaveBeenCalledWith({
      cursor: "txn_10",
    });
  });
});
