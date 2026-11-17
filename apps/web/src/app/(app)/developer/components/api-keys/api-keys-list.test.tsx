import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Nov 16, 2026" }),
}));

import { ApiKeysList } from "./api-keys-list";
import type { ApiKeyRecord } from "./types";

const apiKey = {
  id: "key_1",
  name: "Recipe sync script",
  start: "PEVpFM",
  enabled: true,
  createdAt: new Date("2026-11-16T10:00:00Z"),
} as ApiKeyRecord;

describe("ApiKeysList", () => {
  // Phones get one stacked row per key, so status and actions sit on screen
  // instead of past the table's sideways scroll.
  it("lists each key with its status and actions as a stacked row", () => {
    const onToggleStatus = vi.fn(async () => {});
    const onDeleteClick = vi.fn();
    render(
      <ApiKeysList
        apiKeys={[apiKey]}
        isInitialLoading={false}
        error={null}
        onRetry={vi.fn()}
        onToggleStatus={onToggleStatus}
        onDeleteClick={onDeleteClick}
      />,
    );

    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Recipe sync script")).toBeInTheDocument();
    expect(within(row).getByText("Status.enabled")).toBeInTheDocument();
    expect(within(row).getByText("PEVpFM")).toBeInTheDocument();

    fireEvent.click(
      within(row).getByRole("button", { name: "Actions.disableTooltip" }),
    );
    expect(onToggleStatus).toHaveBeenCalledWith(apiKey);
    fireEvent.click(
      within(row).getByRole("button", { name: "Actions.deleteTooltip" }),
    );
    expect(onDeleteClick).toHaveBeenCalledWith(apiKey);
  });
});
