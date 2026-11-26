import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

import { AgentsSectionNav } from "./section-nav.client";

function renderNav() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AgentsSectionNav />
    </NextIntlClientProvider>,
  );
}

describe("AgentsSectionNav", () => {
  it("jumps to the section heading and focuses it", () => {
    const heading = document.createElement("h2");
    heading.id = "agents-marketplace";
    heading.tabIndex = -1;
    heading.scrollIntoView = vi.fn();
    document.body.append(heading);
    renderNav();

    const link = screen.getByRole("link", { name: "Marketplace" });
    const allowed = fireEvent.click(link);

    expect(allowed).toBe(false);
    expect(heading.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(heading);
    expect(window.location.hash).toBe("#agents-marketplace");
    heading.remove();
  });

  it("never lets the browser push a hash entry, even before a section exists", () => {
    window.history.replaceState(null, "", "/agents");
    const before = window.history.length;
    renderNav();

    const allowed = fireEvent.click(
      screen.getByRole("link", { name: "Coworkers" }),
    );

    expect(allowed).toBe(false);
    expect(window.history.length).toBe(before);
  });
});
