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

function renderMigration(
  defaultVersionId = "v20",
  inUse = [{ versionId: "v16", count: 5 }],
) {
  render(
    <SokoBotVersionMigration
      versions={[
        { id: "v16", name: "v16", euPinned: true },
        { id: "v19", name: "v19", euPinned: false },
        { id: "v20", name: "v20", euPinned: true },
        { id: "v21", name: "v21", euPinned: false },
      ]}
      defaultVersionId={defaultVersionId}
      inUse={inUse}
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
      toVersionId: "v20",
      notifyOwners: true,
    });
  });

  it("locks the notice on for a version that runs outside the EU", async () => {
    renderMigration("v19");
    const box = screen.getByRole("checkbox");
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
    await waitFor(() => expect(migrateActionMock).toHaveBeenCalled());
    expect(migrateActionMock.mock.calls[0][0].input.notifyOwners).toBe(true);
  });

  it("lets a move that stays outside the EU go quietly", async () => {
    renderMigration("v21", [{ versionId: "v19", count: 5 }]);
    const box = screen.getByRole("checkbox");
    expect(box).toBeEnabled();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
    await waitFor(() => expect(migrateActionMock).toHaveBeenCalled());
    expect(migrateActionMock.mock.calls[0][0].input.notifyOwners).toBe(false);
  });

  it("moves quietly when the box is cleared", async () => {
    renderMigration();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
    await waitFor(() => expect(migrateActionMock).toHaveBeenCalled());
    expect(migrateActionMock.mock.calls[0][0].input.notifyOwners).toBe(false);
  });
});
