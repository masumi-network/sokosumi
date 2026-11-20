import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import { ConnectionsTabs } from "./connections-tabs";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function renderTabs(searchParams: string) {
  const onUrlUpdate = vi.fn();
  render(
    <NuqsTestingAdapter
      searchParams={searchParams}
      onUrlUpdate={onUrlUpdate}
      hasMemory
    >
      <ConnectionsTabs
        connectedAppsContent={<div>Connected apps panel</div>}
        mcpContent={<div>MCP panel</div>}
      />
    </NuqsTestingAdapter>,
  );
  return onUrlUpdate;
}

describe("ConnectionsTabs", () => {
  it("falls back to connected-apps when the tab query parameter is invalid", () => {
    renderTabs("?tab=invalid-tab");

    expect(
      screen.getByRole("tab", { name: "tabs.connectedApps" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Connected apps panel")).toBeVisible();
  });

  it("opens the requested valid tab and updates the URL when switching", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = renderTabs("?tab=mcp");

    expect(screen.getByRole("tab", { name: "tabs.mcp" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("MCP panel")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "tabs.connectedApps" }));

    expect(screen.getByText("Connected apps panel")).toBeVisible();
    expect(onUrlUpdate).toHaveBeenCalled();
  });
});
