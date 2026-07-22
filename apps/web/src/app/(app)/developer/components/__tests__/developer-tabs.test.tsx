import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

vi.mock("nuqs", () => ({
  useQueryState: () => ["coworkers", vi.fn()],
}));

import { DeveloperTabs } from "../developer-tabs";

const messages = {
  App: {
    Developer: {
      tabs: {
        oauthClients: "OAuth Clients",
        apiKeys: "API Keys",
        coworkers: "Coworkers",
        tasks: "Tasks",
        docs: "Documentation",
      },
    },
  },
};

describe("DeveloperTabs", () => {
  it("renders coworkers tab and content", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DeveloperTabs
          oauthClientsContent={<div>OAuth content</div>}
          apiKeysContent={<div>API keys content</div>}
          coworkersContent={<div>Coworkers content</div>}
          tasksContent={<div>Tasks content</div>}
          docsContent={<div>Docs content</div>}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "Coworkers" })).toBeInTheDocument();
    expect(screen.getByText("Coworkers content")).toBeInTheDocument();
  });

  it("renders tasks tab and content", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DeveloperTabs
          oauthClientsContent={<div>OAuth content</div>}
          apiKeysContent={<div>API keys content</div>}
          coworkersContent={<div>Coworkers content</div>}
          tasksContent={<div>Tasks content</div>}
          docsContent={<div>Docs content</div>}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
  });
});
