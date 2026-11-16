import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { TaskCreditsUsed } from "./task-credits-used";

const { getTaskTotalMock } = vi.hoisted(() => ({
  getTaskTotalMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { credits: number }) =>
    values ? `${key}: ${values.credits}` : key,
}));

vi.mock("@/lib/services/history.service", () => ({
  historyService: { getTaskTotal: getTaskTotalMock },
}));

const TASK_ID = "01960001-0001-7001-8001-000000000042";

async function renderRow() {
  const row = await TaskCreditsUsed({ taskId: TASK_ID });
  return render(<TooltipProvider>{row as ReactElement}</TooltipProvider>);
}

describe("TaskCreditsUsed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links the net credits to this Task's transactions", async () => {
    getTaskTotalMock.mockResolvedValue({ credits: 12.5, count: 3 });

    await renderRow();

    expect(getTaskTotalMock).toHaveBeenCalledWith(TASK_ID);
    expect(
      screen.getByRole("link", { name: "creditsUsed: 12.5" }),
    ).toHaveAttribute("href", `/history?taskId=${TASK_ID}&scope=workspace`);
  });

  it("cuts the amount to cents like Transactions does", async () => {
    getTaskTotalMock.mockResolvedValue({ credits: 700.402, count: 1 });

    await renderRow();

    expect(
      screen.getByRole("link", { name: "creditsUsed: 700.4" }),
    ).toBeInTheDocument();
  });

  it("says no credits were used when the ledger has no rows", async () => {
    getTaskTotalMock.mockResolvedValue({ credits: 0, count: 0 });

    await renderRow();

    expect(screen.getByText("noCreditsUsed")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows no row when the ledger cannot be read", async () => {
    getTaskTotalMock.mockRejectedValue(new Error("403"));

    expect(await TaskCreditsUsed({ taskId: TASK_ID })).toBeNull();
  });
});
