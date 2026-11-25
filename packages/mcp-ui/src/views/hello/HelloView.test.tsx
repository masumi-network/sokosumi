import type { App } from "@modelcontextprotocol/ext-apps";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelloView } from "./HelloView.tsx";

const data = {
  name: "Ada",
  createdAt: "2026-11-25T12:00:00Z",
  url: "https://app.sokosumi.com/tasks/SOK-1",
};

function renderHello(webBaseUrl?: string) {
  const openLink = vi.fn().mockResolvedValue({});
  const app = { openLink } as unknown as App;
  render(
    <HelloView
      data={data}
      context={{ app, locale: "en-US", timeZone: "UTC", webBaseUrl }}
    />,
  );
  return openLink;
}

afterEach(cleanup);

describe("HelloView", () => {
  it("shows the name and the date in the host's locale and time zone", () => {
    renderHello();

    expect(screen.getByRole("heading", { name: "Hello, Ada" })).toBeTruthy();
    expect(
      screen.getByText(/Created Nov 25, 2026, 12:00\sPM/).textContent,
    ).toBeTruthy();
  });

  it("opens the link through the host when it is under the Web base URL", () => {
    const openLink = renderHello("https://app.sokosumi.com");

    fireEvent.click(screen.getByRole("button", { name: "Review in Sokosumi" }));

    expect(openLink).toHaveBeenCalledWith({ url: data.url });
  });

  it("hides the button when the link is not under the Web base URL", () => {
    renderHello("https://example.com");

    expect(screen.queryByRole("button")).toBeNull();
  });
});
