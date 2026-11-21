import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";

import CatchUpLayout from "./layout";

const { segment } = vi.hoisted(() => ({
  segment: { current: null as string | null },
}));

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => segment.current,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function renderLayout(child: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CatchUpLayout>{child}</CatchUpLayout>
    </NextIntlClientProvider>,
  );
}

describe("CatchUpLayout", () => {
  it("keeps the tabs above a tab that is still loading", () => {
    segment.current = "decisions";
    renderLayout(<div data-testid="chat-unread-view-loading" />);

    expect(
      screen.getByRole("navigation", { name: "Catch up sections" }),
    ).toBeTruthy();
    expect(screen.getByTestId("chat-unread-view-loading")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Decisions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks Overview on the Catch up page itself", () => {
    segment.current = null;
    renderLayout(null);

    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Saved" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
