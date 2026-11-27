import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageListSearchContext } from "@/components/page-list-search";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
  useFormatter: () => ({
    dateTime: () => "Nov 16, 2026",
    relativeTime: () => "2h ago",
  }),
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

it("puts a key name ahead of newer status matches on both the table and the phone list", () => {
  const otherKeys = Array.from({ length: 6 }, (_, index) => ({
    ...apiKey,
    id: `other-${index}`,
    name: `Sync job ${index}`,
  }));
  const byName = {
    ...apiKey,
    name: "Enabled billing export",
    enabled: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  render(
    <PageListSearchContext.Provider
      value={{ query: "enabled", register: () => () => {} }}
    >
      <ApiKeysList
        apiKeys={[
          ...otherKeys,
          byName,
          { ...byName, id: "unrelated", name: "Hidden job" },
        ]}
        isInitialLoading={false}
        error={null}
        onRetry={vi.fn()}
        onToggleStatus={vi.fn()}
        onDeleteClick={vi.fn()}
      />
    </PageListSearchContext.Provider>,
  );

  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(byName.name);
  const desktop = within(screen.getByRole("table"));
  expect(desktop.getAllByRole("row")[1]).toHaveTextContent(byName.name);
  expect(screen.queryByText("Hidden job")).not.toBeInTheDocument();
});

// Better Auth stamps `lastRequest` on each verified request. An empty one is
// "no recorded use", never "never used": old keys may not be tracked.
it("shows when each key was last used, or that no use is recorded", () => {
  render(
    <ApiKeysList
      apiKeys={[
        { ...apiKey, lastRequest: new Date(Date.now() - 2 * 3_600_000) },
        { ...apiKey, id: "key_2", name: "Unused key", lastRequest: null },
      ]}
      isInitialLoading={false}
      error={null}
      onRetry={vi.fn()}
      onToggleStatus={vi.fn()}
      onDeleteClick={vi.fn()}
    />,
  );

  const [used, unused] = screen.getAllByRole("listitem");
  expect(used).toHaveTextContent("LastUsed.used 2h ago");
  expect(unused).toHaveTextContent("LastUsed.none");
  const table = within(screen.getByRole("table"));
  expect(table.getByText("Table.lastUsed")).toBeInTheDocument();
  expect(table.getByText("2h ago")).toBeInTheDocument();
  expect(table.getByText("LastUsed.none")).toBeInTheDocument();
});
