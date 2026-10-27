import { ProjectAdProvider } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import type { BotAdAccount } from "@/lib/soko-bot/load-bot-ad-accounts";

import messages from "../../../../../messages/en.json";
import { AdAccountsSection } from "./ad-accounts-section";

function row(
  provider: ProjectAdProvider,
  name: string,
  projectId: string,
  projectName: string,
): BotAdAccount {
  return {
    projectId,
    projectName,
    account: {
      id: `${projectId}-${name}`,
      connectionId: "conn-1",
      provider,
      externalAccountId: "123-456-7890",
      name,
      currency: "EUR",
      timeZone: null,
      loginCustomerId: null,
      createdAt: new Date("2026-10-01"),
    },
  };
}

function renderSection(accounts: BotAdAccount[], projectId: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdAccountsSection accounts={accounts} botProjectId={projectId} />
    </NextIntlClientProvider>,
  );
}

describe("AdAccountsSection", () => {
  it("lists each account with its provider, Project and a link to the Ads page", () => {
    renderSection(
      [
        row(ProjectAdProvider.GOOGLE_ADS, "Acme Search", "p1", "Acme"),
        row(ProjectAdProvider.META_ADS, "Acme Social", "p2", "Beta Co"),
      ],
      null,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Acme Search")).toBeInTheDocument();
    expect(screen.getByText("Google Ads · Acme")).toBeInTheDocument();
    expect(screen.getByText("Acme Social")).toBeInTheDocument();
    expect(screen.getByText("Meta Ads · Beta Co")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Open\s*:\s*Acme Search$/ }),
    ).toHaveAttribute("href", "/ads?projectId=p1");
    expect(
      screen.getByRole("link", { name: /^Open\s*:\s*Acme Social$/ }),
    ).toHaveAttribute("href", "/ads?projectId=p2");
  });

  it("explains the empty state and links to the Ads page", () => {
    renderSection([], null);

    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Connect one on the Ads page" }),
    ).toHaveAttribute("href", "/ads");
  });

  it("links a shared bot's empty state to its Project", () => {
    renderSection([], "p9");

    expect(
      screen.getByRole("link", { name: "Connect one on the Ads page" }),
    ).toHaveAttribute("href", "/ads?projectId=p9");
  });
});
