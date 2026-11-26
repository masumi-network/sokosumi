import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

import { AgentsSectionNav } from "./section-nav.client";

function renderNav() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AgentsSectionNav />
    </NextIntlClientProvider>,
  );
}

/**
 * One section as the page renders it: a stable wrapper with the jump id
 * around a Suspense fallback that later gives way to the content.
 */
function mountSection(id: string) {
  const target = document.createElement("div");
  target.id = id;
  target.tabIndex = -1;
  target.scrollIntoView = vi.fn();
  const fallback = document.createElement("section");
  fallback.setAttribute("data-agents-section-loading", "");
  target.append(fallback);
  document.body.append(target);
  return {
    target,
    /** Suspense resolves: the fallback is replaced inside the wrapper. */
    resolve: () =>
      act(() => {
        fallback.replaceWith(document.createElement("section"));
      }),
  };
}

describe("AgentsSectionNav", () => {
  afterEach(() => {
    for (const id of ["agents-coworkers", "agents-marketplace"]) {
      document.getElementById(id)?.remove();
    }
  });

  it("jumps to the section and focuses its stable wrapper", () => {
    const marketplace = mountSection("agents-marketplace");
    renderNav();

    const allowed = fireEvent.click(
      screen.getByRole("link", { name: "Marketplace" }),
    );

    expect(allowed).toBe(false);
    expect(marketplace.target.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(marketplace.target);
    expect(window.location.hash).toBe("#agents-marketplace");
  });

  it("keeps focus on the section when its content streams in after the jump", () => {
    const marketplace = mountSection("agents-marketplace");
    renderNav();
    fireEvent.click(screen.getByRole("link", { name: "Marketplace" }));

    marketplace.resolve();

    expect(document.activeElement).toBe(marketplace.target);
  });

  it("follows the last of repeated jumps while both sections still load", () => {
    const coworkers = mountSection("agents-coworkers");
    const marketplace = mountSection("agents-marketplace");
    renderNav();

    fireEvent.click(screen.getByRole("link", { name: "Marketplace" }));
    fireEvent.click(screen.getByRole("link", { name: "Coworkers" }));
    marketplace.resolve();
    coworkers.resolve();

    expect(document.activeElement).toBe(coworkers.target);
  });

  it("never takes focus back after the reader moves on and blurs", () => {
    const marketplace = mountSection("agents-marketplace");
    renderNav();
    fireEvent.click(screen.getByRole("link", { name: "Marketplace" }));

    const other = screen.getByRole("link", { name: "Coworkers" });
    other.focus();
    other.blur();
    expect(document.activeElement).toBe(document.body);
    marketplace.resolve();

    expect(document.activeElement).toBe(document.body);
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
