import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  cmoSitePageName,
  cmoSitePageNote,
  cmoSitePagesDue,
} from "./cmo-site-pages.service";

describe("cmoSitePagesDue", () => {
  const read = (startedAt: string, queue: string[] = [], pages = 1) => ({
    startedAt,
    queue,
    pages: Array.from({ length: pages }, () => ({
      url: "https://acme.io/",
      title: "Acme",
      summary: "",
      facts: [],
      name: "home",
      readAt: startedAt,
      desktopFileId: null,
      phoneFileId: null,
      noteFileId: null,
    })),
  });

  it("reads a site never read, and goes on with one left half read", () => {
    const now = new Date("2026-11-22T10:00:00Z");
    expect(cmoSitePagesDue(null, now)).toBe(true);
    expect(
      cmoSitePagesDue(read("2026-11-22T09:00:00Z", ["https://acme.io/a"]), now),
    ).toBe(true);
  });

  it("reads the site again from the 14th, before the 15th's Brand Brain refresh", () => {
    const index = read("2026-11-02T10:00:00Z");
    expect(cmoSitePagesDue(index, new Date("2026-11-13T23:00:00Z"))).toBe(
      false,
    );
    expect(cmoSitePagesDue(index, new Date("2026-11-14T00:10:00Z"))).toBe(true);
  });

  it("does not read a site again within a week of the last reading", () => {
    expect(
      cmoSitePagesDue(
        read("2026-11-10T10:00:00Z"),
        new Date("2026-11-14T10:00:00Z"),
      ),
    ).toBe(false);
  });

  it("tries a reading that kept no page again after six hours", () => {
    const empty = read("2026-11-22T03:00:00Z", [], 0);
    expect(cmoSitePagesDue(empty, new Date("2026-11-22T08:00:00Z"))).toBe(
      false,
    );
    expect(cmoSitePagesDue(empty, new Date("2026-11-22T09:30:00Z"))).toBe(true);
  });
});

describe("cmoSitePageName", () => {
  it("names a page by its path, home for the homepage, never twice", () => {
    expect(cmoSitePageName("https://acme.io/", new Set())).toBe("home");
    expect(cmoSitePageName("https://acme.io/blog/Launch", new Set())).toBe(
      "blog-launch",
    );
    expect(
      cmoSitePageName("https://acme.io/blog/launch", new Set(["blog-launch"])),
    ).toBe("blog-launch-2");
  });
});

describe("cmoSitePageNote", () => {
  it("leads with the address, summary and facts, then the page's words", () => {
    const note = cmoSitePageNote(
      {
        url: "https://acme.io/pricing",
        title: "Plans",
        summary: "Three plans for small teams.",
        facts: ["Starter $9 a month", "Pro $29 a month"],
        desktopFileId: "f-desk",
        phoneFileId: null,
      },
      "Plans\n\n\n\nStarter $9",
    );
    expect(note).toBe(
      [
        "# Plans",
        "",
        "https://acme.io/pricing",
        "",
        "Three plans for small teams.",
        "",
        "- Starter $9 a month",
        "- Pro $29 a month",
        "",
        "Screenshots (brand pictures for visualFileIds): desktop f-desk",
        "",
        "## The page's words",
        "",
        "Plans",
        "",
        "Starter $9",
      ].join("\n"),
    );
  });
});
