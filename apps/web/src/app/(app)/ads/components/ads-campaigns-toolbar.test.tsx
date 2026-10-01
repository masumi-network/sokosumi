import type { ProjectAdAccount } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdsCampaignsToolbar } from "./ads-campaigns-toolbar";

const ACCOUNTS = [
  { id: "a1", name: "Main" },
  { id: "a2", name: "Second" },
] as ProjectAdAccount[];

function renderToolbar(
  accounts: ProjectAdAccount[],
  range: "7d" | "30d" = "30d",
) {
  const onUrlUpdate = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <AdsCampaignsToolbar
          accountId={accounts[0].id}
          accounts={accounts}
          range={range}
        />
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
  return onUrlUpdate;
}

describe("AdsCampaignsToolbar", () => {
  it("hides the account switcher with a single account", () => {
    renderToolbar([ACCOUNTS[0]]);

    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("offers the account switcher from two accounts", () => {
    renderToolbar(ACCOUNTS);

    expect(
      screen.getByRole("combobox", { name: "Ad account" }),
    ).toHaveTextContent("Main");
  });

  it("marks the current range and writes a new one to the URL", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = renderToolbar(ACCOUNTS);

    expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "7 days" }));

    expect(onUrlUpdate.mock.calls[0][0].searchParams.get("range")).toBe("7d");
  });

  it("keeps the selected range when it is clicked again", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = renderToolbar(ACCOUNTS);

    await user.click(screen.getByRole("radio", { name: "30 days" }));

    expect(onUrlUpdate).not.toHaveBeenCalled();
  });
});
