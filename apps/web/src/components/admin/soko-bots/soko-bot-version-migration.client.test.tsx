import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { migrateActionMock, refreshMock } = vi.hoisted(() => ({
  migrateActionMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/actions/admin-soko-bots/action", () => ({
  migrateAdminSokoBotVersionsAction: (...args: unknown[]) =>
    migrateActionMock(...args),
}));

import { SokoBotVersionMigration } from "./soko-bot-version-migration.client";

function renderMigration() {
  render(
    <SokoBotVersionMigration
      versions={[
        { id: "v16", name: "v16" },
        { id: "v19", name: "v19" },
      ]}
      defaultVersionId="v19"
      inUse={[{ versionId: "v16", count: 5 }]}
    />,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Move the fleet to Luna" },
  });
}

describe("SokoBotVersionMigration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    migrateActionMock.mockResolvedValue({
      ok: true,
      value: {
        total: 5,
        moved: 5,
        notified: 4,
        alreadyOnVersion: 0,
        failed: 0,
        failures: [],
      },
    });
  });

  it("tells owners by default", async () => {
    renderMigration();
    expect(screen.getByRole("checkbox")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
    await waitFor(() => expect(migrateActionMock).toHaveBeenCalled());
    expect(migrateActionMock.mock.calls[0][0].input).toMatchObject({
      toVersionId: "v19",
      notifyOwners: true,
    });
  });

  it("moves quietly when the box is cleared", async () => {
    renderMigration();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
    await waitFor(() => expect(migrateActionMock).toHaveBeenCalled());
    expect(migrateActionMock.mock.calls[0][0].input.notifyOwners).toBe(false);
  });
});
