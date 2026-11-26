import { act, fireEvent, render, screen } from "@testing-library/react";
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

  /** A section still streaming: its fallback heading carries the id. */
  function mountLoadingSection(id: string) {
    const section = document.createElement("section");
    section.setAttribute("data-agents-section-loading", "");
    const fallback = document.createElement("h2");
    fallback.id = id;
    fallback.tabIndex = -1;
    fallback.scrollIntoView = vi.fn();
    section.append(fallback);
    document.body.append(section);
    return { section, fallback };
  }

  /** Suspense resolves: the fallback section gives way to the real one. */
  async function resolveSection(loading: HTMLElement, id: string) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.id = id;
    heading.tabIndex = -1;
    section.append(heading);
    await act(async () => {
      loading.replaceWith(section);
      await Promise.resolve();
    });
    return { section, heading };
  }

  it("keeps keyboard focus on the section when it streams in after the jump", async () => {
    const loading = mountLoadingSection("agents-marketplace");
    renderNav();
    const link = screen.getByRole("link", { name: "Marketplace" });
    link.focus();

    fireEvent.click(link);
    expect(document.activeElement).toBe(loading.fallback);

    const { section, heading } = await resolveSection(
      loading.section,
      "agents-marketplace",
    );

    expect(document.activeElement).toBe(heading);
    section.remove();
  });

  it("leaves focus alone when the reader moved on before the section arrived", async () => {
    const loading = mountLoadingSection("agents-marketplace");
    renderNav();

    fireEvent.click(screen.getByRole("link", { name: "Marketplace" }));
    const coworkers = screen.getByRole("link", { name: "Coworkers" });
    coworkers.focus();

    const { section } = await resolveSection(
      loading.section,
      "agents-marketplace",
    );

    expect(document.activeElement).toBe(coworkers);
    section.remove();
  });
});
