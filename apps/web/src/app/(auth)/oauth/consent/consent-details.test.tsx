import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConsentDetails } from "./consent-details";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const notices = [
  "apiAccessNotice",
  "mcpAccessNotice",
  "offlineAccessNotice",
  "unverifiedNotice",
];

function renderedNotices(): string[] {
  return notices.filter((key) => screen.queryByText(key) !== null);
}

describe("ConsentDetails", () => {
  const owned = {
    clientName: "Acme",
    redirectUri: "https://app.acme.test/callback",
    selfRegistered: false,
  };

  it("names the client and adds no notice for openid only", () => {
    render(<ConsentDetails {...owned} scope="openid" />);

    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("wantsAccess")).toBeInTheDocument();
    expect(renderedNotices()).toEqual([]);
    expect(screen.queryByText(/^redirectHost/)).not.toBeInTheDocument();
  });

  it("warns about full API access for sokosumi:api", () => {
    render(
      <ConsentDetails {...owned} scope="openid sokosumi:api offline_access" />,
    );

    expect(renderedNotices()).toEqual([
      "apiAccessNotice",
      "offlineAccessNotice",
    ]);
  });

  it("says the app uses Sokosumi through MCP for sokosumi:mcp", () => {
    render(<ConsentDetails {...owned} scope="openid sokosumi:mcp" />);

    expect(renderedNotices()).toEqual(["mcpAccessNotice"]);
  });

  describe("unverified app", () => {
    const selfRegistered = {
      ...owned,
      clientName: "Claude Code",
      redirectUri: "http://127.0.0.1:33418/callback?x=1",
      selfRegistered: true,
      scope: "openid sokosumi:mcp offline_access",
    };

    it("shows the note and the redirect host for a self-registered app", () => {
      render(<ConsentDetails {...selfRegistered} />);

      expect(renderedNotices()).toEqual([
        "mcpAccessNotice",
        "offlineAccessNotice",
        "unverifiedNotice",
      ]);
      expect(
        screen.getByText('redirectHost {"host":"127.0.0.1:33418"}'),
      ).toBeInTheDocument();
    });

    // Fail closed: until Core says the client has an owner, the person is told
    // the app is unverified.
    it("treats a client Core did not classify as unverified", () => {
      render(<ConsentDetails {...selfRegistered} selfRegistered={undefined} />);

      expect(screen.getByText("unverifiedNotice")).toBeInTheDocument();
    });

    it("names a custom-scheme redirect by its scheme", () => {
      render(
        <ConsentDetails
          {...selfRegistered}
          redirectUri="com.example.agent:/oauth/callback"
        />,
      );

      expect(
        screen.getByText('redirectHost {"host":"com.example.agent"}'),
      ).toBeInTheDocument();
    });

    // The browser hands `com.attacker://…` to the app that claims the scheme,
    // whatever host follows it.
    it("keeps the scheme of a custom-scheme redirect that names a web host", () => {
      render(
        <ConsentDetails
          {...selfRegistered}
          redirectUri="com.attacker://claude.ai/cb"
        />,
      );

      expect(
        screen.getByText('redirectHost {"host":"com.attacker://claude.ai"}'),
      ).toBeInTheDocument();
    });

    it("keeps the scheme of a plain-http redirect off this computer", () => {
      render(
        <ConsentDetails
          {...selfRegistered}
          redirectUri="http://agents.example/cb"
        />,
      );

      expect(
        screen.getByText('redirectHost {"host":"http://agents.example"}'),
      ).toBeInTheDocument();
    });

    it.each([
      ["http://localhost:3000/cb", "localhost:3000"],
      ["http://[::1]:3000/cb", "[::1]:3000"],
    ])("names the loopback redirect %s by its host", (redirectUri, host) => {
      render(<ConsentDetails {...selfRegistered} redirectUri={redirectUri} />);

      expect(
        screen.getByText(`redirectHost ${JSON.stringify({ host })}`),
      ).toBeInTheDocument();
    });

    it("names an https redirect by its host", () => {
      render(
        <ConsentDetails
          {...selfRegistered}
          redirectUri="https://agents.example:8443/cb"
        />,
      );

      expect(
        screen.getByText('redirectHost {"host":"agents.example:8443"}'),
      ).toBeInTheDocument();
    });

    it("keeps the note but drops the host line for an unreadable redirect", () => {
      render(<ConsentDetails {...selfRegistered} redirectUri="not a url" />);

      expect(screen.getByText("unverifiedNotice")).toBeInTheDocument();
      expect(screen.queryByText(/^redirectHost/)).not.toBeInTheDocument();
    });
  });
});
