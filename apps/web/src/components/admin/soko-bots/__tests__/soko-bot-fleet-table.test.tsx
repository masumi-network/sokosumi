import type {
  AdminSokoBotList,
  AdminSokoBotListItem,
} from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useFormatter: () => ({ dateTime: () => "date" }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/lib/actions/admin-soko-bots/action", () => ({
  listAdminSokoBotsAction: (...args: unknown[]) => listMock(...args),
  deleteAllAdminCusosAction: vi.fn(),
}));

import { SokoBotFleetTable } from "../soko-bot-fleet-table.client";

function bot(overrides: Partial<AdminSokoBotListItem>): AdminSokoBotListItem {
  return {
    id: "bot_1",
    name: "Ada's bot",
    status: "IDLE",
    archivedAt: null,
    versionId: "v36",
    kind: "assistant",
    runtimeVersion: null,
    runtimeDeployment: null,
    lastActivityAt: new Date("2026-11-25T10:00:00.000Z"),
    lastSucceededAt: null,
    lastFailedAt: null,
    consecutiveTurnFailures: 0,
    outOfCredits: false,
    turnCount: 3,
    pendingDecisionCount: 0,
    scheduleCount: 0,
    owner: { id: "u1", name: "Ada", email: "ada@example.com" },
    evalLane: false,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-25T10:00:00.000Z"),
    ...overrides,
  };
}

function list(items: AdminSokoBotListItem[]): AdminSokoBotList {
  return {
    items,
    total: items.length,
    summary: {
      active: items.length,
      activeRecently: items.length,
      pendingDecisions: 0,
      attention: [],
      attentionTotal: 0,
    },
  };
}

describe("SokoBotFleetTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks Core for eval bots only when the switch is on, and tags them", async () => {
    listMock.mockResolvedValue({
      ok: true,
      value: list([
        bot({}),
        bot({ id: "bot_eval", name: "Cuso", kind: "cmo", evalLane: true }),
      ]),
    });
    render(<SokoBotFleetTable initialList={list([bot({})])} limit={100} />);

    expect(screen.queryByText("evalBadge")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "showEvals" }));

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ evals: "include", kind: "all" }),
      ),
    );
    expect(await screen.findByText("evalBadge")).toBeInTheDocument();
  });

  it("keeps eval bots out when the fleet kind changes with the switch off", async () => {
    listMock.mockResolvedValue({ ok: true, value: list([]) });
    render(<SokoBotFleetTable initialList={list([bot({})])} limit={100} />);

    fireEvent.click(screen.getByRole("radio", { name: "kind.cmo" }));

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ evals: "exclude", kind: "cmo" }),
      ),
    );
  });
});
