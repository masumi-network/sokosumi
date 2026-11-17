import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/developer/api-keys" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { DeveloperSectionsHeader } from "./developer-sections-header";

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("DeveloperSectionsHeader", () => {
  beforeEach(() => {
    pathname.current = "/developer/api-keys";
  });

  it("names the area and marks the current section", async () => {
    await act(async () => {
      render(<DeveloperSectionsHeader showVendors={Promise.resolve(false)} />);
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "title" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "sectionsLabel" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "tabs.apiKeys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "tabs.oauthClients" }),
    ).not.toHaveAttribute("aria-current");
    expect(
      screen.queryByRole("link", { name: "tabs.vendors" }),
    ).not.toBeInTheDocument();
  });

  // A slow vendor lookup must not remount the other links: a keyboard user
  // focused on one would lose their place.
  it("keeps the other links and focus while Vendors resolves", async () => {
    const access = deferred();
    await act(async () => {
      render(<DeveloperSectionsHeader showVendors={access.promise} />);
    });
    const oauth = screen.getByRole("link", { name: "tabs.oauthClients" });
    oauth.focus();

    await act(async () => {
      access.resolve(true);
    });

    expect(screen.getByRole("link", { name: "tabs.vendors" })).toHaveAttribute(
      "href",
      "/developer/vendors",
    );
    expect(screen.getByRole("link", { name: "tabs.oauthClients" })).toBe(oauth);
    expect(document.activeElement).toBe(oauth);
  });

  // The vendor pages gate access themselves; the row is already there while
  // the lookup runs, so the page does not jump.
  it("shows the row on Vendors before the lookup resolves", async () => {
    pathname.current = "/developer/vendors";
    await act(async () => {
      render(<DeveloperSectionsHeader showVendors={deferred().promise} />);
    });
    expect(
      screen.getByRole("navigation", { name: "sectionsLabel" }),
    ).toBeInTheDocument();
  });

  // Detail pages keep their own header and Back link.
  it("renders nothing below a section", async () => {
    pathname.current = "/developer/coworkers/cw_1";
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <DeveloperSectionsHeader showVendors={Promise.resolve(true)} />,
      ));
    });
    expect(container).toBeEmptyDOMElement();
  });
});
