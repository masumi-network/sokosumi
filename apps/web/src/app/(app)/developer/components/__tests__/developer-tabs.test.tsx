import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setTabMock = vi.fn();
let activeTab = "coworkers";

vi.mock("nuqs", () => ({
  useQueryState: () => [activeTab, setTabMock],
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
        vendors: "Vendors",
        docs: "Documentation",
      },
    },
  },
};

const baseProps = {
  oauthClientsContent: <div>OAuth content</div>,
  apiKeysContent: <div>API keys content</div>,
  coworkersContent: <div>Coworkers content</div>,
  tasksContent: <div>Tasks content</div>,
  vendorsContent: <div>Vendors content</div>,
  docsContent: <div>Docs content</div>,
};

describe("DeveloperTabs", () => {
  beforeEach(() => {
    activeTab = "coworkers";
    setTabMock.mockClear();
  });

  it("renders coworkers tab and content", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DeveloperTabs showVendorsTab={false} {...baseProps} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "Coworkers" })).toBeInTheDocument();
    expect(screen.getByText("Coworkers content")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Vendors" }),
    ).not.toBeInTheDocument();
  });

  it("renders tasks tab and content", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DeveloperTabs showVendorsTab={false} {...baseProps} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
  });

  it("renders vendors tab only when enabled", () => {
    activeTab = "vendors";

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DeveloperTabs showVendorsTab {...baseProps} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "Vendors" })).toBeInTheDocument();
    expect(screen.getByText("Vendors content")).toBeInTheDocument();
  });

  it("falls back when vendors tab is disabled", () => {
    activeTab = "vendors";

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DeveloperTabs showVendorsTab={false} {...baseProps} />
      </NextIntlClientProvider>,
    );

    expect(setTabMock).toHaveBeenCalledWith("oauth-clients");
    expect(screen.getByText("OAuth content")).toBeInTheDocument();
  });
});
