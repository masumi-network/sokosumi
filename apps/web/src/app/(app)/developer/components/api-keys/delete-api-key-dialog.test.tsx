import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
  useFormatter: () => ({ relativeTime: () => "2d ago" }),
}));

import { DeleteApiKeyDialog } from "./delete-api-key-dialog";
import type { ApiKeyRecord } from "./types";

const DAY = 86_400_000;

function renderDialog(lastRequest: Date | null) {
  render(
    <DeleteApiKeyDialog
      apiKey={
        {
          id: "key_1",
          name: "Recipe sync script",
          enabled: true,
          createdAt: new Date("2026-11-01T10:00:00Z"),
          lastRequest,
        } as ApiKeyRecord
      }
      open
      onOpenChange={vi.fn()}
      onSuccess={vi.fn()}
      deleteApiKey={vi.fn(async () => true)}
    />,
  );
}

describe("DeleteApiKeyDialog", () => {
  it("warns that a key used in the last 7 days is still in use", () => {
    renderDialog(new Date(Date.now() - 2 * DAY));
    expect(screen.getByRole("note")).toHaveTextContent(
      "DeleteDialog.recentUse 2d ago",
    );
  });

  it.each([
    ["used over 7 days ago", new Date(Date.now() - 8 * DAY)],
    ["with no recorded use", null],
  ])("does not warn for a key %s", (_, lastRequest) => {
    renderDialog(lastRequest);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
